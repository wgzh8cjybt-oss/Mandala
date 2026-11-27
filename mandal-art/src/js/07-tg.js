/* ============================================================
   07-tg: Telegram Web Apps SDK + настоящая синхронизация с облаком.
   CloudStorage: значение ≤ 4096 симв., ≤ 1024 ключей → данные сжимаются
   (gzip, если доступно), кодируются в base64 и режутся на куски;
   манифест ma14_meta пишется ПОСЛЕДНИМ (коммит), контрольная сумма проверяется.
   Облако Telegram — это синхронизация между устройствами одного аккаунта
   без собственного сервера. Покупки/общий рейтинг потребуют бэкенда.
   ============================================================ */
const Tg = (() => {
  const w = () => (window.Telegram && window.Telegram.WebApp) || null;
  const KEY = CONFIG.cloudPrefix, CHUNK = 3500, MAX_CHUNKS = 900;
  let busy = false, error = '', timer = 0;
  const atLeast = v => { const x = w(); try { return !!(x && x.isVersionAtLeast && x.isVersionAtLeast(v)); } catch (e) { return false; } };

  /* ---- кодек состояния ---- */
  const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
  function b64enc(bytes) { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
  function b64dec(str) { const s = atob(str), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  async function pipe(stream, bytes) { const wr = stream.writable.getWriter(); wr.write(bytes); wr.close(); return new Uint8Array(await new Response(stream.readable).arrayBuffer()); }
  async function encode(obj) {
    const raw = new TextEncoder().encode(JSON.stringify(obj));
    if (typeof CompressionStream === 'function') { try { return { str: b64enc(await pipe(new CompressionStream('gzip'), raw)), mode: 'gz' }; } catch (e) { /* без сжатия */ } }
    return { str: b64enc(raw), mode: 'raw' };
  }
  async function decode(str, mode) {
    let bytes = b64dec(str);
    if (mode === 'gz') { if (typeof DecompressionStream !== 'function') throw new Error('этот WebView не умеет распаковывать данные'); bytes = await pipe(new DecompressionStream('gzip'), bytes); }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  const split = (s, n) => { const o = []; for (let i = 0; i < s.length; i += n) o.push(s.slice(i, i + n)); return o; };

  /* ---- обёртки CloudStorage с таймаутом ---- */
  const T = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('таймаут облака')), ms || 12000))]);
  const cget = keys => T(new Promise((res, rej) => w().CloudStorage.getItems(keys, (e, v) => e ? rej(new Error(String(e))) : res(v || {}))));
  const cset = (k, v) => T(new Promise((res, rej) => w().CloudStorage.setItem(k, v, (e, ok) => (e || !ok) ? rej(new Error(String(e || 'не сохранено'))) : res())));
  const cdel = keys => T(new Promise((res, rej) => w().CloudStorage.removeItems(keys, (e) => e ? rej(new Error(String(e))) : res())));

  const api = {
    _encode: encode, _decode: decode, _fnv: fnv, _split: split,
    isTelegram() { const x = w(); return !!(x && (x.initData || (x.platform && x.platform !== 'unknown'))); },
    version() { const x = w(); return x && x.version ? x.version : '—'; },
    available() { const x = w(); return !!(x && x.CloudStorage && x.CloudStorage.getItems && atLeast('6.9') && api.isTelegram()); },
    cloudStatus() { return { available: api.available(), busy, error }; },

    init() {
      const x = w(); if (!x) return;
      try { x.ready(); } catch (e) { /* ignore */ }
      try { x.expand(); } catch (e) { /* ignore */ }
      try { if (atLeast('7.7') && x.disableVerticalSwipes) x.disableVerticalSwipes(); } catch (e) { /* ignore */ }
      try { if (x.BackButton) x.BackButton.onClick(() => { Modal.closeTop(); }); } catch (e) { /* ignore */ }
      try {
        x.onEvent('deactivated', () => { Scene.pause(); if (_saveT) persistNow(); api.flush(); });
        x.onEvent('activated', () => { Scene.resume(); });
      } catch (e) { /* события 8.0+ */ }
    },
    applyColors() {
      const x = w(), t = themeById(S && S.activeTheme) || THEMES[0];
      const mt = document.querySelector('meta[name="theme-color"]'); if (mt) mt.setAttribute('content', t.meta);
      if (!x) return;
      try { if (atLeast('6.9')) { x.setHeaderColor(t.meta); x.setBackgroundColor(t.meta); } } catch (e) { /* ignore */ }
      try { if (atLeast('7.10') && x.setBottomBarColor) x.setBottomBarColor(t.meta); } catch (e) { /* ignore */ }
    },
    syncBack() {
      const x = w(); if (!x || !x.BackButton) return;
      try { if (Modal.stack.length) x.BackButton.show(); else x.BackButton.hide(); } catch (e) { /* ignore */ }
    },

    async readMeta() {
      const v = await cget([KEY + '_meta']);
      const raw = v[KEY + '_meta'];
      if (!raw) return null;
      try { const m = JSON.parse(raw); return (m && m.n > 0 && m.ts) ? m : null; } catch (e) { return null; }
    },
    async cloudPush(manual) {
      if (!api.available()) return { ok: false, error: 'облако доступно только внутри Telegram' };
      if (busy) return { ok: false, error: 'синхронизация уже идёт' };
      busy = true; error = '';
      try {
        if (_saveT) persistNow();
        const ts = S.updatedAt;
        const enc = await encode({ app: 'mandal-art', schema: 2, ts, data: S });
        const chunks = split(enc.str, CHUNK);
        if (chunks.length > MAX_CHUNKS) throw new Error('слишком много данных для облака — сделайте экспорт и удалите старые записи');
        const old = await api.readMeta().catch(() => null);
        for (let i = 0; i < chunks.length; i += 4) await Promise.all(chunks.slice(i, i + 4).map((c, j) => cset(KEY + '_' + (i + j), c)));
        await cset(KEY + '_meta', JSON.stringify({ v: 2, n: chunks.length, ts, len: enc.str.length, enc: enc.mode, sum: fnv(enc.str) }));
        if (old && old.n > chunks.length) { const st = []; for (let i = chunks.length; i < old.n; i++) st.push(KEY + '_' + i); await cdel(st).catch(() => {}); }
        S.meta.lastPush = Date.now(); S.meta.syncedTs = ts; persistNow(true);
        return { ok: true, chunks: chunks.length, mode: enc.mode };
      } catch (e) { error = (e && e.message) || String(e); return { ok: false, error }; }
      finally { busy = false; if (UI.tab === 'hq') scheduleRender(); }
    },
    async cloudFetch() {
      if (!api.available()) return { ok: false, error: 'облако доступно только внутри Telegram' };
      busy = true; error = '';
      try {
        const meta = await api.readMeta();
        if (!meta) return { ok: false, reason: 'empty' };
        const keys = Array.from({ length: meta.n }, (_, i) => KEY + '_' + i);
        let str = '';
        for (let i = 0; i < keys.length; i += 40) {
          const part = keys.slice(i, i + 40), vals = await cget(part);
          part.forEach(k => { if (typeof vals[k] !== 'string' || !vals[k]) throw new Error('в облаке не хватает части данных'); str += vals[k]; });
        }
        if (str.length !== meta.len || fnv(str) !== meta.sum) throw new Error('данные в облаке повреждены (контрольная сумма)');
        const obj = await decode(str, meta.enc);
        const st = normalizeState(obj && obj.data, false);
        if (!st) throw new Error('в облаке неверный формат данных');
        return { ok: true, state: st, ts: meta.ts };
      } catch (e) { error = (e && e.message) || String(e); return { ok: false, error }; }
      finally { busy = false; if (UI.tab === 'hq') scheduleRender(); }
    },
    flush() { if (api.available() && S.settings.autoSync && S.updatedAt > (S.meta.syncedTs || 0) && !isPristine()) api.cloudPush(false); },
    scheduleSync(delay) {
      clearTimeout(timer);
      if (!api.available() || !S.settings.autoSync) return;
      timer = setTimeout(() => { if (S.updatedAt > (S.meta.syncedTs || 0)) api.cloudPush(false); }, delay == null ? 8000 : delay);
    },
    /* спасение прогресса из облака старых версий (ключи, которые писали Gemini-версии) */
    async legacyRescue() {
      try {
        const v = await cget(['mandal_art_data', 'wh40k_mandal_data']);
        const found = [];
        ['mandal_art_data', 'wh40k_mandal_data'].forEach(k => {
          if (!v[k]) return;
          try { const st = normalizeState(JSON.parse(v[k]), true); if (st && hasContent(st)) { st._src = k === 'mandal_art_data' ? 'mandal_art_v13' : 'mandal_art_wh40k_v1'; st._score = scoreOf(st); found.push(st); } } catch (e) { /* ignore */ }
        });
        return mergeLegacy(found);
      } catch (e) { return null; }
    },
    async startupSync() {
      if (!api.available() || !S.settings.autoSync) return;
      try {
        const meta = await api.readMeta(), synced = S.meta.syncedTs || 0;
        if (!meta) {
          if (isPristine()) { const lg = await api.legacyRescue(); if (lg) { applyExternalState(lg, 'cloud-legacy'); toast('{ic:clouddown} Прогресс найден в облаке старой версии и восстановлен', 'long'); return; } }
          if (!isPristine()) api.scheduleSync(3000);
          return;
        }
        const cloudNew = meta.ts > synced, localChanged = S.updatedAt > synced;
        if (cloudNew && (isPristine() || !localChanged)) {
          const r = await api.cloudFetch();
          if (r.ok) { applyExternalState(r.state, 'cloud-auto', r.ts); toast('{ic:clouddown} Прогресс загружен из облака Telegram', 'long'); }
        } else if (cloudNew && localChanged) {
          const useCloud = await Modal.confirm({ title: 'Конфликт данных', msg: 'В облаке есть данные от ' + fullStr(meta.ts) + ', а на этом устройстве — свои изменения от ' + fullStr(S.updatedAt) + '.\n«Облако» — загрузить из облака (текущие сохранятся как копия).\n«Устройство» — оставить это устройство; облако будет перезаписано.', ok: 'Облако', cancel: 'Устройство' });
          if (useCloud) { const r = await api.cloudFetch(); if (r.ok) { applyExternalState(r.state, 'cloud-conflict', r.ts); toast('{ic:clouddown} Загружено из облака'); } }
          else api.scheduleSync(1500);
        } else if (localChanged) api.scheduleSync(3000);
      } catch (e) { error = (e && e.message) || String(e); }
    }
  };
  return api;
})();

/* «чистый» профиль: ничего не вводили — можно безопасно заменить данными из облака */
function isPristine() {
  const c = cellStat(S);
  return c.filled === 0 && c.done === 0 && S.diary.length === 0 && S.xp === CONFIG.startXp && S.unlockedRelics.length <= 1 && S.mandals.length === 1;
}
