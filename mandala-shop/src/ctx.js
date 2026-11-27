// Контекст приложения и общие записи: журнал аудита, журнал платёжных событий, настройки.
import { one, run } from './db.js';

export function createCtx({ cfg, db, tg, log, now = Date.now }) {
  return { cfg, db, tg, log, now };
}

export function audit(ctx, actor, action, target, details) {
  run(ctx.db, 'INSERT INTO audit_log(ts, actor, action, target, details) VALUES (?,?,?,?,?)',
    ctx.now(), String(actor), action, target == null ? null : String(target), details === undefined ? null : JSON.stringify(details));
}

/** Журнал транзакций: каждое платёжное событие с контекстом. Пишется в той же транзакции, что и изменение данных. */
export function event(ctx, type, { ref = null, tgId = null, data } = {}) {
  run(ctx.db, 'INSERT INTO events_log(ts, type, ref, tg_id, data) VALUES (?,?,?,?,?)',
    ctx.now(), type, ref == null ? null : String(ref), tgId, data === undefined ? null : JSON.stringify(data));
}

export function getSetting(ctx, key, def = null) {
  const r = one(ctx.db, 'SELECT value FROM settings WHERE key = ?', key);
  return r ? r.value : def;
}
export function setSetting(ctx, key, value) {
  run(ctx.db, 'INSERT INTO settings(key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    key, String(value), ctx.now());
}
