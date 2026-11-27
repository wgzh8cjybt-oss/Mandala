// Пользователи: создание/обновление по данным Telegram, принятие условий покупки.
import { one, run } from './db.js';
import { getSetting } from './ctx.js';
import { HttpError, clip } from './util.js';

export function upsertUser(ctx, u) {
  const t = ctx.now();
  run(ctx.db, `INSERT INTO users(tg_id, username, first_name, last_name, language_code, created_at, last_seen_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(tg_id) DO UPDATE SET username = excluded.username, first_name = excluded.first_name, last_name = excluded.last_name,
      language_code = excluded.language_code, last_seen_at = excluded.last_seen_at`,
  u.id, u.username ? clip(u.username, 64) : null, u.first_name ? clip(u.first_name, 64) : null, u.last_name ? clip(u.last_name, 64) : null,
  u.language_code ? clip(u.language_code, 12) : null, t, t);
  return getUser(ctx, u.id);
}

/** Заглушка для пользователя, которого ещё не видели в приложении (ручная выдача, платёж из сверки). */
export function ensureUserStub(ctx, tgId) {
  const t = ctx.now();
  run(ctx.db, 'INSERT OR IGNORE INTO users(tg_id, created_at, last_seen_at) VALUES (?,?,?)', tgId, t, t);
}

export const getUser = (ctx, tgId) => one(ctx.db, 'SELECT * FROM users WHERE tg_id = ?', tgId);

export const currentTermsVersion = ctx => getSetting(ctx, 'terms_version', ctx.cfg.termsVersion);

export function termsState(ctx, user) {
  const version = currentTermsVersion(ctx);
  return { version, accepted: !!user && user.terms_version === version, accepted_at: user ? user.terms_accepted_at : null };
}

export function acceptTerms(ctx, tgId, version) {
  if (String(version) !== currentTermsVersion(ctx)) throw new HttpError(409, 'terms_changed', 'Условия обновились — откройте их ещё раз.');
  run(ctx.db, 'UPDATE users SET terms_version = ?, terms_accepted_at = ? WHERE tg_id = ?', String(version), ctx.now(), tgId);
}
