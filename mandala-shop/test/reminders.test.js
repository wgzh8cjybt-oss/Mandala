// Напоминания «Возвращение к своему пути»: настройки, снимок, планировщик (время, пояс, тихие часы, частота),
// защита от дублей, блокировка бота, лимиты Telegram, команды /remind и /stop, библиотека текстов.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/db.js';
import { TEXTS } from '../src/reminder_texts.js';
import { composeMessage, localClock, remindersView } from '../src/reminders.js';
import { ADMIN_ID, startServer } from './helpers.js';

let t;
before(async () => { t = await startServer({ env: { REMIND_GAP_MS: '0', STATS_TZ: 'UTC' } }); });
after(async () => { await t.close(); });
beforeEach(() => t.clock.advance(61000));

let n = 0;
const newUser = () => 9100 + (++n);
/** Время задаём по UTC; 2026-11-09 — понедельник. */
const at = (d, h = 0, m = 0) => Date.UTC(2026, 10, d, h, m, 0);
const setNow = ms => { t.clock.t = ms; };
const tick = () => t.app.jobs.reminders();
const sentTo = u => t.mock.messagesTo(u);
const setSeen = (u, ms) => run(t.db, 'UPDATE users SET last_seen_at = ? WHERE tg_id = ?', ms, u);
const logRows = u => t.q('SELECT * FROM reminder_log WHERE tg_id = ? ORDER BY id', u);

/** Включает напоминания (вход в приложение происходит «сейчас»), затем отодвигает «последний заход» на daysAgo суток назад. */
async function enable(u, patch = {}, o = {}) {
  const r = await t.as(u).put('/api/reminders', { enabled: true, tz: 'UTC', quiet: null, weekly: { on: false }, inactivity: { on: false }, ...patch });
  assert.equal(r.status, 200, r.text);
  if (o.snapshot) assert.equal((await t.as(u).put('/api/reminders/snapshot', o.snapshot)).status, 200);
  setSeen(u, o.seen ?? t.clock.t - 3 * 86400e3);
  return r.json.reminders;
}

test('по умолчанию напоминания выключены; GET отдаёт настройки по умолчанию и допустимые значения', async () => {
  const r = await t.as(newUser()).get('/api/reminders');
  assert.equal(r.status, 200);
  const x = r.json.reminders;
  assert.equal(x.enabled, false);
  assert.deepEqual(x.settings.daily, { on: true, time: '09:00' });
  assert.equal(x.settings.style, 'warm'); assert.equal(x.settings.freq, 'daily');
  assert.deepEqual(x.options.inactivity_days, [2, 3, 5, 7, 14]);
  assert.equal(x.next_at, null);
  assert.equal((await t.req('GET', '/api/reminders')).status, 401, 'без входа через Telegram нельзя');
});

test('настройки проверяются: время, день, частота, стиль, часовой пояс, типы', async () => {
  const u = newUser(), put = b => t.as(u).put('/api/reminders', b);
  for (const body of [{ daily: { time: '25:00' } }, { daily: { time: '9:00' } }, { weekly: { day: 0 } }, { weekly: { day: 8 } }, { freq: 'hourly' }, { style: 'angry' },
    { tz: 'Mars/Base' }, { tz: 'x'.repeat(80) }, { inactivity: { days: 4 } }, { enabled: 'yes' }, { quiet: { from: '99:99' } }, { daily: 5 }, { write_access: 1 }]) {
    const r = await put(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.error.code, 'bad_request');
  }
  const ok = await put({ enabled: true, tz: 'Asia/Tokyo', style: 'focus', freq: 'weekdays', daily: { time: '07:30' }, weekly: { day: 5, time: '19:00' }, inactivity: { days: 7 } });
  assert.equal(ok.status, 200);
  const s = ok.json.reminders.settings;
  assert.equal(s.tz, 'Asia/Tokyo'); assert.equal(s.style, 'focus'); assert.equal(s.freq, 'weekdays'); assert.equal(s.daily.time, '07:30');
  assert.deepEqual(s.weekly, { on: true, day: 5, time: '19:00' }); assert.equal(s.inactivity.days, 7);
  assert.ok(ok.json.reminders.next_at > t.clock.t, 'есть примерное время следующего напоминания');
  const part = await put({ style: 'calm' });   // частичное изменение не сбрасывает остальное
  assert.equal(part.json.reminders.settings.style, 'calm'); assert.equal(part.json.reminders.settings.daily.time, '07:30'); assert.equal(part.json.reminders.enabled, true);
});

test('снимок цели: без включённых напоминаний не сохраняется; проверяется и очищается; при выключении удаляется', async () => {
  const u = newUser();
  const off = await t.as(u).put('/api/reminders/snapshot', { goal: 'Бизнес' });
  assert.equal(off.status, 409); assert.equal(off.json.error.code, 'reminders_disabled');
  assert.equal(t.q('SELECT * FROM reminder_snapshot WHERE tg_id = ?', u).length, 0);
  await enable(u);
  for (const body of [[], { goal: 5 }, { dirs: 'x' }, { dirs: Array.from({ length: 9 }, () => ({ n: 'a', p: 1 })) }, { dirs: [5] }, { done: -1 }, { done: 1.5 }, { week: 3 }, { next: [1, 2, 3, 4].map(i => ({ t: 'x' + i })) }, { last_active: 'вчера' }]) {
    assert.equal((await t.as(u).put('/api/reminders/snapshot', body)).status, 400, JSON.stringify(body));
  }
  const ok = await t.as(u).put('/api/reminders/snapshot', { goal: ' Создать\nсобственный   бизнес ' + 'я'.repeat(200), dirs: [{ n: 'Здоровье', p: 40 }, { n: '', p: 5 }], done: 9, total: 5, next: [{ t: 'Позвонить', d: '2026-11-30' }, { t: 'Читать', d: 'завтра' }], last_active: t.clock.t + 1e9 });
  assert.equal(ok.status, 200);
  const row = t.q1('SELECT * FROM reminder_snapshot WHERE tg_id = ?', u), snap = JSON.parse(row.snapshot_json);
  assert.ok(snap.goal.startsWith('Создать собственный бизнес я'), 'пробелы и переводы строк схлопнуты');
  assert.equal(Array.from(snap.goal).length, 120, 'цель обрезана до 120 символов');
  assert.deepEqual(snap.dirs, [{ n: 'Здоровье', p: 40 }], 'пустые направления отброшены');
  assert.equal(snap.done, 5, 'done не больше total');
  assert.deepEqual(snap.next, [{ t: 'Позвонить', d: '2026-11-30' }, { t: 'Читать', d: null }]);
  assert.ok(row.last_active_at <= t.clock.t, 'время активности из будущего обрезано');
  await t.as(u).put('/api/reminders', { enabled: false });
  assert.equal(t.q('SELECT * FROM reminder_snapshot WHERE tg_id = ?', u).length, 0, 'без согласия личных данных на сервере нет');
});

test('ежедневное: не раньше назначенного времени, один раз в день, на следующий день снова; сообщение персональное, с /stop и кнопкой', async () => {
  const u = newUser();
  setNow(at(10, 8, 0));
  await enable(u, { daily: { time: '09:00' } }, { snapshot: { goal: 'Создать <b>свой</b> бизнес & семью', dirs: [{ n: 'Финансы', p: 10 }], next: [{ t: 'Составить бизнес-план' }] } });
  setNow(at(10, 8, 30)); await tick();
  assert.equal(sentTo(u).length, 0, 'до 09:00 тихо');
  setNow(at(10, 9, 5)); const r1 = await tick();
  assert.equal(r1.sent, 1); assert.equal(sentTo(u).length, 1);
  const m = sentTo(u)[0];
  assert.ok(m.text.includes('/stop'), 'есть способ отключить');
  assert.ok(m.text.includes('&lt;b&gt;свой&lt;/b&gt; бизнес &amp; семью') || !m.text.includes('Создать'), 'пользовательский текст экранирован');
  assert.ok(!m.text.includes('<b>свой</b>'));
  assert.equal(m.extra.reply_markup.inline_keyboard[0][0].web_app.url, 'https://shop.test/');
  setNow(at(10, 9, 10)); await tick(); setNow(at(10, 12, 0)); await tick();
  assert.equal(sentTo(u).length, 1, 'повторно в тот же день не отправляется');
  setNow(at(11, 9, 0)); await tick();
  assert.equal(sentTo(u).length, 2, 'на следующий день — снова');
  const rows = logRows(u);
  assert.deepEqual(rows.map(r => [r.kind, r.status, r.slot]), [['daily', 'sent', 'd:2026-11-10'], ['daily', 'sent', 'd:2026-11-11']]);
  assert.ok(rows.every(r => r.text_id && !('text' in r)), 'в журнале id текста, а не сам текст');
  assert.notEqual(rows[0].text_id, rows[1].text_id, 'подряд один и тот же текст не повторяется');
});

test('параллельные и повторные проходы не создают дублей', async () => {
  const u = newUser();
  setNow(at(10, 10, 0));
  await enable(u, { daily: { time: '09:00' } });
  await Promise.all([tick(), tick(), tick()]);
  await tick();
  assert.equal(sentTo(u).length, 1);
  assert.equal(logRows(u).length, 1);
});

test('часовой пояс: время считается по местным часам пользователя', async () => {
  const tokyo = newUser(), ny = newUser();
  setNow(at(10, 0, 0));
  await enable(tokyo, { tz: 'Asia/Tokyo', daily: { time: '09:00' } });
  await enable(ny, { tz: 'America/New_York', daily: { time: '09:00' } });
  assert.equal(localClock(at(10, 0, 0), 'Asia/Tokyo').min, 9 * 60);
  setNow(at(10, 0, 5)); await tick();      // в Токио 09:05, в Нью-Йорке 19:05 предыдущего дня
  assert.equal(sentTo(tokyo).length, 1); assert.equal(sentTo(ny).length, 0);
  setNow(at(10, 14, 5)); await tick();     // в Нью-Йорке 09:05 (ноябрь, UTC-5)
  assert.equal(sentTo(ny).length, 1);
});

test('тихие часы: напоминание откладывается до их конца (до 3 часов), иначе пропускается; опоздавшее больше 3 часов не отправляется', async () => {
  const early = newUser(), night = newUser(), late = newUser();
  setNow(at(10, 2, 0));
  await enable(early, { daily: { time: '07:00' }, quiet: { from: '22:00', to: '08:00' } });
  await enable(night, { daily: { time: '03:00' }, quiet: { from: '22:00', to: '08:00' } });
  await enable(late, { daily: { time: '09:00' } });
  setNow(at(10, 3, 5)); await tick();
  setNow(at(10, 7, 30)); await tick();
  assert.equal(sentTo(early).length, 0, 'в тихие часы не пишем');
  setNow(at(10, 8, 0)); await tick();
  assert.equal(sentTo(early).length, 1, 'в 08:00 тихие часы закончились');
  assert.equal(sentTo(night).length, 0);
  assert.deepEqual(logRows(night).map(r => [r.status, r.error]), [['skipped', 'quiet']], 'сдвиг больше 3 часов — пропуск, а не ночное сообщение');
  setNow(at(10, 12, 30)); await tick();   // сервер «проснулся» через 3,5 часа после 09:00
  assert.equal(sentTo(late).length, 0);
  assert.deepEqual(logRows(late).map(r => [r.status, r.error]), [['skipped', 'late']]);
});

test('частота: по будням, через день, только итоги недели', async () => {
  const wd = newUser(), e2 = newUser(), wo = newUser();
  setNow(at(13, 7, 0));                    // пятница, 2026-11-13
  await enable(wd, { freq: 'weekdays' }); await enable(e2, { freq: 'every2' }); await enable(wo, { freq: 'weekly_only' });
  for (const day of [13, 14, 15, 16, 17]) { setNow(at(day, 9, 5)); await tick(); }
  // пт 13, сб 14, вс 15, пн 16, вт 17
  assert.deepEqual(logRows(wd).map(r => r.slot), ['d:2026-11-13', 'd:2026-11-16', 'd:2026-11-17'], 'по будням: нет субботы и воскресенья');
  assert.deepEqual(logRows(e2).map(r => r.slot), ['d:2026-11-13', 'd:2026-11-15', 'd:2026-11-17'], 'через день');
  assert.equal(sentTo(wo).length, 0, 'weekly_only: ежедневных нет');
});

test('если пользователь уже заходил сегодня, ежедневное не отправляется', async () => {
  const u = newUser();
  setNow(at(10, 8, 0));
  await enable(u, {}, { seen: at(10, 8, 30) });
  setNow(at(10, 9, 5)); await tick();
  assert.equal(sentTo(u).length, 0);
  setNow(at(11, 9, 5)); await tick();
  assert.equal(sentTo(u).length, 1, 'на следующий день, если не заходил, напоминание приходит');
});

test('недельные итоги: в назначенный день заменяют ежедневное, показывают цифры без упрёков', async () => {
  const u = newUser(), z = newUser();
  setNow(at(15, 10, 0));   // воскресенье
  await enable(u, { weekly: { on: true, day: 7, time: '18:00' } }, { snapshot: { goal: 'Выучить язык', done: 12, total: 81, week: { done: 4, planned: 6 } } });
  await enable(z, { weekly: { on: true, day: 7, time: '18:00' } }, { snapshot: { goal: 'Выучить язык', week: { done: 0, planned: 5 } } });
  setNow(at(15, 9, 5)); await tick();
  assert.equal(sentTo(u).length, 0, 'в день итогов ежедневного нет, ждём 18:00');
  setNow(at(15, 18, 5)); await tick();
  assert.equal(sentTo(u).length, 1);
  assert.ok(sentTo(u)[0].text.includes('Итоги недели: выполнено 4 из 6.'));
  assert.ok(sentTo(u)[0].text.includes('Общий путь: выполнено 12 из 81 (15%).'));
  assert.ok(sentTo(z)[0].text.includes('запланировано шагов: 5'), 'ноль выполненных — без «0 из 5»');
  assert.ok(!/0 из 5/.test(sentTo(z)[0].text));
  assert.equal(logRows(u)[0].kind, 'weekly');
});

test('возвращение после перерыва: через N дней, не чаще раза в 7 дней, не больше 3 подряд; после возвращения счётчик сбрасывается', async () => {
  const u = newUser();
  setNow(at(10, 10, 0));
  await enable(u, { inactivity: { on: true, days: 5 }, daily: { on: false } }, { seen: at(10, 10, 0) });
  setNow(at(14, 10, 0)); await tick();
  assert.equal(sentTo(u).length, 0, 'прошло меньше 5 дней');
  setNow(at(15, 10, 0)); await tick();
  assert.equal(sentTo(u).length, 1); assert.equal(logRows(u)[0].kind, 'inactivity');
  assert.ok(!/дн(ей|я)|не заходил|пропустил|давно/i.test(sentTo(u)[0].text), 'без счёта дней и упрёков');
  for (const d of [16, 17, 20, 21]) { setNow(at(d, 10, 0)); await tick(); }
  assert.equal(sentTo(u).length, 1, 'до 7 дней не повторяется');
  setNow(at(22, 10, 0)); await tick();
  setNow(at(29, 10, 0)); await tick();
  assert.equal(sentTo(u).length, 3);
  setNow(at(36, 10, 0)); await tick();
  assert.equal(sentTo(u).length, 3, 'больше трёх подряд не шлём');
  setSeen(u, at(36, 12, 0));                                  // человек вернулся
  setNow(at(42, 10, 0)); await tick();                        // прошло 5+ дней после возвращения
  assert.equal(sentTo(u).length, 4, 'после возвращения всё работает снова');
});

test('пауза: после 7 сообщений без возвращения в приложение больше ничего не отправляется', async () => {
  const u = newUser();
  setNow(at(10, 8, 0));
  await enable(u, { inactivity: { on: false } }, { seen: at(9, 0, 0) });
  for (let d = 10; d <= 20; d++) { setNow(at(d, 9, 5)); await tick(); }
  assert.equal(sentTo(u).length, 7);
  assert.equal(remindersView(t.ctx, u).paused.reason, 'away', 'пользователь увидит, что напоминания на паузе, пока он не вернётся');
  setSeen(u, at(20, 9, 30)); setNow(at(21, 9, 5)); await tick();
  assert.equal(sentTo(u).length, 8, 'после захода в приложение снова работает');
});

test('бот заблокирован: пометка «недоступен», без повторных попыток; /start снимает пометку', async () => {
  const u = newUser();
  setNow(at(10, 8, 0));
  await enable(u);
  t.mock.blockedChats.add(u);
  setNow(at(10, 9, 5)); const r = await tick();
  assert.equal(r.blocked, 1);
  const st = t.q1('SELECT * FROM reminder_settings WHERE tg_id = ?', u);
  assert.equal(st.chat_state, 'blocked');
  assert.deepEqual(logRows(u).map(x => x.status), ['blocked']);
  const calls = t.mock.callsOf('sendMessage').length;
  setNow(at(10, 9, 30)); await tick(); setNow(at(11, 9, 5)); await tick();
  assert.equal(t.mock.callsOf('sendMessage').length, calls, 'пока не разблокирован, бот не пытается писать');
  assert.equal((await t.as(u).get('/api/reminders')).json.reminders.chat.state, 'blocked');
  t.mock.blockedChats.delete(u);
  await t.webhook({ update_id: t.nextUpdateId(), message: { message_id: 1, date: 1, chat: { id: u, type: 'private' }, from: { id: u, first_name: 'U' }, text: '/start' } });
  assert.equal(t.q1('SELECT chat_state FROM reminder_settings WHERE tg_id = ?', u).chat_state, 'ok');
  setNow(at(12, 9, 5)); await tick();
  assert.equal(sentTo(u).length >= 1, true, 'после /start сообщения идут снова');
});

test('лимит Telegram (429): пауза на retry_after, затем отправка без дублей; сетевые ошибки — до 3 попыток', async () => {
  const a = newUser(), b = newUser();
  setNow(at(10, 8, 0));
  await enable(a); await enable(b);
  t.mock.failNext('sendMessage', { code: 429, description: 'Too Many Requests: retry after 30', parameters: { retry_after: 30 } });
  setNow(at(10, 9, 5)); const r1 = await tick();
  assert.equal(r1.rate_limited, true);
  assert.equal(sentTo(a).length + sentTo(b).length, 0);
  setNow(at(10, 9, 5) + 10000); const r2 = await tick();
  assert.ok(r2.paused_until, 'во время паузы запросы не уходят');
  setNow(at(10, 9, 5) + 40000); await tick();                      // пауза закончилась
  setNow(at(10, 9, 5) + 40000 + 6 * 60e3); await tick();           // повтор неудачной попытки
  assert.equal(sentTo(a).length, 1); assert.equal(sentTo(b).length, 1);
  await t.as(a).put('/api/reminders', { enabled: false }); await t.as(b).put('/api/reminders', { enabled: false });
  const c = newUser();
  setNow(at(11, 8, 0)); await enable(c);
  t.mock.failNext('sendMessage', { code: 502, description: 'Bad Gateway', times: 3 });
  for (let i = 0; i < 5; i++) { setNow(at(11, 9, 5) + i * 6 * 60e3); await tick(); }
  const row = logRows(c).find(x => x.kind === 'daily');
  assert.equal(row.attempts, 3); assert.equal(row.status, 'failed', 'после 3 неудач слот закрыт, сообщение не «догоняет» бесконечно');
});

test('команды бота: /remind показывает состояние, /stop выключает и удаляет данные', async () => {
  const u = newUser();
  const cmd = async text => { await t.webhook({ update_id: t.nextUpdateId(), message: { message_id: 1, date: 1, chat: { id: u, type: 'private' }, from: { id: u, first_name: 'U' }, text } }); return sentTo(u).at(-1).text; };
  assert.ok((await cmd('/remind')).includes('Напоминания выключены'));
  await enable(u, { daily: { time: '08:30' }, style: 'calm' }, { snapshot: { goal: 'Тест' } });
  const info = await cmd('/remind');
  assert.ok(info.includes('Напоминания включены') && info.includes('08:30') && info.includes('спокойный') && info.includes('/stop'));
  assert.ok((await cmd('/stop')).includes('Напоминания выключены'));
  assert.equal(t.q1('SELECT enabled FROM reminder_settings WHERE tg_id = ?', u).enabled, 0);
  assert.equal(t.q('SELECT * FROM reminder_snapshot WHERE tg_id = ?', u).length, 0, 'данные удалены');
  assert.ok((await cmd('/stop')).includes('и так выключены'));
  assert.ok((await cmd('/help')).includes('/remind'));
});

test('пробное сообщение: отправляется, проверяет доступность бота, ограничено 3 в час', async () => {
  const u = newUser();
  assert.equal((await t.as(u).post('/api/reminders/test')).status, 409);
  await enable(u, {}, { snapshot: { goal: 'Своя цель' } });
  const ok = await t.as(u).post('/api/reminders/test');
  assert.equal(ok.status, 200); assert.equal(ok.json.reminders.chat.state, 'ok');
  assert.ok(sentTo(u).at(-1).text.startsWith('<b>Пробное напоминание</b>'));
  assert.equal(logRows(u).at(-1).kind, 'test');
  await t.as(u).post('/api/reminders/test'); await t.as(u).post('/api/reminders/test');
  assert.equal((await t.as(u).post('/api/reminders/test')).status, 429);
  const v = newUser();
  await enable(v); t.mock.blockedChats.add(v);
  const bl = await t.as(v).post('/api/reminders/test');
  assert.equal(bl.status, 409); assert.equal(bl.json.error.code, 'bot_unreachable');
  assert.equal((await t.as(v).get('/api/reminders')).json.reminders.chat.state, 'blocked');
  await t.as(v).put('/api/reminders', { enabled: false }); await t.as(v).put('/api/reminders', { enabled: true });
  assert.equal(t.q1('SELECT chat_state FROM reminder_settings WHERE tg_id = ?', v).chat_state, 'unknown', 'повторное включение заново проверяет доступность');
});

test('DELETE полностью удаляет настройки, снимок и журнал; админ видит сводку без текстов', async () => {
  const u = newUser();
  setNow(at(10, 8, 0));
  await enable(u, {}, { snapshot: { goal: 'Секретная цель' } });
  setNow(at(10, 9, 5)); await tick();
  const adm = await t.admin.get('/api/admin/reminders');
  assert.equal(adm.status, 200);
  assert.ok(adm.json.enabled_users >= 1 && adm.json.sent_24h >= 1);
  assert.ok(!JSON.stringify(adm.json).includes('Секретная цель'), 'личные данные не попадают в админку');
  assert.equal((await t.as(u).get('/api/admin/reminders')).status, 403);
  const d = await t.as(u).del('/api/reminders');
  assert.equal(d.status, 200); assert.equal(d.json.reminders.enabled, false);
  for (const tbl of ['reminder_settings', 'reminder_snapshot', 'reminder_log']) assert.equal(t.q(`SELECT * FROM ${tbl} WHERE tg_id = ?`, u).length, 0, tbl);
});

test('библиотека текстов: не меньше 60, три стиля × три вида, без упрёков, без эмодзи и HTML, подстановки согласованы', () => {
  assert.ok(TEXTS.length >= 60, 'текстов: ' + TEXTS.length);
  assert.equal(new Set(TEXTS.map(x => x.id)).size, TEXTS.length, 'id уникальны');
  for (const k of ['daily', 'weekly', 'inactivity']) for (const s of ['warm', 'calm', 'focus']) {
    const list = TEXTS.filter(x => x.k === k && x.s === s);
    assert.ok(list.length >= 6, `${k}/${s}: ${list.length}`);
    assert.ok(list.some(x => !x.needs.length), `${k}/${s}: есть универсальный текст`);
  }
  const forbidden = /пропустил|пропущен|забыл[аи]?(?![а-я])|ленив|стыд|вина|виноват|провал|неудач|слабак|бездейств|потерял|упустил/iu;
  for (const x of TEXTS) {
    assert.ok(!forbidden.test(x.t), `упрёк в тексте ${x.id}: ${x.t}`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(x.t), 'эмодзи в ' + x.id);
    assert.ok(!/[<>&]/.test(x.t), 'HTML-символы в ' + x.id);
    assert.ok(x.t.length <= 260, 'длинный текст ' + x.id);
    const used = [...x.t.matchAll(/\{(\w+)\}/g)].map(m => m[1]);
    assert.deepEqual([...new Set(used)].sort(), x.needs.slice().sort(), 'подстановки и needs не совпадают в ' + x.id);
  }
});

test('выбор текста: детерминирован для одного слота, использует цель пользователя, не повторяет недавние', () => {
  const snap = { goal: 'Открыть своё дело', dirs: [{ n: 'Финансы', p: 20 }, { n: 'Здоровье', p: 80 }], next: [{ t: 'Написать план' }] };
  const a = composeMessage({ kind: 'daily', style: 'warm', snapshot: snap, seed: '1|d:2026-11-10' });
  const b = composeMessage({ kind: 'daily', style: 'warm', snapshot: snap, seed: '1|d:2026-11-10' });
  assert.deepEqual(a, b, 'повтор отправки даёт тот же текст');
  let personal = 0;
  for (let i = 0; i < 40; i++) { const m = composeMessage({ kind: 'daily', style: 'focus', snapshot: snap, seed: 'x|' + i }); if (/Открыть своё дело|Финансы|Здоровье|Написать план/.test(m.html)) personal++; }
  assert.ok(personal >= 25, 'большинство сообщений возвращают к цели пользователя: ' + personal + '/40');
  const generic = composeMessage({ kind: 'daily', style: 'warm', snapshot: null, seed: 'g' });
  assert.ok(!/\{|\}/.test(generic.html), 'без данных берётся универсальный текст без пустых подстановок');
  const seen = new Set(); let recent = [];
  for (let i = 0; i < 12; i++) { const m = composeMessage({ kind: 'daily', style: 'warm', snapshot: null, seed: 'r' + i, recent }); seen.add(m.text_id); recent = [m.text_id, ...recent]; }
  assert.equal(seen.size, 4, 'пока есть неиспользованные универсальные тексты — повторов нет');
});
