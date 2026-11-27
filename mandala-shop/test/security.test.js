// Защита: секретный заголовок вебхука, подпись initData, права администратора, лимиты, CORS, заголовки,
// обход каталогов, SQL-инъекции, утечки секретов.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createLogger } from '../src/log.js';
import { TelegramApi } from '../src/telegram.js';
import { ADMIN_ID, ADMIN_TOKEN, BOT_TOKEN, WEBHOOK_PATH, WEBHOOK_SECRET, signInitData, startServer, tgUser } from './helpers.js';

let t;
before(async () => { t = await startServer({ env: { CORS_ORIGINS: 'https://client.example' } }); });
after(async () => { await t.close(); });
beforeEach(() => t.clock.advance(61000));   // новое окно лимитов запросов в каждом тесте

const SECRETS = [BOT_TOKEN, BOT_TOKEN.split(':')[1], WEBHOOK_SECRET, WEBHOOK_PATH, ADMIN_TOKEN];
/** Запрос с «сырым» путём (fetch сам схлопывает «..» — нам нужно отправить как есть). */
const rawGet = (server, path, headers = {}) => new Promise((resolve, reject) => {
  const u = new URL(server.base);
  const r = http.request({ host: u.hostname, port: u.port, path, method: 'GET', headers }, res => {
    const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
  });
  r.on('error', reject); r.end();
});

/* ---------------- вебхук ---------------- */
test('вебхук без секретного заголовка или с чужим отклоняется, поддельная «оплата» ничего не делает', async () => {
  const u = 6100;
  const o = await t.order(u, 'fx_confetti');
  const chargeId = 'forged_charge_1';
  const forged = t.successfulPaymentUpdate({ userId: u, payload: o.id, amount: o.amount, chargeId });
  assert.equal((await t.webhook(forged, { secret: null })).status, 403);
  assert.equal((await t.webhook(forged, { secret: 'wrong' })).status, 403);
  assert.equal((await t.webhook(forged, { secret: WEBHOOK_SECRET.slice(0, -1) + 'x' })).status, 403, 'почти верный секрет');
  assert.equal((await t.webhook(forged, { secret: WEBHOOK_SECRET + 'x' })).status, 403);
  assert.equal(t.q1('SELECT COUNT(*) AS n FROM payments WHERE charge_id = ?', chargeId).n, 0);
  assert.equal(t.q1('SELECT status FROM orders WHERE id = ?', o.id).status, 'pending');
  assert.equal((await t.rights(u)).items.length, 0);
  assert.equal((await t.webhook(forged)).status, 200, 'с настоящим секретом то же обновление принимается');
});

test('вебхук: только POST на секретный адрес; неверный адрес и метод не обрабатываются', async () => {
  const upd = { update_id: t.nextUpdateId() };
  const hdr = { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET };
  assert.equal((await t.req('POST', '/telegram/webhook', { headers: hdr, body: upd })).status, 404, 'без секретной части пути');
  assert.equal((await t.req('POST', '/telegram/webhook/another_path_12345', { headers: hdr, body: upd })).status, 404);
  assert.equal((await t.req('GET', t.webhookPath, { headers: hdr })).status, 404);
  assert.equal((await t.req('PUT', t.webhookPath, { headers: hdr, body: upd })).status, 404);
});

test('вебхук: битый JSON и слишком большое тело', async () => {
  const hdr = { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET, 'content-type': 'application/json' };
  assert.equal((await t.req('POST', t.webhookPath, { headers: hdr, raw: '{не json' })).status, 400);
  assert.equal((await t.req('POST', t.webhookPath, { headers: hdr, raw: 'null' })).status, 400);
  const big = JSON.stringify({ update_id: 1, pad: 'x'.repeat(1.2 * 1024 * 1024) });
  assert.equal((await t.req('POST', t.webhookPath, { headers: hdr, raw: big })).status, 413);
  assert.equal((await t.req('POST', t.webhookPath, { headers: hdr, raw: '[]' })).status, 200, 'не объект — игнорируется спокойно');
});

test('вебхук: обновление без update_id или неизвестного вида игнорируется без ошибки', async () => {
  for (const body of [{}, { update_id: 'x' }, { update_id: t.nextUpdateId() }, { update_id: t.nextUpdateId(), edited_message: {} }, { update_id: t.nextUpdateId(), message: { chat: { type: 'group', id: 1 }, from: { id: 1 }, text: '/start' } }]) {
    assert.equal((await t.webhook(body)).status, 200);
  }
  assert.equal(t.mock.callsOf('sendMessage').filter(c => c.params.chat_id === 1).length, 0, 'в группах бот молчит');
});

test('сбой при обработке вебхука возвращает 500 (Telegram повторит доставку) и пишется в журнал', async () => {
  const orig = t.ctx.tg.sendMessage;
  const u = 6101;
  const o = await t.order(u, 'fx_confetti');
  const chargeId = t.mock.charge(u, { amount: o.amount, payload: o.id });
  // ломаем саму запись в БД: платёж не должен «наполовину» записаться
  t.db.exec('CREATE TRIGGER boom BEFORE INSERT ON entitlements BEGIN SELECT RAISE(ABORT, \'сбой диска\'); END');
  try {
    const r = await t.webhook(t.successfulPaymentUpdate({ userId: u, payload: o.id, amount: o.amount, chargeId, updateId: 777001 }));
    assert.equal(r.status, 500);
  } finally { t.db.exec('DROP TRIGGER boom'); t.ctx.tg.sendMessage = orig; }
  assert.equal(t.q1('SELECT COUNT(*) AS n FROM payments WHERE charge_id = ?', chargeId).n, 0, 'транзакция откатилась целиком');
  assert.equal(t.q1('SELECT status FROM orders WHERE id = ?', o.id).status, 'pending');
  assert.equal(t.q1('SELECT 1 AS x FROM processed_updates WHERE update_id = 777001'), null, 'обновление не помечено обработанным');
  // Telegram повторяет доставку — на этот раз всё проходит
  const retry = await t.webhook(t.successfulPaymentUpdate({ userId: u, payload: o.id, amount: o.amount, chargeId, updateId: 777001 }));
  assert.equal(retry.status, 200);
  assert.equal(t.q1('SELECT status FROM payments WHERE charge_id = ?', chargeId).status, 'succeeded');
  assert.ok(t.q1("SELECT 1 AS x FROM events_log WHERE type = 'webhook_error'"));
});

/* ---------------- подпись initData и права ---------------- */
test('без подписи, с мусором, с чужой подписью и с подменённым пользователем — 401', async () => {
  const now = Math.floor(t.clock.t / 1000);
  assert.equal((await t.req('GET', '/api/me')).status, 401);
  assert.equal((await t.req('GET', '/api/me', { headers: { authorization: 'tma garbage-not-signed' } })).status, 401);
  assert.equal((await t.req('GET', '/api/me', { headers: { authorization: 'Basic abc' } })).status, 401);
  const other = signInitData(tgUser(5), { token: '999999999:AAH_other_bot_token_abcdefghijklmn', authDate: now });
  assert.equal((await t.req('GET', '/api/me', { headers: { authorization: 'tma ' + other } })).status, 401);
  const good = new URLSearchParams(signInitData(tgUser(5), { authDate: now }));
  good.set('user', JSON.stringify(tgUser(ADMIN_ID)));
  const r = await t.req('GET', '/api/admin/dashboard', { headers: { authorization: 'tma ' + good } });
  assert.equal(r.status, 401, 'подмена id на администратора не проходит');
  assert.equal(r.json.error.code, 'bad_init_data');
});

test('устаревшие данные входа (старше суток) отклоняются, свежие принимаются', async () => {
  const now = Math.floor(t.clock.t / 1000);
  const old = signInitData(tgUser(6200), { authDate: now - 86400 - 10 });
  const r = await t.req('GET', '/api/me', { headers: { authorization: 'tma ' + old } });
  assert.equal(r.status, 401);
  assert.match(r.json.error.message, /устарела|недействительна/);
  assert.equal((await t.req('GET', '/api/me', { headers: { authorization: 'tma ' + signInitData(tgUser(6200), { authDate: now - 3600 }) } })).status, 200);
});

test('обычный пользователь не получает доступа к админ-API ни по одному маршруту; анонимный — тоже', async () => {
  const adminRoutes = t.app.router.routes.filter(r => r.pattern.startsWith('/api/admin/'));
  assert.ok(adminRoutes.length >= 25, 'нашлось админ-маршрутов: ' + adminRoutes.length);
  for (const r of adminRoutes) {
    const p = r.pattern.replace(/:[A-Za-z_]+/g, '1');
    const user = await t.req(r.method, p, { user: 6300, body: r.method === 'GET' ? undefined : {} });
    assert.equal(user.status, 403, `${r.method} ${r.pattern} для пользователя → ${user.status}`);
    t.clock.advance(4000);   // неудачные входы ограничены по частоте — не упираемся в этот лимит
    const anon = await t.req(r.method, p, { body: r.method === 'GET' ? undefined : {} });
    assert.equal(anon.status, 401, `${r.method} ${r.pattern} без входа → ${anon.status}`);
    t.clock.advance(4000);
    const wrong = await t.req(r.method, p, { token: 'z'.repeat(48), body: r.method === 'GET' ? undefined : {} });
    assert.equal(wrong.status, 401, `${r.method} ${r.pattern} с чужим токеном → ${wrong.status}`);
  }
});

test('все пользовательские маршруты, кроме публичных, требуют входа', async () => {
  const open = new Set(['GET /api/health', 'GET /api/catalog', 'GET /api/terms']);
  const userRoutes = t.app.router.routes.filter(r => !r.pattern.startsWith('/api/admin/') && !open.has(`${r.method} ${r.pattern}`));
  assert.ok(userRoutes.length >= 7);
  for (const r of userRoutes) {
    t.clock.advance(4000);
    const res = await t.req(r.method, r.pattern.replace(/:[A-Za-z_]+/g, 'x'), { body: r.method === 'GET' ? undefined : {} });
    assert.equal(res.status, 401, `${r.method} ${r.pattern} → ${res.status}`);
  }
  assert.equal((await t.req('GET', '/api/health')).status, 200);
  assert.equal((await t.req('GET', '/api/terms')).status, 200);
});

test('попытки «повысить права» через тело и заголовки не работают', async () => {
  const hdr = { 'x-admin': '1', 'x-user-id': String(ADMIN_ID), 'x-forwarded-for': '127.0.0.1' };
  for (const body of [{ is_admin: true }, { isAdmin: true, tg_id: ADMIN_ID }, JSON.parse('{"__proto__":{"isAdmin":true}}')]) {
    const r = await t.req('PUT', '/api/admin/settings', { user: 6400, body, headers: hdr });
    assert.equal(r.status, 403);
  }
  assert.equal((await t.as(6400).get('/api/me', { headers: hdr })).json.is_admin, false);
  assert.equal((await t.admin.get('/api/me')).json.is_admin, true);
});

test('вход администратора по токену: работает только при заданном ADMIN_TOKEN и только с верным значением', async () => {
  const s = await startServer({ env: { ADMIN_TOKEN } });
  try {
    assert.equal((await s.req('GET', '/api/admin/dashboard', { token: ADMIN_TOKEN })).status, 200);
    assert.equal((await s.req('GET', '/api/admin/dashboard', { token: ADMIN_TOKEN + 'x' })).status, 401);
    assert.equal((await s.req('GET', '/api/admin/dashboard', { token: ADMIN_TOKEN.slice(1) })).status, 401);
    const r = await s.req('POST', '/api/admin/settings', { token: ADMIN_TOKEN, body: {} });
    assert.ok([404, 405].includes(r.status));
    assert.equal((await s.req('PUT', '/api/admin/settings', { token: ADMIN_TOKEN, body: { support_contact: '@new' } })).status, 200);
    assert.ok(s.q1("SELECT 1 AS x FROM audit_log WHERE actor = 'token' AND action = 'settings.update'"), 'действия по токену тоже попадают в журнал');
  } finally { await s.close(); }
  assert.equal((await t.req('GET', '/api/admin/dashboard', { token: ADMIN_TOKEN })).status, 401, 'токен не задан — по нему не пускают');
});

test('заблокированный пользователь не получает данных, но получает понятный отказ', async () => {
  await t.as(6500).get('/api/me');
  await t.admin.post('/api/admin/users/6500/block', { blocked: true });
  const r = await t.as(6500).get('/api/me');
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, 'blocked');
});

/* ---------------- ввод данных ---------------- */
test('битый JSON, слишком большое тело, неизвестный маршрут и неверный метод', async () => {
  assert.equal((await t.req('POST', '/api/orders', { user: 6600, raw: '{oops', headers: { 'content-type': 'application/json' } })).json.error.code, 'bad_json');
  for (const raw of ['[]', '5', 'null', '"строка"']) assert.equal((await t.req('POST', '/api/orders', { user: 6600, raw, headers: { 'content-type': 'application/json' } })).json.error.code, 'bad_json', raw);
  const put = await t.req('PUT', '/api/admin/settings', { user: ADMIN_ID, raw: '{oops', headers: { 'content-type': 'application/json' } });
  assert.equal(put.status, 400, 'битый JSON не принимается за «пустые настройки»');
  const big = await t.req('POST', '/api/orders', { user: 6600, raw: JSON.stringify({ product_id: 'x'.repeat(70 * 1024) }), headers: { 'content-type': 'application/json' } });
  assert.equal(big.status, 413);
  const nf = await t.req('GET', '/api/нет-такого');
  assert.equal(nf.status, 404);
  assert.equal(nf.json.ok, false);
  const m = await t.req('DELETE', '/api/catalog');
  assert.equal(m.status, 405);
  assert.equal((await t.req('OPTIONS', '/api/orders')).status, 204);
});

test('SQL-инъекции в параметрах и теле не срабатывают, таблицы целы', async () => {
  const evil = "'; DROP TABLE products; --";
  assert.equal((await t.admin.get('/api/admin/users?q=' + encodeURIComponent(evil))).status, 200);
  assert.equal((await t.admin.get('/api/admin/users?q=' + encodeURIComponent("' OR 1=1 --"))).json.users.length, 0);
  assert.equal((await t.admin.get('/api/admin/payments?q=' + encodeURIComponent(evil) + '&status=' + encodeURIComponent(evil))).status, 200);
  assert.equal((await t.admin.get('/api/admin/orders?status=' + encodeURIComponent("paid' OR '1'='1"))).json.orders.length, 0);
  assert.equal((await t.admin.get('/api/admin/events?type=' + encodeURIComponent(evil))).status, 200);
  assert.equal((await t.admin.put('/api/admin/products/' + encodeURIComponent(evil), { price_stars: 5 })).status, 404);
  await t.acceptTerms(6700);
  assert.equal((await t.as(6700).post('/api/orders', { product_id: evil })).status, 404);
  assert.equal((await t.admin.get('/api/admin/users?q=%25')).json.users.length, 0, '«%» ищется буквально, а не как шаблон');
  assert.equal((await t.admin.get('/api/admin/users?q=_')).json.users.length, 0, '«_» тоже буквально');
  for (const tbl of ['products', 'orders', 'payments', 'entitlements', 'users']) assert.ok(t.q1(`SELECT COUNT(*) AS n FROM ${tbl}`).n >= 0);
  assert.ok(t.q1('SELECT COUNT(*) AS n FROM products').n >= 28);
});

/* ---------------- заголовки, CORS ---------------- */
test('заголовки безопасности на ответах API и страницах', async () => {
  const api = await t.as(6800).get('/api/me');
  assert.equal(api.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(api.headers.get('cache-control'), 'no-store');
  assert.equal(api.headers.get('referrer-policy'), 'no-referrer');
  assert.match(api.headers.get('strict-transport-security') || '', /max-age=\d+/, 'PUBLIC_URL на https — включён HSTS');
  for (const p of ['/', '/admin']) {
    const page = await t.req('GET', p);
    assert.equal(page.status, 200, p);
    const csp = page.headers.get('content-security-policy');
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'none'/);
    assert.match(csp, /connect-src 'self'/);
    assert.ok(!/script-src[^;]*\*/.test(csp), 'нет «*» в script-src');
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  }
  const err = await t.req('GET', '/api/нет');
  assert.equal(err.headers.get('x-content-type-options'), 'nosniff');
});

test('CORS: только свой адрес и перечисленные в CORS_ORIGINS; «*» не используется', async () => {
  const ok = await t.req('GET', '/api/health', { headers: { origin: 'https://shop.test' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://shop.test');
  const listed = await t.req('GET', '/api/health', { headers: { origin: 'https://client.example' } });
  assert.equal(listed.headers.get('access-control-allow-origin'), 'https://client.example');
  const evil = await t.req('GET', '/api/health', { headers: { origin: 'https://evil.example' } });
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const pre = await t.req('OPTIONS', '/api/orders', { headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), null);
  const pre2 = await t.req('OPTIONS', '/api/orders', { headers: { origin: 'https://shop.test', 'access-control-request-method': 'POST' } });
  assert.match(pre2.headers.get('access-control-allow-headers'), /authorization/);
  const n = await t.req('GET', '/api/health', { headers: { origin: 'null' } });
  assert.equal(n.headers.get('access-control-allow-origin'), null, 'Origin: null не разрешается');
});

/* ---------------- файлы ---------------- */
test('обход каталогов через /art, /media и скачивание копий не работает', async () => {
  for (const p of ['/art/..%2f..%2fsecret.txt', '/art/%2e%2e/%2e%2e/secret.txt', '/art/../../secret.txt', '/art/../secret.txt', '/art/figures/../../../secret.txt', '/art/.hidden', '/art/%00', '/art/figures/', '/art', '/media/../x.png', '/media/%2e%2e%2fx.png', '/media/short.png', '/media/abcdefgh1234.svg', '/media/abcdefgh1234.html']) {
    const r = await rawGet(t, p);
    assert.ok(r.status === 404 || r.status === 400, `${p} → ${r.status}`);
    assert.ok(!r.text.includes('TOP-SECRET'), p + ' не должен отдавать секретный файл');
  }
  assert.equal((await rawGet(t, '/art/figures/x.webp')).status, 200);
  for (const p of ['/api/admin/backups/..%2f..%2fmandala.sqlite', '/api/admin/backups/passwd']) {
    const r = await t.req('GET', p, { user: ADMIN_ID });
    assert.ok([400, 404].includes(r.status), `${p} → ${r.status}`);
  }
  assert.equal((await rawGet(t, '/mandala.sqlite')).status, 404);
  assert.equal((await rawGet(t, '/src/config.js')).status, 404);
  assert.equal((await rawGet(t, '/.env')).status, 404);
  assert.equal((await rawGet(t, '/package.json')).status, 404);
});

test('статические страницы отдаются, остальные методы к ним не принимаются', async () => {
  assert.match((await t.req('GET', '/')).text, /client/);
  assert.match((await t.req('GET', '/admin')).text, /admin/);
  assert.equal((await t.req('POST', '/', { body: {} })).status, 404);
  assert.equal((await t.req('GET', '/favicon.ico')).status, 204);
  const head = await t.req('HEAD', '/');
  assert.equal(head.status, 200);
  assert.equal(head.buf.length, 0);
});

/* ---------------- утечки секретов ---------------- */
test('журнал сервера не содержит секретов, даже когда они попадают в сообщения об ошибках', async () => {
  const lines = [];
  const log = createLogger({ secrets: SECRETS, sink: l => lines.push(l) });
  log.error('сбой', { url: `https://api.telegram.org/bot${BOT_TOKEN}/getMe`, hook: `/telegram/webhook/${WEBHOOK_PATH}`, h: WEBHOOK_SECRET, a: ADMIN_TOKEN, error: new Error('токен ' + BOT_TOKEN.split(':')[1]) });
  const out = lines.join('\n');
  for (const s of SECRETS) assert.ok(!out.includes(s), 'секрет остался в журнале: ' + s.slice(0, 8));
  assert.match(out, /\*\*\*/);
});

test('ошибки клиента Bot API не содержат токен бота', async () => {
  const dead = new TelegramApi({ token: BOT_TOKEN, base: 'http://127.0.0.1:1', timeoutMs: 500 });
  const e = await dead.getMe().catch(x => x);
  assert.equal(e.name, 'TelegramError');
  assert.ok(!e.message.includes(BOT_TOKEN) && !JSON.stringify(e).includes(BOT_TOKEN));
  const bad = new TelegramApi({ token: '1:wrong_token_value_abcdefghijklmnop', base: t.mock.base });
  const e2 = await bad.getMe().catch(x => x);
  assert.equal(e2.code, 401);
  assert.ok(!e2.message.includes('wrong_token_value'));
});

test('журнал сервера после всех проверок не содержит токена бота, секрета вебхука и токена администратора', async () => {
  const out = t.logs.join('\n');
  assert.ok(out.length > 100);
  for (const s of SECRETS) assert.ok(!out.includes(s), 'в журнале найден секрет: ' + s.slice(0, 8));
});

test('ответы API не содержат секретов и внутренних деталей', async () => {
  const urls = ['/api/me', '/api/catalog', '/api/terms', '/api/orders', '/api/health'];
  for (const u of urls) { const r = await t.as(ADMIN_ID).get(u); for (const s of SECRETS) assert.ok(!r.text.includes(s), `${u} раскрывает секрет`); }
  for (const u of ['/api/admin/meta', '/api/admin/dashboard', '/api/admin/products', '/api/admin/settings', '/api/admin/webhook', '/api/admin/audit', '/api/admin/events', '/api/admin/users', '/api/admin/payments', '/api/admin/orders', '/api/admin/backups']) {
    const r = await t.admin.get(u);
    assert.ok(r.status === 200 || r.status === 502, `${u} → ${r.status}`);
    for (const s of SECRETS) assert.ok(!r.text.includes(s), `${u} раскрывает секрет`);
  }
});

test('непредвиденная ошибка сервера отдаёт общий ответ без стека и путей к файлам', async () => {
  const saved = t.cfg.adminIds;
  t.cfg.adminIds = null;   // ломаем внутреннее состояние, чтобы вызвать исключение в обработчике
  let r;
  try { r = await t.as(6900).get('/api/catalog'); } finally { t.cfg.adminIds = saved; }
  assert.equal(r.status, 500);
  assert.equal(r.json.error.code, 'internal');
  assert.ok(!/\.js|node_modules|TypeError|at /.test(r.text), r.text);
  assert.ok(t.logs.some(l => l.includes('необработанная ошибка')), 'подробности остались только в журнале сервера');
});

/* ---------------- лимиты (отдельные серверы) ---------------- */
test('неудачные попытки входа ограничены: 30 в минуту с одного адреса', async () => {
  const s = await startServer();
  try {
    const codes = [];
    for (let i = 0; i < 40; i++) codes.push((await s.req('GET', '/api/me', { headers: { authorization: 'tma broken' + i } })).status);
    assert.equal(codes.slice(0, 30).every(c => c === 401), true);
    assert.ok(codes.slice(30).every(c => c === 429), codes.join(','));
    s.clock.advance(61000);
    assert.equal((await s.req('GET', '/api/me', { headers: { authorization: 'tma broken' } })).status, 401, 'через минуту счётчик сброшен');
  } finally { await s.close(); }
});

test('общий лимит запросов: 300 в минуту с одного адреса', async () => {
  const s = await startServer();
  try {
    let limited = 0, okCount = 0;
    for (let i = 0; i < 320; i++) { const r = await s.req('GET', '/api/health'); if (r.status === 429) limited++; else if (r.status === 200) okCount++; }
    assert.equal(okCount, 300);
    assert.equal(limited, 20);
    s.clock.advance(61000);
    assert.equal((await s.req('GET', '/api/health')).status, 200);
  } finally { await s.close(); }
});

test('за обратным прокси (TRUST_PROXY=1) учитывается последний адрес в X-Forwarded-For, подделать начало цепочки нельзя', async () => {
  const s = await startServer({ env: { TRUST_PROXY: '1' } });
  try {
    const hit = async (xff, i) => (await s.req('GET', '/api/me', { headers: { authorization: 'tma bad' + i, 'x-forwarded-for': xff } })).status;
    const codes = [];
    for (let i = 0; i < 35; i++) codes.push(await hit(`10.0.${i}.1, 203.0.113.7`, i));   // начало цепочки меняется, настоящий адрес — нет
    assert.ok(codes.slice(30).every(c => c === 429), codes.join(','));
    assert.equal(await hit('1.1.1.1, 198.51.100.9', 99), 401, 'другой настоящий адрес — отдельный счётчик');
  } finally { await s.close(); }
  const s2 = await startServer();   // без доверия к прокси заголовок игнорируется
  try {
    const codes = [];
    for (let i = 0; i < 35; i++) codes.push((await s2.req('GET', '/api/me', { headers: { authorization: 'tma bad' + i, 'x-forwarded-for': `10.9.${i}.1` } })).status);
    assert.ok(codes.slice(30).every(c => c === 429), 'подмена X-Forwarded-For не обходит лимит');
  } finally { await s2.close(); }
});
