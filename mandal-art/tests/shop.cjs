// Вкладка «Магазин»: витрина без сервера, слоты мандал, получение огоньков, применение прав, история.
// Сервер здесь — ИМИТАЦИЯ (перехват запросов браузера). Настоящий Telegram и платежи не проверяются:
// проверяется клиентская логика и то, что приложение само ничего не «засчитывает» без ответа сервера.
const { launch, URL: APP } = require('./lib.cjs');
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ''); } };
const BASE = 'http://localhost:8765';
const SHOTS = __dirname + '/shots';
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS);

const TG = uid => `(() => {
  window.__invoices = []; window.__invoiceResult = 'paid';
  window.Telegram = { WebApp: { initData: 'query_id=mock&user=%7B%22id%22%3A${uid}%7D&hash=mock', initDataUnsafe: { user: { id: ${uid} } }, platform: 'android', version: '8.0', isVersionAtLeast: v => parseFloat(v) <= 8.0,
    ready() {}, expand() {}, disableVerticalSwipes() {}, setHeaderColor() {}, setBackgroundColor() {}, setBottomBarColor() {}, onEvent() {},
    BackButton: { onClick() {}, show() {}, hide() {} }, HapticFeedback: { impactOccurred() {}, notificationOccurred() {}, selectionChanged() {} },
    openInvoice(url, cb) { window.__invoices.push(url); setTimeout(() => cb(window.__invoiceResult), 30); } } };
})();`;

function fakeServer() {
  const st = { enabled: true, calls: [], claims: [], seq: 100, orderProduct: {}, paidOrders: {}, nextStatus: 'paid', terms: { version: 1, accepted: true }, history: [] };
  st.rights = { slots: { extra: 0, total: 1, max: 12 }, items: [], consumables: [], etag: 'e0' };
  const P = (id, category, kind, price, grant, extra) => Object.assign({ id, category, kind, title: id, description: 'описание', family: '', rights_status: 'own', price_stars: price, status: 'active', grant, sort: 10, owned: 0, can_buy: true }, extra || {});
  st.products = [
    P('slot_plus_1', 'slots', 'slot', 50, { slots: 1 }, { title: '+1 слот мандалы' }),
    P('flames_100', 'rewards', 'flames', 40, { flames: 100 }, { title: '100 огоньков' }),
    P('uni_scrooge', 'universes', 'universe', 60, { builtin: 'scrooge' }, { title: 'Вселенная Scrooge Gold', family: 'sc' }),
    P('bg_deep', 'backgrounds', 'background', 30, { background: 'deep' }, { title: 'Фон «Бездна»' }),
    P('fig_art_coins', 'characters', 'figure', 40, {}, { title: 'Артефакт: Золотой столбик' })
  ];
  const json = (route, obj, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(obj) });
  st.pay = pid => {
    const p = st.products.find(x => x.id === pid), id = ++st.seq;
    if (p.kind === 'flames') st.rights.consumables.push({ id, product_id: pid, flames: p.grant.flames, source: 'order', created_at: Date.now() });
    else {
      st.rights.items.push({ id, product_id: pid, kind: p.kind, grant: p.grant, source: 'order', created_at: Date.now() });
      if (p.kind === 'slot') { st.rights.slots.extra += p.grant.slots; st.rights.slots.total = Math.min(12, 1 + st.rights.slots.extra); }
      else { p.owned = 1; p.can_buy = false; p.reason = 'owned'; }
    }
    st.rights.etag = 'e' + id;
    st.history.unshift({ id: 'o' + id, product_id: pid, title: p.title, amount: p.price_stars, currency: 'XTR', status: 'paid', created_at: Date.now(), paid_at: Date.now() });
  };
  st.handler = async route => {
    const req = route.request(), u = new URL(req.url()), path = u.pathname, m = req.method();
    st.calls.push(m + ' ' + path);
    if (path === '/api/health') return json(route, { ok: true, time: Date.now() });
    if (path === '/api/catalog') return json(route, { ok: true, shop: { enabled: st.enabled }, categories: [], products: st.products });
    if (path === '/api/me') return json(route, { ok: true, user: { id: 42 }, rights: st.rights, terms: st.terms, shop: { enabled: st.enabled } });
    if (path === '/api/rights/sync') return json(route, { ok: true, rights: st.rights, terms: st.terms, shop: { enabled: st.enabled } });
    if (path === '/api/terms' && m === 'GET') return json(route, { ok: true, version: 1, text: 'Условия.' });
    if (path === '/api/orders' && m === 'POST') {
      const body = JSON.parse(req.postData() || '{}'), id = 'o' + (++st.seq);
      st.orderProduct[id] = body.product_id;
      return json(route, { ok: true, order: { id, status: 'created', invoice_link: 'https://t.me/$' + id } });
    }
    if (path === '/api/orders' && m === 'GET') return json(route, { ok: true, orders: st.history });
    const mo = /^\/api\/orders\/(o\d+)$/.exec(path);
    if (mo) {
      if (st.nextStatus === 'paid' && !st.paidOrders[mo[1]]) { st.paidOrders[mo[1]] = 1; st.pay(st.orderProduct[mo[1]]); }
      return json(route, { ok: true, order: { id: mo[1], status: st.nextStatus }, rights: st.nextStatus === 'paid' ? st.rights : undefined });
    }
    if (path === '/api/claim' && m === 'POST') {
      const ids = JSON.parse(req.postData() || '{}').ids || []; let n = 0;
      st.rights.consumables = st.rights.consumables.filter(c => { if (ids.includes(c.id)) { n++; return false; } return true; });
      st.claims.push(ids); st.rights.etag = 'c' + (++st.seq);
      return json(route, { ok: true, claimed: n, rights: st.rights });
    }
    return json(route, { ok: false, error: { code: 'not_found', message: 'нет маршрута' } }, 404);
  };
  return st;
}

async function device(opts) {
  opts = opts || {};
  const h = await launch({ dsf: opts.dsf || 1, init: opts.uid ? TG(opts.uid) : undefined, storage: opts.storage });
  if (opts.server) {
    await h.page.route(BASE + '/api/**', opts.server.handler);
    await h.page.route(APP, async route => { const r = await route.fetch(); let b = await r.text(); b = b.replace('</head>', '<meta name="shop-api" content="' + BASE + '"></head>'); route.fulfill({ response: r, body: b }); });
  }
  if (opts.w) await h.page.setViewportSize({ width: opts.w, height: opts.h || 760 });
  await h.page.goto(APP); await h.page.waitForTimeout(800);
  await h.page.evaluate(() => { while (Modal.closeTop()); });
  return h;
}
const openShop = async p => { await p.click('#nav [data-tab="relics"]'); await p.waitForTimeout(150); await p.click('[data-act="hall"][data-v="shop"]'); await p.waitForTimeout(250); };
const clickText = (p, re, sel) => p.evaluate(([src, s]) => { const r = new RegExp(src); const b = [...document.querySelectorAll(s || '.overlay .btn, .modal .btn')].find(x => r.test(x.textContent)); if (b) b.click(); return !!b; }, [re.source, sel || '']);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  /* ---------- A. обычный браузер: витрина без сервера и без Telegram ---------- */
  let d = await device({});
  let p = d.page;
  await openShop(p);
  const seg = await p.evaluate(() => { const s = document.querySelector('.hall-seg'); return { n: s.querySelectorAll('button').length, txt: [...s.querySelectorAll('button')].map(b => b.textContent.trim().replace(/\s+/g, ' ')), fit: s.scrollWidth <= s.clientWidth + 1, hs: [...s.querySelectorAll('button')].map(b => Math.round(b.getBoundingClientRect().height)) }; });
  ok('hall has three tabs including «Магазин»; they fit the 390px screen on one line', seg.n === 3 && /Магазин/i.test(seg.txt[2]) && seg.fit && seg.hs.every(h => h < 46), seg);
  const bn = await p.evaluate(() => { const b = document.querySelector('.sh-banner'); return b ? { cls: b.className, txt: b.textContent } : null; });
  ok('outside Telegram the banner honestly says purchases work only inside Telegram', bn && /Витрина магазина/.test(bn.txt) && /внутри Telegram/.test(bn.txt), bn);
  const sc = await p.evaluate(() => ({ n: document.querySelectorAll('.sh-item').length, total: SHOWCASE.length, buy: document.querySelectorAll('[data-act="shop-buy"]').length, btn: [...document.querySelectorAll('.sh-item')].map(e => [e.dataset.kind, e.querySelector('.btn').disabled, e.querySelector('.btn').textContent.trim()]) }));
  ok('showcase lists all sample products and has NO working buy button (no fake purchases)', sc.n === sc.total && sc.n === 26 && sc.buy === 0 && sc.btn.every(b => b[1] === true), sc);
  ok('supported kinds say «Витрина», unsupported say «Скоро в приложении»', sc.btn.every(b => (['slot', 'flames', 'universe', 'relic', 'figure'].includes(b[0]) ? b[2] === 'Витрина' : b[2] === 'Скоро в приложении')), sc.btn);
  await p.click('.an-chips button[data-v="slots"]'); await p.waitForTimeout(150);
  ok('category chip filters the list', await p.evaluate(() => { const k = [...document.querySelectorAll('.sh-item')].map(e => e.dataset.kind); return k.length === 2 && k.every(x => x === 'slot') && document.querySelector('.an-chips .on').dataset.v === 'slots'; }));
  await p.click('.an-chips button[data-v="all"]'); await p.waitForTimeout(150);
  ok('«Все» shows everything again', await p.evaluate(() => document.querySelectorAll('.sh-item').length === 26));
  ok('slot card: one mandala, limit is not enforced without a server', await p.evaluate(() => /Ограничение включится/.test(document.querySelector('.sh-slots').textContent) && document.querySelector('.sh-slots .n b').textContent === '1' && Shop.slotLimit() === null));
  ok('no «Мои покупки» block without purchases', await p.evaluate(() => !/Мои покупки/.test(document.querySelector('#relicsScroll').textContent)));
  await p.screenshot({ path: SHOTS + '/shop-1-showcase.png' });
  // оформление: из «Штаба» и из склада огоньков
  await p.click('#nav [data-tab="hq"]'); await p.waitForTimeout(250);
  ok('HQ has a «Магазин» card that opens the shop tab', await p.evaluate(() => !!document.querySelector('#viewHq [data-act="shop-open"], #hqScroll [data-act="shop-open"], [data-act="shop-open"]')));
  await p.evaluate(() => document.querySelector('[data-act="shop-open"]').click()); await p.waitForTimeout(300);
  ok('from HQ the shop tab opens on the relics screen', await p.evaluate(() => UI.tab === 'relics' && UI.hall === 'shop' && !!document.querySelector('.sh-banner')));
  await p.click('[data-act="hall"][data-v="relics"]'); await p.waitForTimeout(150);
  await p.click('[data-act="store"]'); await p.waitForTimeout(250);
  ok('flame store modal links to the Stars shop', await p.evaluate(() => !!document.querySelector('.store-shop [data-s="shop"]')));
  await p.click('.store-shop [data-s="shop"]'); await p.waitForTimeout(300);
  ok('the link closes the modal and opens the shop tab', await p.evaluate(() => UI.hall === 'shop' && !document.querySelector('.store-shop')));
  // без сервера лимит прежний: «+ Цель» работает
  await p.click('#nav [data-tab="mandala"]'); await p.waitForTimeout(200);
  await p.click('[data-act="add-mandala"]'); await p.waitForTimeout(200);
  ok('without a connected shop «+ Цель» still creates a mandala (old limit)', await p.evaluate(() => S.mandals.length === 2));
  ok('state schema keeps shopApplied and drops junk ids', await p.evaluate(() => { const a = normalizeState({ v: 2, shopApplied: { fl: [1, 'x', -3, 1.5, 2, 2, 9007199254740993] } }, false).shopApplied.fl; const b = normalizeState({ v: 2 }, false).shopApplied.fl; return JSON.stringify(a) === '[1,2]' && Array.isArray(b) && b.length === 0 && Array.isArray(S.shopApplied.fl); }));
  const errsA = d.errors.filter(e => !/404|Failed to load resource/.test(e));
  ok('A: no page errors', errsA.length === 0, errsA);
  await d.browser.close();

  /* ---------- B. внутри Telegram, но сервера нет ---------- */
  d = await device({ uid: 7 });
  p = d.page; await openShop(p);
  const b2 = await p.evaluate(() => ({ t: document.querySelector('.sh-banner').textContent, help: !!document.querySelector('[data-act="shop-help"]') }));
  ok('in Telegram without a server: banner says the shop is not connected and offers «Как включить покупки»', /не подключён к серверу/.test(b2.t) && b2.help, b2);
  await p.click('[data-act="shop-help"]'); await p.waitForTimeout(250);
  ok('the help window explains what is needed (server, bot token, https)', await p.evaluate(() => /Node\.js 22\.13/.test(document.body.textContent) && /BotFather/.test(document.body.textContent)));
  await p.evaluate(() => { while (Modal.closeTop()); });
  await d.browser.close();

  /* ---------- C. Telegram + сервер (имитация) ---------- */
  const srv = fakeServer();
  d = await device({ uid: 42, server: srv, w: 390 });
  p = d.page; await openShop(p); await p.waitForTimeout(500);
  await p.screenshot({ path: SHOTS + '/shop-2-live.png' });
  const c1 = await p.evaluate(() => ({ b: document.querySelector('.sh-banner').className, t: document.querySelector('.sh-banner').textContent, n: document.querySelectorAll('.sh-item').length, st: Shop.status(), slots: document.querySelector('.sh-slots').textContent, lim: Shop.slotLimit() }));
  ok('connected: banner is green «Магазин подключён», five server products listed (not the sample showcase)', /good/.test(c1.b) && /Магазин подключён/.test(c1.t) && c1.n === 5 && c1.st.ok === true, c1);
  ok('slot limit now comes from the server (1) and the card says all slots are taken', c1.lim === 1 && /У вас слотов: 1/.test(c1.slots) && /Все заняты/.test(c1.slots), c1.slots);
  const c2 = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.sh-item')].map(e => [e.querySelector('.t').textContent, [e.querySelector('.btn').disabled, e.querySelector('.btn').textContent.trim()]])));
  ok('supported products can be bought; an unsupported kind (background) says «Скоро в приложении»', c2['+1 слот мандалы'][0] === false && /Купить/.test(c2['+1 слот мандалы'][1]) && c2['Вселенная Scrooge Gold'][0] === false && c2['Фон «Бездна»'][0] === true && /Скоро/.test(c2['Фон «Бездна»'][1]) && c2['Артефакт: Золотой столбик'][0] === false, c2);

  // стена «нужен слот»
  await p.click('#nav [data-tab="mandala"]'); await p.waitForTimeout(200);
  await p.click('[data-act="add-mandala"]'); await p.waitForTimeout(350);
  ok('with all slots taken «+ Цель» does NOT create a mandala and offers the shop', await p.evaluate(() => S.mandals.length === 1 && /Нужен новый слот/.test(document.body.textContent) && /от 50 Stars/.test(document.body.textContent)));
  await clickText(p, /В магазин/); await p.waitForTimeout(400);
  ok('«В магазин» opens the Slots category', await p.evaluate(() => UI.tab === 'relics' && UI.hall === 'shop' && UI.shopCat === 'slots' && [...document.querySelectorAll('.sh-item')].every(e => e.dataset.kind === 'slot') && document.querySelectorAll('.sh-item').length === 1));

  // покупка слота
  await p.click('[data-act="shop-buy"][data-id="slot_plus_1"]'); await p.waitForTimeout(400);
  await clickText(p, /К оплате/); await p.waitForTimeout(1500);
  ok('slot purchase: order created, official invoice opened, server confirmed -> limit 2', await p.evaluate(() => window.__invoices.length === 1 && Shop.slotLimit() === 2), srv.calls.slice(-6));
  ok('«Мои покупки» appears and the slots card shows 1 / 2', await p.evaluate(() => /Мои покупки/.test(document.querySelector('#relicsScroll').textContent) && /У вас слотов: 2/.test(document.querySelector('.sh-slots').textContent)));
  await p.click('#nav [data-tab="mandala"]'); await p.waitForTimeout(200);
  await p.click('[data-act="add-mandala"]'); await p.waitForTimeout(250);
  ok('after buying the slot «+ Цель» creates the second mandala', await p.evaluate(() => S.mandals.length === 2));
  await p.click('[data-act="add-mandala"]'); await p.waitForTimeout(350);
  ok('the third one is blocked again (2 slots, both taken)', await p.evaluate(() => S.mandals.length === 2 && /Нужен новый слот/.test(document.body.textContent)));
  await p.evaluate(() => { while (Modal.closeTop()); });

  // существующие мандалы не удаляются, даже если слотов меньше
  await p.evaluate(() => { for (let i = 0; i < 2; i++) S.mandals.push(newMandala('Старая ' + i)); save(); });
  srv.rights.slots = { extra: 0, total: 1, max: 12 }; srv.rights.etag = 'low';
  await p.evaluate(() => Shop.sync()); await p.waitForTimeout(300);
  ok('fewer slots than existing mandalas: nothing is deleted, only new ones are blocked', await p.evaluate(() => S.mandals.length === 4 && Shop.slotLimit() === 1));
  srv.rights.slots = { extra: 1, total: 2, max: 12 };

  // огоньки: получение один раз
  await openShop(p);
  const fl0 = await p.evaluate(() => S.flames);
  srv.rights.consumables = [{ id: 7, product_id: 'flames_100', flames: 100, source: 'order', created_at: Date.now() }]; srv.rights.etag = 'f1';
  await p.evaluate(() => Shop.sync()); await p.waitForTimeout(300);
  ok('purchased flames wait for receipt: card + dot on the tab, nothing credited yet', await p.evaluate(() => /Ждут получения: 100/.test(document.querySelector('.sh-claim') ? document.querySelector('.sh-claim').textContent : '') || (renderRelics(), /Ждут получения: 100/.test(document.querySelector('.sh-claim').textContent))) && await p.evaluate(() => !!document.querySelector('.hall-seg button:last-child .seg-dot')) && await p.evaluate(f => S.flames === f, fl0));
  await p.click('[data-act="shop-claim"]'); await p.waitForTimeout(700);
  ok('claim credits +100 exactly once and confirms ids [7] to the server; the card disappears', await p.evaluate(f => S.flames === f + 100 && !document.querySelector('.sh-claim') && S.shopApplied.fl.includes(7), fl0) && JSON.stringify(srv.claims[srv.claims.length - 1]) === '[7]', srv.claims);
  srv.rights.consumables = [{ id: 7, product_id: 'flames_100', flames: 100, source: 'order', created_at: Date.now() }];     // сервер «забыл» (гонка/другое устройство)
  await p.evaluate(() => Shop.sync()); await p.waitForTimeout(300);
  await p.evaluate(() => renderRelics());
  await p.click('[data-act="shop-claim"]'); await p.waitForTimeout(700);
  ok('the same pack shown again is NOT credited twice (local dedupe) but is confirmed to the server', await p.evaluate(f => S.flames === f + 100, fl0) && srv.claims.length === 2, { claims: srv.claims });

  // покупка пачки огоньков зачисляется сама
  await p.click('.an-chips button[data-v="all"]'); await p.waitForTimeout(200);
  await p.click('[data-act="shop-buy"][data-id="flames_100"]'); await p.waitForTimeout(400);
  await clickText(p, /К оплате/); await p.waitForTimeout(2200);
  ok('buying a flames pack credits it automatically after the server confirms', await p.evaluate(f => S.flames === f + 200 && S.shopApplied.fl.length === 2, fl0), await p.evaluate(() => [S.flames, S.shopApplied.fl]));

  // вселенная применяется у нас; «Есть у вас»
  const hadSc = await p.evaluate(() => S.unlockedThemes.includes('scrooge'));
  await p.click('[data-act="shop-buy"][data-id="uni_scrooge"]'); await p.waitForTimeout(400);
  await clickText(p, /К оплате/); await p.waitForTimeout(2200);
  ok('universe purchase unlocks the Scrooge theme on this device and the card says «Есть у вас»', hadSc === false && await p.evaluate(() => S.unlockedThemes.includes('scrooge') && /Есть у вас/.test([...document.querySelectorAll('.sh-item')].find(e => /Scrooge/.test(e.textContent)).textContent)), hadSc);

  // история
  await p.click('[data-act="shop-history"]'); await p.waitForTimeout(500);
  const hist = await p.evaluate(() => ({ n: document.querySelectorAll('.sh-ord').length, txt: document.querySelector('#shHist').textContent }));
  ok('purchase history lists the three orders with «Оплачено»', hist.n === 3 && (hist.txt.match(/Оплачено/g) || []).length === 3 && /Вселенная Scrooge Gold/.test(hist.txt), hist);
  await p.screenshot({ path: SHOTS + '/shop-3-history.png' });
  await p.evaluate(() => { while (Modal.closeTop()); });
  await p.screenshot({ path: SHOTS + '/shop-4-after.png' });

  // магазин закрыт
  srv.enabled = false; await p.evaluate(() => Shop.refresh(true)); await p.waitForTimeout(400); await p.evaluate(() => renderRelics());
  ok('shop closed on the server: banner warns, buy buttons are not shown as active', await p.evaluate(() => /временно закрыт/.test(document.querySelector('.sh-banner').textContent) && document.querySelectorAll('[data-act="shop-buy"]').length === 0));
  const errsC = d.errors.filter(e => !/404|Failed to load resource/.test(e));
  ok('C: no page errors', errsC.length === 0, errsC);
  await d.browser.close();

  /* ---------- D. узкий экран 360px, все три вселенные ---------- */
  for (const [th, nm] of [['wh40k', 'wh'], ['onepiece', 'op'], ['scrooge', 'sc']]) {
    const dd = await device({ w: 360, h: 740, storage: { mandal_art_v14: JSON.stringify({ v: 2, xp: 3000, flames: 500, unlockedThemes: ['wh40k', 'purple', 'cyan', 'red', 'amber', 'onepiece', 'scrooge'], activeTheme: th }) } });
    await openShop(dd.page);
    const w = await dd.page.evaluate(() => { const r = document.querySelector('#relicsScroll'); const s = document.querySelector('.hall-seg'); return { over: r.scrollWidth > r.clientWidth + 1, segFit: s.scrollWidth <= s.clientWidth + 1, hs: [...s.querySelectorAll('button')].map(b => Math.round(b.getBoundingClientRect().height)), page: document.documentElement.scrollWidth <= window.innerWidth + 1 }; });
    ok('360px / ' + th + ': tabs on one line, no horizontal scroll', !w.over && w.segFit && w.hs.every(h => h < 46) && w.page, w);
    await dd.page.screenshot({ path: SHOTS + '/shop-360-' + nm + '.png' });
    await dd.browser.close();
  }

  console.log('\nshop:', pass, 'pass,', fail, 'fail');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(2); });
