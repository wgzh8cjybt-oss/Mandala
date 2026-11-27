// successful_payment: запись платежа, выдача прав, защита от двойной обработки, аномалии, права по типам товаров.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createCtx } from '../src/ctx.js';
import { openDb } from '../src/db.js';
import { recordPayment } from '../src/payments.js';
import { ADMIN_ID, BOT_TOKEN, startServer } from './helpers.js';

let t;
before(async () => { t = await startServer(); });
after(async () => { await t.close(); });
beforeEach(() => t.clock.advance(61000));

let n = 0;
const newUser = () => 8000 + (++n);
const count = (sql, ...p) => t.q1(sql, ...p).n;
const payments = u => t.q('SELECT * FROM payments WHERE tg_id = ? ORDER BY id', u);
const ents = u => t.q('SELECT * FROM entitlements WHERE tg_id = ? ORDER BY id', u);
const eventsOf = (type, ref) => t.q('SELECT * FROM events_log WHERE type = ? AND ref = ?', type, ref);

/** Платёж «с нуля» в обход pre_checkout: Telegram списал Stars, на сервер пришло successful_payment с нужными полями. */
async function rawPay(userId, o = {}) {
  const amount = o.amount, payload = o.payload;
  const chargeId = o.chargeId ?? t.mock.charge(userId, { amount, payload });
  const update = t.successfulPaymentUpdate({ userId: o.fromUser ?? userId, payload, amount, chargeId, currency: o.currency, updateId: o.updateId });
  const r = await t.webhook(update);
  return { r, chargeId, update };
}

test('оплата слота: платёж, заказ, право и сообщение пользователю записываются согласованно', async () => {
  const u = newUser();
  const r = await t.buy(u, 'slot_plus_1');
  assert.equal(r.paid, true);
  assert.equal(r.res.status, 200);
  const pay = t.q1('SELECT * FROM payments WHERE charge_id = ?', r.chargeId);
  assert.equal(pay.status, 'succeeded');
  assert.equal(pay.amount, 50);
  assert.equal(pay.currency, 'XTR');
  assert.equal(pay.tg_id, u);
  assert.equal(pay.order_id, r.order.id);
  assert.equal(pay.source, 'webhook');
  assert.equal(pay.provider_charge_id, r.chargeId);
  assert.equal(pay.anomaly, null);
  assert.ok(!(pay.raw_json || '').includes(BOT_TOKEN));
  assert.ok(JSON.parse(pay.raw_json).telegram_payment_charge_id === r.chargeId, 'сырые данные платежа сохранены для разбора споров');

  const order = t.q1('SELECT * FROM orders WHERE id = ?', r.order.id);
  assert.equal(order.status, 'paid');
  assert.equal(order.paid_at, t.clock.t);

  const [e] = ents(u);
  assert.equal(e.kind, 'slot'); assert.equal(e.source, 'purchase'); assert.equal(e.status, 'active');
  assert.equal(e.order_id, order.id); assert.equal(e.payment_id, pay.id); assert.equal(e.product_id, 'slot_plus_1');

  const rights = await t.rights(u);
  assert.deepEqual(rights.slots, { extra: 1, total: 2, max: 10 });
  assert.equal(rights.items.length, 1);

  const msgs = t.mock.messagesTo(u).map(m => m.text).join('\n');
  assert.match(msgs, /Оплата получена/);
  assert.ok(msgs.includes(order.id), 'в сообщении есть номер заказа');
  assert.equal(t.mock.messagesTo(ADMIN_ID).filter(m => m.text.includes(order.id)).length, 0, 'обычная оплата админа не беспокоит');

  assert.equal(eventsOf('payment_succeeded', r.chargeId).length, 1);
  assert.equal(eventsOf('order_created', order.id).length, 1);
  assert.equal(eventsOf('pre_checkout_ok', order.id).length, 1);
});

test('опрос заказа после оплаты: статус «paid» и свежий снимок прав приходят с сервера', async () => {
  const u = newUser();
  const o = await t.order(u, 'fx_confetti');
  const before = (await t.as(u).get('/api/orders/' + o.id)).json;
  assert.equal(before.order.status, 'pending');
  assert.equal(before.rights, undefined);
  const r = await t.pay(o.invoice_link, u);
  assert.equal(r.paid, true);
  const after = (await t.as(u).get('/api/orders/' + o.id)).json;
  assert.equal(after.order.status, 'paid');
  assert.equal(after.order.invoice_link, undefined);
  assert.equal(after.rights.items[0].product_id, 'fx_confetti');
  assert.deepEqual(after.rights.items[0].grant, { preset: 'confetti' });
  const hist = (await t.as(u).get('/api/orders')).json.orders[0];
  assert.equal(hist.status, 'paid');
  assert.equal(hist.payment.charge_id, r.chargeId);
});

test('права живут на сервере: после «повторного входа» (новая подпись) приходит то же самое', async () => {
  const u = newUser();
  await t.buy(u, 'bg_nebula');
  await t.buy(u, 'fx_confetti');
  const a = await t.rights(u);
  t.clock.advance(5 * 3600e3);
  const b = await t.rights(u);
  assert.equal(a.etag, b.etag);
  assert.deepEqual(b.items.map(i => i.product_id), ['bg_nebula', 'fx_confetti']);
  assert.equal((await t.as(u).post('/api/rights/sync')).json.rights.etag, a.etag);
  await t.buy(u, 'feat_heatmap');
  assert.notEqual((await t.rights(u)).etag, a.etag, 'etag меняется вместе с набором прав');
});

/* ---------------- защита от двойной обработки ---------------- */
test('одно и то же обновление, доставленное повторно, не создаёт второго платежа и права', async () => {
  const u = newUser();
  const o = await t.order(u, 'fx_confetti');
  const chargeId = t.mock.charge(u, { amount: o.amount, payload: o.id });
  const update = t.successfulPaymentUpdate({ userId: u, payload: o.id, amount: o.amount, chargeId });
  assert.equal((await t.webhook(update)).status, 200);
  assert.equal((await t.webhook(update)).status, 200);
  assert.equal((await t.webhook(update)).status, 200);
  assert.equal(payments(u).length, 1);
  assert.equal(ents(u).length, 1);
  assert.equal(t.mock.messagesTo(u).filter(m => /Оплата получена/.test(m.text)).length, 1, 'пользователю не пишут трижды');
});

test('тот же платёж под новым номером обновления (повтор от Telegram или сверки) тоже не дублируется', async () => {
  const u = newUser();
  const o = await t.order(u, 'fx_confetti');
  const chargeId = t.mock.charge(u, { amount: o.amount, payload: o.id });
  await rawPay(u, { amount: o.amount, payload: o.id, chargeId });
  await rawPay(u, { amount: o.amount, payload: o.id, chargeId });
  assert.equal(payments(u).length, 1);
  assert.equal(ents(u).length, 1);
  assert.equal(eventsOf('payment_duplicate', chargeId).length, 1);
});

test('восемь одновременных доставок одного платежа дают один платёж и одно право', async () => {
  const u = newUser();
  const o = await t.order(u, 'slot_plus_1');
  const chargeId = t.mock.charge(u, { amount: o.amount, payload: o.id });
  const update = t.successfulPaymentUpdate({ userId: u, payload: o.id, amount: o.amount, chargeId });
  const rs = await Promise.all(Array.from({ length: 8 }, () => t.webhook(update)));
  assert.ok(rs.every(r => r.status === 200));
  const more = await Promise.all(Array.from({ length: 4 }, () => t.webhook(t.successfulPaymentUpdate({ userId: u, payload: o.id, amount: o.amount, chargeId }))));
  assert.ok(more.every(r => r.status === 200));
  assert.equal(payments(u).length, 1);
  assert.equal(ents(u).length, 1);
  assert.equal((await t.rights(u)).slots.extra, 1, 'слот выдан один раз');
});

test('два соединения с одной базой: второй вызов видит платёж первого (защита держится в БД, а не в памяти процесса)', async () => {
  const u = newUser();
  const o = await t.order(u, 'fx_confetti');
  const db2 = openDb(path.join(t.cfg.dataDir, 'mandala.sqlite'));
  try {
    const ctx2 = createCtx({ cfg: t.cfg, db: db2, tg: t.ctx.tg, log: t.ctx.log, now: () => t.clock.t });
    const p = { chargeId: 'two_conn_charge_1', tgId: u, amount: o.amount, currency: 'XTR', payload: o.id, source: 'webhook' };
    assert.equal(recordPayment(t.ctx, p).result, 'granted');
    assert.equal(recordPayment(ctx2, p).result, 'duplicate');
    assert.equal(recordPayment(ctx2, { ...p, chargeId: 'two_conn_charge_2' }).result, 'anomaly', 'другой платёж за уже оплаченный заказ — на разбор');
  } finally { db2.close(); }
  assert.equal(ents(u).length, 1);
});

test('на уровне базы нельзя выдать одно и то же право по одному заказу дважды', async () => {
  const u = newUser();
  const o = await t.order(u, 'fx_confetti');
  const ins = () => t.db.prepare("INSERT INTO entitlements(tg_id, product_id, kind, grant_json, source, order_id, status, created_at) VALUES (?,?,?,?,?,?,?,?)").run(u, 'fx_confetti', 'effect', '{}', 'purchase', o.id, 'active', 1);
  ins();
  assert.throws(ins, /UNIQUE/);
  t.db.prepare('DELETE FROM entitlements WHERE order_id = ?').run(o.id);
});

/* ---------------- аномалии ---------------- */
const anomaly = async (userId, code) => {
  const p = payments(userId).at(-1);
  assert.equal(p.status, 'anomaly');
  assert.equal(p.anomaly, code);
  assert.equal(ents(userId).length, 0, 'при аномалии права не выдаются');
  assert.equal(eventsOf('payment_anomaly', p.charge_id).length, 1);
  const admin = t.mock.messagesTo(ADMIN_ID).map(m => m.text).join('\n');
  assert.ok(admin.includes(code) && admin.includes(`<code>${userId}</code>`), 'владельцу ушло сообщение с причиной');
  return p;
};

test('аномалия: сумма платежа не совпала с заказом — права не выдаются, владелец уведомлён', async () => {
  const u = newUser();
  const o = await t.order(u, 'fx_confetti');
  await rawPay(u, { amount: 1, payload: o.id });
  await anomaly(u, 'amount_mismatch');
  assert.equal(t.q1('SELECT status FROM orders WHERE id = ?', o.id).status, 'pending', 'заказ остаётся неоплаченным');
});

test('аномалия: неизвестный номер заказа (в том числе «мусорный» огромный payload)', async () => {
  const u = newUser();
  await rawPay(u, { amount: 25, payload: 'o_несуществует' });
  const p = await anomaly(u, 'unknown_order');
  assert.equal(p.order_id, null);
  const u2 = newUser();
  await rawPay(u2, { amount: 25, payload: 'x'.repeat(5000) });
  const p2 = payments(u2)[0];
  assert.equal(p2.anomaly, 'unknown_order');
  assert.ok(Array.from(p2.payload).length <= 200, 'мусор в payload обрезается');
});

test('аномалия: платёж по чужому заказу', async () => {
  const owner = newUser(), payer = newUser();
  const o = await t.order(owner, 'fx_confetti');
  await rawPay(payer, { amount: o.amount, payload: o.id });
  await anomaly(payer, 'user_mismatch');
  assert.equal(ents(owner).length, 0, 'владелец заказа тоже ничего не получил');
  assert.equal(t.q1('SELECT status FROM orders WHERE id = ?', o.id).status, 'pending');
});

test('аномалия: валюта не XTR', async () => {
  const u = newUser();
  const o = await t.order(u, 'fx_confetti');
  await rawPay(u, { amount: o.amount, payload: o.id, currency: 'USD' });
  await anomaly(u, 'currency');
});

test('аномалия: второй платёж за уже оплаченный заказ — права не удваиваются', async () => {
  const u = newUser();
  const r = await t.buy(u, 'feat_export_png');
  await rawPay(u, { amount: r.order.amount, payload: r.order.id });
  const p = payments(u).at(-1);
  assert.equal(p.anomaly, 'order_already_paid');
  assert.equal(ents(u).length, 1);
  assert.equal(count("SELECT COUNT(*) AS n FROM payments WHERE tg_id = ? AND status = 'anomaly'", u), 1);
});

test('аномалия: оплата заказа, у которого счёт не был создан (failed)', async () => {
  const u = newUser();
  const o = await t.order(u, 'fx_confetti');
  t.db.prepare("UPDATE orders SET status = 'failed' WHERE id = ?").run(o.id);
  await rawPay(u, { amount: o.amount, payload: o.id });
  await anomaly(u, 'order_failed');
});

test('аномалии видны в админке, их можно пометить решёнными, они не попадают в оборот', async () => {
  const u = newUser();
  await rawPay(u, { amount: 77, payload: 'o_ghost' });
  const d = (await t.admin.get('/api/admin/dashboard')).json;
  const row = d.anomalies.find(a => a.tg_id === u);
  assert.ok(row);
  assert.equal(row.anomaly, 'unknown_order');
  const before = d.stats.totals.gross_stars;
  assert.equal(d.stats.totals.anomalies_count >= 1, true);
  const res = await t.admin.post(`/api/admin/payments/${t.q1('SELECT id FROM payments WHERE tg_id = ?', u).id}/resolve`, { note: 'проверил, вернул вручную' });
  assert.equal(res.status, 200);
  const d2 = (await t.admin.get('/api/admin/dashboard')).json;
  assert.ok(!d2.anomalies.find(a => a.tg_id === u));
  assert.equal(d2.stats.totals.gross_stars - before >= 0, true);
  const again = await t.admin.post(`/api/admin/payments/${t.q1('SELECT id FROM payments WHERE tg_id = ? AND status = ?', u, 'anomaly').id}/resolve`, {});
  assert.equal(again.status, 200, 'повторная пометка не ломается');
  const ok = await t.buy(newUser(), 'fx_confetti');
  const notAnomaly = await t.admin.post(`/api/admin/payments/${t.q1('SELECT id FROM payments WHERE charge_id = ?', ok.chargeId).id}/resolve`, {});
  assert.equal(notAnomaly.status, 409);
});

test('поздняя оплата: счёт истёк, но Stars списаны — право выдаётся (деньги важнее срока), событие записано', async () => {
  const u = newUser();
  const o = await t.order(u, 'fx_confetti');
  await t.webhook(t.preCheckoutUpdate({ userId: u, payload: o.id, amount: o.amount }));
  const chargeId = t.mock.charge(u, { amount: o.amount, payload: o.id });   // Stars списаны в Telegram
  t.clock.advance(3600e3 + 30000);
  t.app.jobs.housekeeping();
  assert.equal(t.q1('SELECT status FROM orders WHERE id = ?', o.id).status, 'expired');
  await t.webhook(t.successfulPaymentUpdate({ userId: u, payload: o.id, amount: o.amount, chargeId }));
  assert.equal(t.q1('SELECT status FROM orders WHERE id = ?', o.id).status, 'paid');
  assert.equal(ents(u).length, 1);
  assert.equal(eventsOf('late_payment', o.id).length, 1);
});

test('сообщение об оплате без номера платежа или суммы фиксируется как «битое», сервер отвечает 200', async () => {
  const u = newUser();
  const update = t.successfulPaymentUpdate({ userId: u, payload: 'o_x', amount: 10, chargeId: '' });
  const r = await t.webhook(update);
  assert.equal(r.status, 200);
  assert.equal(count("SELECT COUNT(*) AS n FROM events_log WHERE type = 'payment_malformed'"), 1);
  assert.equal(payments(u).length, 0);
  const bad2 = t.successfulPaymentUpdate({ userId: u, payload: 'o_x', amount: -5, chargeId: 'abc' });
  assert.equal((await t.webhook(bad2)).status, 200);
  assert.equal(payments(u).length, 0);
  assert.ok(t.mock.messagesTo(ADMIN_ID).some(m => /неверной структурой/.test(m.text)));
});

test('пользователь заблокировал бота: оплата всё равно записывается и права выдаются', async () => {
  const u = newUser();
  const o = await t.order(u, 'fx_confetti');
  t.mock.blockedChats.add(u);
  const chargeId = t.mock.charge(u, { amount: o.amount, payload: o.id });
  const r = await t.webhook(t.successfulPaymentUpdate({ userId: u, payload: o.id, amount: o.amount, chargeId }));
  assert.equal(r.status, 200);
  assert.equal(ents(u).length, 1);
  assert.ok(t.logs.some(l => l.includes('sendMessage не удался')));
  t.mock.blockedChats.delete(u);
});

/* ---------------- права по типам товаров ---------------- */
test('слоты мандал: первый бесплатный, купленные добавляются, максимум соблюдается', async () => {
  const u = newUser();
  assert.deepEqual((await t.rights(u)).slots, { extra: 0, total: 1, max: 10 });
  for (let i = 0; i < 3; i++) assert.equal((await t.buy(u, 'slot_plus_3')).paid, true);
  assert.deepEqual((await t.rights(u)).slots, { extra: 9, total: 10, max: 10 });
  const r1 = await t.as(u).post('/api/orders', { product_id: 'slot_plus_1' });
  assert.equal(r1.status, 409);
  assert.equal(r1.json.error.code, 'slot_limit');
  const cat = (await t.as(u).get('/api/catalog')).json.products.find(p => p.id === 'slot_plus_3');
  assert.equal(cat.can_buy, false);
  assert.equal(cat.reason, 'slot_limit');
  assert.equal(cat.owned, 3, 'слоты можно покупать повторно');
});

test('товар «один на пользователя»: повторная покупка запрещена, в каталоге виден владелец', async () => {
  const u = newUser();
  await t.buy(u, 'bg_nebula');
  const r = await t.as(u).post('/api/orders', { product_id: 'bg_nebula' });
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, 'owned');
  const p = (await t.as(u).get('/api/catalog')).json.products.find(x => x.id === 'bg_nebula');
  assert.equal(p.owned, 1);
  assert.equal(p.can_buy, false);
});

test('огоньки: пачка приходит как «ждущая», получение подтверждается один раз и только владельцем', async () => {
  const u = newUser(), other = newUser();
  await t.buy(u, 'flames_50');
  await t.buy(u, 'flames_50');
  const rights = await t.rights(u);
  assert.equal(rights.items.length, 0, 'огоньки — не постоянное право');
  assert.equal(rights.consumables.length, 2);
  assert.deepEqual(rights.consumables.map(c => c.flames), [50, 50]);
  const [a, b] = rights.consumables;
  const foreign = await t.as(other).post('/api/claim', { ids: [a.id] });
  assert.equal(foreign.json.claimed, 0, 'чужие огоньки получить нельзя');
  const c1 = await t.as(u).post('/api/claim', { ids: [a.id] });
  assert.equal(c1.json.claimed, 1);
  assert.deepEqual(c1.json.rights.consumables.map(c => c.id), [b.id]);
  assert.equal((await t.as(u).post('/api/claim', { ids: [a.id, a.id] })).json.claimed, 0, 'повтор безвреден');
  assert.equal((await t.as(u).post('/api/claim', { ids: 'все' })).status, 400);
  assert.equal((await t.as(u).post('/api/claim', { ids: [1.5] })).status, 400);
});

test('права по типам: вселенная, фон, анимация, эффект, реликвии, функция — каждое со своим описанием', async () => {
  const u = newUser();
  for (const id of ['uni_onepiece', 'bg_wh_forge', 'anim_wh_embers', 'fx_wh_sparks', 'col_wh', 'feat_export_png']) assert.equal((await t.buy(u, id)).paid, true, id);
  const items = Object.fromEntries((await t.rights(u)).items.map(i => [i.product_id, i]));
  assert.deepEqual(items.uni_onepiece.grant, { builtin: 'onepiece' });
  assert.deepEqual(items.bg_wh_forge.grant, { mode: 'css', preset: 'forge' });
  assert.deepEqual(items.anim_wh_embers.grant, { mode: 'css', preset: 'embers' });
  assert.deepEqual(items.fx_wh_sparks.grant, { preset: 'sparks' });
  assert.deepEqual(items.col_wh.grant, { relics: ['wh_2', 'wh_3'] });
  assert.deepEqual(items.feat_export_png.grant, { feature: 'export_png' });
  assert.equal(items.uni_onepiece.kind, 'universe');
});

test('если владелец поправил товар, у покупателей показывается актуальное содержимое (кроме слотов — они по снимку)', async () => {
  const u = newUser();
  await t.buy(u, 'bg_nebula');
  await t.buy(u, 'slot_plus_1');
  await t.admin.put('/api/admin/products/bg_nebula', { grant: { mode: 'css', preset: 'vault' } });
  await t.admin.put('/api/admin/products/slot_plus_1', { grant: { slots: 2 } });
  const r = await t.rights(u);
  assert.deepEqual(r.items.find(i => i.product_id === 'bg_nebula').grant, { mode: 'css', preset: 'vault' });
  assert.equal(r.slots.extra, 1, 'купленный слот не «подорожал» задним числом');
  await t.admin.put('/api/admin/products/slot_plus_1', { grant: { slots: 1 } });
});

test('история платежей и заказов пользователя в админке', async () => {
  const u = newUser();
  const r = await t.buy(u, 'feat_heatmap');
  const d = (await t.admin.get(`/api/admin/users/${u}`)).json;
  assert.equal(d.user.tg_id, u);
  assert.equal(d.orders[0].title, 'Годовая карта активности');
  assert.equal(d.payments[0].charge_id, r.chargeId);
  assert.equal(d.entitlements[0].product_id, 'feat_heatmap');
  const list = (await t.admin.get('/api/admin/payments?q=' + r.chargeId)).json.payments;
  assert.equal(list.length, 1);
  assert.equal(list[0].username, 'user' + u);
});
