// Точка входа сервера.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { ConfigError, loadConfig, loadDotEnv } from './config.js';
import { openDb } from './db.js';
import { createLogger } from './log.js';
import { TelegramApi, registerWebhook } from './telegram.js';

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  loadDotEnv();
  let cfg;
  try { cfg = loadConfig(); } catch (e) { if (e instanceof ConfigError) { console.error(e.message); process.exit(1); } throw e; }
  const log = createLogger({ level: cfg.logLevel, secrets: [cfg.botToken, cfg.botToken.split(':')[1], cfg.webhookSecret, cfg.webhookPath, cfg.adminToken] });
  const db = openDb(path.join(cfg.dataDir, 'mandala.sqlite'));
  const tg = new TelegramApi({ token: cfg.botToken, base: cfg.telegramApiBase });
  const app = createApp({ cfg, db, tg, log, publicDir: path.join(here, '..', 'public') });

  try {
    const me = await tg.getMe();
    log.info('бот подключён', { username: me.username });
    if (cfg.botUsername && me.username && cfg.botUsername.toLowerCase() !== me.username.toLowerCase()) log.warn('BOT_USERNAME не совпадает с реальным именем бота', { env: cfg.botUsername, real: me.username });
  } catch (e) { log.error('Не удалось проверить токен бота (getMe): сервер запущен, но платежи работать не будут', { error: e }); }
  if (!cfg.supportContact) log.warn('SUPPORT_CONTACT не задан: /paysupport и /support не покажут контакт');
  if (cfg.autoSetWebhook) { try { log.info('вебхук зарегистрирован', await registerWebhook(tg, cfg)); } catch (e) { log.error('не удалось зарегистрировать вебхук', { error: e }); } }

  const server = http.createServer(app.handler);
  server.requestTimeout = 60000; server.headersTimeout = 15000; server.keepAliveTimeout = 5000;
  await new Promise(r => server.listen(cfg.port, cfg.host, r));
  log.info('сервер запущен', { port: cfg.port, public_url: cfg.publicUrl });
  app.startTimers();

  let closing = false;
  const stop = sig => {
    if (closing) return; closing = true;
    log.info('остановка', { signal: sig });
    app.stopTimers();
    setTimeout(() => process.exit(0), 8000).unref();   // страховка: не ждать «зависших» соединений дольше 8 секунд
    server.close(() => { try { db.close(); } catch { /* ignore */ } process.exit(0); });
    server.closeIdleConnections?.();
  };
  process.on('SIGTERM', () => stop('SIGTERM')); process.on('SIGINT', () => stop('SIGINT'));
  process.on('unhandledRejection', e => log.error('unhandledRejection', { error: e }));
}
main();
