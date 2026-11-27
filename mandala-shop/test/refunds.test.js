// Возвраты Stars (refundStarPayment), сообщения refunded_payment от Telegram, ручная выдача и отзыв прав.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_ID, startServer, tgUser } from './helpers.js';

let t;
before(async () => { t = await startServer({ timeoutMs: 400 }); });
after(async () => { await t.close(); });
beforeEach(() => t.clock.advance(61000));

let n = 0;
const newUser = () => 9000 + (++n);
const payRow = chargeId => t.q1('SELECT * FROM payments WHERE charge_id = ?', chargeId);
const refund = (chargeId, reason) => t.admin.post(`/api/admin/payments/${payRow(chargeId).id}/refund`, { reason });
const ents = u => t.q('SELECT * FROM entitlements WHERE tg_id = ? ORDER BY id', u);
const refundCalls = () => t.mock.callsOf('refundStarPayment').length;
const refundedUpdate = (u, b, uid) => ({
  update_id: uid ?? t.nextUpdateId(),
  message: { message_id: 7, date: t.mock.clock(), chat: { id: u, type: 'private' }, from: tgUser(u), refunded_payment: { currency: 'XTR', total_amount: b.order.amount, invoice_payload: b.order.id, telegram_payment_charge_id: b.chargeId } }
});

test('возврат администратором: Stars возвращаются через Bot API, право отзывается, остальные покупки целы', async () => {
  const u = newUser();
  const slot = await t.buy(u, 'slot_plus_1');
  const fx = await t.buy(u, 'fx_confetti');
  assert.equal((await t.rights(u)).slots.total, 2);
  const etag0 = (await t.rights(u)).etag;
  const balance0 = t.mock.balance();

  const r = await refund(slot.chargeId, 'просьба пользователя');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(t.mock.lastCall('refundStarPayment').params, { user_id: u, telegram_payment_charge_id: slot.chargeId });
  const pay = payRow(slot.chargeId);
  assert.equal(pay.status, 'refunded');
  assert.equal(pay.refunded_by, 'tg:' + ADMIN_ID);
  assert.equal(pay.refund_reason, 'просьба пользователя');
  assert.equal(pay.refunded_at, t.clock.t);
  assert.equal(pay.refund_error, null);
  assert.equal(t.q1('SELECT status FROM orders WHERE id = ?', slot.order.id).status, 'refunded');
  const e = ents(u).find(x => x.product_id === 'slot_plus_1');
  assert.equal(e.status, 'revoked');
  assert.equal(e.revoke_reason, 'refund');

  const rights = await t.rights(u);
  assert.equal(rights.slots.total, 1, 'слот отозван');
  assert.deepEqual(rights.items.map(i => i.product_id), ['fx_confetti'], 'остальные покупки на месте');
  assert.notEqual(rights.etag, etag0);
  assert.equal(payRow(fx.chargeId).status, 'succeeded');
  assert.ok(t.mock.refunded(slot.chargeId));
  assert.equal(t.mock.balance(), balance0 - 50);

  assert.ok(t.q1("SELECT 1 AS x FROM audit_log WHERE action = 'payment.refund_request' AND actor = ?", 'tg:' + ADMIN_ID));
  assert.equal(t.q("SELECT 1 FROM events_log WHERE type IN ('refund_requested','refund_succeeded') AND ref = ?", slot.chargeId).length, 2);
  const hist = (await t.as(u).get('/api/orders')).json.orders.find(o => o.id === slot.order.id);
  assert.equal(hist.status, 'refunded');
  assert.equal(hist.payment.status, 'refunded');
});

test('повторный возврат того же платежа невозможен и не обращается к Telegram', async () => {
  const u = newUser();
  const b = await t.buy(u, 'fx_confetti');
  assert.equal((await refund(b.chargeId)).status, 200);
  const calls = refundCalls();
  const again = await refund(b.chargeId);
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, 'already_refunded');
  assert.equal(refundCalls(), calls);
});

test('после возврата товар можно купить заново (владение считается по действующим правам)', async () => {
  const u = newUser();
  const b = await t.buy(u, 'bg_nebula');
  assert.equal((await t.as(u).post('/api/orders', { product_id: 'bg_nebula' })).status, 409);
  await refund(b.chargeId);
  const again = await t.buy(u, 'bg_nebula');
  assert.equal(again.paid, true);
  assert.deepEqual((await t.rights(u)).items.map(i => i.product_id), ['bg_nebula']);
});

test('Telegram отклонил возврат: платёж и право остаются, причина сохранена, повтор возможен', async () => {
  const u = newUser();
  const b = await t.buy(u, 'fx_confetti');
  t.mock.failNext('refundStarPayment', { code: 400, description: 'Bad Request: CHARGE_ID_INVALID' });
  const r = await refund(b.chargeId);
  assert.equal(r.status, 502);
  assert.equal(r.json.error.code, 'refund_failed');
  assert.match(r.json.error.message, /CHARGE_ID_INVALID/);
  const pay = payRow(b.chargeId);
  assert.equal(pay.status, 'succeeded');
  assert.match(pay.refund_error, /CHARGE_ID_INVALID/);
  assert.equal(ents(u)[0].status, 'active');
  assert.equal(t.q("SELECT 1 FROM events_log WHERE type = 'refund_failed' AND ref = ?", b.chargeId).length, 1);
  assert.equal((await refund(b.chargeId)).status, 200, 'после устранения причины возврат проходит');
  assert.equal(payRow(b.chargeId).refund_error, null);
});

test('нет ответа от Telegram: исход неизвестен — платёж «возвращается», повтор через минуту, «уже возвращён» считается успехом', async () => {
  const u = newUser();
  const b = await t.buy(u, 'fx_confetti');
  t.mock.failNext('refundStarPayment', { network: true });
  const r = await refund(b.chargeId);
  assert.equal(r.status, 502);
  assert.equal(r.json.error.code, 'refund_unknown');
  assert.equal(payRow(b.chargeId).status, 'refund_pending');
  assert.equal(ents(u)[0].status, 'active', 'пока не подтверждено, право не отзываем');

  t.mock.refundNow(b.chargeId);   // на самом деле Telegram возврат выполнил
  const soon = await refund(b.chargeId);
  assert.equal(soon.status, 409);
  assert.equal(soon.json.error.code, 'refund_in_progress');
  t.clock.advance(61000);
  const ok = await refund(b.chargeId);
  assert.equal(ok.status, 200, ok.text);
  assert.equal(payRow(b.chargeId).status, 'refunded');
  assert.equal(ents(u)[0].status, 'revoked');
});

test('зависший ответ Telegram (таймаут) обрабатывается так же, как обрыв связи', async () => {
  const u = newUser();
  const b = await t.buy(u, 'fx_confetti');
  t.mock.failNext('refundStarPayment', { hang: true });
  const r = await refund(b.chargeId);
  assert.equal(r.status, 502);
  assert.equal(r.json.error.code, 'refund_unknown');
  assert.equal(payRow(b.chargeId).status, 'refund_pending');
});

test('Telegram сообщил о возврате (refunded_payment): платёж помечается возвращённым, право отзывается, повторы безвредны', async () => {
  const u = newUser();
  const b = await t.buy(u, 'slot_plus_1');
  const upd = refundedUpdate(u, b);
  assert.equal((await t.webhook(upd)).status, 200);
  const pay = payRow(b.chargeId);
  assert.equal(pay.status, 'refunded');
  assert.equal(pay.refunded_by, 'telegram');
  assert.equal((await t.rights(u)).slots.total, 1);
  assert.equal((await t.webhook(upd)).status, 200);
  assert.equal((await t.webhook(refundedUpdate(u, b))).status, 200, 'то же сообщение под новым номером обновления');
  assert.equal(t.q("SELECT 1 FROM events_log WHERE type = 'refund_succeeded' AND ref = ?", b.chargeId).length, 1);
  assert.equal((await refund(b.chargeId)).status, 409, 'вернуть ещё раз нельзя');
});

test('refunded_payment про неизвестный платёж или без номера фиксируется в журнале, сервер не падает', async () => {
  const u = newUser();
  const fake = { order: { id: 'o_x', amount: 5 }, chargeId: 'нет_такого_платежа' };
  assert.equal((await t.webhook(refundedUpdate(u, fake))).status, 200);
  assert.equal(t.q("SELECT 1 FROM events_log WHERE type = 'refund_unknown' AND ref = 'нет_такого_платежа'").length, 1);
  const bad = refundedUpdate(u, { order: { id: 'o_x', amount: 5 }, chargeId: '' });
  assert.equal((await t.webhook(bad)).status, 200);
  assert.ok(t.q1("SELECT 1 AS x FROM events_log WHERE type = 'refund_malformed'"));
});

test('огоньки: возврат пачки, которую пользователь уже получил, создаёт «списание»; неполученную просто убирает', async () => {
  const u = newUser();
  const a = await t.buy(u, 'flames_50');
  const b = await t.buy(u, 'flames_150');
  const [ca] = (await t.rights(u)).consumables;
  assert.equal(ca.flames, 50);
  await t.as(u).post('/api/claim', { ids: [ca.id] });      // клиент уже получил и потратил 50
  await refund(a.chargeId);
  await refund(b.chargeId);                                   // 150 ещё не получал
  const rights = await t.rights(u);
  assert.deepEqual(rights.consumables.map(c => c.flames), [-50], 'остаётся только списание полученных 50');
  assert.equal(ents(u).filter(e => e.source === 'refund_debit').length, 1);
  assert.equal(ents(u).find(e => e.product_id === 'flames_150').status, 'revoked');
  const claimed = await t.as(u).post('/api/claim', { ids: [rights.consumables[0].id] });
  assert.equal(claimed.json.claimed, 1);
  assert.deepEqual(claimed.json.rights.consumables, []);
  assert.equal((await t.rights(u)).consumables.length, 0);
});

test('возврат платежа с аномалией (неизвестный заказ): Stars возвращаются, прав нет', async () => {
  const u = newUser();
  const chargeId = t.mock.charge(u, { amount: 33, payload: 'o_ghost_order' });
  await t.webhook(t.successfulPaymentUpdate({ userId: u, payload: 'o_ghost_order', amount: 33, chargeId }));
  assert.equal(payRow(chargeId).status, 'anomaly');
  const r = await refund(chargeId, 'ошибочный платёж');
  assert.equal(r.status, 200, r.text);
  assert.equal(payRow(chargeId).status, 'refunded');
  assert.ok(t.mock.refunded(chargeId));
  assert.equal(ents(u).length, 0);
});

test('если возврат аномалии не прошёл, платёж возвращается в состояние «аномалия», а не «успешный»', async () => {
  const u = newUser();
  const chargeId = t.mock.charge(u, { amount: 33, payload: 'o_ghost_two' });
  await t.webhook(t.successfulPaymentUpdate({ userId: u, payload: 'o_ghost_two', amount: 33, chargeId }));
  t.mock.failNext('refundStarPayment', { code: 400, description: 'Bad Request: test' });
  assert.equal((await refund(chargeId)).status, 502);
  assert.equal(payRow(chargeId).status, 'anomaly');
});

test('возвраты доступны только администратору', async () => {
  const u = newUser();
  const b = await t.buy(u, 'fx_confetti');
  const id = payRow(b.chargeId).id;
  const calls = refundCalls();
  assert.equal((await t.as(u).post(`/api/admin/payments/${id}/refund`, {})).status, 403, 'обычный пользователь');
  assert.equal((await t.req('POST', `/api/admin/payments/${id}/refund`, { body: {} })).status, 401, 'без подписи');
  assert.equal((await t.req('POST', `/api/admin/payments/${id}/refund`, { body: {}, token: 'x'.repeat(40) })).status, 401, 'чужой токен');
  assert.equal(refundCalls(), calls);
  assert.equal(payRow(b.chargeId).status, 'succeeded');
  assert.equal((await t.admin.post('/api/admin/payments/999999/refund', {})).status, 404);
  assert.equal((await t.admin.post('/api/admin/payments/abc/refund', {})).status, 404);
});

/* ---------------- ручная выдача и отзыв прав ---------------- */
test('ручная выдача: право появляется без платежа и заказа, пользователь заводится автоматически, всё в журнале', async () => {
  const u = 91000 + n;   // пользователь, который ни разу не открывал приложение
  const gross0 = (await t.admin.get('/api/admin/dashboard')).json.stats.totals.gross_stars;
  const r = await t.admin.post('/api/admin/grant', { tg_id: u, product_id: 'bg_nebula', reason: 'подарок за помощь' });
  assert.equal(r.status, 200, r.text);
  const e = ents(u)[0];
  assert.equal(e.source, 'admin'); assert.equal(e.granted_by, 'tg:' + ADMIN_ID); assert.equal(e.order_id, null); assert.equal(e.payment_id, null);
  assert.ok(t.q1('SELECT 1 AS x FROM users WHERE tg_id = ?', u));
  assert.equal(t.q1('SELECT COUNT(*) AS n FROM payments WHERE tg_id = ?', u).n, 0);
  assert.deepEqual((await t.rights(u)).items.map(i => i.product_id), ['bg_nebula']);
  assert.equal((await t.admin.get('/api/admin/dashboard')).json.stats.totals.gross_stars, gross0, 'подарок не попадает в оборот');
  assert.ok(t.q1("SELECT 1 AS x FROM audit_log WHERE action = 'entitlement.grant' AND details LIKE '%подарок за помощь%'"));
  assert.equal(t.mock.messagesTo(u).length, 0, 'сообщение об «оплате» не отправляется');
});

test('ручная выдача соблюдает те же ограничения и проверяет входные данные', async () => {
  const u = newUser();
  assert.equal((await t.admin.post('/api/admin/grant', { tg_id: u, product_id: 'bg_nebula' })).status, 200);
  const dup = await t.admin.post('/api/admin/grant', { tg_id: u, product_id: 'bg_nebula' });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error.code, 'owned');
  for (let i = 0; i < 3; i++) assert.equal((await t.admin.post('/api/admin/grant', { tg_id: u, product_id: 'slot_plus_3' })).status, 200);
  assert.equal((await t.admin.post('/api/admin/grant', { tg_id: u, product_id: 'slot_plus_1' })).json.error.code, 'slot_limit');
  assert.equal((await t.admin.post('/api/admin/grant', { tg_id: u, product_id: 'нет_такого' })).status, 404);
  assert.equal((await t.admin.post('/api/admin/grant', { tg_id: 'abc', product_id: 'bg_nebula' })).status, 400);
  assert.equal((await t.admin.post('/api/admin/grant', { tg_id: -1, product_id: 'bg_nebula' })).status, 400);
  assert.equal((await t.admin.post('/api/admin/grant', { product_id: 'bg_nebula' })).status, 400);
  assert.equal((await t.as(u).post('/api/admin/grant', { tg_id: u, product_id: 'fx_confetti' })).status, 403, 'выдавать права может только администратор');
});

test('отзыв права: пропадает из снимка прав, повторный отзыв и неизвестный номер дают понятные ошибки', async () => {
  const u = newUser();
  await t.admin.post('/api/admin/grant', { tg_id: u, product_id: 'fx_confetti' });
  const id = ents(u)[0].id;
  const r = await t.admin.post(`/api/admin/entitlements/${id}/revoke`, { reason: 'ошибка выдачи' });
  assert.equal(r.status, 200);
  assert.equal((await t.rights(u)).items.length, 0);
  assert.equal(ents(u)[0].revoke_reason, 'ошибка выдачи');
  assert.equal((await t.admin.post(`/api/admin/entitlements/${id}/revoke`, {})).status, 409);
  assert.equal((await t.admin.post('/api/admin/entitlements/999999/revoke', {})).status, 404);
  assert.ok(t.q1("SELECT 1 AS x FROM audit_log WHERE action = 'entitlement.revoke' AND target = ?", String(id)));
  assert.equal((await t.admin.post('/api/admin/grant', { tg_id: u, product_id: 'fx_confetti' })).status, 200, 'после отзыва выдать снова можно');
});

test('отзыв купленного права вручную (без возврата Stars) отмечается в журнале и не меняет платёж', async () => {
  const u = newUser();
  const b = await t.buy(u, 'fx_confetti');
  const id = ents(u)[0].id;
  assert.equal((await t.admin.post(`/api/admin/entitlements/${id}/revoke`, { reason: 'нарушение правил' })).status, 200);
  assert.equal(payRow(b.chargeId).status, 'succeeded', 'платёж остаётся: деньги вернуть можно отдельно');
  assert.equal((await t.rights(u)).items.length, 0);
});
