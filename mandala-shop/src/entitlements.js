// Права доступа: выдача, отзыв, снимок прав пользователя, «получение» расходуемых наград (огоньки).
import crypto from 'node:crypto';
import { all, one, run, tx } from './db.js';
import { audit, event } from './ctx.js';
import { getProduct, limitCheck, REASON_TEXT } from './catalog.js';
import { ensureUserStub } from './users.js';
import { HttpError, jsonParse } from './util.js';

/** Выдача права. Вызывать внутри транзакции (вместе с изменением заказа/платежа). */
export function grantEntitlement(ctx, { tgId, product, source, orderId = null, paymentId = null, grantedBy = null }) {
  const r = run(ctx.db, `INSERT INTO entitlements(tg_id, product_id, kind, grant_json, source, order_id, payment_id, status, created_at, granted_by)
    VALUES (?,?,?,?,?,?,?,'active',?,?)`, tgId, product.id, product.kind, JSON.stringify(product.grant), source, orderId, paymentId, ctx.now(), grantedBy);
  const id = Number(r.lastInsertRowid);
  event(ctx, 'entitlement_granted', { ref: id, tgId, data: { product_id: product.id, kind: product.kind, source, order_id: orderId } });
  return id;
}

/** Отзыв одной записи. Для уже полученных огоньков создаётся «списание», чтобы клиент мог их убрать. */
function revokeRow(ctx, row, reason, by) {
  const t = ctx.now();
  const r = run(ctx.db, "UPDATE entitlements SET status = 'revoked', revoked_at = ?, revoke_reason = ?, revoked_by = ? WHERE id = ? AND status = 'active'", t, reason || null, String(by), row.id);
  if (!r.changes) return false;
  if (row.kind === 'flames' && row.claimed_at && row.source !== 'refund_debit') {
    const n = Number(jsonParse(row.grant_json, {}).flames) || 0;
    if (n > 0) {
      run(ctx.db, `INSERT OR IGNORE INTO entitlements(tg_id, product_id, kind, grant_json, source, payment_id, debit_of, status, created_at, granted_by)
        VALUES (?,?,?,?, 'refund_debit', ?, ?, 'active', ?, ?)`, row.tg_id, row.product_id, 'flames', JSON.stringify({ flames: -n }), row.payment_id, row.id, t, String(by));
    }
  }
  event(ctx, 'entitlement_revoked', { ref: row.id, tgId: row.tg_id, data: { product_id: row.product_id, kind: row.kind, reason: reason || null, by: String(by) } });
  return true;
}

export function revokeForOrder(ctx, orderId, { reason, by }) {
  const rows = all(ctx.db, "SELECT * FROM entitlements WHERE order_id = ? AND status = 'active'", orderId);
  let n = 0;
  for (const row of rows) if (revokeRow(ctx, row, reason, by)) n++;
  return n;
}

export function revokeEntitlement(ctx, id, { reason, by }) {
  return tx(ctx.db, () => {
    const row = one(ctx.db, 'SELECT * FROM entitlements WHERE id = ?', id);
    if (!row) throw new HttpError(404, 'not_found', 'Право не найдено');
    if (row.status !== 'active') throw new HttpError(409, 'not_active', 'Право уже отозвано');
    revokeRow(ctx, row, reason, by);
    audit(ctx, by, 'entitlement.revoke', id, { tg_id: row.tg_id, product_id: row.product_id, reason });
    return true;
  });
}

/** Ручная выдача администратором (без платежа). Лимиты владения и максимум слотов соблюдаются. */
export function adminGrant(ctx, { tgId, productId, reason, actor }) {
  return tx(ctx.db, () => {
    const product = getProduct(ctx, productId);
    if (!product) throw new HttpError(404, 'not_found', 'Товар не найден');
    const why = limitCheck(ctx, tgId, product);
    if (why) throw new HttpError(409, why, REASON_TEXT[why] || why);
    ensureUserStub(ctx, tgId);
    const id = grantEntitlement(ctx, { tgId, product, source: 'admin', grantedBy: String(actor) });
    audit(ctx, actor, 'entitlement.grant', id, { tg_id: tgId, product_id: productId, reason: reason || null });
    return id;
  });
}

/** Полный снимок прав пользователя — источник правды для клиента. */
export function userRights(ctx, tgId) {
  const rows = all(ctx.db, `SELECT e.*, p.grant_json AS cur_grant FROM entitlements e LEFT JOIN products p ON p.id = e.product_id
    WHERE e.tg_id = ? AND e.status = 'active' ORDER BY e.id`, tgId);
  const items = [], consumables = [];
  let slotsExtra = 0;
  for (const r of rows) {
    const snap = jsonParse(r.grant_json, {});
    if (r.kind === 'flames') {
      if (!r.claimed_at) consumables.push({ id: r.id, product_id: r.product_id, flames: Number(snap.flames) || 0, source: r.source, created_at: r.created_at });
      continue;
    }
    if (r.kind === 'slot') slotsExtra += Number(snap.slots) || 0;
    items.push({ id: r.id, product_id: r.product_id, kind: r.kind, grant: r.kind === 'slot' ? snap : (jsonParse(r.cur_grant, null) || snap), source: r.source, created_at: r.created_at });
  }
  const max = ctx.cfg.maxSlots;
  const etag = crypto.createHash('sha1').update(JSON.stringify([items.map(i => [i.id, i.product_id]), consumables.map(c => c.id)])).digest('hex').slice(0, 12);
  return { slots: { extra: slotsExtra, total: Math.min(max, 1 + slotsExtra), max }, items, consumables, etag };
}

/** Клиент подтверждает, что применил огоньки у себя. Идемпотентно. */
export function claimConsumables(ctx, tgId, ids) {
  const list = Array.from(new Set((ids || []).filter(Number.isSafeInteger))).slice(0, 200);
  return tx(ctx.db, () => {
    let n = 0;
    for (const id of list) n += run(ctx.db, "UPDATE entitlements SET claimed_at = ? WHERE id = ? AND tg_id = ? AND kind = 'flames' AND claimed_at IS NULL AND status = 'active'", ctx.now(), id, tgId).changes;
    return n;
  });
}
