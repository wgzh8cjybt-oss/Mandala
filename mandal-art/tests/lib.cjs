const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const URL = 'http://localhost:8765/mandal-art.html';
let srv = null;
// Тесты сами поднимают статический сервер для dist/, если порт ещё не занят (процесс не удерживается: unref)
async function ensureServer() {
  const up = await new Promise(res => { const r = http.get(URL, x => { x.resume(); res(x.statusCode === 200); }); r.on('error', () => res(false)); r.setTimeout(1500, () => { r.destroy(); res(false); }); });
  if (up || srv) return;
  srv = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'mandal-art.html';
    const f = path.join(process.env.DIST_DIR || path.join(__dirname, '..', 'dist'), path.basename(name));
    fs.readFile(f, (e, b) => { if (e) { res.writeHead(404); res.end(); } else { res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' }); res.end(b); } });
  });
  await new Promise(r => srv.listen(8765, r)); srv.unref();
}
async function launch(opts = {}) {
  await ensureServer();
  const browser = await chromium.launch();
  const dev = opts.device ? devices[opts.device] : devices['iPhone 13'];
  const ctx = await browser.newContext({ ...dev, deviceScaleFactor: opts.dsf || 2, locale: 'ru-RU', timezoneId: 'Europe/Kiev' });
  if (opts.init) await ctx.addInitScript(opts.init);
  if (opts.storage) await ctx.addInitScript(([s]) => { if (!sessionStorage.getItem('__seeded')) { for (const k in s) localStorage.setItem(k, s[k]); sessionStorage.setItem('__seeded', '1'); } }, [opts.storage]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  await page.route('https://telegram.org/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  return { browser, ctx, page, errors };
}
module.exports = { launch, URL };
