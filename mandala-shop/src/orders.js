// Заказы: создаются только на сервере. Цена и товар фиксируются снимком; invoice_payload = id заказа.
import { all, one, run, tx } from './db.js';
import { event, getSetting } from './ctx.js';
import { availability, getProduct, shopEnabled, REASON_TEXT } from './catalog.js';
import { currentTermsVersion } from './users.js';
import { HttpError, clip, jsonParse, randomId } from './util.js';

const MAX_ORDERS_PER_HOUR = 20;

export function orderView(o, { withLink = true } = {}) {
  if (!o) return null;
  const snap = jsonParse(o.product_snapshot, {});
  return {
    id: o.id, product_id: o.product_id, title: snap.title || o.product_id, amount: o.amount, currency: o.currency, status: o.status,
    created_at: o.created_at, expires_at: o.expires_at, paid_at: o.paid_at, refunded_at: o.refunded_at,
    invoice_link: withLink && o.status === 'pending' ? o.invoice_link : undefined
  };
}

export async function createOrder(ctx, user, productId) {
  if (!shopEnabled(ctx)) throw new HttpError(503, 'shop_paused', REASON_TEXT.shop_paused);
  if (user.is_blocked) throw new HttpError(403, 'blocked', 'Покупки для этого аккаунта отключены.');
  if (user.terms_version !== currentTermsVersion(ctx)) throw new HttpError(403, 'terms_required', 'Сначала подтвердите условия покупки.');
  const product = getProduct(ctx, productId);
  if (!product) throw new HttpError(404, 'not_found', 'Товар не найден.');

  const step = tx(ctx.db, () => {
    const now = ctx.now();
    if (one(ctx.db, 'SELECT COUNT(*) AS n FROM orders WHERE tg_id = ? AND created_at > ?', user.tg_id, now - 3600e3).n >= MAX_ORDERS_PER_HOUR)
      throw new HttpError(429, 'too_many_orders', 'Слишком много попыток оплаты. Подождите немного.');
    const av = availability(ctx, user.tg_id, product);
    if (!av.can) throw new HttpError(409, av.reason, REASON_TEXT[av.reason] || 'Покупка недоступна.');
    const ex = one(ctx.db, `SELECT * FROM orders WHERE tg_id = ? AND product_id = ? AND status = 'pending' AND expires_at > ? AND amount = ? AND invoice_link IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`, user.tg_id, product.id, now, product.price_stars);
    if (ex) return { reuse: ex };
    const id = randomId('o_', 12);
    const snap = { id: product.id, title: product.title, kind: product.kind, category: product.category, grant: product.grant, price_stars: product.price_stars };
    run(ctx.db, `INSERT INTO orders(id, tg_id, product_id, product_snapshot, amount, currency, status, created_at, updated_at, expires_at)
      VALUES (?,?,?,?,?,'XTR','created',?,?,?)`, id, user.tg_id, product.id, JSON.stringify(snap), product.price_stars, now, now, now + ctx.cfg.orderTtlSec * 1000);
    event(ctx, 'order_created', { ref: id, tgId: user.tg_id, data: { product_id: product.id, amount: product.price_stars } });
    return { id };
  });
  if (step.reuse) return orderView(step.reuse);

  let link;
  try {
    link = await ctx.tg.createInvoiceLink({
      title: clip(product.title, 32), description: clip(product.description || product.title, 255),
      payload: step.id, label: clip(product.title, 32), amount: product.price_stars
    });
    if (typeof link !== 'string' || !/^https:\/\//.test(link)) throw new Error('Telegram вернул неожиданный ответ вместо ссылки');
  } catch (e) {
    tx(ctx.db, () => {
      run(ctx.db, "UPDATE orders SET status = 'failed', note = ?, updated_at = ? WHERE id = ? AND status = 'created'", clip(e.message || String(e), 300), ctx.now(), step.id);
      event(ctx, 'invoice_failed', { ref: step.id, tgId: user.tg_id, data: { error: clip(e.message || String(e), 300) } });
    });
    ctx.log.error('createInvoiceLink не удался', { order: step.id, error: e });
    throw new HttpError(502, 'invoice_failed', 'Не удалось создать счёт в Telegram. Попробуйте позже.');
  }
  return tx(ctx.db, () => {
    run(ctx.db, "UPDATE orders SET status = 'pending', invoice_link = ?, updated_at = ? WHERE id = ? AND status = 'created'", link, ctx.now(), step.id);
    event(ctx, 'invoice_created', { ref: step.id, tgId: user.tg_id });
    return orderView(one(ctx.db, 'SELECT * FROM orders WHERE id = ?', step.id));
  });
}

export function getOrderForUser(ctx, tgId, orderId) {
  const o = one(ctx.db, 'SELECT * FROM orders WHERE id = ? AND tg_id = ?', String(orderId), tgId);
  if (!o) throw new HttpError(404, 'not_found', 'Заказ не найден.');
  return o;
}

/** История покупок пользователя: заказы + платёжные данные. */
export function userHistory(ctx, tgId, limit = 100) {
  const orders = all(ctx.db, 'SELECT * FROM orders WHERE tg_id = ? ORDER BY created_at DESC LIMIT ?', tgId, limit);
  const pays = all(ctx.db, 'SELECT id, charge_id, order_id, amount, status, created_at, refunded_at FROM payments WHERE tg_id = ? ORDER BY created_at DESC LIMIT ?', tgId, limit * 2);
  const byOrder = new Map(pays.filter(p => p.order_id).map(p => [p.order_id, p]));
  return orders.map(o => {
    const v = orderView(o, { withLink: false });
    const p = byOrder.get(o.id);
    if (p) v.payment = { charge_id: p.charge_id, status: p.status, created_at: p.created_at, refunded_at: p.refunded_at };
    return v;
  });
}

/** Закрывает просроченные неоплаченные заказы. */
export function expireStaleOrders(ctx) {
  return tx(ctx.db, () => {
    const now = ctx.now();
    const rows = all(ctx.db, "SELECT id FROM orders WHERE status IN ('created','pending') AND expires_at < ?", now);
    for (const r of rows) run(ctx.db, "UPDATE orders SET status = 'expired', updated_at = ? WHERE id = ? AND status IN ('created','pending')", now, r.id);
    return rows.length;
  });
}
