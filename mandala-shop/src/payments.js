// Платежи Telegram Stars: pre_checkout, successful_payment, возвраты, сверка с Telegram.
// Защита от двойной обработки: processed_updates (id обновления) + payments.charge_id UNIQUE +
// машина состояний заказа в одной транзакции + UNIQUE(order_id, product_id) у прав.
import { all, one, run, tx } from './db.js';
import { audit, event, setSetting } from './ctx.js';
import { getProduct, limitCheck, shopEnabled, REASON_TEXT } from './catalog.js';
import { grantEntitlement, revokeForOrder } from './entitlements.js';
import { ensureUserStub, getUser } from './users.js';
import { HttpError, clip, escHtml, jsonParse } from './util.js';

/** true, если обновление новое (и теперь помечено обработанным). */
export function markUpdate(ctx, updateId, kind) {
  if (updateId == null) return true;
  return run(ctx.db, 'INSERT OR IGNORE INTO processed_updates(update_id, kind, created_at) VALUES (?,?,?)', updateId, kind, ctx.now()).changes === 1;
}
const seenUpdate = (ctx, updateId) => updateId != null && !!one(ctx.db, 'SELECT 1 FROM processed_updates WHERE update_id = ?', updateId);

/* ---------------- уведомления (best effort) ---------------- */
const st = ctx => (ctx._st || (ctx._st = { lastNotified: new Map(), lastQuick: 0, reconciling: false }));
export async function safeSend(ctx, chatId, text, extra) {
  try { await ctx.tg.sendMessage(chatId, text, extra); return true; }
  catch (e) { ctx.log.warn('sendMessage не удался', { chat: chatId, error: e.message }); return false; }
}
export async function notifyAdmins(ctx, text, key = null) {
  if (key) { const m = st(ctx).lastNotified, t = m.get(key) || 0; if (ctx.now() - t < 60000) return; m.set(key, ctx.now()); }
  for (const id of ctx.cfg.adminIds) await safeSend(ctx, id, text);
}

/* ---------------- pre_checkout_query ---------------- */
function decidePreCheckout(ctx, q) {
  const reject = (code, message) => {
    event(ctx, 'pre_checkout_rejected', { ref: typeof q.invoice_payload === 'string' ? q.invoice_payload : null, tgId: q.from.id, data: { code, amount: q.total_amount, currency: q.currency } });
    return { ok: false, code, message };
  };
  const order = typeof q.invoice_payload === 'string' ? one(ctx.db, 'SELECT * FROM orders WHERE id = ?', q.invoice_payload) : null;
  if (!order) return reject('unknown_order', 'Заказ не найден. Откройте магазин в приложении и оформите покупку заново.');
  if (order.tg_id !== q.from.id) return reject('user_mismatch', 'Этот счёт выставлен другому пользователю.');
  if (q.currency !== 'XTR' || q.total_amount !== order.amount) return reject('amount_mismatch', 'Сумма счёта не совпадает с заказом. Оформите покупку заново.');
  if (order.status === 'paid' || order.status === 'refunded') return reject('already_paid', 'Этот заказ уже оплачен.');
  if (order.status !== 'pending') return reject('order_closed', 'Счёт закрыт. Откройте магазин и оформите покупку заново.');
  if (order.expires_at < ctx.now()) {
    run(ctx.db, "UPDATE orders SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending'", ctx.now(), order.id);
    return reject('expired', 'Срок счёта истёк. Откройте магазин и оформите покупку заново.');
  }
  const user = getUser(ctx, order.tg_id);
  if (user && user.is_blocked) return reject('blocked', 'Покупки для этого аккаунта отключены.');
  if (!shopEnabled(ctx)) return reject('shop_paused', REASON_TEXT.shop_paused);
  const product = getProduct(ctx, order.product_id);
  if (!product || product.status !== 'active') return reject('unavailable', REASON_TEXT.unavailable);
  const lim = limitCheck(ctx, order.tg_id, product);
  if (lim) return reject(lim, REASON_TEXT[lim] || 'Покупка недоступна.');
  run(ctx.db, 'UPDATE orders SET precheckout_at = ?, updated_at = ? WHERE id = ?', ctx.now(), ctx.now(), order.id);
  event(ctx, 'pre_checkout_ok', { ref: order.id, tgId: order.tg_id, data: { amount: order.amount } });
  return { ok: true };
}

export async function handlePreCheckout(ctx, q, updateId) {
  if (!q || typeof q.id !== 'string' || !q.from || !Number.isSafeInteger(q.from.id)) { ctx.log.warn('pre_checkout_query: неверная структура'); return { ignored: true }; }
  if (seenUpdate(ctx, updateId)) return { duplicate: true };
  const verdict = tx(ctx.db, () => decidePreCheckout(ctx, q));
  try {
    await ctx.tg.answerPreCheckoutQuery(q.id, verdict.ok, verdict.message);
  } catch (e) {
    ctx.log.error('answerPreCheckoutQuery не удался', { query: q.id, error: e });
    return { ok: verdict.ok, answered: false };
  }
  markUpdate(ctx, updateId, 'pre_checkout_query');
  return { ok: verdict.ok, code: verdict.code, answered: true };
}

/* ---------------- successful_payment ---------------- */
/** Идемпотентная запись платежа и выдача прав. Вызывается из вебхука и из сверки. */
export function recordPayment(ctx, p) {
  return tx(ctx.db, () => {
    if (p.updateId != null && !markUpdate(ctx, p.updateId, 'successful_payment')) return { result: 'duplicate_update' };
    const existing = one(ctx.db, 'SELECT * FROM payments WHERE charge_id = ?', p.chargeId);
    if (existing) {
      event(ctx, 'payment_duplicate', { ref: p.chargeId, tgId: p.tgId, data: { source: p.source } });
      return { result: 'duplicate', payment: existing };
    }
    const order = typeof p.payload === 'string' && p.payload ? one(ctx.db, 'SELECT * FROM orders WHERE id = ?', p.payload) : null;
    let anomaly = null;
    if (p.currency !== 'XTR') anomaly = 'currency';
    else if (!order) anomaly = 'unknown_order';
    else if (order.tg_id !== p.tgId) anomaly = 'user_mismatch';
    else if (order.amount !== p.amount) anomaly = 'amount_mismatch';
    else if (order.status === 'paid' || order.status === 'refunded') anomaly = 'order_already_paid';
    else if (order.status === 'failed') anomaly = 'order_failed';

    const t = ctx.now();
    if (p.tgId) ensureUserStub(ctx, p.tgId);
    const ins = run(ctx.db, `INSERT INTO payments(charge_id, provider_charge_id, order_id, tg_id, amount, currency, payload, status, anomaly, source, created_at, raw_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, p.chargeId, p.providerChargeId || null, anomaly === 'unknown_order' ? null : (order ? order.id : null), p.tgId || null, p.amount, p.currency,
    p.payload == null ? null : clip(p.payload, 200), anomaly ? 'anomaly' : 'succeeded', anomaly, p.source || 'webhook', t, p.raw ? JSON.stringify(p.raw) : null);
    const paymentId = Number(ins.lastInsertRowid);
    const payment = one(ctx.db, 'SELECT * FROM payments WHERE id = ?', paymentId);

    if (anomaly) {
      event(ctx, 'payment_anomaly', { ref: p.chargeId, tgId: p.tgId, data: { anomaly, amount: p.amount, payload: clip(p.payload || '', 200), order: order ? order.id : null } });
      return { result: 'anomaly', anomaly, payment, order };
    }
    if (order.status === 'expired' || order.status === 'cancelled') event(ctx, 'late_payment', { ref: order.id, tgId: p.tgId, data: { order_status: order.status } });
    run(ctx.db, "UPDATE orders SET status = 'paid', paid_at = ?, updated_at = ? WHERE id = ?", t, t, order.id);
    const snap = jsonParse(order.product_snapshot, {});
    const cur = getProduct(ctx, order.product_id);
    const product = { id: order.product_id, kind: snap.kind || (cur && cur.kind), grant: snap.grant || (cur && cur.grant) || {} };
    const entId = grantEntitlement(ctx, { tgId: p.tgId, product, source: 'purchase', orderId: order.id, paymentId });
    event(ctx, 'payment_succeeded', { ref: p.chargeId, tgId: p.tgId, data: { order: order.id, amount: p.amount, product_id: order.product_id, source: p.source, entitlement: entId } });
    return { result: 'granted', payment, order, title: snap.title || order.product_id };
  });
}

async function afterPayment(ctx, res, tgId, amount) {
  if (res.result === 'granted') {
    await safeSend(ctx, tgId, `Оплата получена: «${escHtml(res.title)}», ${amount} Stars.\nПраво уже добавлено в ваш аккаунт — откройте приложение (при необходимости нажмите «Обновить права» в магазине).\nНомер заказа: <code>${escHtml(res.order.id)}</code>`);
  } else if (res.result === 'anomaly') {
    await notifyAdmins(ctx, `Платёж требует разбора: ${escHtml(res.anomaly)}.\nStars: ${amount}, пользователь: <code>${tgId}</code>, платёж №${res.payment.id}.\nПрава не выданы. Откройте админку → «Платежи»: можно вернуть Stars или решить вручную.`, 'anomaly:' + res.payment.id);
  }
}

export async function handleSuccessfulPayment(ctx, msg, updateId) {
  const sp = msg.successful_payment, payer = msg.from && msg.from.id;
  const ok = sp && typeof sp.telegram_payment_charge_id === 'string' && sp.telegram_payment_charge_id && sp.telegram_payment_charge_id.length <= 256 &&
    Number.isSafeInteger(sp.total_amount) && sp.total_amount > 0 && typeof sp.currency === 'string' && Number.isSafeInteger(payer);
  if (!ok) {
    ctx.log.error('successful_payment: неверная структура', { updateId });
    tx(ctx.db, () => { markUpdate(ctx, updateId, 'successful_payment'); event(ctx, 'payment_malformed', { data: { update_id: updateId } }); });
    await notifyAdmins(ctx, 'Пришло сообщение об оплате с неверной структурой (см. журнал сервера). Проверьте «Сверка» в админке.', 'malformed');
    return { result: 'malformed' };
  }
  const res = recordPayment(ctx, {
    chargeId: sp.telegram_payment_charge_id, providerChargeId: sp.provider_payment_charge_id, tgId: payer, amount: sp.total_amount,
    currency: sp.currency, payload: sp.invoice_payload, source: 'webhook', updateId, raw: { currency: sp.currency, total_amount: sp.total_amount, invoice_payload: sp.invoice_payload, telegram_payment_charge_id: sp.telegram_payment_charge_id, provider_payment_charge_id: sp.provider_payment_charge_id || null }
  });
  await afterPayment(ctx, res, payer, sp.total_amount);
  return res;
}

/* ---------------- возвраты ---------------- */
/** Завершает возврат в БД (внутри транзакции): платёж → refunded, заказ → refunded, права отозваны. */
export function finalizeRefund(ctx, payment, { by, reason }) {
  const t = ctx.now();
  const r = run(ctx.db, `UPDATE payments SET status = 'refunded', refunded_at = ?, refund_reason = COALESCE(refund_reason, ?), refunded_by = COALESCE(refunded_by, ?), refund_error = NULL
    WHERE id = ? AND status IN ('succeeded','refund_pending','anomaly')`, t, reason || null, String(by), payment.id);
  if (!r.changes) return { noop: true };
  let revoked = 0;
  if (payment.order_id) {
    run(ctx.db, "UPDATE orders SET status = 'refunded', refunded_at = ?, updated_at = ? WHERE id = ? AND status IN ('paid','pending','expired','cancelled')", t, t, payment.order_id);
    revoked = revokeForOrder(ctx, payment.order_id, { reason: 'refund', by });
  }
  event(ctx, 'refund_succeeded', { ref: payment.charge_id, tgId: payment.tg_id, data: { payment_id: payment.id, amount: payment.amount, by: String(by), revoked } });
  return { refunded: true, revoked };
}

/** Telegram сообщил о возврате (message.refunded_payment) — синхронизируем состояние. */
export function handleRefundedPayment(ctx, msg, updateId) {
  const rp = msg.refunded_payment;
  const chargeId = rp && rp.telegram_payment_charge_id;
  return tx(ctx.db, () => {
    if (!markUpdate(ctx, updateId, 'refunded_payment')) return { duplicate: true };
    if (typeof chargeId !== 'string' || !chargeId) { event(ctx, 'refund_malformed', { data: { update_id: updateId } }); return { malformed: true }; }
    const pay = one(ctx.db, 'SELECT * FROM payments WHERE charge_id = ?', chargeId);
    if (!pay) { event(ctx, 'refund_unknown', { ref: chargeId, data: { amount: rp.total_amount } }); return { unknown: true }; }
    return finalizeRefund(ctx, pay, { by: 'telegram', reason: 'refunded_payment' });
  });
}

const REFUND_RETRY_MS = 60000;
/** Возврат по запросу администратора: refundStarPayment → отзыв прав. Повторный возврат невозможен. */
export async function refundPayment(ctx, { paymentId, reason, actor }) {
  const pay = tx(ctx.db, () => {
    const p = one(ctx.db, 'SELECT * FROM payments WHERE id = ?', paymentId);
    if (!p) throw new HttpError(404, 'not_found', 'Платёж не найден');
    if (p.status === 'refunded') throw new HttpError(409, 'already_refunded', 'Этот платёж уже возвращён');
    if (p.status === 'refund_pending' && ctx.now() - (p.refund_requested_at || 0) < REFUND_RETRY_MS) throw new HttpError(409, 'refund_in_progress', 'Возврат уже выполняется, подождите минуту');
    if (!p.tg_id) throw new HttpError(409, 'no_user', 'У платежа неизвестен плательщик — вернуть нельзя');
    run(ctx.db, "UPDATE payments SET status = 'refund_pending', refund_from = COALESCE(CASE WHEN status = 'refund_pending' THEN refund_from ELSE status END, 'succeeded'), refund_requested_at = ?, refund_reason = ?, refunded_by = ? WHERE id = ?",
      ctx.now(), reason ? clip(reason, 300) : null, String(actor), p.id);
    event(ctx, 'refund_requested', { ref: p.charge_id, tgId: p.tg_id, data: { payment_id: p.id, by: String(actor), reason: reason || null } });
    audit(ctx, actor, 'payment.refund_request', p.id, { charge_id: p.charge_id, amount: p.amount, reason: reason || null });
    return one(ctx.db, 'SELECT * FROM payments WHERE id = ?', p.id);
  });
  try {
    await ctx.tg.refundStarPayment(pay.tg_id, pay.charge_id);
  } catch (e) {
    const already = /already.?refunded/i.test(e.description || e.message || '');
    if (!already) {
      tx(ctx.db, () => {
        if (e.network) {   // исход неизвестен: оставляем refund_pending — через минуту можно повторить, сверка тоже закроет вопрос
          run(ctx.db, 'UPDATE payments SET refund_error = ? WHERE id = ? AND status = ?', clip(e.message, 300), pay.id, 'refund_pending');
        } else {
          run(ctx.db, "UPDATE payments SET status = COALESCE(refund_from, 'succeeded'), refund_error = ? WHERE id = ? AND status = 'refund_pending'", clip(e.message, 300), pay.id);
        }
        event(ctx, 'refund_failed', { ref: pay.charge_id, tgId: pay.tg_id, data: { error: clip(e.message, 300), network: !!e.network } });
      });
      ctx.log.error('refundStarPayment не удался', { payment: pay.id, error: e });
      throw new HttpError(502, e.network ? 'refund_unknown' : 'refund_failed', e.network
        ? 'Telegram не ответил. Возврат мог пройти — нажмите «Сверка» или повторите через минуту.'
        : 'Telegram отклонил возврат: ' + (e.description || e.message));
    }
  }
  const out = tx(ctx.db, () => finalizeRefund(ctx, one(ctx.db, 'SELECT * FROM payments WHERE id = ?', pay.id), { by: actor, reason }));
  return { payment_id: pay.id, ...out };
}

/* ---------------- сверка с Telegram (getStarTransactions) ---------------- */
/** Подтягивает из Telegram платежи и возвраты, которых нет в базе (пропущенные вебхуки). Идемпотентно.
 *  Список приходит «новые сверху», а возврат имеет тот же id, что и покупка, поэтому сначала собираем всё,
 *  затем записываем покупки, затем применяем возвраты — порядок в ответе Telegram не важен. */
export async function reconcile(ctx, { maxPages = 10, actor = 'system' } = {}) {
  const S = st(ctx);
  if (S.reconciling) return { skipped: true };
  S.reconciling = true;
  const sum = { scanned: 0, new_payments: 0, new_refunds: 0, anomalies: 0 };
  try {
    const purchases = [], refundIds = new Set();
    let offset = 0;
    for (let page = 0; page < maxPages; page++) {
      const res = await ctx.tg.getStarTransactions(offset, 100);
      const list = (res && res.transactions) || [];
      if (!list.length) break;
      for (const t of list) {
        sum.scanned++;
        if (!t || typeof t.id !== 'string') continue;
        const src = t.source, rcv = t.receiver;
        if (src && src.type === 'user' && src.user && Number.isSafeInteger(src.user.id) && typeof src.invoice_payload === 'string' && src.invoice_payload) purchases.push(t);
        else if (rcv && rcv.type === 'user') refundIds.add(t.id);
      }
      offset += list.length;
      if (list.length < 100) break;
    }
    // 1) покупки, которых нет в базе (от старых к новым)
    for (const t of purchases.slice().reverse()) {
      if (one(ctx.db, 'SELECT 1 FROM payments WHERE charge_id = ?', t.id)) continue;
      const r = recordPayment(ctx, { chargeId: t.id, tgId: t.source.user.id, amount: t.amount, currency: 'XTR', payload: t.source.invoice_payload, source: 'reconcile', raw: { id: t.id, amount: t.amount, date: t.date } });
      if (r.result !== 'granted' && r.result !== 'anomaly') continue;
      if (r.result === 'granted') sum.new_payments++; else sum.anomalies++;
      if (refundIds.has(t.id)) {   // платёж уже возвращён в Telegram: не радуем пользователя уведомлением, сразу закрываем
        const f = tx(ctx.db, () => finalizeRefund(ctx, r.payment, { by: 'reconcile', reason: 'refund_in_telegram' }));
        if (f.refunded) sum.new_refunds++;
        continue;
      }
      await afterPayment(ctx, r, t.source.user.id, t.amount);
    }
    // 2) возвраты по платежам, которые у нас ещё не отмечены возвращёнными
    for (const id of refundIds) {
      const pay = one(ctx.db, 'SELECT * FROM payments WHERE charge_id = ?', id);
      if (pay && pay.status !== 'refunded') { const f = tx(ctx.db, () => finalizeRefund(ctx, pay, { by: 'reconcile', reason: 'refund_in_telegram' })); if (f.refunded) sum.new_refunds++; }
    }
    tx(ctx.db, () => { setSetting(ctx, 'last_reconcile_at', String(ctx.now())); event(ctx, 'reconcile', { data: { ...sum, by: String(actor) } }); });
    return sum;
  } finally { S.reconciling = false; }
}

/** Лёгкая сверка по требованию (опрос заказа клиентом): не чаще раза в 20 секунд на весь сервер. */
export async function quickReconcile(ctx) {
  const S = st(ctx);
  if (ctx.now() - S.lastQuick < 20000) return null;
  S.lastQuick = ctx.now();
  try { return await reconcile(ctx, { maxPages: 1, actor: 'poll' }); } catch (e) { ctx.log.warn('быстрая сверка не удалась', { error: e.message }); return null; }
}
