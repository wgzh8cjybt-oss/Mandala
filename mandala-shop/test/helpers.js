// Общие помощники тестов: имитация Bot API Telegram (с проверкой правил для Stars), независимая от сервера
// подпись initData, запуск настоящего сервера на временной базе и «пользователь, который платит».
// Настоящий Telegram и настоящие Stars тесты не трогают: деньги здесь не двигаются.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { all, one, openDb } from '../src/db.js';
import { createLogger } from '../src/log.js';
import { TelegramApi } from '../src/telegram.js';

export const BOT_TOKEN = '123456789:AAH_testtoken_abcdefghijklmnopqrstuv';
export const WEBHOOK_SECRET = 'f3a9c1d27be84a50b6c3e19d7a4f8c2e5b0d6a91c7e348f2';
export const WEBHOOK_PATH = 'hook_test_path_123';
export const ADMIN_ID = 1001;
export const ADMIN_TOKEN = 'admin-token-0123456789abcdefghijklmnopqrstuv';
export const START_MS = Date.UTC(2026, 10, 8, 12, 0, 0);

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function waitFor(fn, { timeout = 3000, step = 20 } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor: время вышло');
    await sleep(step);
  }
}

/* ---------------- подпись initData: независимая реализация по описанию Telegram ---------------- */
export function signParams(params, token = BOT_TOKEN) {
  const dcs = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  return crypto.createHmac('sha256', secret).update(dcs).digest('hex');
}
export function signInitData(user, { token = BOT_TOKEN, authDate, extra = {} } = {}) {
  const params = { auth_date: String(authDate), query_id: 'AAHdF6IQAAAAAN0XohDhrOrc', user: JSON.stringify(user), ...extra };
  return new URLSearchParams({ ...params, hash: signParams(params, token) }).toString();
}
export const tgUser = id => ({ id, first_name: 'User' + id, username: 'user' + id, language_code: 'ru' });

/* ---------------- имитация Bot API ---------------- */
export class MockTelegram {
  constructor(token = BOT_TOKEN) {
    this.token = token; this.calls = []; this.invoices = new Map(); this.ledger = []; this.messages = []; this.answers = new Map();
    this.failures = []; this.blockedChats = new Set(); this.webhook = null; this.commands = null; this.menuButton = null;
    this.seq = { invoice: 0, charge: 0 }; this.clock = () => Math.floor(Date.now() / 1000);
  }
  async start() {
    this.server = http.createServer((req, res) => this._handle(req, res).catch(e => { res.writeHead(500); res.end(String(e && e.stack)); }));
    await new Promise(r => this.server.listen(0, '127.0.0.1', r));
    this.base = `http://127.0.0.1:${this.server.address().port}`;
    return this;
  }
  async stop() { this.server.closeAllConnections?.(); await new Promise(r => this.server.close(r)); }

  callsOf(method) { return this.calls.filter(c => c.method === method); }
  lastCall(method) { const l = this.callsOf(method); return l[l.length - 1] || null; }
  messagesTo(chatId) { return this.messages.filter(m => m.chat_id === chatId); }
  /** Ближайшие вызовы метода завершатся ошибкой Bot API, обрывом соединения (network) или зависанием (hang). */
  failNext(method, { code = 400, description = 'Bad Request: test failure', network = false, hang = false, times = 1, parameters = null } = {}) {
    this.failures.push({ method, code, description, network, hang, times, parameters });
  }

  /** Telegram списал Stars: операция появилась в реестре. Возвращает номер платежа (telegram_payment_charge_id). */
  charge(userId, { amount, payload }) {
    const id = 'tgchg_' + String(++this.seq.charge).padStart(6, '0') + '_' + crypto.randomBytes(4).toString('hex');
    this.ledger.push({ seq: this.ledger.length, id, amount, date: this.clock(), source: { type: 'user', user: tgUser(userId), transaction_type: 'invoice_payment', invoice_payload: payload } });
    return id;
  }
  refunded(chargeId) { return this.ledger.some(t => t.id === chargeId && t.receiver && t.receiver.type === 'user'); }
  /** Telegram вернул Stars (например, по запросу самого владельца вне нашего сервера или когда ответ до нас не дошёл). */
  refundNow(chargeId) {
    const src = this.ledger.find(t => t.id === chargeId && t.source && t.source.type === 'user');
    if (!src || this.refunded(chargeId)) return false;
    this.ledger.push({ seq: this.ledger.length, id: src.id, amount: src.amount, date: this.clock(), receiver: { type: 'user', user: src.source.user } });
    return true;
  }
  /** Запись о выводе Stars через Fragment (как её показывает getStarTransactions). */
  addWithdrawal(amount, state = 'pending') {
    this.ledger.push({ seq: this.ledger.length, id: 'wd_' + (++this.seq.charge), amount, date: this.clock(), receiver: { type: 'fragment', withdrawal_state: { type: state } } });
  }
  balance() {
    let n = 0;
    for (const t of this.ledger) { if (t.source && t.source.type === 'user') n += t.amount; else if (t.receiver) n -= t.amount; }
    return n;
  }

  async _handle(req, res) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const m = /^\/bot([^/]+)\/([A-Za-z]+)$/.exec(req.url.split('?')[0]);
    const send = (status, obj) => { const b = JSON.stringify(obj); res.writeHead(status, { 'content-type': 'application/json' }); res.end(b); };
    const ok = result => send(200, { ok: true, result });
    const err = (code, description, parameters) => send(code, { ok: false, error_code: code, description, ...(parameters ? { parameters } : {}) });
    if (!m) return err(404, 'Not Found');
    if (m[1] !== this.token) return err(401, 'Unauthorized');
    const method = m[2];
    let p = {};
    try { p = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return err(400, 'Bad Request: invalid JSON'); }
    this.calls.push({ method, params: JSON.parse(JSON.stringify(p)), at: Date.now() });

    const fi = this.failures.findIndex(f => f.method === method);
    if (fi >= 0) {
      const f = this.failures[fi];
      if (--f.times <= 0) this.failures.splice(fi, 1);
      if (f.network) return req.socket.destroy();
      if (f.hang) return;   // клиент оборвёт по таймауту
      return err(f.code, f.description, f.parameters);
    }

    switch (method) {
      case 'getMe': return ok({ id: 123456789, is_bot: true, first_name: 'Shop', username: 'test_shop_bot' });
      case 'createInvoiceLink': {
        if (p.currency !== 'XTR') return err(400, 'Bad Request: currency must be XTR');
        if (p.provider_token) return err(400, 'Bad Request: provider_token must be empty for XTR');
        if (!Array.isArray(p.prices) || p.prices.length !== 1) return err(400, 'Bad Request: exactly one price is required for XTR');
        const pr = p.prices[0];
        if (!pr || !Number.isInteger(pr.amount) || pr.amount < 1 || typeof pr.label !== 'string' || !pr.label) return err(400, 'Bad Request: invalid price');
        if (typeof p.title !== 'string' || !p.title || Array.from(p.title).length > 32) return err(400, 'Bad Request: title must be 1-32 characters');
        if (typeof p.description !== 'string' || !p.description || Array.from(p.description).length > 255) return err(400, 'Bad Request: description must be 1-255 characters');
        if (typeof p.payload !== 'string' || !p.payload || Buffer.byteLength(p.payload) > 128) return err(400, 'Bad Request: payload must be 1-128 bytes');
        const link = `https://t.me/$mockinv${++this.seq.invoice}`;
        this.invoices.set(link, { title: p.title, description: p.description, payload: p.payload, amount: pr.amount, currency: p.currency });
        return ok(link);
      }
      case 'answerPreCheckoutQuery': {
        if (typeof p.pre_checkout_query_id !== 'string' || typeof p.ok !== 'boolean') return err(400, 'Bad Request: invalid arguments');
        if (!p.ok && !p.error_message) return err(400, 'Bad Request: error_message is required when ok is false');
        this.answers.set(p.pre_checkout_query_id, { ok: p.ok, error_message: p.error_message || null });
        return ok(true);
      }
      case 'sendMessage': {
        if (this.blockedChats.has(p.chat_id)) return err(403, 'Forbidden: bot was blocked by the user');
        this.messages.push({ chat_id: p.chat_id, text: p.text, extra: p });
        return ok({ message_id: this.messages.length, chat: { id: p.chat_id }, text: p.text });
      }
      case 'refundStarPayment': {
        const src = this.ledger.find(t => t.id === p.telegram_payment_charge_id && t.source && t.source.type === 'user');
        if (!src || src.source.user.id !== p.user_id) return err(400, 'Bad Request: CHARGE_ID_INVALID');
        if (this.refunded(src.id)) return err(400, 'Bad Request: CHARGE_ALREADY_REFUNDED');
        this.refundNow(src.id);
        return ok(true);
      }
      case 'getStarTransactions': {
        const off = Number(p.offset || 0), lim = Math.min(100, Number(p.limit || 100));
        const sorted = this.ledger.slice().sort((a, b) => b.date - a.date || b.seq - a.seq);
        return ok({ transactions: sorted.slice(off, off + lim).map(({ seq, ...t }) => t) });
      }
      case 'getMyStarBalance': return ok({ amount: this.balance(), nanostar_amount: 0 });
      case 'setWebhook': {
        if (typeof p.url !== 'string' || !p.url.startsWith('https://')) return err(400, 'Bad Request: bad webhook: HTTPS url must be provided for webhook');
        if (p.secret_token !== undefined && !/^[A-Za-z0-9_-]{1,256}$/.test(p.secret_token)) return err(400, 'Bad Request: secret token contains unallowed characters');
        this.webhook = p; return ok(true);
      }
      case 'deleteWebhook': this.webhook = null; return ok(true);
      case 'getWebhookInfo': return ok({ url: this.webhook ? this.webhook.url : '', has_custom_certificate: false, pending_update_count: 0, max_connections: this.webhook ? this.webhook.max_connections : undefined, allowed_updates: this.webhook ? this.webhook.allowed_updates : undefined });
      case 'setMyCommands': this.commands = p.commands; return ok(true);
      case 'setChatMenuButton': this.menuButton = p.menu_button; return ok(true);
      default: return err(404, 'Not Found: method ' + method);
    }
  }
}

/* ---------------- запуск настоящего сервера ---------------- */
export async function startServer(opts = {}) {
  const mock = await new MockTelegram().start();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mandala-test-'));
  const publicDir = path.join(dir, 'public');
  fs.mkdirSync(path.join(publicDir, 'admin'), { recursive: true });
  fs.mkdirSync(path.join(publicDir, 'art', 'figures'), { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html><title>client</title>');
  fs.writeFileSync(path.join(publicDir, 'admin', 'index.html'), '<!doctype html><title>admin</title>');
  fs.writeFileSync(path.join(publicDir, 'art', 'figures', 'x.webp'), Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ', 'latin1'));
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'TOP-SECRET');
  const env = {
    BOT_TOKEN, WEBHOOK_SECRET, WEBHOOK_PATH, PUBLIC_URL: 'https://shop.test', ADMIN_IDS: String(ADMIN_ID), DATA_DIR: path.join(dir, 'data'),
    SUPPORT_CONTACT: '@support_test', TELEGRAM_API_BASE: mock.base, BACKUP_EVERY_HOURS: '0', RECONCILE_EVERY_HOURS: '0', STATS_TZ: 'UTC', ...(opts.env || {})
  };
  const cfg = loadConfig(env);
  const clock = { t: START_MS, now() { return this.t; }, advance(ms) { this.t += ms; return this.t; } };
  mock.clock = () => Math.floor(clock.t / 1000);
  const logs = [];
  const log = createLogger({ level: 'debug', secrets: [cfg.botToken, cfg.botToken.split(':')[1], cfg.webhookSecret, cfg.webhookPath, cfg.adminToken], sink: l => logs.push(l) });
  const db = openDb(path.join(cfg.dataDir, 'mandala.sqlite'));
  const tg = new TelegramApi({ token: cfg.botToken, base: cfg.telegramApiBase, timeoutMs: opts.timeoutMs || 2000 });
  const app = createApp({ cfg, db, tg, log, now: () => clock.t, publicDir });
  const server = http.createServer(app.handler);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const webhookPath = '/telegram/webhook/' + WEBHOOK_PATH;

  async function req(method, p, o = {}) {
    const headers = { ...(o.headers || {}) };
    if (o.user != null) headers.authorization = 'tma ' + signInitData(tgUser(o.user), { authDate: Math.floor(clock.t / 1000) });
    if (o.token) headers.authorization = 'Bearer ' + o.token;
    let body;
    if (o.raw !== undefined) body = o.raw;
    else if (o.body !== undefined) { body = typeof o.body === 'string' ? o.body : JSON.stringify(o.body); headers['content-type'] = headers['content-type'] || 'application/json'; }
    const res = await fetch(base + p, { method, headers, body });
    const buf = Buffer.from(await res.arrayBuffer());
    const text = buf.toString('utf8');
    let json = null; try { json = JSON.parse(text); } catch { /* не JSON */ }
    return { status: res.status, headers: res.headers, buf, text, json };
  }
  const as = id => ({
    get: (p, o) => req('GET', p, { ...o, user: id }), post: (p, body, o) => req('POST', p, { ...o, body: body === undefined ? {} : body, user: id }),
    put: (p, body, o) => req('PUT', p, { ...o, body, user: id }), del: (p, o) => req('DELETE', p, { ...o, user: id })
  });

  let updateId = 5000, msgId = 100, queryId = 0;
  const nextUpdateId = () => ++updateId;
  const webhook = (update, o = {}) => req('POST', o.path || webhookPath, {
    headers: o.secret === null ? {} : { 'x-telegram-bot-api-secret-token': o.secret ?? WEBHOOK_SECRET }, body: update
  });
  const successfulPaymentUpdate = ({ userId, payload, amount, chargeId, currency = 'XTR', updateId: uid }) => ({
    update_id: uid ?? nextUpdateId(),
    message: { message_id: ++msgId, date: mock.clock(), chat: { id: userId, type: 'private' }, from: tgUser(userId),
      successful_payment: { currency, total_amount: amount, invoice_payload: payload, telegram_payment_charge_id: chargeId, provider_payment_charge_id: chargeId } }
  });
  const preCheckoutUpdate = ({ userId, payload, amount, currency = 'XTR', id }) => ({
    update_id: nextUpdateId(), pre_checkout_query: { id: id || 'pcq' + (++queryId), from: tgUser(userId), currency, total_amount: amount, invoice_payload: payload }
  });

  /** Пользователь открывает счёт и платит: pre_checkout_query → (если сервер разрешил) списание Stars → successful_payment. */
  async function pay(link, userId, o = {}) {
    const inv = mock.invoices.get(link);
    if (!inv) throw new Error('pay: счёт неизвестен имитации Telegram: ' + link);
    const pc = preCheckoutUpdate({ userId, payload: inv.payload, amount: inv.amount, currency: inv.currency });
    await webhook(pc);
    const answer = mock.answers.get(pc.pre_checkout_query.id) || null;
    if (!answer || !answer.ok) return { paid: false, answer };
    const chargeId = mock.charge(userId, inv);
    const update = successfulPaymentUpdate({ userId, payload: inv.payload, amount: inv.amount, chargeId });
    if (o.missedWebhook) return { paid: true, chargeId, update, missed: true };
    const res = await webhook(update);
    return { paid: true, chargeId, update, res };
  }

  async function acceptTerms(userId) {
    const me = await as(userId).get('/api/me');
    if (me.json && me.json.terms && !me.json.terms.accepted) await as(userId).post('/api/terms/accept', { version: me.json.terms.version });
  }
  /** Создаёт заказ через API (условия принимаются автоматически). */
  async function order(userId, productId) {
    await acceptTerms(userId);
    const r = await as(userId).post('/api/orders', { product_id: productId });
    if (r.status !== 200) throw new Error(`order(${productId}) → ${r.status} ${r.text}`);
    return r.json.order;
  }
  /** Заказ + оплата. */
  async function buy(userId, productId, o = {}) {
    const ord = await order(userId, productId);
    const p = await pay(ord.invoice_link, userId, o);
    return { order: ord, ...p };
  }
  const rights = async userId => (await as(userId).get('/api/me')).json.rights;

  return {
    cfg, db, ctx: app.ctx, app, mock, clock, logs, dir, base, publicDir, server,
    req, as, admin: as(ADMIN_ID), webhook, webhookPath, nextUpdateId, successfulPaymentUpdate, preCheckoutUpdate, pay, order, buy, acceptTerms, rights,
    q: (sql, ...p) => all(db, sql, ...p), q1: (sql, ...p) => one(db, sql, ...p),
    async close() {
      server.closeAllConnections?.();
      await new Promise(r => server.close(r));
      await mock.stop();
      try { db.close(); } catch { /* ignore */ }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}
