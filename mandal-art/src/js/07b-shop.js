/* ============================================================
   07b-shop: клиент магазина Telegram Stars.
   Принцип: клиент НИЧЕГО не «засчитывает» сам. Он создаёт заказ на сервере, открывает официальное окно оплаты
   Telegram (WebApp.openInvoice) и спрашивает у сервера статус заказа. Ответ окна оплаты — только подсказка:
   право выдаёт сервер после платёжного события Telegram. Секретов в клиенте нет: только initData,
   которую подписывает Telegram (сервер проверяет подпись токеном бота).
   Нет сервера / не Telegram / магазин закрыт — кнопки честно блокируются с объяснением, успех не имитируется.
   ============================================================ */
const Shop = (() => {
  const CK = 'mandal_art_shop_v1';
  const FAM_UNI = { wh: 'wh40k', op: 'onepiece', sc: 'scrooge' };
  const REASONS = {
    shop_paused: 'Магазин временно закрыт.', soldout: 'Товар закончился.', unavailable: 'Товар сейчас недоступен.',
    owned: 'Этот товар у вас уже есть.', slot_limit: 'Достигнут максимум слотов мандал.', already_subscribed: 'Подписка уже действует.'
  };
  const st = { base: '', probed: false, online: false, err: '', catalog: null, categories: [], shop: null, me: null, rights: null, terms: null, authed: false, busy: false, ts: 0, last: 0, uid: 0 };
  const subs = [];
  let figCache = null, figKey = '';
  const fire = () => { figCache = null; subs.forEach(fn => { try { fn(); } catch (e) { /* ignore */ } }); };
  const tg = () => (window.Telegram && window.Telegram.WebApp) || null;
  const initData = () => { const x = tg(); return (x && typeof x.initData === 'string' && x.initData) || ''; };
  const tgUid = () => { const x = tg(); try { return (x && x.initDataUnsafe && x.initDataUnsafe.user && x.initDataUnsafe.user.id) || 0; } catch (e) { return 0; } };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const mkErr = (code, message, status) => { const e = new Error(message); e.code = code; e.status = status || 0; return e; };

  /* Адрес сервера магазина: явно задан <meta name="shop-api" content="https://…"> либо страницу отдаёт сам сервер магазина
     (он добавляет <meta name="shop-self">). Иначе сервера нет — и мы не делаем лишних запросов к чужому хостингу. */
  function detectBase() {
    const m = document.querySelector('meta[name="shop-api"]'), v = m && m.getAttribute('content');
    if (v) { try { const u = new URL(v, location.href); if (/^https?:$/.test(u.protocol)) return u.origin; } catch (e) { /* ignore */ } }
    if (document.querySelector('meta[name="shop-self"]') && /^https?:$/.test(location.protocol) && location.hostname) return location.origin;
    return '';
  }

  /* ---- HTTP: таймаут, разбор ошибок сервера {ok:false,error:{code,message}} ---- */
  async function call(method, path, body, o) {
    o = o || {};
    const ctl = typeof AbortController === 'function' ? new AbortController() : null, tm = setTimeout(() => { if (ctl) ctl.abort(); }, o.timeout || 12000);
    try {
      const headers = {};
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const id = initData(); if (o.auth !== false && id) headers.Authorization = 'tma ' + id;
      const r = await fetch(st.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl ? ctl.signal : undefined, cache: 'no-store', credentials: 'omit' });
      let j = null; try { j = await r.json(); } catch (e) { /* не JSON */ }
      if (!j || typeof j !== 'object') throw mkErr('bad_response', 'Сервер вернул неожиданный ответ', r.status);
      if (!r.ok || j.ok === false) throw mkErr((j.error && j.error.code) || 'http_' + r.status, (j.error && j.error.message) || 'Ошибка сервера (' + r.status + ')', r.status);
      return j;
    } catch (e) {
      if (e && e.code) throw e;
      if (e && e.name === 'AbortError') throw mkErr('timeout', 'Сервер не отвечает. Проверьте интернет и повторите.');
      throw mkErr('network', 'Нет связи с магазином. Проверьте интернет и повторите.');
    } finally { clearTimeout(tm); }
  }

  /* ---- локальный кэш прав и каталога (удобство; источник правды — сервер) ---- */
  function loadCache() {
    try {
      const j = JSON.parse(Store.read(CK) || 'null');
      if (!j || j.v !== 1) return;
      const uid = tgUid(); if (uid && j.uid && j.uid !== uid) return;       // кэш другого аккаунта не показываем
      st.rights = j.rights || null; st.catalog = Array.isArray(j.catalog) ? j.catalog : null; st.categories = j.categories || []; st.shop = j.shop || null; st.terms = j.terms || null; st.ts = j.ts || 0; st.uid = j.uid || 0;
    } catch (e) { /* ignore */ }
  }
  function saveCache() { Store.write(CK, JSON.stringify({ v: 1, uid: tgUid() || st.uid || 0, ts: st.ts, rights: st.rights, catalog: st.catalog, categories: st.categories, shop: st.shop, terms: st.terms })); }

  /* ---- статус: честные причины, по которым покупка невозможна ---- */
  function canInvoice() { const x = tg(); try { return !!(x && typeof x.openInvoice === 'function' && (!x.isVersionAtLeast || x.isVersionAtLeast('6.1'))); } catch (e) { return false; } }
  function status() {
    if (!st.probed) return { ok: false, code: 'loading', text: 'Проверяю подключение к магазину…' };
    if (!initData()) return { ok: false, code: 'no_telegram', text: 'Покупки за Stars работают только внутри Telegram.' };
    if (!st.base) return { ok: false, code: 'no_server', text: 'Магазин не подключён к серверу: покупки за Stars недоступны в этой сборке.' };
    if (!st.online) return { ok: false, code: 'offline', text: 'Сервер магазина недоступен. Покупки временно невозможны.' };
    if (st.shop && st.shop.enabled === false) return { ok: false, code: 'closed', text: 'Магазин временно закрыт.' };
    if (!st.authed) return { ok: false, code: 'auth', text: st.err || 'Не удалось подтвердить аккаунт Telegram. Закройте и откройте приложение заново.' };
    if (!canInvoice()) return { ok: false, code: 'no_invoice', text: 'Эта версия Telegram не умеет открывать окно оплаты. Обновите Telegram.' };
    return { ok: true, code: 'ok', text: '' };
  }

  /* ---- данные ---- */
  function setRights(r) { if (r && typeof r === 'object') { st.rights = r; st.ts = Date.now(); saveCache(); fire(); } }
  async function refresh(force) {
    if (!st.online) return;
    if (!force && Date.now() - st.last < 20000) return;
    st.last = Date.now();
    try { const c = await call('GET', '/api/catalog'); st.catalog = Array.isArray(c.products) ? c.products : []; st.categories = c.categories || []; st.shop = c.shop || st.shop; } catch (e) { st.err = e.message; }
    if (initData()) {
      try { const m = await call('GET', '/api/me'); st.me = m; st.rights = m.rights || st.rights; st.terms = m.terms || st.terms; st.shop = m.shop || st.shop; st.authed = true; st.err = ''; st.uid = tgUid(); }
      catch (e) { st.authed = false; st.err = e.message; }
    }
    st.ts = Date.now(); saveCache(); fire();
  }
  async function init() {
    loadCache();
    st.base = detectBase();
    if (!st.base) { st.probed = true; fire(); return; }
    try { const h = await call('GET', '/api/health', undefined, { auth: false, timeout: 6000 }); st.online = !!(h && h.ok === true && typeof h.time === 'number'); } catch (e) { st.online = false; st.err = e.message; }
    st.probed = true;
    if (st.online) await refresh(true); else fire();
    document.addEventListener('visibilitychange', () => { if (!document.hidden && st.online) refresh(false); });
  }
  async function sync() {
    if (!st.online || !initData()) throw mkErr('no_auth', status().text);
    const j = await call('POST', '/api/rights/sync');
    st.me = j; st.rights = j.rights || st.rights; st.terms = j.terms || st.terms; st.shop = j.shop || st.shop; st.authed = true; st.ts = Date.now(); saveCache(); fire();
    return j;
  }
  async function history() { const j = await call('GET', '/api/orders'); return j.orders || []; }

  const product = id => (st.catalog || []).find(p => p.id === id) || null;
  const reasonText = code => REASONS[code] || 'Покупка сейчас недоступна.';

  /* ---- фигурки из прав и каталога (в том числе добавленные владельцем в админке) ---- */
  const safeHex = v => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) ? v : '#f59e0b';
  const safeId = v => (typeof v === 'string' && /^[a-z][a-z0-9_]{1,31}$/.test(v)) ? v : '';
  function safeUrl(u) {     // только файлы с нашего сервера: /art/… или /media/…
    if (typeof u !== 'string' || u.length > 300) return '';
    let p = u;
    if (/^https?:\/\//i.test(u)) { try { const x = new URL(u); if (!st.base || x.origin !== st.base) return ''; p = x.pathname; } catch (e) { return ''; } }
    if (!/^\/(art|media)\/[A-Za-z0-9._\/-]+$/.test(p) || p.indexOf('..') >= 0) return '';
    return st.base + p;
  }
  function ownedFigIds() { const s = new Set(); ((st.rights && st.rights.items) || []).forEach(it => { if (it && it.kind === 'figure' && it.grant && it.grant.figure) { const id = safeId(it.grant.figure.id); if (id) s.add(id); } }); return s; }
  function customFigures() {
    const key = (st.rights ? st.rights.etag : '') + '|' + (st.catalog ? st.catalog.length : 0) + '|' + st.ts;
    if (figCache && figKey === key) return figCache;
    const builtin = new Set(FIGURES.map(f => f.id)), out = [], seen = new Set();
    const add = (grant, pid, title, desc, family) => {
      const g = grant && grant.figure; if (!g) return;
      const id = safeId(g.id); if (!id || builtin.has(id) || seen.has(id)) return;
      const url = safeUrl(g.url); if (!url) return;
      seen.add(id);
      out.push({ id, custom: true, uni: FAM_UNI[g.family || family] || 'wh40k', name: String(g.name || title || id).slice(0, 40), desc: String(desc || '').slice(0, 160), glow: safeHex(g.glow), url, product: pid, rank: 99, flames: 0, w: 0, h: 0 });
    };
    ((st.rights && st.rights.items) || []).forEach(it => { if (it && it.kind === 'figure') { const p = product(it.product_id); add(it.grant, it.product_id, p && p.title, p && p.description, p && p.family); } });
    (st.catalog || []).forEach(p => { if (p.kind === 'figure') add(p.grant, p.id, p.title, p.description, p.family); });
    figCache = out; figKey = key; return out;
  }

  /* ---- условия покупки ---- */
  async function ensureTerms() {
    if (st.me && st.me.terms && st.me.terms.accepted) return true;
    let t; try { t = await call('GET', '/api/terms', undefined, { auth: false }); } catch (e) { toast(e.message, 'err'); return false; }
    const ok = await new Promise(res => {
      const rec = Modal.open('<h3>' + I('scroll') + ' Условия покупки</h3><div class="msg shop-terms">' + esc(t.text) + '</div><div class="btns"><button class="btn ghost" data-r="0">Не принимаю</button><button class="btn" data-r="1">Принимаю</button></div>', { top: true, onClose: () => res(false) });
      rec.el.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (!b) return; rec.onClose = null; Modal.close(rec); res(b.dataset.r === '1'); });
    });
    if (!ok) return false;
    try { const r = await call('POST', '/api/terms/accept', { version: t.version }); if (st.me) st.me.terms = r.terms; else st.me = { terms: r.terms }; return true; }
    catch (e) { toast(e.message, 'err'); return false; }
  }

  /* ---- покупка ---- */
  function progress(title, text) {
    const rec = Modal.open('<h3>' + I('star') + ' ' + esc(title) + '</h3><div class="msg" id="shopPrgTx">' + esc(text) + '</div><div class="shop-spin" aria-hidden="true"></div><div class="btns"><button class="btn ghost" data-r="x">Закрыть</button></div>', { sticky: true });
    const h = { rec, closed: false, text: t => { const n = $('#shopPrgTx', rec.el); if (n) n.textContent = t; }, close() { if (!h.closed) { h.closed = true; Modal.close(rec); } } };
    rec.el.addEventListener('click', e => { if (e.target.closest('[data-r]')) h.close(); });
    rec.onClose = () => { h.closed = true; };
    return h;
  }
  const TERMINAL = { failed: 'Платёж не прошёл. Ничего не списано.', expired: 'Срок счёта истёк. Ничего не списано — оформите покупку заново.', cancelled: 'Заказ отменён. Ничего не списано.', refunded: 'Платёж возвращён.' };

  async function waitPaid(orderId, hint, title) {
    const id = encodeURIComponent(orderId);
    if (hint === 'cancelled' || hint === 'failed') {       // окно закрыто без оплаты: одна проверка на случай гонки
      try { const j = await call('GET', '/api/orders/' + id); if (j.order && j.order.status === 'paid') return paid(j); } catch (e) { /* ignore */ }
      toast(hint === 'cancelled' ? 'Оплата отменена. Ничего не списано.' : 'Оплата не прошла. Ничего не списано.');
      return { ok: false, reason: hint };
    }
    const pr = progress('Проверяем оплату', 'Ждём подтверждения от сервера. Обычно это несколько секунд.');
    const t0 = Date.now();
    while (Date.now() - t0 < 90000 && !pr.closed) {
      try {
        const j = await call('GET', '/api/orders/' + id), s = j.order && j.order.status;
        if (s === 'paid') { pr.close(); return paid(j); }
        if (TERMINAL[s]) { pr.close(); toast(TERMINAL[s], 'err'); return { ok: false, reason: s }; }
      } catch (e) {
        if (e.code === 'bad_init_data' || e.code === 'auth_required') { pr.close(); toast(e.message, 'err'); return { ok: false, reason: e.code }; }
      }
      await sleep(Date.now() - t0 < 10000 ? 1500 : 3000);
    }
    const userClosed = pr.closed; pr.close();
    setTimeout(() => { if (st.online) sync().catch(() => { /* позже */ }); }, 20000);
    toast(userClosed ? 'Проверю оплату в фоне. Если списание прошло, право появится само или после «Обновить права».' : 'Платёж ещё не подтверждён. Если Telegram показал успех, подождите минуту и нажмите «Обновить права».', 'long');
    return { ok: false, reason: 'pending' };
    function paid(j) { if (j.rights) setRights(j.rights); else refresh(true); toast('{ic:check} Оплата подтверждена сервером'); return { ok: true, rights: j.rights || null, title }; }
  }

  async function buy(productId, o) {
    o = o || {};
    if (st.busy) { toast('Предыдущий платёж ещё обрабатывается', 'err'); return { ok: false, reason: 'busy' }; }
    const s = status(); if (!s.ok) { toast(s.text, 'err'); return { ok: false, reason: s.code }; }
    const p = product(productId); if (!p) { toast('Этот товар не найден в каталоге магазина', 'err'); return { ok: false, reason: 'no_product' }; }
    if (p.can_buy === false) { toast(reasonText(p.reason), 'err'); return { ok: false, reason: p.reason || 'unavailable' }; }
    st.busy = true;
    try {
      if (!await ensureTerms()) return { ok: false, reason: 'terms' };
      const title = o.title || p.title;
      if (!await Modal.confirm({ title: 'Оплатить через Telegram Stars?', msg: '«' + title + '»\nЦена: ' + p.price_stars + ' Stars.\nОплата и подтверждение — в окне Telegram. Право выдаёт сервер после подтверждённого платежа.', ok: 'К оплате' })) return { ok: false, reason: 'cancel' };
      let order;
      try { order = (await call('POST', '/api/orders', { product_id: productId })).order; }
      catch (e) { toast(e.message, 'err'); refresh(true); return { ok: false, reason: e.code || 'error' }; }
      if (!order || !order.id || !order.invoice_link) { toast('Сервер не создал счёт. Повторите позже.', 'err'); return { ok: false, reason: 'no_invoice' }; }
      let hint = '';
      await new Promise(res => { try { tg().openInvoice(order.invoice_link, r => { hint = String(r || ''); res(); }); } catch (e) { hint = 'error'; res(); } });
      if (hint === 'error') { toast('Не удалось открыть окно оплаты Telegram', 'err'); return { ok: false, reason: 'open_failed' }; }
      return await waitPaid(order.id, hint, title);
    } finally { st.busy = false; }
  }

  /** Подтвердить серверу, что огоньки из купленных пачек зачислены у нас. Сервер идемпотентен (повтор ничего не меняет). */
  async function claim(ids) {
    ids = Array.from(new Set((ids || []).filter(n => Number.isSafeInteger(n)))).slice(0, 200);
    if (!ids.length) return null;
    if (!st.online || !initData()) throw mkErr('no_auth', status().text);
    const j = await call('POST', '/api/claim', { ids });
    if (j.rights) setRights(j.rights); else refresh(true);
    return j;
  }
  /** Сколько мандал разрешено сейчас: число из прав сервера, либо null, если магазин не подключён (тогда действует общий лимит). */
  function slotLimit() {
    if (!st.base || !st.rights || !st.rights.slots) return null;
    const t = st.rights.slots.total;
    return Number.isInteger(t) && t >= 1 ? t : null;
  }

  return {
    init, refresh, sync, history, status, product, reasonText, buy, customFigures, claim, slotLimit,
    ownsFigure: id => ownedFigIds().has(id),
    onChange(fn) { subs.push(fn); },
    get catalog() { return st.catalog || []; },
    get categories() { return st.categories || []; },
    get rights() { return st.rights; },
    get me() { return st.me; },
    get base() { return st.base; },
    snapshot() { return { base: st.base, probed: st.probed, online: st.online, authed: st.authed, products: (st.catalog || []).length, items: ((st.rights && st.rights.items) || []).length }; }
  };
})();
Shop.onChange(() => { try { Hooks.change(); } catch (e) { /* ignore */ } });
