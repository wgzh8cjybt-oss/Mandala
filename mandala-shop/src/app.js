// Сборка приложения: контекст, маршруты, фоновые задачи (истечение заказов, резервные копии, сверка с Telegram).
import fs from 'node:fs';
import path from 'node:path';
import { registerAdmin } from './admin.js';
import { registerApi } from './api.js';
import { seedCatalog } from './catalog.js';
import { createCtx, event, getSetting, setSetting } from './ctx.js';
import { backupDb, listBackups, run } from './db.js';
import { Router, createHandler } from './http.js';
import { expireStaleOrders } from './orders.js';
import { reconcile } from './payments.js';
import { registerReminders, runReminders } from './reminders.js';
import { DEFAULT_PAYSUPPORT, DEFAULT_TERMS } from './texts.js';

export function createApp({ cfg, db, tg, log, now = Date.now, publicDir }) {
  const ctx = createCtx({ cfg, db, tg, log, now });
  // значения по умолчанию, которые владелец потом правит в админке
  if (getSetting(ctx, 'terms_text') === null) setSetting(ctx, 'terms_text', DEFAULT_TERMS);
  if (getSetting(ctx, 'terms_version') === null) setSetting(ctx, 'terms_version', cfg.termsVersion);
  if (getSetting(ctx, 'paysupport_text') === null) setSetting(ctx, 'paysupport_text', DEFAULT_PAYSUPPORT);
  seedCatalog(ctx);

  const router = new Router();
  registerApi(router, ctx);
  registerReminders(router, ctx);
  registerAdmin(router, ctx);
  const handler = createHandler(ctx, router, { publicDir, now });
  const backupDir = path.join(cfg.dataDir, 'backups');

  const jobs = {
    /** закрывает просроченные заказы и чистит старые идентификаторы обновлений */
    housekeeping() {
      const n = expireStaleOrders(ctx);
      const old = run(db, 'DELETE FROM processed_updates WHERE created_at < ?', now() - 30 * 86400e3).changes;
      const oldRem = run(db, 'DELETE FROM reminder_log WHERE created_at < ?', now() - 180 * 86400e3).changes;
      if (n || old || oldRem) log.info('служебная очистка', { expired_orders: n, old_updates: old, old_reminders: oldRem });
    },
    async backup(force = false) {
      const list = listBackups(backupDir), last = list.length ? list[list.length - 1].mtime : 0;
      if (!force && (cfg.backupEveryHours <= 0 || now() - last < cfg.backupEveryHours * 3600e3)) return null;
      const r = await backupDb(db, backupDir, { keep: cfg.backupKeep, now: now() });
      log.info('резервная копия создана', r);
      return r;
    },
    /** напоминания: один проход планировщика (раз в REMINDERS_TICK_SEC секунд) */
    async reminders() {
      const r = await runReminders(ctx);
      if (r.sent || r.failed || r.blocked) log.info('напоминания', r);
      return r;
    },
    async reconcile() {
      if (cfg.reconcileEveryHours <= 0) return null;
      const r = await reconcile(ctx, { maxPages: 20, actor: 'schedule' });
      log.info('сверка с Telegram', r);
      return r;
    }
  };
  const timers = [];
  const safe = (name, fn) => async () => { try { await fn(); } catch (e) { log.error('фоновая задача: ' + name, { error: e }); } };
  return {
    ctx, router, handler, jobs,
    startTimers() {
      const add = (fn, ms, first) => { const t = setInterval(fn, ms); t.unref(); timers.push(t); if (first !== undefined) { const f = setTimeout(fn, first); f.unref(); timers.push(f); } };
      add(safe('housekeeping', async () => jobs.housekeeping()), 5 * 60e3, 5000);
      add(safe('backup', () => jobs.backup()), 3600e3, 20000);
      if (cfg.remindersEnabled) add(safe('reminders', () => jobs.reminders()), cfg.remindTickSec * 1000, 15000);
      if (cfg.reconcileEveryHours > 0) add(safe('reconcile', () => jobs.reconcile()), cfg.reconcileEveryHours * 3600e3, 90e3);
    },
    stopTimers() { timers.forEach(t => { clearInterval(t); clearTimeout(t); }); timers.length = 0; }
  };
}
