// Заказы и pre_checkout_query: сервер сам создаёт заказ, сам определяет цену и разрешает или отклоняет оплату.
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_ID, startServer } from './helpers.js';

let t;
before(async () => { t = await startServer(); });
after(async () => { await t.close(); });
beforeEach(() => t.clock.advance(61000));   // новое «окно» лимитов запросов в каждом тесте

let n = 0;
const newUser = () => 7000 + (++n);
const lastEvent = type => { const r = t.q1('SELECT * FROM events_log WHERE type = ? ORDER BY id DESC LIMIT 1', type); return r && { ...r, data: JSON.parse(r.data || 'null') }; };
async function pre(userId, payload, amount, o = {}) {
  const update = t.preCheckoutUpdate({ userId, payload, amount, currency: o.currency });
  const r = await t.webhook(update);
  return { r, answer: t.mock.answers.get(update.pre_checkout_query.id), update };
}

test('заказ невозможен без подтверждения условий покупки', async () => {
  const u = newUser();
  const before = t.mock.callsOf('createInvoiceLink').length;
  const r = await t.as(u).post('/api/orders', { product_id: 'slot_plus_1' });
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, 'terms_required');
  assert.equal(t.mock.callsOf('createInvoiceLink').length, before, 'счёт в Telegram не создавался');
});

test('условия: неверная версия отклоняется, верная принимается и запоминается на сервере', async () => {
  const u = newUser();
  const me = await t.as(u).get('/api/me');
  assert.equal(me.json.terms.accepted, false);
  const bad = await t.as(u).post('/api/terms/accept', { version: 'старая' });
  assert.equal(bad.status, 409);
  assert.equal(bad.json.error.code, 'terms_changed');
  const ok = await t.as(u).post('/api/terms/accept', { version: me.json.terms.version });
  assert.equal(ok.json.terms.accepted, true);
  assert.equal((await t.as(u).get('/api/me')).json.terms.accepted, true);
  assert.ok(t.q1('SELECT terms_accepted_at FROM users WHERE tg_id = ?', u).terms_accepted_at);
});

test('счёт Stars: XTR, одна позиция, без provider_token, payload = номер заказа, лимиты Telegram соблюдены', async () => {
  const u = newUser();
  const o = await t.order(u, 'feat_export_png');
  const c = t.mock.lastCall('createInvoiceLink').params;
  assert.equal(c.currency, 'XTR');
  assert.equal(c.prices.length, 1);
  assert.equal(c.prices[0].amount, 40);
  assert.ok(!('provider_token' in c), 'для Stars токен платёжного провайдера не передаётся');
  assert.equal(c.payload, o.id);
  assert.match(o.id, /^o_[A-Za-z0-9_-]{16}$/);
  assert.ok(Buffer.byteLength(c.payload) <= 128);
  assert.equal(o.status, 'pending');
  assert.equal(o.amount, 40);
  assert.match(o.invoice_link, /^https:\/\/t\.me\//);
  const row = t.q1('SELECT * FROM orders WHERE id = ?', o.id);
  assert.equal(row.tg_id, u);
  assert.equal(row.currency, 'XTR');
  assert.equal(JSON.parse(row.product_snapshot).id, 'feat_export_png');
  assert.ok(row.expires_at > t.clock.t);
});

test('длинные название и описание обрезаются под лимиты Telegram (32 и 255 символов)', async () => {
  const r = await t.admin.post('/api/admin/products', { id: 'long_item', category: 'features', kind: 'feature', title: 'Очень длинное название товара ' + 'я'.repeat(30), description: 'д'.repeat(255), price_stars: 7, grant: { feature: 'year_heatmap' } });
  assert.equal(r.status, 200, r.text);
  const u = newUser();
  await t.order(u, 'long_item');
  const c = t.mock.lastCall('createInvoiceLink').params;
  assert.ok(Array.from(c.title).length <= 32, 'title ' + Array.from(c.title).length);
  assert.ok(Array.from(c.prices[0].label).length <= 32);
  assert.ok(Array.from(c.description).length <= 255);
});

test('цену, валюту и сумму, присланные клиентом, сервер игнорирует', async () => {
  const u = newUser();
  await t.acceptTerms(u);
  const r = await t.as(u).post('/api/orders', { product_id: 'feat_heatmap', price_stars: 1, amount: 1, currency: 'USD', status: 'paid', tg_id: 1001 });
  assert.equal(r.status, 200);
  assert.equal(r.json.order.amount, 40);
  assert.equal(r.json.order.status, 'pending');
  const row = t.q1('SELECT * FROM orders WHERE id = ?', r.json.order.id);
  assert.equal(row.tg_id, u, 'заказ принадлежит пользователю из подписи Telegram, а не из тела запроса');
  assert.equal(t.mock.invoices.get(r.json.order.invoice_link).amount, 40);
});

test('неизвестный товар, пустой запрос и запрос без авторизации', async () => {
  const u = newUser();
  await t.acceptTerms(u);
  assert.equal((await t.as(u).post('/api/orders', { product_id: 'нет_такого' })).status, 404);
  assert.equal((await t.as(u).post('/api/orders', {})).status, 400);
  assert.equal((await t.as(u).post('/api/orders', { product_id: 123 })).status, 400);
  const anon = await t.req('POST', '/api/orders', { body: { product_id: 'slot_plus_1' } });
  assert.equal(anon.status, 401);
  assert.equal(anon.json.error.code, 'auth_required');
});

test('повторный запрос того же товара возвращает тот же неоплаченный счёт, а не плодит новые', async () => {
  const u = newUser();
  const a = await t.order(u, 'fx_confetti');
  const calls = t.mock.callsOf('createInvoiceLink').length;
  const b = await t.order(u, 'fx_confetti');
  assert.equal(b.id, a.id);
  assert.equal(b.invoice_link, a.invoice_link);
  assert.equal(t.mock.callsOf('createInvoiceLink').length, calls);
  assert.equal(t.q1("SELECT COUNT(*) AS n FROM orders WHERE tg_id = ? AND product_id = 'fx_confetti'", u).n, 1);
});

test('сбой Telegram при создании счёта: заказ помечается ошибкой, прав нет, следующая попытка проходит', async () => {
  const u = newUser();
  await t.acceptTerms(u);
  t.mock.failNext('createInvoiceLink', { code: 500, description: 'Internal Server Error' });
  const r = await t.as(u).post('/api/orders', { product_id: 'bg_nebula' });
  assert.equal(r.status, 502);
  assert.equal(r.json.error.code, 'invoice_failed');
  const bad = t.q1("SELECT * FROM orders WHERE tg_id = ? AND product_id = 'bg_nebula'", u);
  assert.equal(bad.status, 'failed');
  assert.ok(lastEvent('invoice_failed'));
  assert.equal((await t.rights(u)).items.length, 0);
  const again = await t.as(u).post('/api/orders', { product_id: 'bg_nebula' });
  assert.equal(again.status, 200);
  assert.notEqual(again.json.order.id, bad.id);
});

test('ответ Telegram без ссылки на счёт не принимается за успех', async () => {
  const u = newUser();
  await t.acceptTerms(u);
  const orig = t.ctx.tg.createInvoiceLink;
  t.ctx.tg.createInvoiceLink = async () => ({ не: 'ссылка' });
  try {
    const r = await t.as(u).post('/api/orders', { product_id: 'bg_nebula' });
    assert.equal(r.status, 502);
  } finally { t.ctx.tg.createInvoiceLink = orig; }
});

test('магазин на паузе: новые заказы отклоняются, оплата уже выставленных счетов тоже', async () => {
  const u = newUser();
  const o = await t.order(u, 'fx_confetti');
  assert.equal((await t.admin.put('/api/admin/settings', { shop_enabled: false })).status, 200);
  try {
    const r = await t.as(newUser()).post('/api/orders', { product_id: 'fx_confetti' });
    assert.equal(r.status, 503, 'пауза магазина проверяется раньше условий покупки');
    const u2 = newUser(); await t.acceptTerms(u2);
    const r2 = await t.as(u2).post('/api/orders', { product_id: 'fx_confetti' });
    assert.equal(r2.status, 503);
    assert.equal(r2.json.error.code, 'shop_paused');
    const p = await pre(u, o.id, o.amount);
    assert.equal(p.answer.ok, false);
    assert.equal(lastEvent('pre_checkout_rejected').data.code, 'shop_paused');
    assert.equal((await t.as(u).get('/api/catalog')).json.shop.enabled, false);
  } finally { await t.admin.put('/api/admin/settings', { shop_enabled: true }); }
  assert.equal((await pre(u, o.id, o.amount)).answer.ok, true, 'после открытия магазина счёт снова оплачивается');
});

test('заблокированный пользователь не может ни создать заказ, ни оплатить выставленный счёт', async () => {
  const u = newUser();
  const o = await t.order(u, 'fx_confetti');
  assert.equal((await t.admin.post(`/api/admin/users/${u}/block`, { blocked: true })).status, 200);
  const r = await t.as(u).post('/api/orders', { product_id: 'bg_nebula' });
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, 'blocked');
  const p = await pre(u, o.id, o.amount);
  assert.equal(p.answer.ok, false);
  assert.equal(lastEvent('pre_checkout_rejected').data.code, 'blocked');
  await t.admin.post(`/api/admin/users/${u}/block`, { blocked: false });
  assert.equal((await t.as(u).get('/api/me')).status, 200);
});

test('лимит запросов на создание заказов: 10 в минуту на пользователя', async () => {
  const u = newUser();
  await t.acceptTerms(u);
  const codes = [];
  for (let i = 0; i < 12; i++) codes.push((await t.as(u).post('/api/orders', { product_id: 'fx_confetti' })).status);
  assert.deepEqual(codes.slice(0, 10), Array(10).fill(200));
  assert.deepEqual(codes.slice(10), [429, 429]);
  t.clock.advance(61000);
  assert.equal((await t.as(u).post('/api/orders', { product_id: 'fx_confetti' })).status, 200);
});

test('не больше 20 заказов в час на пользователя', async () => {
  const u = newUser();
  await t.acceptTerms(u);
  const products = (await t.as(u).get('/api/catalog')).json.products.filter(p => p.can_buy).map(p => p.id);
  assert.ok(products.length >= 21, 'для проверки нужно 21 доступный товар, есть ' + products.length);
  for (let i = 0; i < 20; i++) {
    const r = await t.as(u).post('/api/orders', { product_id: products[i] });
    assert.equal(r.status, 200, `заказ ${i + 1}: ${r.text}`);
    t.clock.advance(7000);
  }
  const r = await t.as(u).post('/api/orders', { product_id: products[20] });
  assert.equal(r.status, 429);
  assert.equal(r.json.error.code, 'too_many_orders');
  t.clock.advance(3600e3);
  assert.equal((await t.as(u).post('/api/orders', { product_id: products[20] })).status, 200);
});

/* ---------------- pre_checkout_query ---------------- */
test('pre_checkout: нормальный заказ подтверждается (ok=true), время проверки сохраняется', async () => {
  const u = newUser();
  const o = await t.order(u, 'fx_confetti');
  const p = await pre(u, o.id, o.amount);
  assert.equal(p.r.status, 200);
  assert.deepEqual(p.answer, { ok: true, error_message: null });
  assert.ok(t.q1('SELECT precheckout_at FROM orders WHERE id = ?', o.id).precheckout_at);
  assert.equal(lastEvent('pre_checkout_ok').ref, o.id);
});

test('pre_checkout: неизвестный номер заказа отклоняется с понятным текстом', async () => {
  const u = newUser();
  const p = await pre(u, 'o_подделка', 25);
  assert.equal(p.answer.ok, false);
  assert.match(p.answer.error_message, /Заказ не найден/);
  assert.equal(lastEvent('pre_checkout_rejected').data.code, 'unknown_order');
  const p2 = await pre(u, 'x'.repeat(5000), 25);
  assert.equal(p2.answer.ok, false);
});

test('pre_checkout: чужой счёт, другая сумма, другая валюта отклоняются', async () => {
  const owner = newUser(), other = newUser();
  const o = await t.order(owner, 'fx_confetti');
  let p = await pre(other, o.id, o.amount);
  assert.equal(p.answer.ok, false);
  assert.equal(lastEvent('pre_checkout_rejected').data.code, 'user_mismatch');
  p = await pre(owner, o.id, 1);
  assert.equal(p.answer.ok, false);
  assert.equal(lastEvent('pre_checkout_rejected').data.code, 'amount_mismatch');
  p = await pre(owner, o.id, o.amount, { currency: 'USD' });
  assert.equal(p.answer.ok, false);
  assert.equal(lastEvent('pre_checkout_rejected').data.code, 'amount_mismatch');
  assert.equal((await pre(owner, o.id, o.amount)).answer.ok, true, 'настоящий владелец с верной суммой проходит');
});

test('pre_checkout: просроченный заказ отклоняется и закрывается', async () => {
  const u = newUser();
  const o = await t.order(u, 'fx_confetti');
  t.clock.advance(3600e3 + 5000);
  const p = await pre(u, o.id, o.amount);
  assert.equal(p.answer.ok, false);
  assert.equal(lastEvent('pre_checkout_rejected').data.code, 'expired');
  assert.equal(t.q1('SELECT status FROM orders WHERE id = ?', o.id).status, 'expired');
  assert.equal((await t.as(u).get('/api/orders/' + o.id)).json.order.status, 'expired');
  assert.equal(t.q1('SELECT invoice_link FROM orders WHERE id = ?', o.id).invoice_link !== null, true);
  assert.equal((await t.as(u).get('/api/orders/' + o.id)).json.order.invoice_link, undefined, 'ссылка закрытого заказа клиенту не отдаётся');
});

test('pre_checkout: уже оплаченный заказ повторно оплатить нельзя', async () => {
  const u = newUser();
  const r = await t.buy(u, 'feat_export_png');
  assert.equal(r.paid, true);
  const p = await pre(u, r.order.id, r.order.amount);
  assert.equal(p.answer.ok, false);
  assert.equal(lastEvent('pre_checkout_rejected').data.code, 'already_paid');
});

test('pre_checkout: товар убрали из продажи после создания счёта — оплата отклоняется', async () => {
  const u = newUser();
  await t.admin.post('/api/admin/products', { id: 'temp_item', category: 'effects', kind: 'effect', title: 'Временный', price_stars: 9, grant: { preset: 'sparks' } });
  const o = await t.order(u, 'temp_item');
  await t.admin.put('/api/admin/products/temp_item', { status: 'archived' });
  const p = await pre(u, o.id, o.amount);
  assert.equal(p.answer.ok, false);
  assert.equal(lastEvent('pre_checkout_rejected').data.code, 'unavailable');
});

test('pre_checkout: товар уже есть у пользователя (выдан вручную) — повторная оплата отклоняется', async () => {
  const u = newUser();
  const o = await t.order(u, 'bg_nebula');
  const g = await t.admin.post('/api/admin/grant', { tg_id: u, product_id: 'bg_nebula', reason: 'тест' });
  assert.equal(g.status, 200, g.text);
  const p = await pre(u, o.id, o.amount);
  assert.equal(p.answer.ok, false);
  assert.equal(lastEvent('pre_checkout_rejected').data.code, 'owned');
});

test('pre_checkout: то же обновление, доставленное дважды, обрабатывается один раз', async () => {
  const u = newUser();
  const o = await t.order(u, 'fx_confetti');
  const update = t.preCheckoutUpdate({ userId: u, payload: o.id, amount: o.amount });
  await t.webhook(update);
  await t.webhook(update);
  assert.equal(t.mock.callsOf('answerPreCheckoutQuery').filter(c => c.params.pre_checkout_query_id === update.pre_checkout_query.id).length, 1);
});

test('pre_checkout: битая структура игнорируется без ошибки сервера и без ответа', async () => {
  const before = t.mock.callsOf('answerPreCheckoutQuery').length;
  for (const q of [{}, { id: 5, from: { id: 1 } }, { id: 'a' }, { id: 'a', from: { id: 'x' } }]) {
    const r = await t.webhook({ update_id: t.nextUpdateId(), pre_checkout_query: q });
    assert.equal(r.status, 200);
  }
  assert.equal(t.mock.callsOf('answerPreCheckoutQuery').length, before);
});

test('pre_checkout: если Telegram не принял ответ, сервер не падает и не помечает обновление обработанным', async () => {
  const u = newUser();
  const o = await t.order(u, 'fx_confetti');
  const update = t.preCheckoutUpdate({ userId: u, payload: o.id, amount: o.amount });
  t.mock.failNext('answerPreCheckoutQuery', { network: true });
  const r = await t.webhook(update);
  assert.equal(r.status, 200);
  assert.equal(t.q1('SELECT 1 AS x FROM processed_updates WHERE update_id = ?', update.update_id), null);
  assert.ok(t.logs.some(l => l.includes('answerPreCheckoutQuery не удался')));
  await t.webhook(update);   // повторная доставка того же обновления отвечает нормально
  assert.equal(t.mock.answers.get(update.pre_checkout_query.id).ok, true);
});

/* ---------------- чтение заказов ---------------- */
test('история: пользователь видит только свои заказы, ссылки на счёт в истории нет', async () => {
  const a = newUser(), b = newUser();
  const oa = await t.order(a, 'fx_confetti');
  await t.order(b, 'bg_nebula');
  const hist = await t.as(a).get('/api/orders');
  assert.equal(hist.status, 200);
  assert.deepEqual(hist.json.orders.map(o => o.id), [oa.id]);
  assert.equal(hist.json.orders[0].invoice_link, undefined);
  const foreign = await t.as(b).get('/api/orders/' + oa.id);
  assert.equal(foreign.status, 404, 'чужой заказ не раскрывается');
  assert.equal((await t.as(a).get('/api/orders/' + oa.id)).json.order.invoice_link, oa.invoice_link, 'свой неоплаченный заказ отдаёт ссылку для повторного открытия');
});

test('нет ни одного маршрута, которым клиент мог бы объявить заказ «оплаченным»', async () => {
  const u = newUser();
  const o = await t.order(u, 'fx_confetti');
  for (const [m, p, body] of [['POST', `/api/orders/${o.id}`, { status: 'paid' }], ['PUT', `/api/orders/${o.id}`, { status: 'paid' }], ['POST', `/api/orders/${o.id}/paid`, {}], ['POST', '/api/payments', { order_id: o.id }], ['POST', '/api/rights', { product_id: 'fx_confetti' }], ['POST', '/api/grant', { product_id: 'fx_confetti' }]]) {
    const r = await t.req(m, p, { user: u, body });
    assert.ok([404, 405].includes(r.status), `${m} ${p} → ${r.status}`);
  }
  assert.equal(t.q1('SELECT status FROM orders WHERE id = ?', o.id).status, 'pending');
  assert.equal((await t.rights(u)).items.length, 0);
});

test('служебная очистка закрывает просроченные заказы; для того же товара создаётся новый заказ', async () => {
  const u = newUser();
  const o = await t.order(u, 'fx_confetti');
  t.clock.advance(3600e3 + 1000);
  t.app.jobs.housekeeping();
  assert.equal(t.q1('SELECT status FROM orders WHERE id = ?', o.id).status, 'expired');
  const o2 = await t.order(u, 'fx_confetti');
  assert.notEqual(o2.id, o.id);
  assert.equal(t.q1('SELECT status FROM orders WHERE id = ?', o2.id).status, 'pending');
});

test('служебная очистка удаляет идентификаторы обновлений старше 30 дней, свежие остаются', async () => {
  await t.webhook({ update_id: t.nextUpdateId(), message: { message_id: 1, chat: { id: 5, type: 'private' }, from: { id: 5 }, text: '/terms' } });
  const fresh = t.q1('SELECT MAX(update_id) AS id FROM processed_updates').id;
  t.clock.advance(31 * 86400e3);
  const fresh2 = t.nextUpdateId();
  await t.webhook({ update_id: fresh2, message: { message_id: 2, chat: { id: 5, type: 'private' }, from: { id: 5 }, text: '/terms' } });
  t.app.jobs.housekeeping();
  assert.equal(t.q1('SELECT 1 AS x FROM processed_updates WHERE update_id = ?', fresh), null);
  assert.ok(t.q1('SELECT 1 AS x FROM processed_updates WHERE update_id = ?', fresh2));
  assert.ok(ADMIN_ID);
});
