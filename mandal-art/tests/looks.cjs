// Образы оформления: стекло / металл / классика — выбор по теме, переключатель в «Штабе», режимы эффектов, снимки
const { launch, URL } = require('./lib.cjs');
const OUT = __dirname + '/shots/';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } };
const EXPECT = { onepiece: 'glass', purple: 'glass', cyan: 'glass', wh40k: 'metal', red: 'metal', amber: 'metal', scrooge: 'classic' };
(async () => {
  const { browser, page, errors } = await launch({ dsf: 1 });
  await page.goto(URL); await page.waitForTimeout(700);
  await page.click('.modal [data-r="1"]');
  await page.evaluate(() => {
    const m = activeMandala();
    applyCell(m, 40, 'Стать сильнее', true);
    [30, 31, 32, 39, 41, 48, 49, 50].forEach((i, n) => applyCell(m, i, ['Здоровье', 'Деньги', 'Семья', 'Знания', 'Карьера', 'Отдых', 'Друзья', 'Дух'][n], n < 5));
    [0, 1, 2, 3, 4, 9, 10, 11, 12, 13, 14, 18, 19, 20].forEach((i, n) => applyCell(m, i, 'Задача ' + i, n % 3 !== 0));
    addDiary('Первая запись для проверки оформления.');
    S.unlockedThemes = THEMES.map(t => t.id); S.unlockedRelics = ['wh_1', 'wh_2', 'op_1', 'sc_1'];
    S.xp = Math.max(S.xp, 1200); S.flames = 42; S.settings.fx = 'full'; S.settings.skulls = true;
    checkAchievements(true); save(); FX.apply(); scheduleRender();
  });
  await page.waitForTimeout(500);
  for (let i = 0; i < 14; i++) {
    const busy = await page.evaluate(() => lvQueue.length > 0 || !!document.querySelector('.levelup'));
    if (!busy) break;
    await page.evaluate(() => { const e = document.querySelector('.levelup'); if (e) e.click(); });
    await page.waitForTimeout(750);
  }
  await page.evaluate(() => { $('#toasts').innerHTML = ''; });
  const cs = (sel, prop) => page.evaluate(([s, p]) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[p] : null; }, [sel, prop]);
  for (const id of Object.keys(EXPECT)) {
    await page.evaluate(id => { switchTab('mandala'); setTheme(id); }, id);
    await page.waitForTimeout(500);
    const look = await page.evaluate(() => document.body.dataset.look);
    const cls = await page.evaluate(() => document.body.className);
    ok(`${id}: look is ${EXPECT[id]}`, look === EXPECT[id] && cls.includes('look-' + EXPECT[id]) && Object.keys({ glass: 1, metal: 1, classic: 1 }).filter(k => cls.includes('look-' + k)).length === 1, { look, cls });
    if (EXPECT[id] === 'glass') {
      const bf = await cs('#hdr', 'backdropFilter');
      ok(`${id}: glass panel has backdrop-filter`, bf && bf !== 'none', bf);
      ok(`${id}: glass button has no clip-path`, (await cs('#hdr .btn', 'clipPath')) === 'none');
      ok(`${id}: glass button has a gradient background`, /gradient/.test(await cs('#hdr .btn', 'backgroundImage')));
    }
    if (EXPECT[id] === 'metal') {
      ok(`${id}: metal button is cut (clip-path)`, (await cs('#hdr .btn', 'clipPath')) !== 'none');
      ok(`${id}: metal panel has no blur`, ['none', '', null].includes(await cs('#hdr', 'backdropFilter')));
      ok(`${id}: metal button uses serif caps`, (await cs('#hdr .btn', 'textTransform')) === 'uppercase');
    }
    const shot = async (name) => { await page.waitForTimeout(250); await page.evaluate(() => { $('#toasts').innerHTML = ''; }); await page.screenshot({ path: OUT + `look-${id}-${name}.png` }); };
    await shot('1-mandala');
    await page.evaluate(() => switchTab('hq')); await shot('2-hq');
    await page.evaluate(() => { switchTab('mandala'); openStore(); }); await shot('3-store');
    await page.evaluate(() => { Modal.closeTop(); const r = RELICS.find(x => x.id === ({ wh40k: 'wh_2', onepiece: 'op_1', scrooge: 'sc_1' })[S.activeTheme] || 'wh_2'); openReveal(r, true); }); await page.waitForTimeout(1300); await shot('4-reveal');
    await page.evaluate(() => { Modal.closeTop(); });
  }
  // переключатель в Штабе
  await page.evaluate(() => { setTheme('onepiece'); switchTab('hq'); });
  await page.waitForTimeout(300);
  await page.click('#hqScroll [data-act="look"][data-v="metal"]');
  ok('toggle: One Piece → metal', await page.evaluate(() => document.body.dataset.look === 'metal' && S.settings.look === 'metal'));
  ok('toggle: the segment shows the active choice', await page.evaluate(() => document.querySelector('#hqScroll [data-act="look"][data-v="metal"]').classList.contains('active')));
  await page.screenshot({ path: OUT + 'look-onepiece-as-metal.png' });
  await page.click('#hqScroll [data-act="look"][data-v="classic"]');
  ok('toggle: One Piece → classic', await page.evaluate(() => document.body.dataset.look === 'classic'));
  await page.screenshot({ path: OUT + 'look-onepiece-as-classic.png' });
  await page.click('#hqScroll [data-act="look"][data-v="auto"]');
  ok('toggle: auto returns the theme default', await page.evaluate(() => document.body.dataset.look === 'glass' && S.settings.look === 'auto'));
  // выбор сохраняется между запусками
  await page.click('#hqScroll [data-act="look"][data-v="metal"]');
  await page.waitForTimeout(400);
  await page.reload(); await page.waitForTimeout(900);
  ok('setting survives a reload', await page.evaluate(() => S.settings.look === 'metal' && document.body.dataset.look === 'metal'));
  await page.evaluate(() => { S.settings.look = 'auto'; save(); Look.apply(); });
  // режимы эффектов
  await page.evaluate(() => { setTheme('onepiece'); S.settings.fx = 'off'; FX.apply(); });
  await page.waitForTimeout(250);
  ok('fx off: glass panel loses the blur', ['none', '', null].includes(await cs('#hdr', 'backdropFilter')));
  await page.evaluate(() => { S.settings.fx = 'lite'; FX.apply(); }); await page.waitForTimeout(250);
  const lite = await cs('#hdr', 'backdropFilter');
  ok('fx lite: glass panel keeps a (smaller) blur', lite && lite !== 'none' && /blur\(9px\)/.test(lite), lite);
  await page.evaluate(() => { S.settings.fx = 'full'; FX.apply(); }); await page.waitForTimeout(250);
  const full = await cs('#hdr', 'backdropFilter');
  ok('fx full: glass panel blur is 20px', /blur\(20px\)/.test(full || ''), full);
  // данные: настройка попадает в экспорт и возвращается из импорта
  const rt = await page.evaluate(() => { S.settings.look = 'glass'; const p = parseImport(exportData()); return p.ok ? p.state.settings.look : 'PARSE-FAIL'; });
  ok('export/import keeps settings.look', rt === 'glass', rt);
  const bad = await page.evaluate(() => normalizeState({ settings: { look: 'constructor' } }).settings.look);
  ok('unknown look value falls back to auto', bad === 'auto', bad);
  ok('no console errors', errors.length === 0, errors);
  console.log(`RESULT pass=${pass} fail=${fail}`); console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
