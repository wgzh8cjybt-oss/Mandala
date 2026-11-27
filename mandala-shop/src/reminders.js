// Напоминания «Возвращение к своему пути»: настройки, снимок цели, планировщик, отправка через бота.
// Принципы: только по согласию (по умолчанию выключено), без вины и давления, не больше одного сообщения в день,
// часовой пояс и тихие часы, отправка только с сервера (приложение может быть закрыто), журнал без текста сообщений.
import crypto from 'node:crypto';
import { all, one, run, tx } from './db.js';
import { BUTTON_TEXT, FOOTER, TEXTS } from './reminder_texts.js';
import { TelegramError } from './telegram.js';
import { HttpError, clip, escHtml, isInt, isPlainObject, jsonParse, weekKey } from './util.js';

export const FREQS = ['daily', 'every2', 'weekdays', 'weekly_only'];
export const STYLES = ['warm', 'calm', 'focus'];
export const INACTIVITY_DAYS = [2, 3, 5, 7, 14];
const LATE_MIN = 180;                 // опоздавшее напоминание отправляется не позже, чем через 3 часа после назначенного времени
const FADE_CAP = 7;                   // после 7 сообщений без возвращения в приложение пауза до следующего захода
const INACT_CAP = 3;                  // не больше 3 «возвращающих» сообщений подряд
const INACT_GAP_MS = 7 * 86400e3;     // и не чаще раза в 7 дней
const RETRY_MS = 5 * 60e3, MAX_ATTEMPTS = 3;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMin = s => { const m = TIME_RE.exec(s); return m ? +m[1] * 60 + +m[2] : 0; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- время и часовые пояса ---------------- */
const fmtCache = new Map();
function fmtOf(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
    fmtCache.set(tz, f);
  }
  return f;
}
export function validTz(tz) {
  if (typeof tz !== 'string' || !/^[A-Za-z0-9_+\-/]{1,64}$/.test(tz)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}
/** Местное время в поясе: day = ГГГГ-ММ-ДД, min = минут от полуночи, dow = 1..7 (понедельник = 1). */
export function localClock(ms, tz) {
  const p = Object.fromEntries(fmtOf(tz).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  const hh = (+p.hour) % 24;
  return { day: `${p.year}-${p.month}-${p.day}`, min: hh * 60 + +p.minute, sec: +p.second, dow: { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday] };
}
const localMidnight = (ms, tz) => { const c = localClock(ms, tz); return ms - (c.min * 60 + c.sec) * 1000 - (ms % 1000); };
const dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400e3);

const inQuiet = (q, m) => { const a = toMin(q.from), b = toMin(q.to); if (a === b) return false; return a < b ? (m >= a && m < b) : (m >= a || m < b); };
function firstAllowed(q, from, to) { for (let m = from; m <= to; m++) if (!inQuiet(q, m)) return m; return -1; }

/* ---------------- настройки ---------------- */
export const defaultSettings = cfg => ({
  daily: { on: true, time: '09:00' }, weekly: { on: true, day: 7, time: '18:00' }, freq: 'daily',
  inactivity: { on: true, days: 5 }, style: 'warm', quiet: { from: '22:00', to: '08:00' }, tz: cfg.statsTz
});
const bad = (field, msg) => new HttpError(400, 'bad_request', `${field}: ${msg}`);

/** Применяет частичное изменение настроек с проверкой каждого поля. */
export function applyPatch(cur, patch) {
  const out = structuredClone(cur);
  const obj = (k, v) => { if (!isPlainObject(v)) throw bad(k, 'ожидается объект'); return v; };
  const bool = (k, v) => { if (typeof v !== 'boolean') throw bad(k, 'ожидается true или false'); return v; };
  const time = (k, v) => { if (typeof v !== 'string' || !TIME_RE.test(v)) throw bad(k, 'время вида 09:30'); return v; };
  if ('daily' in patch) { const d = obj('daily', patch.daily); if ('on' in d) out.daily.on = bool('daily.on', d.on); if ('time' in d) out.daily.time = time('daily.time', d.time); }
  if ('weekly' in patch) {
    const w = obj('weekly', patch.weekly);
    if ('on' in w) out.weekly.on = bool('weekly.on', w.on);
    if ('time' in w) out.weekly.time = time('weekly.time', w.time);
    if ('day' in w) { if (!isInt(w.day) || w.day < 1 || w.day > 7) throw bad('weekly.day', 'число от 1 (понедельник) до 7 (воскресенье)'); out.weekly.day = w.day; }
  }
  if ('freq' in patch) { if (!FREQS.includes(patch.freq)) throw bad('freq', 'допустимо: ' + FREQS.join(', ')); out.freq = patch.freq; }
  if ('inactivity' in patch) {
    const i = obj('inactivity', patch.inactivity);
    if ('on' in i) out.inactivity.on = bool('inactivity.on', i.on);
    if ('days' in i) { if (!INACTIVITY_DAYS.includes(i.days)) throw bad('inactivity.days', 'допустимо: ' + INACTIVITY_DAYS.join(', ')); out.inactivity.days = i.days; }
  }
  if ('style' in patch) { if (!STYLES.includes(patch.style)) throw bad('style', 'допустимо: ' + STYLES.join(', ')); out.style = patch.style; }
  if ('tz' in patch) { if (!validTz(patch.tz)) throw bad('tz', 'неизвестный часовой пояс (пример: Europe/Kiev)'); out.tz = patch.tz; }
  if ('quiet' in patch) {
    if (patch.quiet === null) out.quiet = { from: '00:00', to: '00:00' };   // тихие часы выключены
    else { const q = obj('quiet', patch.quiet); if ('from' in q) out.quiet.from = time('quiet.from', q.from); if ('to' in q) out.quiet.to = time('quiet.to', q.to); }
  }
  return out;
}

function settingsOf(cfg, row) {
  const d = defaultSettings(cfg), s = (row && jsonParse(row.settings_json, {})) || {};
  const t = (v, def) => (typeof v === 'string' && TIME_RE.test(v) ? v : def);
  const out = {
    daily: { on: s.daily?.on !== false, time: t(s.daily?.time, d.daily.time) },
    weekly: { on: s.weekly?.on !== false, day: isInt(s.weekly?.day) && s.weekly.day >= 1 && s.weekly.day <= 7 ? s.weekly.day : d.weekly.day, time: t(s.weekly?.time, d.weekly.time) },
    freq: FREQS.includes(s.freq) ? s.freq : d.freq,
    inactivity: { on: s.inactivity?.on !== false, days: INACTIVITY_DAYS.includes(s.inactivity?.days) ? s.inactivity.days : d.inactivity.days },
    style: STYLES.includes(s.style) ? s.style : d.style,
    quiet: { from: t(s.quiet?.from, d.quiet.from), to: t(s.quiet?.to, d.quiet.to) },
    tz: row && validTz(row.tz) ? row.tz : d.tz
  };
  return out;
}

/* ---------------- снимок цели пользователя ---------------- */
const cleanStr = (s, max) => clip(String(s ?? '').replace(/[\p{Cc}\u2028\u2029]+/gu, ' ').replace(/\s+/g, ' ').trim(), max);

/** Проверка и очистка снимка; возвращает { snap, lastActive }. Лишние поля отбрасываются, строки обрезаются. */
export function normalizeSnapshot(body, now) {
  if (!isPlainObject(body)) throw bad('body', 'ожидается объект');
  const int = (k, v, hi) => { if (v === undefined || v === null) return 0; if (!isInt(v) || v < 0 || v > hi) throw bad(k, `целое число от 0 до ${hi}`); return v; };
  const snap = { goal: '', dirs: [], done: 0, total: 0, week: { done: 0, planned: 0 }, streak: 0, next: [] };
  if (body.goal != null) { if (typeof body.goal !== 'string') throw bad('goal', 'строка'); snap.goal = cleanStr(body.goal, 120); }
  if (body.dirs != null) {
    if (!Array.isArray(body.dirs) || body.dirs.length > 8) throw bad('dirs', 'список не длиннее 8');
    body.dirs.forEach((d, i) => {
      if (!isPlainObject(d)) throw bad(`dirs[${i}]`, 'ожидается объект {n, p}');
      const n = cleanStr(d.n, 40);
      if (n) snap.dirs.push({ n, p: Math.min(100, int(`dirs[${i}].p`, d.p, 100)) });
    });
  }
  snap.done = int('done', body.done, 100000); snap.total = int('total', body.total, 100000);
  if (snap.done > snap.total) snap.done = snap.total;
  if (body.week != null) { if (!isPlainObject(body.week)) throw bad('week', 'ожидается объект {done, planned}'); snap.week = { done: int('week.done', body.week.done, 10000), planned: int('week.planned', body.week.planned, 10000) }; }
  snap.streak = int('streak', body.streak, 3650);
  if (body.next != null) {
    if (!Array.isArray(body.next) || body.next.length > 3) throw bad('next', 'список не длиннее 3');
    body.next.forEach((x, i) => {
      if (!isPlainObject(x)) throw bad(`next[${i}]`, 'ожидается объект {t, d}');
      const t = cleanStr(x.t, 80);
      if (t) snap.next.push({ t, d: typeof x.d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.d) ? x.d : null });
    });
  }
  let lastActive = null;
  if (body.last_active != null) { if (!isInt(body.last_active) || body.last_active < 0) throw bad('last_active', 'время в миллисекундах'); lastActive = Math.min(body.last_active, now); }
  return { snap, lastActive };
}

/* ---------------- сборка сообщения ---------------- */
function prng(seed) {
  let a = crypto.createHash('sha1').update(String(seed)).digest().readUInt32LE(0);
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function weeklySummary(snap, fresh) {
  const out = [], w = snap.week || {};
  if (fresh && w.planned > 0) out.push(w.done > 0 ? `Итоги недели: выполнено ${w.done} из ${w.planned}.` : `На этой неделе было запланировано шагов: ${w.planned}. Любой следующий — уже движение.`);
  if (snap.done > 0 && snap.total > 0) out.push(`Общий путь: выполнено ${snap.done} из ${snap.total} (${Math.round(snap.done / snap.total * 100)}%).`);
  return out.join(' ');
}

/** Выбирает текст из библиотеки: учитывает стиль, данные пользователя, не повторяет недавние; при одном и том же seed — тот же результат. */
export function composeMessage({ kind, style, snapshot, seed, recent = [], weekFresh = false }) {
  const snap = snapshot || {}, rnd = prng(seed);
  const dirs = (snap.dirs || []).filter(d => d && d.n).slice().sort((a, b) => (a.p || 0) - (b.p || 0)).slice(0, 3);
  const dir = dirs.length ? dirs[Math.floor(rnd() * dirs.length)].n : '';
  const vars = { goal: snap.goal || '', dir, task: (snap.next && snap.next[0] && snap.next[0].t) || '' };
  const have = new Set(Object.entries(vars).filter(([, v]) => v).map(([k]) => k));
  let pool = TEXTS.filter(x => x.k === kind && x.s === style && x.needs.every(n => have.has(n)));
  const pers = pool.filter(x => x.needs.length), gen = pool.filter(x => !x.needs.length);
  pool = pers.length && (!gen.length || rnd() >= 0.25) ? pers : (gen.length ? gen : pers);
  const rank = id => { const i = recent.indexOf(id); return i < 0 ? Infinity : i; };   // чем дальше в прошлом, тем лучше
  const best = Math.max(...pool.map(x => rank(x.id)));
  pool = pool.filter(x => rank(x.id) === best);
  const tpl = pool[Math.floor(rnd() * pool.length)];
  const body = tpl.t.replace(/\{(goal|dir|task)\}/g, (_, k) => escHtml(vars[k]));
  const parts = [];
  if (kind === 'weekly') { const s = weeklySummary(snap, weekFresh); if (s) parts.push(escHtml(s)); }
  parts.push(body, '<i>' + FOOTER + '</i>');
  return { text_id: tpl.id, html: parts.join('\n\n') };
}

/* ---------------- состояние пользователя ---------------- */
const lastActiveOf = (seen, snapActive, t) => Math.min(t, Math.max(seen || 0, snapActive || 0));
const unansweredCount = (ctx, id, lastActive) => one(ctx.db, "SELECT COUNT(*) AS n FROM reminder_log WHERE tg_id = ? AND status = 'sent' AND kind != 'test' AND sent_at > ?", id, lastActive).n;

/** Статический план дня (без учёта активности): weekly в назначенный день, иначе daily по частоте. */
function staticPlan(st, dow) {
  if (st.weekly.on && dow === st.weekly.day) return { kind: 'weekly', at: toMin(st.weekly.time) };
  if (st.daily.on && st.freq !== 'weekly_only' && (st.freq !== 'weekdays' || dow <= 5)) return { kind: 'daily', at: toMin(st.daily.time) };
  return null;
}
/** Примерное время ближайшего напоминания (мс), без учёта активности пользователя. */
function nextAt(st, now) {
  const c0 = localClock(now, st.tz), mid = localMidnight(now, st.tz);
  for (let i = 0; i < 9; i++) {
    const plan = staticPlan(st, ((c0.dow - 1 + i) % 7) + 1);
    if (!plan) continue;
    const from = firstAllowed(st.quiet, plan.at, Math.min(plan.at + LATE_MIN, 1439));
    if (from < 0) continue;
    const ms = mid + i * 86400e3 + from * 60e3;
    if (ms > now) return ms;
  }
  return null;
}

export function remindersView(ctx, tgId) {
  const t = ctx.now();
  const row = one(ctx.db, 'SELECT * FROM reminder_settings WHERE tg_id = ?', tgId);
  const st = settingsOf(ctx.cfg, row);
  const snap = one(ctx.db, 'SELECT last_active_at, updated_at FROM reminder_snapshot WHERE tg_id = ?', tgId);
  const enabled = !!(row && row.enabled);
  const seen = one(ctx.db, 'SELECT last_seen_at FROM users WHERE tg_id = ?', tgId);
  const n = enabled ? unansweredCount(ctx, tgId, lastActiveOf(seen && seen.last_seen_at, snap && snap.last_active_at, t)) : 0;
  return {
    enabled, settings: st,
    chat: { state: row ? row.chat_state : 'unknown', can_write: !!(row && row.can_write) },
    snapshot: { present: !!snap, updated_at: snap ? snap.updated_at : null },
    paused: enabled && n >= FADE_CAP ? { reason: 'away', sent: n } : null,
    next_at: enabled ? nextAt(st, t) : null,
    options: { freq: FREQS, style: STYLES, inactivity_days: INACTIVITY_DAYS },
    server_time: t
  };
}

/* ---------------- планировщик ---------------- */
const runtime = new WeakMap();   // ctx → { running, pauseUntil }
const isUnreachable = e => e instanceof TelegramError && (e.code === 403 || (e.code === 400 && /chat not found|user is deactivated|peer_id_invalid/i.test(e.description || e.message)));

function choosePlan(ctx, id, st, c, t, lastActive) {
  const base = staticPlan(st, c.dow);
  if (base && base.kind === 'weekly') return { ...base, slot: 'w:' + weekKey(t, st.tz) };
  const daily = st.daily.time;
  if (st.inactivity.on && (t - lastActive) / 86400e3 >= st.inactivity.days) {
    const n = one(ctx.db, "SELECT COUNT(*) AS n, MAX(sent_at) AS last FROM reminder_log WHERE tg_id = ? AND kind = 'inactivity' AND status = 'sent' AND sent_at > ?", id, lastActive);
    if (n.n < INACT_CAP && (!n.last || t - n.last >= INACT_GAP_MS)) return { kind: 'inactivity', at: toMin(daily), slot: 'i:' + c.day };
    return null;   // «возвращающие» сообщения исчерпаны — и обычные ежедневные тоже не шлём: пользователь далеко
  }
  if (!base) return null;       // staticPlan вернул null (ежедневные выключены) либо weekly_only
  if (st.freq === 'every2') {
    const last = one(ctx.db, "SELECT day FROM reminder_log WHERE tg_id = ? AND kind = 'daily' AND status = 'sent' ORDER BY id DESC LIMIT 1", id);
    if (last && dayDiff(last.day, c.day) < 2) return null;
  }
  if (lastActive >= localMidnight(t, st.tz)) return null;   // пользователь уже заходил сегодня — напоминание не нужно
  return { ...base, slot: 'd:' + c.day };
}

function logRow(ctx, id, plan, c, t, status, extra = {}) {
  run(ctx.db, `INSERT INTO reminder_log(tg_id, kind, slot, day, status, attempts, error, created_at, updated_at) VALUES (?,?,?,?,?,0,?,?,?)
    ON CONFLICT(tg_id, kind, slot) DO NOTHING`, id, plan.kind, plan.slot, c.day, status, extra.error || null, t, t);
}

async function processUser(ctx, row, t, rt) {
  const id = row.tg_id, st = settingsOf(ctx.cfg, row), c = localClock(t, st.tz);
  const lastActive = lastActiveOf(row.last_seen_at, row.snap_active, t);
  if (unansweredCount(ctx, id, lastActive) >= FADE_CAP) return 'paused';
  if (one(ctx.db, "SELECT 1 AS x FROM reminder_log WHERE tg_id = ? AND day = ? AND kind != 'test' AND status IN ('sent','sending')", id, c.day)) return 'done';
  const plan = choosePlan(ctx, id, st, c, t, lastActive);
  if (!plan) return 'none';
  const ex = one(ctx.db, 'SELECT * FROM reminder_log WHERE tg_id = ? AND kind = ? AND slot = ?', id, plan.kind, plan.slot);
  if (ex && !(ex.status === 'failed' && ex.attempts < MAX_ATTEMPTS && t - ex.updated_at >= RETRY_MS)) return 'done';

  const deadline = Math.min(plan.at + LATE_MIN, 1439);
  if (c.min < plan.at) return 'wait';
  if (c.min > deadline) { logRow(ctx, id, plan, c, t, 'skipped', { error: 'late' }); return 'skipped'; }
  const from = firstAllowed(st.quiet, c.min, deadline);
  if (from < 0) { logRow(ctx, id, plan, c, t, 'skipped', { error: 'quiet' }); return 'skipped'; }
  if (from > c.min) return 'wait';

  const claimed = tx(ctx.db, () => {
    if (ex) return run(ctx.db, "UPDATE reminder_log SET status = 'sending', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'failed'", t, ex.id).changes > 0;
    return run(ctx.db, "INSERT OR IGNORE INTO reminder_log(tg_id, kind, slot, day, status, attempts, created_at, updated_at) VALUES (?,?,?,?, 'sending', 1, ?, ?)", id, plan.kind, plan.slot, c.day, t, t).changes > 0;
  });
  if (!claimed) return 'done';

  const snap = row.snapshot_json ? jsonParse(row.snapshot_json, null) : null;
  const weekStart = localMidnight(t, st.tz) - (c.dow - 1) * 86400e3;
  const recent = all(ctx.db, "SELECT text_id FROM reminder_log WHERE tg_id = ? AND status = 'sent' AND text_id IS NOT NULL ORDER BY id DESC LIMIT 30", id).map(r => r.text_id);
  const msg = composeMessage({ kind: plan.kind, style: st.style, snapshot: snap, seed: `${id}|${plan.slot}`, recent, weekFresh: !!row.snap_updated && row.snap_updated >= weekStart });
  return deliver(ctx, id, plan, msg, t, rt);
}

async function deliver(ctx, id, plan, msg, t, rt) {
  const extra = ctx.cfg.publicUrl.startsWith('https://') ? { reply_markup: { inline_keyboard: [[{ text: BUTTON_TEXT[plan.kind], web_app: { url: ctx.cfg.publicUrl + '/' } }]] } } : {};
  try {
    await ctx.tg.sendMessage(id, msg.html, extra);
    run(ctx.db, "UPDATE reminder_log SET status = 'sent', text_id = ?, sent_at = ?, updated_at = ?, error = NULL WHERE tg_id = ? AND kind = ? AND slot = ?", msg.text_id, t, t, id, plan.kind, plan.slot);
    run(ctx.db, "UPDATE reminder_settings SET chat_state = 'ok', chat_state_at = ? WHERE tg_id = ?", t, id);
    return 'sent';
  } catch (e) {
    const err = clip(e && e.message, 200);
    if (isUnreachable(e)) {
      run(ctx.db, "UPDATE reminder_log SET status = 'blocked', error = ?, updated_at = ? WHERE tg_id = ? AND kind = ? AND slot = ?", err, t, id, plan.kind, plan.slot);
      run(ctx.db, "UPDATE reminder_settings SET chat_state = 'blocked', chat_state_at = ? WHERE tg_id = ?", t, id);
      return 'blocked';
    }
    run(ctx.db, "UPDATE reminder_log SET status = 'failed', error = ?, updated_at = ? WHERE tg_id = ? AND kind = ? AND slot = ?", err, t, id, plan.kind, plan.slot);
    if (e instanceof TelegramError && e.code === 429) {
      const ra = Number(e.parameters && e.parameters.retry_after) || 30;
      rt.pauseUntil = t + ra * 1000;
      return 'rate_limited';
    }
    ctx.log.warn('напоминание: не удалось отправить', { tg: id, kind: plan.kind, error: err });
    return 'failed';
  }
}

/** Один проход планировщика. Вызывается раз в минуту; безопасен при повторных и параллельных вызовах. */
export async function runReminders(ctx) {
  const out = { checked: 0, sent: 0, skipped: 0, failed: 0, blocked: 0 };
  if (!ctx.cfg.remindersEnabled) return { ...out, off: true };
  const t = ctx.now();
  let rt = runtime.get(ctx);
  if (!rt) { rt = { running: false, pauseUntil: 0 }; runtime.set(ctx, rt); }
  if (rt.running) return { ...out, busy: true };
  if (rt.pauseUntil > t) return { ...out, paused_until: rt.pauseUntil };
  rt.running = true;
  try {
    run(ctx.db, "UPDATE reminder_log SET status = 'skipped', error = 'interrupted', updated_at = ? WHERE status = 'sending' AND updated_at < ?", t, t - 600e3);
    const rows = all(ctx.db, `SELECT s.*, u.last_seen_at, sn.snapshot_json, sn.last_active_at AS snap_active, sn.updated_at AS snap_updated
      FROM reminder_settings s JOIN users u ON u.tg_id = s.tg_id LEFT JOIN reminder_snapshot sn ON sn.tg_id = s.tg_id
      WHERE s.enabled = 1 AND s.chat_state != 'blocked' AND u.is_blocked = 0 ORDER BY s.tg_id`);
    for (const row of rows) {
      if (out.sent + out.failed + out.blocked >= ctx.cfg.remindMaxPerTick) break;
      out.checked++;
      let r;
      try { r = await processUser(ctx, row, t, rt); } catch (e) { ctx.log.error('напоминания: ошибка обработки пользователя', { tg: row.tg_id, error: e }); r = 'failed'; }
      if (r === 'sent') out.sent++; else if (r === 'skipped') out.skipped++; else if (r === 'failed' || r === 'rate_limited') out.failed++; else if (r === 'blocked') out.blocked++;
      if (r === 'rate_limited') { out.rate_limited = true; break; }
      if (r === 'sent' && ctx.cfg.remindGapMs) await sleep(ctx.cfg.remindGapMs);
    }
  } finally { rt.running = false; }
  return out;
}

/* ---------------- команды бота ---------------- */
/** Пользователь написал боту → боту можно писать ему (снимает пометку «заблокирован»). */
export function markReachable(ctx, tgId) {
  run(ctx.db, "UPDATE reminder_settings SET chat_state = 'ok', chat_state_at = ?, can_write = 1 WHERE tg_id = ? AND (chat_state != 'ok' OR can_write = 0)", ctx.now(), tgId);
}

export function stopReminders(ctx, tgId) {
  const changed = tx(ctx.db, () => {
    const n = run(ctx.db, 'UPDATE reminder_settings SET enabled = 0, updated_at = ? WHERE tg_id = ? AND enabled = 1', ctx.now(), tgId).changes;
    run(ctx.db, 'DELETE FROM reminder_snapshot WHERE tg_id = ?', tgId);
    return n > 0;
  });
  return changed
    ? 'Напоминания выключены, больше ничего не придёт. Данные для них (цель, названия направлений) удалены с сервера. Включить снова можно в приложении: Настройки → Напоминания.'
    : 'Напоминания и так выключены. Включить их можно в приложении: Настройки → Напоминания.';
}

const DAYS_RU = ['', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу', 'воскресенье'];
const STYLE_RU = { warm: 'тёплый', calm: 'спокойный', focus: 'по делу' };
const FREQ_RU = { daily: 'каждый день', every2: 'через день', weekdays: 'по будням', weekly_only: 'только итоги недели' };
export function remindStatusText(ctx, tgId) {
  const row = one(ctx.db, 'SELECT * FROM reminder_settings WHERE tg_id = ?', tgId);
  if (!row || !row.enabled) return escHtml('Напоминания выключены. Они помогают возвращаться к своим целям без давления: время, частоту и стиль выбираете вы. Включить можно в приложении: Настройки → Напоминания.');
  const st = settingsOf(ctx.cfg, row), lines = ['Напоминания включены.'];
  if (st.daily.on && st.freq !== 'weekly_only') lines.push(`Ежедневные: ${FREQ_RU[st.freq]}, около ${st.daily.time}.`);
  if (st.weekly.on) lines.push(`Итоги недели: в ${DAYS_RU[st.weekly.day]} около ${st.weekly.time}.`);
  if (st.inactivity.on) lines.push(`Мягкое возвращение, если вас не было ${st.inactivity.days} дн. и больше.`);
  lines.push(`Стиль: ${STYLE_RU[st.style]}. Часовой пояс: ${st.tz}.`, 'Изменить — в приложении, отключить — /stop.');
  return escHtml(lines.join('\n'));
}

/* ---------------- HTTP-API ---------------- */
function noteWriteAccess(ctx, req) {
  if (req.tgUser && req.tgUser.allows_write_to_pm === true) run(ctx.db, 'UPDATE reminder_settings SET can_write = 1 WHERE tg_id = ? AND can_write = 0', req.user.tg_id);
}

export function registerReminders(r, ctx) {
  r.add('GET', '/api/reminders', req => ({ ok: true, reminders: remindersView(ctx, req.user.tg_id) }));

  r.add('PUT', '/api/reminders', req => {
    const body = isPlainObject(req.body) ? req.body : {};
    const id = req.user.tg_id, t = ctx.now();
    const row = one(ctx.db, 'SELECT * FROM reminder_settings WHERE tg_id = ?', id);
    const next = applyPatch(settingsOf(ctx.cfg, row), body);
    if ('enabled' in body && typeof body.enabled !== 'boolean') throw bad('enabled', 'ожидается true или false');
    if ('write_access' in body && typeof body.write_access !== 'boolean') throw bad('write_access', 'ожидается true или false');
    const enabled = 'enabled' in body ? body.enabled : !!(row && row.enabled);
    const canWrite = (row && row.can_write) || body.write_access === true || (req.tgUser && req.tgUser.allows_write_to_pm === true) ? 1 : 0;
    const { tz, ...rest } = next;
    tx(ctx.db, () => {
      run(ctx.db, `INSERT INTO reminder_settings(tg_id, enabled, tz, settings_json, chat_state, can_write, created_at, updated_at) VALUES (?,?,?,?, 'unknown', ?, ?, ?)
        ON CONFLICT(tg_id) DO UPDATE SET enabled = excluded.enabled, tz = excluded.tz, settings_json = excluded.settings_json, can_write = excluded.can_write, updated_at = excluded.updated_at,
          chat_state = CASE WHEN excluded.enabled = 1 AND reminder_settings.enabled = 0 THEN 'unknown' ELSE reminder_settings.chat_state END`,
      id, enabled ? 1 : 0, tz, JSON.stringify(rest), canWrite, t, t);
      if (!enabled) run(ctx.db, 'DELETE FROM reminder_snapshot WHERE tg_id = ?', id);   // нет согласия — нет и личных данных на сервере
    });
    return { ok: true, reminders: remindersView(ctx, id) };
  }, { limit: { max: 30, windowMs: 60000, by: 'user' } });

  r.add('PUT', '/api/reminders/snapshot', req => {
    const id = req.user.tg_id, t = ctx.now();
    const row = one(ctx.db, 'SELECT enabled FROM reminder_settings WHERE tg_id = ?', id);
    if (!row || !row.enabled) throw new HttpError(409, 'reminders_disabled', 'Напоминания выключены: данные для них не сохраняются.');
    const { snap, lastActive } = normalizeSnapshot(req.body, t);
    run(ctx.db, `INSERT INTO reminder_snapshot(tg_id, snapshot_json, last_active_at, updated_at) VALUES (?,?,?,?)
      ON CONFLICT(tg_id) DO UPDATE SET snapshot_json = excluded.snapshot_json, last_active_at = excluded.last_active_at, updated_at = excluded.updated_at`,
    id, JSON.stringify(snap), lastActive, t);
    noteWriteAccess(ctx, req);
    return { ok: true, updated_at: t };
  }, { limit: { max: 30, windowMs: 60000, by: 'user' } });

  // Пробное сообщение: проверяет, что бот может написать пользователю, и показывает выбранный стиль.
  r.add('POST', '/api/reminders/test', async req => {
    const id = req.user.tg_id, t = ctx.now();
    const row = one(ctx.db, 'SELECT * FROM reminder_settings WHERE tg_id = ?', id);
    if (!row || !row.enabled) throw new HttpError(409, 'reminders_disabled', 'Сначала включите напоминания.');
    const st = settingsOf(ctx.cfg, row), c = localClock(t, st.tz);
    const sn = one(ctx.db, 'SELECT snapshot_json FROM reminder_snapshot WHERE tg_id = ?', id);
    const msg = composeMessage({ kind: 'daily', style: st.style, snapshot: sn ? jsonParse(sn.snapshot_json, null) : null, seed: `${id}|test|${t}` });
    const plan = { kind: 'test', slot: 't:' + t };
    run(ctx.db, "INSERT INTO reminder_log(tg_id, kind, slot, day, status, attempts, created_at, updated_at) VALUES (?,?,?,?, 'sending', 1, ?, ?)", id, plan.kind, plan.slot, c.day, t, t);
    const extra = ctx.cfg.publicUrl.startsWith('https://') ? { reply_markup: { inline_keyboard: [[{ text: BUTTON_TEXT.test, web_app: { url: ctx.cfg.publicUrl + '/' } }]] } } : {};
    try {
      await ctx.tg.sendMessage(id, '<b>Пробное напоминание</b> — так будут выглядеть сообщения.\n\n' + msg.html, extra);
    } catch (e) {
      const unreachable = isUnreachable(e);
      run(ctx.db, 'UPDATE reminder_log SET status = ?, error = ?, updated_at = ? WHERE tg_id = ? AND kind = ? AND slot = ?', unreachable ? 'blocked' : 'failed', clip(e && e.message, 200), t, id, plan.kind, plan.slot);
      if (unreachable) {
        run(ctx.db, "UPDATE reminder_settings SET chat_state = 'blocked', chat_state_at = ? WHERE tg_id = ?", t, id);
        throw new HttpError(409, 'bot_unreachable', 'Бот не может вам написать. Откройте чат с ботом и нажмите «Запустить» (Start) или разрешите сообщения в приложении, затем повторите.');
      }
      throw new HttpError(502, 'telegram_unavailable', 'Telegram сейчас не отвечает. Попробуйте позже.');
    }
    run(ctx.db, "UPDATE reminder_log SET status = 'sent', text_id = ?, sent_at = ?, updated_at = ? WHERE tg_id = ? AND kind = ? AND slot = ?", msg.text_id, t, t, id, plan.kind, plan.slot);
    run(ctx.db, "UPDATE reminder_settings SET chat_state = 'ok', chat_state_at = ?, can_write = 1 WHERE tg_id = ?", t, id);
    return { ok: true, reminders: remindersView(ctx, id) };
  }, { limit: { max: 3, windowMs: 3600e3, by: 'user' } });

  // Полное удаление: настройки, снимок и журнал.
  r.add('DELETE', '/api/reminders', req => {
    const id = req.user.tg_id;
    tx(ctx.db, () => { for (const tbl of ['reminder_log', 'reminder_snapshot', 'reminder_settings']) run(ctx.db, `DELETE FROM ${tbl} WHERE tg_id = ?`, id); });
    return { ok: true, reminders: remindersView(ctx, id) };
  });
}

/** Сводка для владельца: сколько включили, что отправлено, ошибки. Текстов сообщений и личных данных здесь нет. */
export function reminderAdminView(ctx) {
  const t = ctx.now();
  const cnt = (sql, ...p) => one(ctx.db, sql, ...p).n;
  return {
    enabled_users: cnt('SELECT COUNT(*) AS n FROM reminder_settings WHERE enabled = 1'),
    blocked_users: cnt("SELECT COUNT(*) AS n FROM reminder_settings WHERE enabled = 1 AND chat_state = 'blocked'"),
    sent_24h: cnt("SELECT COUNT(*) AS n FROM reminder_log WHERE status = 'sent' AND kind != 'test' AND sent_at > ?", t - 86400e3),
    sent_7d: cnt("SELECT COUNT(*) AS n FROM reminder_log WHERE status = 'sent' AND kind != 'test' AND sent_at > ?", t - 7 * 86400e3),
    failed_7d: cnt("SELECT COUNT(*) AS n FROM reminder_log WHERE status IN ('failed','blocked') AND updated_at > ?", t - 7 * 86400e3),
    by_kind_7d: all(ctx.db, "SELECT kind, COUNT(*) AS n FROM reminder_log WHERE status = 'sent' AND kind != 'test' AND sent_at > ? GROUP BY kind", t - 7 * 86400e3),
    recent: all(ctx.db, 'SELECT tg_id, kind, slot, status, text_id, error, attempts, sent_at, updated_at FROM reminder_log ORDER BY id DESC LIMIT 50')
  };
}
