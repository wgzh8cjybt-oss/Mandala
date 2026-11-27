// Клиент Bot API (только то, что нужно магазину Stars) и проверка подписи initData Mini App.
import crypto from 'node:crypto';

export class TelegramError extends Error {
  constructor(message, { code = 0, description = '', parameters = null, network = false } = {}) {
    super(message);
    this.name = 'TelegramError';
    this.code = code; this.description = description; this.parameters = parameters; this.network = network;
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class TelegramApi {
  constructor({ token, base = 'https://api.telegram.org', fetchFn = globalThis.fetch, timeoutMs = 15000 }) {
    if (!token) throw new Error('TelegramApi: нет токена');
    this._token = token; this.base = base.replace(/\/+$/, ''); this.fetch = fetchFn; this.timeoutMs = timeoutMs;
  }

  /** Вызов метода Bot API. Токен живёт только здесь и в URL запроса; в сообщения об ошибках он не попадает. */
  async call(method, params = {}, _retried = false) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    let res;
    try {
      res = await this.fetch(`${this.base}/bot${this._token}/${method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params), signal: ac.signal
      });
    } catch (e) {
      throw new TelegramError(`${method}: сеть недоступна (${e && e.name === 'AbortError' ? 'таймаут' : 'ошибка соединения'})`, { network: true });
    } finally { clearTimeout(timer); }
    let data;
    try { data = await res.json(); } catch { throw new TelegramError(`${method}: HTTP ${res.status}, ответ не JSON`, { code: res.status }); }
    if (!data || data.ok !== true) {
      const ra = data && data.parameters && data.parameters.retry_after;
      if (data && data.error_code === 429 && ra && ra <= 5 && !_retried) { await sleep(ra * 1000 + 100); return this.call(method, params, true); }
      throw new TelegramError(`${method}: ${(data && data.description) || 'HTTP ' + res.status}`, {
        code: (data && data.error_code) || res.status, description: (data && data.description) || '', parameters: (data && data.parameters) || null
      });
    }
    return data.result;
  }

  getMe() { return this.call('getMe'); }
  /** Счёт в Stars: валюта XTR, provider_token не указывается, ровно одна позиция цены. */
  createInvoiceLink({ title, description, payload, label, amount }) {
    return this.call('createInvoiceLink', { title, description, payload, currency: 'XTR', prices: [{ label, amount }] });
  }
  answerPreCheckoutQuery(id, ok, errorMessage) {
    return this.call('answerPreCheckoutQuery', ok ? { pre_checkout_query_id: id, ok: true } : { pre_checkout_query_id: id, ok: false, error_message: errorMessage || 'Оплата невозможна' });
  }
  refundStarPayment(userId, chargeId) { return this.call('refundStarPayment', { user_id: userId, telegram_payment_charge_id: chargeId }); }
  getStarTransactions(offset = 0, limit = 100) { return this.call('getStarTransactions', { offset, limit }); }
  getMyStarBalance() { return this.call('getMyStarBalance'); }
  sendMessage(chatId, text, extra = {}) {
    return this.call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });
  }
  setWebhook(p) { return this.call('setWebhook', p); }
  deleteWebhook(dropPending = false) { return this.call('deleteWebhook', { drop_pending_updates: dropPending }); }
  getWebhookInfo() { return this.call('getWebhookInfo'); }
  setMyCommands(commands) { return this.call('setMyCommands', { commands }); }
  setChatMenuButton(menuButton) { return this.call('setChatMenuButton', { menu_button: menuButton }); }
}

export const webhookRoute = cfg => '/telegram/webhook' + (cfg.webhookPath ? '/' + cfg.webhookPath : '');
export const BOT_COMMANDS = [
  { command: 'start', description: 'Открыть Mandal-Art' },
  { command: 'paysupport', description: 'Помощь с оплатой и возвратом' },
  { command: 'terms', description: 'Условия покупки' },
  { command: 'support', description: 'Поддержка' },
  { command: 'remind', description: 'Напоминания о ваших целях' },
  { command: 'stop', description: 'Отключить напоминания' }
];

/** Регистрирует вебхук (с секретным заголовком), список команд и кнопку меню. Используется скриптом и AUTO_SET_WEBHOOK. */
export async function registerWebhook(tg, cfg, { dropPending = false } = {}) {
  const url = cfg.publicUrl + webhookRoute(cfg);
  await tg.setWebhook({ url, secret_token: cfg.webhookSecret, allowed_updates: ['message', 'pre_checkout_query'], max_connections: 20, drop_pending_updates: dropPending });
  await tg.setMyCommands(BOT_COMMANDS);
  await tg.setChatMenuButton({ type: 'web_app', text: 'Mandal-Art', web_app: { url: cfg.publicUrl + '/' } });
  return { url: cfg.publicUrl + '/telegram/webhook' + (cfg.webhookPath ? '/***' : '') };   // секретную часть пути не показываем
}

/* ---------------- initData Mini App ----------------
   secret = HMAC_SHA256(key="WebAppData", msg=bot_token)
   hash   = HMAC_SHA256(key=secret, msg=строки "ключ=значение" (без hash, по алфавиту) через \n)
   Проверяется и свежесть auth_date. */
export function verifyInitData(initData, botToken, { maxAgeSec = 86400, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const fail = reason => { const e = new Error('initData: ' + reason); e.reason = reason; throw e; };
  if (typeof initData !== 'string' || !initData || initData.length > 8192) fail('пусто или слишком длинно');
  let params;
  try { params = new URLSearchParams(initData); } catch { fail('неразбираемо'); }
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) fail('нет hash');
  const pairs = [];
  for (const [k, v] of params.entries()) if (k !== 'hash') pairs.push(`${k}=${v}`);
  pairs.sort();
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(pairs.join('\n')).digest();
  const given = Buffer.from(hash, 'hex');
  if (given.length !== calc.length || !crypto.timingSafeEqual(given, calc)) fail('подпись не совпала');
  const authDate = Number(params.get('auth_date'));
  if (!Number.isSafeInteger(authDate) || authDate <= 0) fail('нет auth_date');
  if (nowSec - authDate > maxAgeSec) fail('данные устарели');
  if (authDate - nowSec > 300) fail('auth_date из будущего');
  let user = null;
  try { user = JSON.parse(params.get('user') || 'null'); } catch { fail('user не JSON'); }
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) fail('нет user.id');
  return { user, authDate, queryId: params.get('query_id') || null, startParam: params.get('start_param') || null };
}
