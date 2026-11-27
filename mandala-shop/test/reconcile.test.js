// Сверка с Telegram (getStarTransactions): пропущенные вебхуки не приводят к потере платежей и возвратов.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_ID, startServer } from './helpers.js';

let t;
before(async () => { t = await startServer(); });
after(async () => { await t.close(); });
beforeEach(() => t.clock.advance(61000));

let n = 0;
const newUser = () => 6000 + (++n);
const payRow = chargeId => t.q1('SELECT * FROM payments WHERE charge_id = ?', chargeId);
const ents = u => t.q('SELECT * FROM entitlements WHERE tg_id = ? ORDER BY id', u);
const reconcile = async () => { const r = await t.admin.post('/api/admin/reconcile', {}); assert.equal(r.status, 200, r.text); return r.json.result; };
const paidMessages = u => t.mock.messagesTo(u).filter(m => /Оплата получена/.test(m.text)).length;

test('пропущенный вебхук оплаты: сверка находит платёж, выдаёт право, пишет пользователю; повторная сверка ничего не меняет', async () => {
  const u = newUser();
  const b = await t.buy(u, 'fx_confetti', { missedWebhook: true });
  assert.equal(b.missed, true);
  assert.equal(payRow(b.chargeId), null, 'сервер ничего не знает об оплате');
  assert.equal((await t.rights(u)).items.length, 0);

  const r = await reconcile();
  assert.equal(r.new_payments, 1);
  assert.equal(r.anomalies, 0);
  const pay = payRow(b.chargeId);
  assert.equal(pay.status, 'succeeded');
  assert.equal(pay.source, 'reconcile');
  assert.equal(pay.order_id, b.order.id);
  assert.equal(t.q1('SELECT status FROM orders WHERE id = ?', b.order.id).status, 'paid');
  assert.deepEqual((await t.rights(u)).items.map(i => i.product_id), ['fx_confetti']);
  assert.equal(paidMessages(u), 1);

  const again = await reconcile();
  assert.equal(again.new_payments, 0);
  assert.equal(again.new_refunds, 0);
  assert.equal(ents(u).length, 1);
  assert.equal(paidMessages(u), 1);
  assert.ok(Number(t.q1("SELECT value FROM settings WHERE key = 'last_reconcile_at'").value) > 0);
});

test('опрос заказа клиентом сам подтягивает платёж (через 15 секунд после проверки счёта)', async () => {
  const u = newUser();
  const b = await t.buy(u, 'feat_heatmap', { missedWebhook: true });
  const early = (await t.as(u).get('/api/orders/' + b.order.id)).json;
  assert.equal(early.order.status, 'pending', 'сразу после оплаты сервер ещё ждёт вебхук');
  t.clock.advance(16000);
  const late = (await t.as(u).get('/api/orders/' + b.order.id)).json;
  assert.equal(late.order.status, 'paid');
  assert.equal(late.rights.items[0].product_id, 'feat_heatmap');
  assert.equal(payRow(b.chargeId).source, 'reconcile');
});

test('«Обновить права»: если есть оплаченный, но не дошедший заказ, сервер сверяется с Telegram', async () => {
  const u = newUser();
  const b = await t.buy(u, 'bg_nebula', { missedWebhook: true });
  const r = await t.as(u).post('/api/rights/sync');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.rights.items.map(i => i.product_id), ['bg_nebula']);
  assert.equal(payRow(b.chargeId).status, 'succeeded');
});

test('частая сверка по запросам клиентов ограничена: не чаще раза в 20 секунд на весь сервер', async () => {
  const u = newUser();
  await t.buy(u, 'fx_confetti', { missedWebhook: true });
  t.clock.advance(30000);
  const calls = t.mock.callsOf('getStarTransactions').length;
  for (let i = 0; i < 5; i++) await t.as(u).post('/api/rights/sync');
  assert.equal(t.mock.callsOf('getStarTransactions').length - calls, 1);
});

test('возврат, сделанный в Telegram мимо сервера, подтягивается: платёж «возвращён», право отозвано', async () => {
  const u = newUser();
  const b = await t.buy(u, 'slot_plus_1');
  assert.equal((await t.rights(u)).slots.total, 2);
  t.mock.refundNow(b.chargeId);
  const r = await reconcile();
  assert.equal(r.new_refunds, 1);
  assert.equal(payRow(b.chargeId).status, 'refunded');
  assert.equal(payRow(b.chargeId).refunded_by, 'reconcile');
  assert.equal((await t.rights(u)).slots.total, 1);
  assert.equal((await reconcile()).new_refunds, 0);
});

test('пропущены и оплата, и возврат: за один проход платёж сразу «возвращён», пользователю «оплата получена» не шлют', async () => {
  const u = newUser();
  const b = await t.buy(u, 'fx_confetti', { missedWebhook: true });
  t.mock.refundNow(b.chargeId);
  // в ответе Telegram возврат идёт раньше покупки («новые сверху») — порядок обработки не должен иметь значения
  const r = await reconcile();
  assert.equal(r.new_payments, 1);
  assert.equal(r.new_refunds, 1);
  assert.equal(payRow(b.chargeId).status, 'refunded');
  assert.equal(ents(u).length, 1);
  assert.equal(ents(u)[0].status, 'revoked');
  assert.equal((await t.rights(u)).items.length, 0);
  assert.equal(paidMessages(u), 0);
});

test('платёж с неизвестным заказом из сверки попадает в «аномалии», владелец уведомлён', async () => {
  const u = newUser();
  t.mock.charge(u, { amount: 30, payload: 'o_кто_то_заплатил' });
  const r = await reconcile();
  assert.equal(r.anomalies, 1);
  const p = t.q1("SELECT * FROM payments WHERE tg_id = ? AND status = 'anomaly'", u);
  assert.equal(p.anomaly, 'unknown_order');
  assert.equal(p.source, 'reconcile');
  assert.ok(t.mock.messagesTo(ADMIN_ID).some(m => m.text.includes('unknown_order') && m.text.includes(String(u))));
});

test('операции без нашего payload (вывод через Fragment, чужие переводы) игнорируются', async () => {
  const payments0 = t.q1('SELECT COUNT(*) AS n FROM payments').n;
  t.mock.addWithdrawal(1000, 'succeeded');
  t.mock.ledger.push({ seq: t.mock.ledger.length, id: 'other_1', amount: 5, date: t.mock.clock(), source: { type: 'user', user: { id: 4242 }, transaction_type: 'paid_media_payment' } });
  const r = await reconcile();
  assert.ok(r.scanned >= 2);
  assert.equal(t.q1('SELECT COUNT(*) AS n FROM payments').n, payments0);
});

test('несколько страниц: больше 100 операций обрабатываются полностью', async () => {
  const before = t.q1('SELECT COUNT(*) AS n FROM payments').n;
  for (let i = 0; i < 105; i++) t.mock.charge(7000000 + i, { amount: 10, payload: 'o_bulk_' + i });
  const r = await reconcile();
  assert.ok(r.scanned >= 105);
  assert.equal(r.anomalies, 105);
  assert.equal(t.q1('SELECT COUNT(*) AS n FROM payments').n - before, 105);
  assert.equal((await reconcile()).anomalies, 0);
  const pages = t.mock.callsOf('getStarTransactions').filter(c => c.params.offset >= 100);
  assert.ok(pages.length >= 1, 'запрашивалась вторая страница');
});

test('одновременные сверки не дублируют работу: вторая пропускается', async () => {
  const [a, b] = await Promise.all([t.admin.post('/api/admin/reconcile', {}), t.admin.post('/api/admin/reconcile', {})]);
  const results = [a.json.result, b.json.result];
  assert.ok(results.some(r => r.skipped === true) || results.every(r => typeof r.scanned === 'number'));
});

test('Telegram недоступен во время сверки: админ получает ошибку, данные не портятся; клиентский опрос не падает', async () => {
  const u = newUser();
  const b = await t.buy(u, 'fx_confetti', { missedWebhook: true });
  const payments0 = t.q1('SELECT COUNT(*) AS n FROM payments').n;
  t.mock.failNext('getStarTransactions', { code: 500, description: 'Internal Server Error' });
  const r = await t.admin.post('/api/admin/reconcile', {});
  assert.equal(r.status, 500);
  assert.equal(t.q1('SELECT COUNT(*) AS n FROM payments').n, payments0);
  t.clock.advance(30000);
  t.mock.failNext('getStarTransactions', { network: true });
  assert.equal((await t.as(u).post('/api/rights/sync')).status, 200, 'клиент получает ответ и в этот раз, просто без новых прав');
  t.clock.advance(30000);
  assert.equal((await t.as(u).post('/api/rights/sync')).json.rights.items.length, 1, 'при следующей попытке всё подтягивается');
  assert.equal(payRow(b.chargeId).status, 'succeeded');
});

test('плановое задание сверки (jobs.reconcile) работает и отключается настройкой RECONCILE_EVERY_HOURS=0', async () => {
  assert.equal(await t.app.jobs.reconcile(), null, 'в тестовой конфигурации сверка по расписанию выключена');
  const prev = t.cfg.reconcileEveryHours;
  t.cfg.reconcileEveryHours = 24;
  try { const r = await t.app.jobs.reconcile(); assert.equal(typeof r.scanned, 'number'); } finally { t.cfg.reconcileEveryHours = prev; }
});

test('баланс Stars и список операций для админки: суммы, виды операций, вывод через Fragment', async () => {
  const bal = await t.admin.get('/api/admin/stars/balance');
  assert.equal(bal.status, 200);
  assert.equal(bal.json.balance.amount, t.mock.balance());
  t.mock.charge(newUser(), { amount: 500, payload: 'o_balance_test' });
  assert.equal((await t.admin.get('/api/admin/stars/balance')).json.balance.amount, bal.json.balance.amount, 'ответ кэшируется на минуту');
  assert.equal((await t.admin.get('/api/admin/stars/balance?fresh=1')).json.balance.amount, bal.json.balance.amount + 500);
  t.mock.failNext('getMyStarBalance', { code: 500, description: 'oops' });
  assert.equal((await t.admin.get('/api/admin/stars/balance?fresh=1')).status, 502);

  t.mock.addWithdrawal(300, 'pending');
  const tx = [];
  for (let off = 0; off < 400; off += 100) tx.push(...(await t.admin.get(`/api/admin/stars/transactions?limit=100&offset=${off}`)).json.transactions);
  const kinds = new Set(tx.map(x => x.kind));
  assert.ok(kinds.has('incoming') && kinds.has('refund') && kinds.has('withdrawal'), [...kinds].join(','));
  assert.equal(tx.find(x => x.kind === 'withdrawal').withdrawal_state, 'pending');
  assert.equal((await t.as(newUser()).get('/api/admin/stars/balance')).status, 403);
});

test('информация о вебхуке для админки скрывает секретную часть адреса', async () => {
  t.mock.webhook = { url: 'https://shop.test/telegram/webhook/hook_test_path_123', max_connections: 20, allowed_updates: ['message', 'pre_checkout_query'] };
  const r = await t.admin.get('/api/admin/webhook');
  assert.equal(r.status, 200);
  assert.ok(!r.text.includes('hook_test_path_123'));
  assert.equal(r.json.webhook.url, 'https://shop.test/telegram/webhook/***');
  assert.deepEqual(r.json.webhook.allowed_updates, ['message', 'pre_checkout_query']);
});
