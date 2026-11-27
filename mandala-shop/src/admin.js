// Админ-API: товары, пользователи, платежи, возвраты, ручная выдача прав, настройки, сверка, резервные копии, аналитика.
import path from 'node:path';
import { all, one, run, tx } from './db.js';
import { audit, getSetting, setSetting } from './ctx.js';
import { ANIM_PRESETS, BG_PRESETS, BUILTIN_RELICS, BUILTIN_THEMES, CATEGORIES, EFFECT_PRESETS, FAMILIES, FEATURES, KINDS, PALETTE_VARS, RIGHTS, STATUSES, createProduct, listAllProducts, updateProduct } from './catalog.js';
import { adminGrant, revokeEntitlement } from './entitlements.js';
import { backupDb, listBackups } from './db.js';
import { deleteMedia, listMedia, saveMedia } from './media.js';
import { reconcile, refundPayment } from './payments.js';
import { reminderAdminView } from './reminders.js';
import { financialStats } from './stats.js';
import { HttpError, clip, isInt, jsonParse } from './util.js';
import { DEFAULT_PAYSUPPORT, DEFAULT_TERMS } from './texts.js';
import { currentTermsVersion } from './users.js';

const page = (req, def = 50, max = 200) => {
  const limit = Math.min(max, Math.max(1, parseInt(req.query.limit, 10) || def));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  return { limit, offset };
};
const likeEsc = s => String(s).replace(/[\\%_]/g, c => '\\' + c);
const bodyOf = req => (req.body && typeof req.body === 'object' ? req.body : {});

const SETTINGS = {
  terms_text: { max: 8000, def: ctx => DEFAULT_TERMS },
  terms_version: { max: 20, re: /^[A-Za-z0-9._-]+$/, def: ctx => ctx.cfg.termsVersion },
  paysupport_text: { max: 2000, def: () => DEFAULT_PAYSUPPORT },
  support_contact: { max: 100, def: ctx => ctx.cfg.supportContact },
  shop_enabled: { flag: true, def: () => '1' },
  public_pending_rights: { flag: true, def: () => '0' }
};

export function registerAdmin(r, ctx) {
  const A = (method, p, fn, opts = {}) => r.add(method, '/api/admin' + p, fn, { ...opts, auth: 'admin' });

  A('GET', '/reminders', () => ({ ok: true, ...reminderAdminView(ctx) }));

  A('GET', '/meta', () => ({
    ok: true, categories: CATEGORIES, kinds: KINDS, statuses: STATUSES, families: FAMILIES, rights: RIGHTS,
    presets: { background: BG_PRESETS, animated_bg: ANIM_PRESETS, effect: EFFECT_PRESETS, features: FEATURES, themes: BUILTIN_THEMES, relics: BUILTIN_RELICS, palette_vars: PALETTE_VARS },
    star_usd_estimate: ctx.cfg.starUsdEstimate, tz: ctx.cfg.statsTz, public_url: ctx.cfg.publicUrl
  }));

  /* ---- обзор и аналитика ---- */
  A('GET', '/dashboard', () => ({
    ok: true, stats: financialStats(ctx),
    anomalies: all(ctx.db, "SELECT id, charge_id, tg_id, amount, anomaly, payload, created_at FROM payments WHERE status = 'anomaly' AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 50"),
    refund_pending: one(ctx.db, "SELECT COUNT(*) AS n FROM payments WHERE status = 'refund_pending'").n,
    last_reconcile_at: Number(getSetting(ctx, 'last_reconcile_at', 0)) || null,
    counts: { products: one(ctx.db, 'SELECT COUNT(*) AS n FROM products').n, users: one(ctx.db, 'SELECT COUNT(*) AS n FROM users').n, orders_pending: one(ctx.db, "SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'").n },
    backups: listBackups(path.join(ctx.cfg.dataDir, 'backups')).slice(-5).reverse()
  }));

  const cache = { t: 0, v: null };   // баланс запрашиваем у Telegram не чаще раза в минуту
  A('GET', '/stars/balance', async req => {
    if (req.query.fresh !== '1' && cache.v && ctx.now() - cache.t < 60000) return { ok: true, balance: cache.v, cached_at: cache.t };
    try { cache.v = await ctx.tg.getMyStarBalance(); cache.t = ctx.now(); }
    catch (e) { throw new HttpError(502, 'telegram_error', 'Не удалось получить баланс Stars: ' + e.message); }
    return { ok: true, balance: cache.v, cached_at: cache.t };
  });

  // История операций Stars в Telegram: поступления, возвраты и выводы (Fragment) — для сверки и контроля вывода.
  A('GET', '/stars/transactions', async req => {
    const { limit, offset } = page(req, 50, 100);
    let res;
    try { res = await ctx.tg.getStarTransactions(offset, limit); } catch (e) { throw new HttpError(502, 'telegram_error', 'Telegram: ' + e.message); }
    const kind = t => {
      if (t.source && t.source.type === 'user') return 'incoming';
      if (t.receiver && t.receiver.type === 'user') return 'refund';
      if (t.receiver && t.receiver.type === 'fragment') return 'withdrawal';
      if (t.source && t.source.type === 'fragment') return 'withdrawal_return';
      return 'other';
    };
    return {
      ok: true, offset, transactions: ((res && res.transactions) || []).map(t => ({
        id: t.id, amount: t.amount, nanostar_amount: t.nanostar_amount || 0, date: t.date, kind: kind(t),
        payload: t.source && t.source.invoice_payload ? clip(t.source.invoice_payload, 40) : null,
        withdrawal_state: t.receiver && t.receiver.withdrawal_state ? t.receiver.withdrawal_state.type : null
      }))
    };
  });

  A('POST', '/reconcile', async req => ({ ok: true, result: await reconcile(ctx, { maxPages: 50, actor: req.actor }) }));

  A('GET', '/webhook', async () => {
    let w;
    try { w = await ctx.tg.getWebhookInfo(); } catch (e) { throw new HttpError(502, 'telegram_error', 'Telegram: ' + e.message); }
    const mask = u => (u || '').replace(/(\/telegram\/webhook\/)[^/?#]+/, '$1***');
    return { ok: true, webhook: { url: mask(w.url), pending_update_count: w.pending_update_count, last_error_date: w.last_error_date || null, last_error_message: w.last_error_message || null, max_connections: w.max_connections || null, allowed_updates: w.allowed_updates || null } };
  });

  /* ---- товары ---- */
  A('GET', '/products', () => {
    const owned = Object.fromEntries(all(ctx.db, "SELECT product_id, COUNT(*) AS n FROM entitlements WHERE status = 'active' AND source = 'purchase' GROUP BY product_id").map(x => [x.product_id, x.n]));
    return { ok: true, products: listAllProducts(ctx).map(p => ({ ...p, sold: owned[p.id] || 0 })) };
  });
  A('POST', '/products', req => ({ ok: true, product: createProduct(ctx, bodyOf(req), req.actor) }));
  A('PUT', '/products/:id', req => ({ ok: true, product: updateProduct(ctx, req.params.id, bodyOf(req), req.actor) }));

  /* ---- пользователи ---- */
  A('GET', '/users', req => {
    const { limit, offset } = page(req);
    const q = String(req.query.q || '').trim().replace(/^@/, '');
    const rows = all(ctx.db, `SELECT u.*,
        (SELECT COUNT(*) FROM payments p WHERE p.tg_id = u.tg_id AND p.status IN ('succeeded','refund_pending')) AS purchases,
        (SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.tg_id = u.tg_id AND p.status IN ('succeeded','refund_pending')) AS spent
      FROM users u WHERE (? = '' OR CAST(u.tg_id AS TEXT) = ? OR u.username LIKE ? ESCAPE '\\' OR u.first_name LIKE ? ESCAPE '\\')
      ORDER BY u.last_seen_at DESC LIMIT ? OFFSET ?`, q, q, '%' + likeEsc(q) + '%', '%' + likeEsc(q) + '%', limit, offset);
    return { ok: true, users: rows, total: one(ctx.db, 'SELECT COUNT(*) AS n FROM users').n };
  });
  A('GET', '/users/:id', req => {
    const id = Number(req.params.id);
    const user = isInt(id) ? one(ctx.db, 'SELECT * FROM users WHERE tg_id = ?', id) : null;
    if (!user) throw new HttpError(404, 'not_found', 'Пользователь не найден');
    return {
      ok: true, user,
      orders: all(ctx.db, 'SELECT * FROM orders WHERE tg_id = ? ORDER BY created_at DESC LIMIT 100', id).map(o => ({ ...o, product_snapshot: undefined, title: jsonParse(o.product_snapshot, {}).title })),
      payments: all(ctx.db, 'SELECT id, charge_id, order_id, amount, status, anomaly, created_at, refunded_at FROM payments WHERE tg_id = ? ORDER BY created_at DESC LIMIT 100', id),
      entitlements: all(ctx.db, 'SELECT id, product_id, kind, source, order_id, status, created_at, granted_by, revoked_at, revoke_reason, claimed_at FROM entitlements WHERE tg_id = ? ORDER BY id DESC LIMIT 200', id)
    };
  });
  A('POST', '/users/:id/block', req => {
    const id = Number(req.params.id), blocked = !!bodyOf(req).blocked;
    return tx(ctx.db, () => {
      if (!one(ctx.db, 'SELECT 1 FROM users WHERE tg_id = ?', id)) throw new HttpError(404, 'not_found', 'Пользователь не найден');
      run(ctx.db, 'UPDATE users SET is_blocked = ? WHERE tg_id = ?', blocked ? 1 : 0, id);
      audit(ctx, req.actor, blocked ? 'user.block' : 'user.unblock', id);
      return { ok: true, blocked };
    });
  });

  /* ---- заказы и платежи ---- */
  A('GET', '/orders', req => {
    const { limit, offset } = page(req);
    const st = String(req.query.status || '');
    const rows = all(ctx.db, `SELECT o.id, o.tg_id, o.product_id, o.amount, o.status, o.created_at, o.paid_at, o.refunded_at, o.note, o.product_snapshot, u.username FROM orders o LEFT JOIN users u ON u.tg_id = o.tg_id
      WHERE (? = '' OR o.status = ?) ORDER BY o.created_at DESC LIMIT ? OFFSET ?`, st, st, limit, offset);
    return { ok: true, orders: rows.map(o => ({ ...o, product_snapshot: undefined, title: jsonParse(o.product_snapshot, {}).title })) };
  });
  A('GET', '/payments', req => {
    const { limit, offset } = page(req);
    const st = String(req.query.status || ''), q = String(req.query.q || '').trim();
    const rows = all(ctx.db, `SELECT p.id, p.charge_id, p.order_id, p.tg_id, p.amount, p.status, p.anomaly, p.source, p.created_at, p.refunded_at, p.refund_reason, p.refunded_by, p.refund_error, p.resolved_at, p.resolve_note, u.username
      FROM payments p LEFT JOIN users u ON u.tg_id = p.tg_id
      WHERE (? = '' OR p.status = ?) AND (? = '' OR p.charge_id = ? OR p.order_id = ? OR CAST(p.tg_id AS TEXT) = ?)
      ORDER BY p.created_at DESC LIMIT ? OFFSET ?`, st, st, q, q, q, q, limit, offset);
    return { ok: true, payments: rows };
  });
  A('POST', '/payments/:id/refund', async req => ({ ok: true, ...(await refundPayment(ctx, { paymentId: Number(req.params.id), reason: bodyOf(req).reason, actor: req.actor })) }));
  A('POST', '/payments/:id/resolve', req => tx(ctx.db, () => {
    const id = Number(req.params.id), note = clip(String(bodyOf(req).note || ''), 300);
    const p = one(ctx.db, 'SELECT * FROM payments WHERE id = ?', id);
    if (!p) throw new HttpError(404, 'not_found', 'Платёж не найден');
    if (p.status !== 'anomaly') throw new HttpError(409, 'not_anomaly', 'Помечать решённым можно только платёж с аномалией');
    run(ctx.db, 'UPDATE payments SET resolved_at = ?, resolve_note = ? WHERE id = ?', ctx.now(), note || null, id);
    audit(ctx, req.actor, 'payment.resolve', id, { note });
    return { ok: true };
  }));

  /* ---- права ---- */
  A('POST', '/grant', req => {
    const b = bodyOf(req);
    if (!isInt(b.tg_id) || b.tg_id <= 0 || typeof b.product_id !== 'string') throw new HttpError(400, 'bad_request', 'Нужны tg_id (число) и product_id.');
    return { ok: true, entitlement_id: adminGrant(ctx, { tgId: b.tg_id, productId: b.product_id, reason: clip(String(b.reason || ''), 300), actor: req.actor }) };
  });
  A('POST', '/entitlements/:id/revoke', req => ({ ok: revokeEntitlement(ctx, Number(req.params.id), { reason: clip(String(bodyOf(req).reason || ''), 300), by: req.actor }) }));

  /* ---- файлы ---- */
  A('POST', '/media', req => ({ ok: true, media: saveMedia(ctx, req.rawBody, { label: req.query.label, actor: req.actor }) }), { raw: true, rawLimit: 13 * 1024 * 1024 });
  A('GET', '/media', () => ({ ok: true, media: listMedia(ctx) }));
  A('DELETE', '/media/:id', req => { deleteMedia(ctx, req.params.id, req.actor); return { ok: true }; });

  /* ---- настройки ---- */
  A('GET', '/settings', () => ({ ok: true, settings: Object.fromEntries(Object.entries(SETTINGS).map(([k, s]) => [k, getSetting(ctx, k, s.def(ctx))])) }));
  A('PUT', '/settings', req => tx(ctx.db, () => {
    const b = bodyOf(req), changed = {};
    for (const [k, v] of Object.entries(b)) {
      const s = SETTINGS[k];
      if (!s) throw new HttpError(400, 'bad_setting', 'Неизвестная настройка: ' + k);
      let val = s.flag ? (v === true || v === '1' || v === 1 ? '1' : '0') : String(v ?? '');
      if (!s.flag && (val.length > s.max || (s.re && !s.re.test(val)))) throw new HttpError(400, 'bad_setting', `Недопустимое значение: ${k}`);
      const old = getSetting(ctx, k, s.def(ctx));
      if (old === val) continue;
      setSetting(ctx, k, val);
      changed[k] = s.flag || val.length < 40 ? { from: old, to: val } : { length: val.length };
    }
    // Изменили текст условий, а версию нет → поднимаем версию, чтобы пользователи подтвердили заново.
    if (changed.terms_text && !changed.terms_version) {
      const v = currentTermsVersion(ctx), next = /^\d+$/.test(v) ? String(Number(v) + 1) : v + '.1';
      setSetting(ctx, 'terms_version', next); changed.terms_version = { from: v, to: next, auto: true };
    }
    if (Object.keys(changed).length) audit(ctx, req.actor, 'settings.update', null, changed);
    return { ok: true, changed: Object.keys(changed), settings: Object.fromEntries(Object.entries(SETTINGS).map(([k, s]) => [k, getSetting(ctx, k, s.def(ctx))])) };
  }));

  /* ---- резервные копии, журналы ---- */
  A('GET', '/backups', () => ({ ok: true, backups: listBackups(path.join(ctx.cfg.dataDir, 'backups')).reverse() }));
  A('POST', '/backup', async req => {
    const res = await backupDb(ctx.db, path.join(ctx.cfg.dataDir, 'backups'), { keep: ctx.cfg.backupKeep, now: ctx.now() });
    audit(ctx, req.actor, 'backup.create', res.file, { size: res.size });
    return { ok: true, backup: res };
  });
  A('GET', '/backups/:name', req => {
    const name = req.params.name;
    if (!/^mandala-\d{8}-\d{6}(-\d+)?\.sqlite\.gz$/.test(name)) throw new HttpError(400, 'bad_name', 'Недопустимое имя файла');
    audit(ctx, req.actor, 'backup.download', name);
    return { __file: path.join(ctx.cfg.dataDir, 'backups', name), mime: 'application/gzip', download: name };
  });
  A('GET', '/audit', req => { const { limit, offset } = page(req, 100, 500); return { ok: true, items: all(ctx.db, 'SELECT * FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?', limit, offset).map(x => ({ ...x, details: jsonParse(x.details, null) })) }; });
  A('GET', '/events', req => {
    const { limit, offset } = page(req, 100, 500), type = String(req.query.type || '');
    return { ok: true, items: all(ctx.db, "SELECT * FROM events_log WHERE (? = '' OR type = ?) ORDER BY id DESC LIMIT ? OFFSET ?", type, type, limit, offset).map(x => ({ ...x, data: jsonParse(x.data, null) })) };
  });
}
