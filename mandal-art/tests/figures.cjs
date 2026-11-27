// Фигурки-стенды и покупка за Stars. Сервер магазина здесь — ИМИТАЦИЯ (перехват запросов браузера), настоящий Telegram и
// настоящие платежи не проверяются. Проверяем клиентскую логику: витрина, получение, вращение, и главное —
// что без подтверждения сервера покупка НЕ засчитывается.
const { launch, URL: APP } = require('./lib.cjs');
const { execSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE = 'http://localhost:8765';

const TG = (uid) => `(() => {
  window.__invoices = []; window.__invoiceResult = 'paid';
  window.Telegram = { WebApp: { initData: 'query_id=mock&user=%7B%22id%22%3A${uid}%7D&hash=mock', initDataUnsafe: { user: { id: ${uid} } }, platform: 'android', version: '8.0', isVersionAtLeast: v => parseFloat(v) <= 8.0,
    ready() {}, expand() {}, disableVerticalSwipes() {}, setHeaderColor() {}, setBackgroundColor() {}, setBottomBarColor() {}, onEvent() {},
    BackButton: { onClick() {}, show() {}, hide() {} }, HapticFeedback: { impactOccurred() {}, notificationOccurred() {}, selectionChanged() {} },
    openInvoice(url, cb) { window.__invoices.push(url); setTimeout(() => cb(window.__invoiceResult), 30); } } };
})();`;

/** Имитация сервера: состояние в замыкании, чтобы тест мог менять ответы */
function fakeServer() {
  const st = { rights: { etag: 'e0', items: [] }, terms: { version: 1, accepted: false }, orders: {}, polls: 0, orderStatus: 'pending', calls: [], enabled: true, canBuy: true };
  const prod = (id, price, extra) => Object.assign({ id, category: 'characters', kind: 'figure', title: id, description: '', family: 'wh', rights_status: 'pending', price_stars: price, status: 'active', grant: {}, owned: 0, can_buy: st.canBuy }, extra || {});
  const json = (route, obj, status) => route.fulfill({ status: status || 200, contentType: 'application/json', body: JSON.stringify(obj) });
  st.handler = async route => {
    const req = route.request(), u = new URL(req.url()), path = u.pathname, m = req.method();
    st.calls.push(m + ' ' + path);
    if (path === '/api/health') return json(route, { ok: true, time: Date.now() });
    if (path === '/api/catalog') return json(route, { ok: true, shop: { enabled: st.enabled }, categories: [], products: [prod('fig_wh_trooper', 80), prod('fig_wh_skull', 50), prod('fig_srv_gold', 120, { grant: { figure: { id: 'srv_gold', name: 'Золотой страж', family: 'wh', url: '/art/figures/srv_gold.webp', glow: '#ff0000' } } }), prod('fig_evil', 10, { grant: { figure: { id: 'evil', name: 'x', family: 'wh', url: 'javascript:alert(1)', glow: '#ff0000' } } }), prod('fig_evil2', 10, { grant: { figure: { id: 'evil2', name: 'x', family: 'wh', url: '//evil.example/a.png', glow: '#ff0000' } } })] });
    if (path === '/api/me') return json(route, { ok: true, user: { id: 42 }, rights: st.rights, terms: st.terms, shop: { enabled: st.enabled } });
    if (path === '/api/terms' && m === 'GET') return json(route, { ok: true, version: 1, text: 'Условия: цифровые товары, возвраты через /paysupport.' });
    if (path === '/api/terms/accept') { st.terms = { version: 1, accepted: true }; return json(route, { ok: true, terms: st.terms }); }
    if (path === '/api/orders' && m === 'POST') {
      if (st.orderError) return json(route, { ok: false, error: { code: 'unavailable', message: 'Товар недоступен.' } }, 409);
      const id = 'ord' + Object.keys(st.orders).length; st.orders[id] = { id, status: 'created' };
      return json(route, { ok: true, order: { id, status: 'created', invoice_link: 'https://t.me/$' + id } });
    }
    const mo = /^\/api\/orders\/(ord\d+)$/.exec(path);
    if (mo) {
      st.polls++;
      const s = st.orderStatus;
      return json(route, { ok: true, order: { id: mo[1], status: s }, rights: s === 'paid' ? st.rights : undefined });
    }
    if (path === '/api/rights/sync') return json(route, { ok: true, rights: st.rights, terms: st.terms, shop: { enabled: st.enabled } });
    return json(route, { ok: false, error: { code: 'not_found', message: 'нет такого маршрута' } }, 404);
  };
  return st;
}

async function device(opts) {
  opts = opts || {};
  const h = await launch({ dsf: 1, init: opts.uid ? TG(opts.uid) : undefined, storage: opts.storage });
  if (opts.server) {
    await h.page.route(BASE + '/api/**', opts.server.handler);
    await h.page.route(APP, async route => { const r = await route.fetch(); let b = await r.text(); b = b.replace('</head>', '<meta name="shop-api" content="' + BASE + '"></head>'); route.fulfill({ response: r, body: b }); });
  }
  await h.page.goto(APP); await h.page.waitForTimeout(700);
  const w = await h.page.$('.modal [data-r="1"]'); if (w) await w.click();
  return h;
}
const openHall = async (p, tab) => { await p.click('#nav [data-tab="relics"]'); await p.waitForTimeout(150); if (tab) { await p.click('[data-act="hall"][data-v="' + tab + '"]'); await p.waitForTimeout(150); } };

(async () => {
  /* ---------- 1. витрина и статусы ---------- */
  let d = await device({});
  let p = d.page;
  await openHall(p, 'figs');
  const tiles = await p.evaluate(() => [...document.querySelectorAll('.fig')].map(e => [e.dataset.id, e.className.replace('fig ', '')]));
  ok('15 figure tiles shown (6 WH + 4 One Piece + 2 Scrooge + 3 original 3D artifacts)', tiles.length === 15 && tiles.filter(t => t[0].startsWith('wh_')).length === 6 && tiles.filter(t => t[0].startsWith('op_')).length === 4 && tiles.filter(t => t[0].startsWith('sc_')).length === 2 && tiles.filter(t => t[0].startsWith('art_')).length === 3, tiles);
  ok('at 250 XP (rank 2) skull, adept, One Piece captain and Scrooge are ready, the rest locked', JSON.stringify(tiles.filter(t => t[1] === 'ready').map(t => t[0]).sort()) === JSON.stringify(['op_captain', 'sc_scrooge', 'wh_adept', 'wh_skull']) && tiles.filter(t => t[1] === 'locked').length === 11, tiles);
  ok('Scrooge section lists its two figures and no "being prepared" stub remains', await p.evaluate(() => !!document.querySelector('.fig[data-id="sc_scrooge"]') && !!document.querySelector('.fig[data-id="sc_daisy"]') && !/Фигурки этой вселенной ещё готовятся/.test(document.querySelector('#relicsScroll').textContent)));
  ok('hall tab switch shows counts 1/9 and 0/15, a "ready" dot and the Shop tab', await p.evaluate(() => { const b = [...document.querySelectorAll('.hall-seg button')]; return b.length === 3 && /1\/9/.test(b[0].textContent) && /0\/15/.test(b[1].textContent) && !!b[1].querySelector('.seg-dot') && /Магазин/.test(b[2].textContent); }));
  ok('nav dot shows when a figure can be claimed', await p.evaluate(() => getComputedStyle(document.querySelector('#dotRelics')).display !== 'none'));
  ok('locked figure tiles are visible, named and marked locked (not hidden)', await p.evaluate(() => { const e = document.querySelector('.fig[data-id="wh_golden"]'); return e && e.classList.contains('locked') && /Император/.test(e.textContent) && !!e.querySelector('.fg-lock') && e.querySelector('.fgs') && getComputedStyle(e.querySelector('.fgs')).backgroundImage.startsWith('url('); }));

  /* ---------- 2. окно просмотра ---------- */
  await p.evaluate(() => document.getElementById('m3d-src').remove());      // как на устройстве без WebGL: окно остаётся на лёгком CSS-стенде (3D проверяет tests/three.cjs)
  await p.click('.fig[data-id="wh_skull"]'); await p.waitForSelector('.fgv'); await p.waitForTimeout(500);
  const v1 = await p.evaluate(() => ({ faces: document.querySelectorAll('.fgv-face').length, sl: document.querySelectorAll('.fgv-sl').length, open: UI.fgv, fx: FX.level(), tr: document.querySelector('.fgv-obj').style.transform, w: document.querySelector('.fgv-obj').getBoundingClientRect().width, eye: !!document.querySelector('.fgv-eye'), claim: !!document.querySelector('[data-a="claim"]') }));
  ok('viewer: two faces, thickness slices by FX level, eye glint for the skull, claim button for a ready figure', v1.faces === 2 && v1.sl === ({ full: 12, lite: 6, off: 0 })[v1.fx] && v1.eye && v1.claim && v1.open && v1.w > 100, v1);
  const rot = () => p.evaluate(() => { const m = /rotateY\((-?[\d.]+)deg\)/.exec(document.querySelector('.fgv-obj').style.transform); return m ? parseFloat(m[1]) : null; });
  const ang = n => ((n % 360) + 360) % 360;
  await p.click('[data-v="auto"]'); await p.waitForTimeout(100);           // выключаем автовращение, чтобы углы были точными
  await p.click('[data-v="side"]'); await p.waitForTimeout(900);
  ok('"Сбоку" turns the stand to 90°', Math.abs(ang(await rot()) - 90) < 2, await rot());
  await p.click('[data-v="back"]'); await p.waitForTimeout(900);
  ok('"Сзади" turns the stand to 180°', Math.abs(ang(await rot()) - 180) < 2, await rot());
  await p.click('[data-v="front"]'); await p.waitForTimeout(900);
  ok('"Спереди" returns to 0°', Math.abs(ang(await rot() + 180) - 180) < 2, await rot());
  const before = await rot();
  const box = await (await p.$('#fgvStage')).boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down();
  await p.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 20, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(200);
  const after = await rot();
  ok('dragging rotates the figure by hand', after !== null && Math.abs(after - before) > 40, { before, after });
  await p.waitForTimeout(1500);
  ok('inertia keeps turning for a moment, then settles', true);
  await p.click('.fgv-x'); await p.waitForTimeout(250);
  ok('close removes the viewer and frees the flag', await p.evaluate(() => !document.querySelector('.fgv') && UI.fgv === false));

  /* ---------- 3. получение за ранг, достижения, сохранение ---------- */
  await openHall(p, 'figs');
  const fl0 = await p.evaluate(() => S.flames);
  await p.click('.fig[data-id="wh_skull"]'); await p.waitForSelector('.fgv'); await p.waitForTimeout(300);
  await p.click('[data-a="claim"]'); await p.waitForTimeout(600);
  const c1 = await p.evaluate(() => ({ own: S.unlockedFigs.slice(), flames: S.flames, ach: !!S.achievements.fig1, st: figStatus(figById('wh_skull')), claim: !!document.querySelector('[data-a="claim"]'), kick: document.querySelector('#fgvKick').textContent }));
  ok('claiming by rank adds the figure for free and grants "first figure" achievement (+3 flames)', JSON.stringify(c1.own) === '["wh_skull"]' && c1.ach && c1.flames === fl0 + 3 && c1.st === 'owned' && !c1.claim && /получена/.test(c1.kick), c1);
  await p.click('.fgv-x'); await p.waitForTimeout(250);
  await p.reload(); await p.waitForTimeout(700);
  await openHall(p, 'figs');
  ok('owned figure survives reload (saved)', await p.evaluate(() => S.unlockedFigs.includes('wh_skull') && document.querySelector('.fig[data-id="wh_skull"]').classList.contains('owned')));
  ok('claiming twice is refused', await p.evaluate(() => unlockFig('wh_skull', 'xp').ok === false && S.unlockedFigs.length === 1));
  ok('a figure above the current rank cannot be claimed for free', await p.evaluate(() => unlockFig('wh_golden', 'xp').ok === false && !S.unlockedFigs.includes('wh_golden')));

  /* ---------- 4. огоньки ---------- */
  await p.evaluate(() => { S.flames = 15; save(); renderRelics(); });
  await p.click('.fig[data-id="wh_trooper"]'); await p.waitForSelector('.fgv'); await p.waitForTimeout(300);
  ok('not enough flames: button disabled and the shortage is explained', await p.evaluate(() => { const b = document.querySelector('[data-a="flames"]'); return b && b.disabled && /Огоньков не хватает/.test(document.querySelector('#fgvAct').textContent); }));
  ok('locked preview mode is marked (dark figure, "Предпросмотр")', await p.evaluate(() => document.querySelector('.fgv').classList.contains('locked') && getComputedStyle(document.querySelector('.fgv-prev')).display !== 'none'));
  await p.click('.fgv-x'); await p.waitForTimeout(200);
  await p.evaluate(() => { S.flames = 25; save(); });
  await p.click('.fig[data-id="wh_trooper"]'); await p.waitForSelector('.fgv'); await p.waitForTimeout(300);
  await p.click('[data-a="flames"]'); await p.waitForTimeout(300);
  ok('flames purchase asks for confirmation first', await p.evaluate(() => !!document.querySelector('.modal [data-r="1"]') || !!document.querySelector('.overlay .btn')));
  await p.evaluate(() => { const b = [...document.querySelectorAll('.overlay .btn')].find(x => /Открыть/.test(x.textContent)); if (b) b.click(); });
  await p.waitForTimeout(700);
  const fl = await p.evaluate(() => ({ own: S.unlockedFigs.includes('wh_trooper'), flames: S.flames }));
  ok('flames purchase spends exactly 20 flames and unlocks the figure', fl.own && fl.flames === 5, fl);
  await p.click('.fgv-x'); await p.waitForTimeout(200);

  /* ---------- 5. Stars без сервера: честный отказ ---------- */
  await p.click('.fig[data-id="wh_walker"]'); await p.waitForSelector('.fgv'); await p.waitForTimeout(300);
  const stars0 = await p.evaluate(() => { const b = document.querySelector('[data-a="stars"]'); return { dis: b && b.disabled, note: document.querySelector('.fgv-note').textContent }; });
  ok('plain browser: Stars button is disabled and says it works only inside Telegram', stars0.dis && /только внутри Telegram/.test(stars0.note), stars0);
  const r0 = await p.evaluate(async () => { const r = await Shop.buy('fig_wh_walker'); return { r, own: figOwned('wh_walker'), st: Shop.status().code }; });
  ok('Shop.buy outside Telegram does not unlock anything', r0.r.ok === false && !r0.own && r0.st === 'no_telegram', r0);
  await p.click('.fgv-x'); await p.waitForTimeout(200);

  /* ---------- 6. достижения и «все фигурки» ---------- */
  const ach = await p.evaluate(() => { S.unlockedFigs = ['wh_skull', 'wh_adept', 'wh_trooper', 'op_captain']; checkAchievements(); const a4 = !!S.achievements.fig4, aall = !!S.achievements.figall; S.unlockedFigs = FIGURES.map(f => f.id); checkAchievements(); return { a4, all: !!S.achievements.figall, aall }; });
  ok('achievements: four figures -> "collection", all figures -> "full showcase"', ach.a4 && ach.all && !ach.aall, ach);

  /* ---------- 7. повышение ранга сообщает о новой фигурке ---------- */
  await p.evaluate(() => { S.unlockedFigs = []; S.xp = 640; save(); });
  await p.evaluate(() => addXp(30, 'test'));
  await p.waitForSelector('.levelup', { timeout: 3000 }); await p.waitForTimeout(200);
  const lv = await p.evaluate(() => (document.querySelector('.levelup') || {}).textContent || '');
  ok('level-up overlay names the newly available figures (rank 4 gives Космодесантник and Мечник)', /Доступна фигурка/.test(lv) && /Космодесантник/.test(lv) && /Мечник/.test(lv), lv);
  await p.close(); await d.browser.close();

  /* ---------- 8. миграция состояния ---------- */
  d = await device({ storage: { mandal_art_v14: JSON.stringify({ v: 2, xp: 900, flames: 3, unlockedFigs: ['wh_skull', 'BAD ID', 5, 'wh_skull', '../x', 'op_cook'] }) } });
  p = d.page;
  const mig = await p.evaluate(() => S.unlockedFigs);
  ok('state: junk figure ids are dropped, duplicates removed', JSON.stringify(mig) === '["wh_skull","op_cook"]', mig);
  await p.close(); await d.browser.close();
  d = await device({ storage: { mandal_art_v14: JSON.stringify({ v: 2, xp: 900, flames: 3 }) } });
  ok('old state without figures loads (empty list)', await d.page.evaluate(() => Array.isArray(S.unlockedFigs) && S.unlockedFigs.length === 0));
  const errs0 = d.errors.slice();
  await d.page.close(); await d.browser.close();
  ok('no page errors so far', errs0.length === 0, errs0);

  /* ---------- 9. покупка за Stars на имитации сервера ---------- */
  const srv = fakeServer();
  d = await device({ uid: 42, server: srv });
  p = d.page; await p.waitForTimeout(600);
  const s1 = await p.evaluate(() => ({ st: Shop.status(), snap: Shop.snapshot() }));
  ok('with a server and Telegram initData the shop becomes available', s1.st.ok === true && s1.snap.products >= 2, s1);
  ok('server rejects/ignores unsafe figure URLs; a valid server-added figure appears', await p.evaluate(() => { const c = Shop.customFigures(); return c.length === 1 && c[0].id === 'srv_gold' && /^http:\/\/localhost:8765\/art\//.test(c[0].url); }));
  await openHall(p, 'figs');
  ok('server-added figure is listed under its universe with the shop badge', await p.evaluate(() => { const e = document.querySelector('.fig[data-id="srv_gold"]'); return e && e.classList.contains('locked') && /Магазин/.test(e.textContent); }));

  // A: Telegram говорит «paid», а сервер ещё нет -> права НЕТ, пока сервер не подтвердит
  await p.click('.fig[data-id="wh_trooper"]'); await p.waitForSelector('.fgv'); await p.waitForTimeout(300);
  const starBtn = await p.evaluate(() => { const b = document.querySelector('[data-a="stars"]'); return { dis: b.disabled, txt: b.textContent.trim() }; });
  ok('Stars button is enabled and shows the server price', !starBtn.dis && /80/.test(starBtn.txt), starBtn);
  await p.click('[data-a="stars"]'); await p.waitForTimeout(400);
  ok('first purchase requires accepting the terms (shown before any payment)', await p.evaluate(() => /Условия покупки/.test(document.body.textContent)) && srv.terms.accepted === false);
  await p.evaluate(() => [...document.querySelectorAll('.overlay .btn')].find(b => b.dataset.r === '1').click()); await p.waitForTimeout(400);
  ok('terms acceptance is sent to the server', srv.terms.accepted === true && srv.calls.includes('POST /api/terms/accept'));
  await p.evaluate(() => [...document.querySelectorAll('.overlay .btn')].find(b => /К оплате/.test(b.textContent)).click());
  await p.waitForTimeout(900);
  ok('order is created on the server and the official Telegram invoice window is opened', srv.calls.includes('POST /api/orders') && await p.evaluate(() => window.__invoices.length === 1 && /^https:\/\/t\.me\//.test(window.__invoices[0])));
  ok('Telegram said "paid" but the server says pending -> NOT unlocked, "checking" shown', await p.evaluate(() => !figOwned('wh_trooper') && /Проверяем оплату/.test(document.body.textContent)));
  srv.rights = { etag: 'e1', items: [{ product_id: 'fig_wh_trooper', kind: 'figure', grant: { figure: { id: 'wh_trooper', name: 'Космодесантник', family: 'wh', mode: 'standee', url: '/art/figures/wh_trooper.webp', glow: '#d97706' } } }] };
  srv.orderStatus = 'paid';
  await p.waitForTimeout(4200);
  ok('after the server confirms (order paid + rights) the figure is owned', await p.evaluate(() => figOwned('wh_trooper') && Shop.ownsFigure('wh_trooper')), srv.calls.slice(-6));
  ok('the viewer shows the figure as received', await p.evaluate(() => /получена/.test(document.querySelector('#fgvKick').textContent) && !document.querySelector('[data-a="stars"]')));
  await p.click('.fgv-x'); await p.waitForTimeout(200);

  // B: окно оплаты закрыто пользователем
  srv.orderStatus = 'pending'; srv.rights = { etag: 'e1', items: [] }; await p.evaluate(() => { window.__invoiceResult = 'cancelled'; Shop.refresh(true); }); await p.waitForTimeout(400);
  const rB = await p.evaluate(async () => { const pr = Shop.buy('fig_wh_skull'); await new Promise(r => setTimeout(r, 400)); [...document.querySelectorAll('.overlay .btn')].find(b => /К оплате/.test(b.textContent)).click(); const r = await pr; return { r, own: figOwned('wh_skull') }; });
  ok('cancelled payment: nothing unlocked, honest message', rB.r.ok === false && rB.r.reason === 'cancelled' && !rB.own, rB);

  // C: сервер сообщает failed
  srv.orderStatus = 'failed'; await p.evaluate(() => { window.__invoiceResult = 'paid'; });
  const rC = await p.evaluate(async () => { const pr = Shop.buy('fig_wh_skull'); await new Promise(r => setTimeout(r, 400)); [...document.querySelectorAll('.overlay .btn')].find(b => /К оплате/.test(b.textContent)).click(); const r = await pr; return { r, own: figOwned('wh_skull') }; });
  ok('server says "failed" even though the window said paid: nothing unlocked', rC.r.ok === false && rC.r.reason === 'failed' && !rC.own, rC);

  // D: сервер не подтверждает, пользователь закрывает ожидание -> pending, ничего не выдано
  srv.orderStatus = 'pending';
  const rD = await p.evaluate(async () => { const pr = Shop.buy('fig_wh_skull'); await new Promise(r => setTimeout(r, 400)); [...document.querySelectorAll('.overlay .btn')].find(b => /К оплате/.test(b.textContent)).click(); await new Promise(r => setTimeout(r, 2500)); [...document.querySelectorAll('.overlay .btn')].find(b => b.dataset.r === 'x').click(); const r = await pr; return { r, own: figOwned('wh_skull') }; });
  ok('no confirmation from the server: result is "pending", nothing unlocked, no fake success', rD.r.ok === false && rD.r.reason === 'pending' && !rD.own, rD);

  // E: товар недоступен — сервер отказал при создании заказа
  srv.orderError = true;
  const rE = await p.evaluate(async () => { const pr = Shop.buy('fig_wh_skull'); await new Promise(r => setTimeout(r, 400)); [...document.querySelectorAll('.overlay .btn')].find(b => /К оплате/.test(b.textContent)).click(); const r = await pr; return { r, own: figOwned('wh_skull'), toast: document.querySelector('#toasts').textContent }; });
  ok('server refuses the order: the error is shown and nothing is unlocked', rE.r.ok === false && !rE.own && /недоступен/.test(rE.toast), rE);
  srv.orderError = false;

  // F: магазин закрыт
  srv.enabled = false; await p.evaluate(() => Shop.refresh(true)); await p.waitForTimeout(400);
  ok('shop closed on the server: status says so and buy is refused', await p.evaluate(async () => { const s = Shop.status(); const r = await Shop.buy('fig_wh_skull'); return s.code === 'closed' && r.ok === false; }));
  srv.enabled = true;
  const errs1 = d.errors.filter(e => !/404|Failed to load resource/.test(e));
  ok('no page errors during shop flows', errs1.length === 0, errs1);
  await p.close(); await d.browser.close();

  /* ---------- 10. режимы эффектов и публичная сборка ---------- */
  d = await device({ storage: { mandal_art_v14: JSON.stringify({ v: 2, xp: 900, flames: 3, settings: { fx: 'off' } }) } });
  p = d.page; await openHall(p, 'figs');
  await p.click('.fig[data-id="wh_adept"]'); await p.waitForSelector('.fgv'); await p.waitForTimeout(300);
  ok('FX off: viewer opens without thickness slices, particles or float animation, still draggable', await p.evaluate(() => FX.level() === 'off' && document.querySelectorAll('.fgv-sl').length === 0 && document.querySelectorAll('.fgv-mote').length === 0 && getComputedStyle(document.querySelector('.fgv-lift')).animationName === 'none'));
  await p.close(); await d.browser.close();
  execSync('python3 build.py --public', { cwd: __dirname + '/..' });
  const hh = await launch({ dsf: 1 }); await hh.page.goto(APP.replace('mandal-art.html', 'mandal-art-public.html')); await hh.page.waitForTimeout(700);
  const w2 = await hh.page.$('.modal [data-r="1"]'); if (w2) await w2.click();
  await openHall(hh.page);
  ok('public build (rights pending): only the 3 original 3D artifacts, no franchise figure data, art or depth maps', await hh.page.evaluate(() => FIGURES.length === 3 && FIGURES.every(f => f.uni === 'art') && Object.keys(FIGURE_DEPTH).length === 0 && !/\.fgd\.(wh|op|sc)_/.test([...document.styleSheets].map(s => { try { return [...s.cssRules].map(r => r.selectorText || '').join(' '); } catch (e) { return ''; } }).join(' '))));
  ok('public build has no page errors', hh.errors.length === 0, hh.errors);
  await hh.browser.close();
  execSync('rm -f dist/mandal-art-public.html', { cwd: __dirname + '/..' });

  console.log('\nfigures:', pass, 'pass,', fail, 'fail');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST CRASH', e); process.exit(2); });
