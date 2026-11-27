// HTTP-сервер без зависимостей: роутер, лимиты, заголовки безопасности, CORS, статика, вебхук Telegram.
import fs from 'node:fs';
import path from 'node:path';
import { authenticate, authenticateAdmin } from './api.js';
import { handleUpdate } from './bot.js';
import { event } from './ctx.js';
import { MEDIA_RE, MIME, mediaDir } from './media.js';
import { webhookRoute } from './telegram.js';
import { HttpError, jsonParse, safeEqual } from './util.js';

export class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler, opts = {}) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:[A-Za-z_]+/g, m => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
    this.routes.push({ method, re, keys, handler, opts, pattern });
  }
  match(method, p) {
    let pathOnly = false;
    for (const r of this.routes) {
      const m = r.re.exec(p);
      if (!m) continue;
      if (r.method !== method) { pathOnly = true; continue; }
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
    return pathOnly ? { methodNotAllowed: true } : null;
  }
}

export class RateLimiter {
  constructor() { this.m = new Map(); }
  hit(key, max, windowMs, now) {
    const e = this.m.get(key);
    if (!e || e.reset <= now) { this.m.set(key, { n: 1, reset: now + windowMs }); return true; }
    e.n++;
    return e.n <= max;
  }
  gc(now) { for (const [k, e] of this.m) if (e.reset <= now) this.m.delete(k); }
}

const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.webm': 'video/webm', '.mp4': 'video/mp4', '.gz': 'application/gzip', '.ico': 'image/x-icon' };
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";

const SELF_META = '<meta name="shop-self" content="1">';
/** Добавляет метку в <head> (или в начало, если разметка нестандартная). Уже стоящую метку не дублирует. */
export function withSelfMeta(html) {
  if (/<meta[^>]+name=["']shop-self["']/i.test(html)) return html;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, () => SELF_META + '</head>');
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, m => m + SELF_META);
  return html.replace(/^\s*(<!doctype[^>]*>)?/i, m => m + SELF_META);
}

export function createHandler(ctx, router, { publicDir, now = () => Date.now() }) {
  const limiter = new RateLimiter();
  setInterval(() => limiter.gc(now()), 60000).unref();
  const isHttps = ctx.cfg.publicUrl.startsWith('https://');

  const baseHeaders = (extra = {}) => {
    const h = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'permissions-policy': 'camera=(), microphone=(), geolocation=()', ...extra };
    if (isHttps) h['strict-transport-security'] = 'max-age=31536000';
    return h;
  };
  const clientIp = req => {
    if (ctx.cfg.trustProxy) { const x = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean); if (x.length) return x[x.length - 1]; }
    return req.socket.remoteAddress || '?';
  };
  const corsHeaders = req => {
    const o = req.headers.origin;
    if (!o) return {};
    if (o === ctx.cfg.publicUrl || ctx.cfg.corsOrigins.includes(o)) {
      return { 'access-control-allow-origin': o, vary: 'Origin', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'access-control-max-age': '600' };
    }
    return {};
  };
  const sendJson = (req, res, status, obj, extra = {}) => {
    const body = JSON.stringify(obj);
    res.writeHead(status, baseHeaders({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body), ...extra }));
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  const sendError = (req, res, e, extra) => {
    if (e instanceof HttpError) return sendJson(req, res, e.status, { ok: false, error: { code: e.code, message: e.message, ...(e.extra || {}) } }, extra);
    ctx.log.error('необработанная ошибка', { path: req.url.split('?')[0], error: e });
    return sendJson(req, res, 500, { ok: false, error: { code: 'internal', message: 'Внутренняя ошибка сервера.' } }, extra);
  };

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const len = Number(req.headers['content-length'] || 0);
      if (len > limit) return reject(new HttpError(413, 'too_large', 'Слишком большой запрос.'));
      const chunks = []; let size = 0, done = false;
      req.on('data', c => {
        if (done) return;
        size += c.length;
        if (size > limit) { done = true; reject(new HttpError(413, 'too_large', 'Слишком большой запрос.')); req.resume(); return; }
        chunks.push(c);
      });
      req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
      req.on('error', e => { if (!done) { done = true; reject(e); } });
    });
  }

  function serveFile(req, res, file, { mime, cache = 'no-cache', download } = {}) {
    let st;
    try { st = fs.statSync(file); if (!st.isFile()) throw new Error('not file'); } catch { return sendError(req, res, new HttpError(404, 'not_found', 'Не найдено')); }
    const type = mime || STATIC_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const h = baseHeaders({ 'content-type': type, 'cache-control': cache, 'accept-ranges': 'bytes' });
    if (type.startsWith('text/html')) h['content-security-policy'] = CSP;
    if (download) h['content-disposition'] = `attachment; filename="${download}"`;
    let start = 0, end = st.size - 1, status = 200;
    const rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (rg && (rg[1] || rg[2])) {
      if (rg[1]) { start = Number(rg[1]); if (rg[2]) end = Math.min(end, Number(rg[2])); } else { start = Math.max(0, st.size - Number(rg[2])); }
      if (start > end || start >= st.size) { res.writeHead(416, { ...h, 'content-range': `bytes */${st.size}` }); return res.end(); }
      status = 206; h['content-range'] = `bytes ${start}-${end}/${st.size}`;
    }
    h['content-length'] = end - start + 1;
    res.writeHead(status, h);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  }

  const under = (root, rel) => { const f = path.resolve(root, rel); return f.startsWith(path.resolve(root) + path.sep) ? f : null; };
  const clientFile = () => ctx.cfg.clientFile || path.join(publicDir, 'index.html');

  // Клиент отдаётся с меткой <meta name="shop-self">: так приложение знает, что API магазина — на этом же адресе,
  // и не стучится на чужие адреса вслепую. Файл читается один раз и перечитывается только при изменении.
  let clientCache = { file: '', mtime: 0, body: null };
  function serveClient(req, res) {
    const file = clientFile();
    let st;
    try { st = fs.statSync(file); if (!st.isFile()) throw new Error('not file'); } catch { return sendError(req, res, new HttpError(404, 'not_found', 'Не найдено')); }
    if (!clientCache.body || clientCache.file !== file || clientCache.mtime !== st.mtimeMs) {
      clientCache = { file, mtime: st.mtimeMs, body: Buffer.from(withSelfMeta(fs.readFileSync(file, 'utf8')), 'utf8') };
    }
    res.writeHead(200, baseHeaders({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'content-length': clientCache.body.length, 'content-security-policy': CSP }));
    res.end(req.method === 'HEAD' ? undefined : clientCache.body);
  }

  async function handleWebhook(req, res) {
    const secret = req.headers['x-telegram-bot-api-secret-token'];
    if (typeof secret !== 'string' || !safeEqual(secret, ctx.cfg.webhookSecret)) {
      ctx.log.warn('вебхук: неверный секретный заголовок', { ip: clientIp(req) });
      return sendJson(req, res, 403, { ok: false });
    }
    let update;
    try { update = jsonParse((await readBody(req, 1024 * 1024)).toString('utf8'), null); } catch (e) { return sendError(req, res, e); }
    if (!update || typeof update !== 'object') return sendJson(req, res, 400, { ok: false });
    try {
      const r = await handleUpdate(ctx, update);
      ctx.log.debug('вебхук обработан', { update_id: update.update_id, result: r && (r.result || r.handled || r.ok) });
      return sendJson(req, res, 200, { ok: true });
    } catch (e) {
      ctx.log.error('вебхук: ошибка обработки (Telegram повторит доставку)', { update_id: update.update_id, error: e });
      try { event(ctx, 'webhook_error', { data: { update_id: update.update_id, error: String(e.message).slice(0, 200) } }); } catch { /* ignore */ }
      return sendJson(req, res, 500, { ok: false });
    }
  }

  return async function handler(req, res) {
    try {
      const url = new URL(req.url, 'http://x');
      let p;
      try { p = decodeURIComponent(url.pathname); } catch { throw new HttpError(400, 'bad_request', 'Неверный адрес.'); }
      const method = req.method;

      if (p === webhookRoute(ctx.cfg) && method === 'POST') return handleWebhook(req, res);

      if (p.startsWith('/api/')) {
        const cors = corsHeaders(req);
        if (method === 'OPTIONS') { res.writeHead(204, baseHeaders(cors)); return res.end(); }
        const t = now(), ip = clientIp(req);
        if (!limiter.hit('ip:' + ip, 300, 60000, t)) throw new HttpError(429, 'rate_limited', 'Слишком много запросов. Подождите минуту.');
        const m = router.match(method === 'HEAD' ? 'GET' : method, p);
        if (!m) throw new HttpError(404, 'not_found', 'Метод не найден.');
        if (m.methodNotAllowed) throw new HttpError(405, 'method_not_allowed', 'Метод не поддерживается.');
        const { route, params } = m, o = route.opts;
        req.params = params;
        req.query = Object.fromEntries(url.searchParams.entries());
        if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
          if (o.raw) req.rawBody = await readBody(req, o.rawLimit || 1024 * 1024);
          else {
            const buf = await readBody(req, 64 * 1024);
            let body = {};
            if (buf.length) { try { body = JSON.parse(buf.toString('utf8')); } catch { throw new HttpError(400, 'bad_json', 'Неверный JSON.'); } }
            if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'bad_json', 'Ожидается JSON-объект.');
            req.body = body;
          }
        }
        try {
          if (o.auth === 'optional') authenticate(ctx, req, { optional: true });
          else if (o.auth === 'admin') authenticateAdmin(ctx, req);
          else if (o.auth !== 'none') authenticate(ctx, req);
        } catch (e) {
          if (e instanceof HttpError && e.status === 401 && !limiter.hit('authfail:' + ip, 30, 60000, t)) throw new HttpError(429, 'rate_limited', 'Слишком много неудачных попыток.');
          throw e;
        }
        if (o.limit) {
          const who = o.limit.by === 'user' && req.user ? 'u' + req.user.tg_id : 'ip' + ip;
          if (!limiter.hit(`${route.pattern}:${who}`, o.limit.max, o.limit.windowMs, t)) throw new HttpError(429, 'rate_limited', 'Слишком часто. Подождите немного.');
        }
        const out = await route.handler(req);
        if (out && out.__file) return serveFile(req, res, out.__file, { mime: out.mime, download: out.download, cache: 'no-store' });
        return sendJson(req, res, 200, out, cors);
      }

      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(404, 'not_found', 'Не найдено');
      if (p === '/' || p === '/index.html') return serveClient(req, res);
      if (p === '/admin' || p === '/admin/') return serveFile(req, res, path.join(publicDir, 'admin', 'index.html'));
      if (p === '/favicon.ico') { res.writeHead(204, baseHeaders()); return res.end(); }
      if (p.startsWith('/art/')) {
        const f = under(path.join(publicDir, 'art'), p.slice(5));
        if (!f || /(^|\/)\./.test(p)) throw new HttpError(404, 'not_found', 'Не найдено');
        return serveFile(req, res, f, { cache: 'public, max-age=3600' });
      }
      if (p.startsWith('/media/')) {
        const name = p.slice(7);
        if (!MEDIA_RE.test(name)) throw new HttpError(404, 'not_found', 'Не найдено');
        return serveFile(req, res, path.join(mediaDir(ctx), name), { mime: MIME[name.split('.').pop()], cache: 'public, max-age=31536000, immutable' });
      }
      throw new HttpError(404, 'not_found', 'Не найдено');
    } catch (e) {
      return sendError(req, res, e, corsHeaders(req));
    }
  };
}
