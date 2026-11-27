// Публичное API Mini App. Подлинность пользователя — только по подписанной Telegram строке initData
// (заголовок Authorization: tma <initData>); всё, что присылает клиент о «успешной оплате», игнорируется.
import { one } from './db.js';
import { getSetting } from './ctx.js';
import { CATEGORIES, publicCatalog, shopEnabled } from './catalog.js';
import { claimConsumables, userRights } from './entitlements.js';
import { createOrder, getOrderForUser, orderView, userHistory } from './orders.js';
import { quickReconcile } from './payments.js';
import { verifyInitData } from './telegram.js';
import { acceptTerms, currentTermsVersion, termsState, upsertUser } from './users.js';
import { DEFAULT_TERMS } from './texts.js';
import { HttpError, isInt, isPlainObject, safeEqual } from './util.js';

/** Проверка initData → req.user. optional=true: без заголовка пропускаем (публичный каталог). */
export function authenticate(ctx, req, { optional = false } = {}) {
  const h = req.headers.authorization || '';
  const m = /^tma\s+(.+)$/i.exec(h);
  if (!m) { if (optional) return null; throw new HttpError(401, 'auth_required', 'Откройте приложение из Telegram.'); }
  let info;
  try { info = verifyInitData(m[1], ctx.cfg.botToken, { maxAgeSec: ctx.cfg.initDataMaxAgeSec, nowSec: Math.floor(ctx.now() / 1000) }); }
  catch (e) { if (optional) return null; throw new HttpError(401, 'bad_init_data', 'Сессия Telegram недействительна или устарела. Закройте и откройте приложение заново.'); }
  req.tgUser = info.user;
  const user = upsertUser(ctx, info.user);
  if (user.is_blocked) throw new HttpError(403, 'blocked', 'Доступ ограничен.');
  req.user = user;
  req.isAdmin = ctx.cfg.adminIds.has(user.tg_id);
  return user;
}

/** Администратор: Telegram-пользователь из ADMIN_IDS либо (если задан) Bearer ADMIN_TOKEN. */
export function authenticateAdmin(ctx, req) {
  const h = req.headers.authorization || '';
  const b = /^bearer\s+(.+)$/i.exec(h);
  if (b) {
    if (ctx.cfg.adminToken && safeEqual(b[1], ctx.cfg.adminToken)) { req.actor = 'token'; req.isAdmin = true; return; }
    throw new HttpError(401, 'bad_token', 'Неверный токен администратора.');
  }
  authenticate(ctx, req);
  if (!req.isAdmin) throw new HttpError(403, 'forbidden', 'Только для администраторов.');
  req.actor = 'tg:' + req.user.tg_id;
}

const shopInfo = ctx => ({
  enabled: shopEnabled(ctx), currency: 'XTR', terms_version: currentTermsVersion(ctx),
  support_contact: getSetting(ctx, 'support_contact', ctx.cfg.supportContact) || null,
  bot_username: ctx.cfg.botUsername || null
});

export function registerApi(r, ctx) {
  r.add('GET', '/api/health', () => ({ ok: true, time: ctx.now() }), { auth: 'none' });

  r.add('GET', '/api/catalog', req => {
    const user = req.user || null;
    return { ok: true, shop: shopInfo(ctx), categories: CATEGORIES, products: publicCatalog(ctx, user ? user.tg_id : null), authenticated: !!user };
  }, { auth: 'optional' });

  r.add('GET', '/api/terms', () => ({ ok: true, version: currentTermsVersion(ctx), text: getSetting(ctx, 'terms_text', DEFAULT_TERMS) }), { auth: 'none' });

  const me = req => {
    const user = req.user;
    return {
      ok: true, server_time: ctx.now(),
      user: { id: user.tg_id, username: user.username, first_name: user.first_name }, is_admin: !!req.isAdmin,
      shop: shopInfo(ctx), terms: termsState(ctx, user), rights: userRights(ctx, user.tg_id)
    };
  };
  r.add('GET', '/api/me', req => me(req));

  // «Обновить права»: полный снимок с сервера; если есть оплаченные, но ещё не дошедшие заказы — подтягиваем платежи из Telegram.
  r.add('POST', '/api/rights/sync', async req => {
    const waiting = one(ctx.db, "SELECT COUNT(*) AS n FROM orders WHERE tg_id = ? AND status = 'pending' AND precheckout_at IS NOT NULL AND created_at > ?", req.user.tg_id, ctx.now() - 86400e3).n;
    if (waiting) await quickReconcile(ctx);
    return me(req);
  });

  r.add('POST', '/api/terms/accept', req => {
    acceptTerms(ctx, req.user.tg_id, req.body && req.body.version);
    return { ok: true, terms: termsState(ctx, one(ctx.db, 'SELECT * FROM users WHERE tg_id = ?', req.user.tg_id)) };
  });

  r.add('POST', '/api/orders', async req => {
    const pid = req.body && req.body.product_id;
    if (typeof pid !== 'string' || !pid) throw new HttpError(400, 'bad_request', 'Не указан товар.');
    const order = await createOrder(ctx, req.user, pid);
    return { ok: true, order };
  }, { limit: { max: 10, windowMs: 60000, by: 'user' } });

  r.add('GET', '/api/orders', req => ({ ok: true, orders: userHistory(ctx, req.user.tg_id) }));

  // Опрос статуса после закрытия окна оплаты. Статус «paid» ставит только сервер по платёжному событию Telegram.
  r.add('GET', '/api/orders/:id', async req => {
    let o = getOrderForUser(ctx, req.user.tg_id, req.params.id);
    if (o.status === 'pending' && o.precheckout_at && ctx.now() - o.precheckout_at > 15000) {
      await quickReconcile(ctx);
      o = getOrderForUser(ctx, req.user.tg_id, req.params.id);
    }
    const out = { ok: true, order: orderView(o) };
    if (o.status === 'paid') out.rights = userRights(ctx, req.user.tg_id);
    return out;
  }, { limit: { max: 60, windowMs: 60000, by: 'user' } });

  r.add('POST', '/api/claim', req => {
    const ids = req.body && req.body.ids;
    if (!Array.isArray(ids) || ids.length > 200 || !ids.every(isInt)) throw new HttpError(400, 'bad_request', 'ids: список чисел.');
    return { ok: true, claimed: claimConsumables(ctx, req.user.tg_id, ids), rights: userRights(ctx, req.user.tg_id) };
  });
}
