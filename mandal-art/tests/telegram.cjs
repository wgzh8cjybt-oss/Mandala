// Telegram WebApp на имитации (НЕ настоящий Telegram): SDK-вызовы, BackButton, цвета, облако CloudStorage:
// чанки, контрольная сумма, мусор в облаке, второе устройство, конфликт, старые облачные ключи Gemini-версий.
const { launch, URL } = require('./lib.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };
const MOCK = cloud => `(() => {
  const store = ${JSON.stringify(cloud || {})}; window.__cloud = store; window.__calls = []; let backCb = null, failSet = false;
  window.__setFail = v => { failSet = v; }; window.__back = () => backCb && backCb();
  const rec = (n, a) => window.__calls.push([n].concat(a || []));
  window.Telegram = { WebApp: { initData: 'query_id=mock', platform: 'android', version: '8.0', isVersionAtLeast: v => parseFloat(v) <= 8.0,
    ready() { rec('ready'); }, expand() { rec('expand'); }, disableVerticalSwipes() { rec('dvs'); },
    setHeaderColor(c) { rec('header', [c]); }, setBackgroundColor(c) { rec('bg', [c]); }, setBottomBarColor(c) { rec('bottom', [c]); },
    onEvent(n, f) { (window.__ev = window.__ev || {})[n] = f; },
    BackButton: { onClick(f) { backCb = f; }, show() { window.__backVisible = true; }, hide() { window.__backVisible = false; } },
    HapticFeedback: { impactOccurred(s) { rec('impact', [s]); }, notificationOccurred(t) { rec('notify', [t]); }, selectionChanged() { rec('select'); } },
    CloudStorage: {
      getItems(keys, cb) { setTimeout(() => { const o = {}; keys.forEach(k => { o[k] = store[k] || ''; }); cb(null, o); }, 4); },
      setItem(k, v, cb) { setTimeout(() => { if (failSet) return cb('MOCK_FAIL', false);
        if (typeof v !== 'string' || v.length > 4096 || !/^[A-Za-z0-9_-]{1,128}$/.test(k) || (!(k in store) && Object.keys(store).length >= 1024)) return cb('VALUE_INVALID', false);
        store[k] = v; cb(null, true); }, 4); },
      removeItems(keys, cb) { setTimeout(() => { keys.forEach(k => delete store[k]); cb(null, true); }, 4); } } } };
})();`;
async function device(cloud, storage) {
  const h = await launch({ init: MOCK(cloud), storage, dsf: 1 });
  await h.page.goto(URL); await h.page.waitForTimeout(500);
  return h;
}
const cloudOf = h => h.page.evaluate(() => JSON.parse(JSON.stringify(window.__cloud)));
const rnd = n => { let s = ''; while (s.length < n) s += Math.random().toString(36).slice(2); return s.slice(0, n); };

(async () => {
  let d = await device();
  const p = d.page;
  await p.evaluate(() => { S.settings.autoSync = false; });
  ok('Telegram detected, CloudStorage available (version 8.0 mock)', await p.evaluate(() => Tg.isTelegram() && Tg.available() && Tg.version() === '8.0'));
  const calls = await p.evaluate(() => window.__calls.map(c => c[0]));
  ok('SDK init: ready(), expand(), disableVerticalSwipes() called', ['ready', 'expand', 'dvs'].every(n => calls.includes(n)), calls);
  const meta0 = await p.evaluate(() => ({ meta: THEMES.find(t => t.id === S.activeTheme).meta, last: window.__calls.filter(c => c[0] === 'header').pop() }));
  ok('header color follows the theme', meta0.last && meta0.last[1] === meta0.meta, meta0);
  await p.evaluate(() => { S.unlockedThemes = THEMES.map(t => t.id); setTheme('onepiece'); });
  ok('header/background colors change with theme', await p.evaluate(() => { const h = window.__calls.filter(c => c[0] === 'header').pop(), b = window.__calls.filter(c => c[0] === 'bg').pop(); return h[1] === '#04202f' && b[1] === '#04202f'; }));
  await p.evaluate(() => setTheme('wh40k'));
  // BackButton (приветственное окно нового профиля закрываем заранее: оно лежит в стеке под магазином)
  await p.click('.modal [data-r="1"]').catch(() => {});
  await p.waitForTimeout(300);
  await p.evaluate(() => openStore());
  ok('BackButton shown while a dialog is open', await p.evaluate(() => window.__backVisible === true));
  await p.evaluate(() => window.__back());
  ok('BackButton closes the dialog and hides itself', await p.evaluate(() => Modal.stack.length === 0 && window.__backVisible === false));

  // push малого состояния
  await p.evaluate(() => { const m = activeMandala(); applyCell(m, 40, 'Цель', false); applyCell(m, 30, 'Шаг', true); addDiary('Облачная запись'); persistNow(); });
  let r = await p.evaluate(() => Tg.cloudPush(true));
  let cl = await cloudOf(d);
  const keys = Object.keys(cl);
  const meta = JSON.parse(cl.ma14_meta || 'null');
  ok('push ok, meta + chunks written', r.ok && meta && keys.length === meta.n + 1, { r, keys });
  ok('every value fits the 4096-char CloudStorage limit', keys.every(k => cl[k].length <= 4096));
  const joined = Array.from({ length: meta.n }, (_, i) => cl['ma14_' + i]).join('');
  ok('meta length + checksum match stored chunks', joined.length === meta.len && (await p.evaluate(s => Tg._fnv(s), joined)) === meta.sum, { len: joined.length, meta });
  ok('lastPush/syncedTs recorded', await p.evaluate(() => S.meta.lastPush > 0 && S.meta.syncedTs === S.updatedAt));

  // большое состояние: много кусков, круговой обмен
  await p.evaluate(rn => { S.diary = Array.from({ length: 400 }, (_, i) => ({ id: 1e12 + i, ts: 1e12 + i, date: '01.01.2026', text: rn[i], rewarded: true })); persistNow(); }, Array.from({ length: 400 }, () => rnd(1200)));
  const sum1 = await p.evaluate(() => S.diary.map(e => e.text).join('').length);
  r = await p.evaluate(() => Tg.cloudPush(true));
  cl = await cloudOf(d);
  const m2 = JSON.parse(cl.ma14_meta);
  ok('big state split into many chunks and pushed', r.ok && r.chunks > 20 && Object.keys(cl).length === m2.n + 1, { chunks: r.chunks, mode: r.mode });
  const f = await p.evaluate(() => Tg.cloudFetch().then(x => ({ ok: x.ok, n: x.state && x.state.diary.length, len: x.state && x.state.diary.map(e => e.text).join('').length, xp: x.state && x.state.xp, err: x.error })));
  ok('fetch returns identical data (400 entries, same text length)', f.ok && f.n === 400 && f.len === sum1, f);
  // порча данных в облаке
  const keep = await cloudOf(d);
  await p.evaluate(() => { const v = window.__cloud.ma14_0; window.__cloud.ma14_0 = (v[0] === 'A' ? 'B' : 'A') + v.slice(1); });
  let bad = await p.evaluate(() => Tg.cloudFetch());
  ok('flipped character in cloud -> rejected by checksum', !bad.ok && /контрольн/.test(bad.error || ''), bad);
  await p.evaluate(k => { Object.assign(window.__cloud, k); delete window.__cloud.ma14_1; }, { ma14_0: keep.ma14_0 });
  bad = await p.evaluate(() => Tg.cloudFetch());
  ok('missing chunk -> rejected, local data untouched', !bad.ok && /не хватает/.test(bad.error || '') && (await p.evaluate(() => S.diary.length)) === 400, bad);
  await p.evaluate(k => { window.__cloud.ma14_1 = k; }, keep.ma14_1);
  // ошибка записи
  await p.evaluate(() => window.__setFail(true));
  r = await p.evaluate(() => Tg.cloudPush(true));
  ok('write failure reported, busy flag reset', !r.ok && !!r.error && (await p.evaluate(() => Tg.cloudStatus().busy === false)), r);
  await p.evaluate(() => window.__setFail(false));
  // лишние куски удаляются после уменьшения данных
  await p.evaluate(() => { S.diary = S.diary.slice(0, 3); persistNow(); });
  r = await p.evaluate(() => Tg.cloudPush(true));
  cl = await cloudOf(d);
  const m3 = JSON.parse(cl.ma14_meta);
  ok('stale chunks removed after data shrinks', r.ok && Object.keys(cl).length === m3.n + 1 && m3.n < m2.n, { before: m2.n, after: m3.n, keys: Object.keys(cl).length });
  ok('no console errors (device 1)', d.errors.length === 0, d.errors);
  const finalCloud = cl, finalXp = await p.evaluate(() => S.xp), finalDiary = await p.evaluate(() => S.diary.length);
  await d.browser.close();

  // второе устройство, чистый профиль -> подтягивает облако само
  d = await device(finalCloud); await d.page.waitForTimeout(2300);
  let s = await d.page.evaluate(() => ({ xp: S.xp, diary: S.diary.length, done: S.mandals[0].cells.filter(c => c.completed).length, synced: S.meta.syncedTs, toast: $$('.toast').map(t => t.textContent).join('|') }));
  ok('device 2 (empty profile) auto-loads cloud data', s.diary === finalDiary && s.done === 1 && s.xp === finalXp && s.synced > 0, s);
  ok('device 2 shows a "loaded from cloud" notice', /облака/.test(s.toast), s.toast);
  ok('no console errors (device 2)', d.errors.length === 0, d.errors);
  await d.browser.close();

  // конфликт: на устройстве свои изменения, а в облаке новее
  const local = { schema: 2, xp: 300, flames: 15, activeId: 1, mandals: [{ id: 1, title: 'Локальная', cells: Array.from({ length: 81 }, (_, i) => i === 40 ? { text: 'Локальная', completed: false } : { text: '', completed: false }) }], diary: [], unlockedRelics: ['wh_1'], unlockedThemes: ['wh40k'], activeTheme: 'wh40k', meta: { welcome: true } };
  d = await device(finalCloud, { mandal_art_v14: JSON.stringify(local) }); await d.page.waitForTimeout(1800);
  ok('conflict dialog appears (local changes vs newer cloud)', await d.page.$('.modal:has-text("Конфликт данных")') !== null);
  await d.page.click('.modal button:has-text("Устройство")'); await d.page.waitForTimeout(2800);
  s = await d.page.evaluate(() => ({ xp: S.xp, title: S.mandals[0].title }));
  const afterKeep = JSON.parse((await cloudOf(d)).ma14_meta);
  ok('choose "device": local data kept and pushed over the cloud', s.xp === 300 && afterKeep.ts > JSON.parse(finalCloud.ma14_meta).ts, { s, afterKeep });
  await d.browser.close();
  d = await device(finalCloud, { mandal_art_v14: JSON.stringify(local) }); await d.page.waitForTimeout(1800);
  await d.page.click('.modal button:has-text("Облако")'); await d.page.waitForTimeout(900);
  s = await d.page.evaluate(() => ({ xp: S.xp, diary: S.diary.length, bak: readBackupInfo() }));
  ok('choose "cloud": cloud data loaded, previous local state saved as backup', s.diary === finalDiary && s.bak && s.bak.xp === 300, s);
  await d.browser.close();

  // старые облачные ключи Gemini-версий
  const oldCloud = { mandal_art_data: JSON.stringify({ activeId: 1, mandals: [{ id: 1, title: 'Из старого облака', cells: Array.from({ length: 81 }, (_, i) => i === 40 ? { text: 'Из старого облака', completed: false } : i === 30 ? { text: 'Шаг', completed: true } : { text: '', completed: false }) }], xp: 90, flames: 9, activeTheme: 'purple', unlockedFigurines: ['wh_1', 'wh_2'], diary: {} }) };
  d = await device(oldCloud); await d.page.waitForTimeout(2300);
  s = await d.page.evaluate(() => ({ xp: S.xp, title: S.mandals[0].title, relics: S.unlockedRelics.length, toast: $$('.toast').map(t => t.textContent).join('|') }));
  ok('legacy cloud key (mandal_art_data) rescued on empty profile', s.xp === 90 && s.title === 'Из старого облака' && s.relics === 2 && /старой версии/.test(s.toast), s);
  await d.browser.close();

  // автосинхронизация после изменения
  d = await device(); await d.page.evaluate(() => { const m = activeMandala(); applyCell(m, 40, 'Авто', false); addDiary('Авто-синхронизация'); });
  await d.page.waitForTimeout(9800);
  const auto = await cloudOf(d);
  ok('auto-sync pushes ~8 s after a change', !!auto.ma14_meta && JSON.parse(auto.ma14_meta).n >= 1, Object.keys(auto));
  ok('no console errors (auto-sync)', d.errors.length === 0, d.errors);
  await d.browser.close();
  console.log(`RESULT pass=${pass} fail=${fail}`);
})();
