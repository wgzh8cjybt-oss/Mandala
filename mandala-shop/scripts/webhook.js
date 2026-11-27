// Управление вебхуком: node scripts/webhook.js set | info | delete
import { loadConfig, loadDotEnv } from '../src/config.js';
import { TelegramApi, registerWebhook } from '../src/telegram.js';

loadDotEnv();
const cmd = process.argv[2];
let cfg;
try { cfg = loadConfig(); } catch (e) { console.error(e.message); process.exit(1); }
const tg = new TelegramApi({ token: cfg.botToken, base: cfg.telegramApiBase });
const mask = u => (u || '').replace(/(\/telegram\/webhook\/)[^/?#]+/, '$1***');
try {
  if (cmd === 'set') {
    console.log('Регистрирую вебхук, команды и кнопку меню…');
    console.log(await registerWebhook(tg, cfg, { dropPending: process.argv.includes('--drop-pending') }));
    console.log('Готово. Проверьте: npm run webhook:info');
  } else if (cmd === 'info') {
    const w = await tg.getWebhookInfo();
    console.log({ url: mask(w.url), pending_update_count: w.pending_update_count, last_error_date: w.last_error_date && new Date(w.last_error_date * 1000).toISOString(), last_error_message: w.last_error_message, max_connections: w.max_connections, allowed_updates: w.allowed_updates });
  } else if (cmd === 'delete') {
    await tg.deleteWebhook(process.argv.includes('--drop-pending'));
    console.log('Вебхук удалён.');
  } else { console.log('Использование: node scripts/webhook.js set|info|delete [--drop-pending]'); process.exit(2); }
} catch (e) { console.error('Ошибка:', e.message); process.exit(1); }
