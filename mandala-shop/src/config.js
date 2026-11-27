// Загрузка и проверка настроек из переменных окружения (+ необязательный файл .env без зависимостей).
import fs from 'node:fs';
import path from 'node:path';

export class ConfigError extends Error {
  constructor(problems) { super('Ошибка настроек:\n - ' + problems.join('\n - ')); this.problems = problems; }
}

export function parseEnvFile(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

/** Подмешивает .env в process.env, не перетирая уже заданные переменные. */
export function loadDotEnv(file = path.resolve(process.cwd(), '.env'), env = process.env) {
  try {
    const parsed = parseEnvFile(fs.readFileSync(file, 'utf8'));
    for (const [k, v] of Object.entries(parsed)) if (env[k] === undefined) env[k] = v;
    return true;
  } catch { return false; }
}

const int = (v, def) => (v === undefined || v === '' ? def : Number(v));
const bool = (v, def) => (v === undefined || v === '' ? def : /^(1|true|yes|on)$/i.test(String(v)));

export function loadConfig(env = process.env) {
  const p = [];
  const botToken = (env.BOT_TOKEN || '').trim();
  if (!botToken || /replace_with/i.test(botToken)) p.push('BOT_TOKEN не задан (получите токен у @BotFather и впишите в .env)');
  else if (!/^\d{3,}:[A-Za-z0-9_-]{20,}$/.test(botToken)) p.push('BOT_TOKEN выглядит неверно (ожидается вид 123456789:AA…)');

  const webhookSecret = (env.WEBHOOK_SECRET || '').trim();
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(webhookSecret)) p.push('WEBHOOK_SECRET: 16–256 символов A-Z a-z 0-9 _ - (например: openssl rand -hex 32)');
  const webhookPath = (env.WEBHOOK_PATH || '').trim();
  if (webhookPath && !/^[A-Za-z0-9_-]{8,128}$/.test(webhookPath)) p.push('WEBHOOK_PATH: 8–128 символов A-Z a-z 0-9 _ -');

  let publicUrl = (env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  const httpsOk = /^https:\/\/[^\s/]+/i.test(publicUrl);
  const localOk = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(publicUrl);
  if (!publicUrl) p.push('PUBLIC_URL не задан (https-адрес сервера)');
  else if (!httpsOk && !localOk) p.push('PUBLIC_URL должен начинаться с https:// (Telegram не принимает http для Mini App и вебхука)');

  const adminIds = new Set(String(env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean).map(Number));
  for (const id of adminIds) if (!Number.isSafeInteger(id) || id <= 0) p.push('ADMIN_IDS: только числовые Telegram ID через запятую');
  const adminToken = (env.ADMIN_TOKEN || '').trim();
  if (adminToken && adminToken.length < 32) p.push('ADMIN_TOKEN короче 32 символов — задайте длиннее или оставьте пустым');
  if (!adminIds.size && !adminToken) p.push('Нужен хотя бы один администратор: ADMIN_IDS или ADMIN_TOKEN');

  const cfg = {
    botToken, botUsername: (env.BOT_USERNAME || '').replace(/^@/, '').trim(),
    webhookSecret, webhookPath, publicUrl, adminIds, adminToken,
    port: int(env.PORT, 8080), host: env.HOST || '0.0.0.0',
    dataDir: path.resolve(env.DATA_DIR || './data'),
    supportContact: (env.SUPPORT_CONTACT || '').trim(),
    termsVersion: String(env.TERMS_VERSION || '1'),
    initDataMaxAgeSec: int(env.INITDATA_MAX_AGE_SEC, 86400),
    orderTtlSec: int(env.ORDER_TTL_SEC, 3600),
    maxSlots: int(env.MAX_SLOTS, 10),
    starUsdEstimate: Number(env.STAR_USD_ESTIMATE || 0.013),
    statsTz: env.STATS_TZ || 'Europe/Kiev',
    backupEveryHours: int(env.BACKUP_EVERY_HOURS, 6), backupKeep: int(env.BACKUP_KEEP, 28),
    reconcileEveryHours: int(env.RECONCILE_EVERY_HOURS, 24),
    remindersEnabled: bool(env.REMINDERS_ENABLED, true), remindTickSec: int(env.REMINDERS_TICK_SEC, 60),
    remindGapMs: int(env.REMIND_GAP_MS, 40), remindMaxPerTick: int(env.REMIND_MAX_PER_TICK, 300),
    corsOrigins: String(env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean),
    trustProxy: bool(env.TRUST_PROXY, false),
    telegramApiBase: (env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, ''),
    autoSetWebhook: bool(env.AUTO_SET_WEBHOOK, false),
    logLevel: env.LOG_LEVEL || 'info',
    clientFile: env.CLIENT_FILE ? path.resolve(env.CLIENT_FILE) : null
  };
  for (const [k, v, lo, hi] of [['PORT', cfg.port, 1, 65535], ['INITDATA_MAX_AGE_SEC', cfg.initDataMaxAgeSec, 60, 604800], ['ORDER_TTL_SEC', cfg.orderTtlSec, 120, 86400], ['MAX_SLOTS', cfg.maxSlots, 1, 50], ['BACKUP_KEEP', cfg.backupKeep, 1, 1000], ['BACKUP_EVERY_HOURS', cfg.backupEveryHours, 0, 720], ['RECONCILE_EVERY_HOURS', cfg.reconcileEveryHours, 0, 720], ['REMINDERS_TICK_SEC', cfg.remindTickSec, 10, 3600], ['REMIND_GAP_MS', cfg.remindGapMs, 0, 5000], ['REMIND_MAX_PER_TICK', cfg.remindMaxPerTick, 1, 5000]]) {
    if (!Number.isFinite(v) || v < lo || v > hi) p.push(`${k}: число от ${lo} до ${hi}`);
  }
  if (!(cfg.starUsdEstimate >= 0 && cfg.starUsdEstimate < 10)) p.push('STAR_USD_ESTIMATE: число от 0 до 10');
  try { new Intl.DateTimeFormat('en', { timeZone: cfg.statsTz }); } catch { p.push('STATS_TZ: неизвестный часовой пояс'); }
  if (p.length) throw new ConfigError(p);
  return cfg;
}
