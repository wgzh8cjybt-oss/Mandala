// Синтетическая проверка плавности (НЕ замер на реальном телефоне): headless Chromium, программная отрисовка,
// замедление процессора в 4 раза через CDP, 3 секунды кадров. Плюс долгое нажатие на блок.
const { launch, URL } = require('./lib.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } };
(async () => {
  const { browser, ctx, page, errors } = await launch({ dsf: 2 });
  await page.goto(URL); await page.waitForTimeout(600); await page.click('.modal [data-r="1"]');
  await page.evaluate(() => { S.unlockedThemes = THEMES.map(t => t.id); const m = activeMandala(); applyCell(m, 40, 'Цель', false); [30, 31, 32, 39, 41, 48].forEach(i => applyCell(m, i, 'Шаг ' + i, true)); });
  await page.waitForTimeout(500);
  // долгое нажатие на ячейку -> режим одного блока (480 мс)
  const box = await page.evaluate(() => { const r = cellEls[31].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up(); await page.waitForTimeout(300);
  ok('long-press on a cell switches to single-block focus mode', await page.evaluate(() => UI.mode === 'block' || $('#board').classList.contains('focus')), await page.evaluate(() => ({ mode: UI.mode })));
  await page.evaluate(() => setMode('all')); await page.waitForTimeout(200);
  const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const sample = () => page.evaluate(() => new Promise(res => { const t = []; let last = performance.now(), end = last + 3000; (function f(now) { t.push(now - last); last = now; if (now < end) requestAnimationFrame(f); else res(t.slice(5)); })(last); }));
  const stat = t => { const s = t.slice().sort((a, b) => a - b); return { avg: +(t.reduce((a, b) => a + b, 0) / t.length).toFixed(1), p95: +s[Math.floor(s.length * .95)].toFixed(1), long: t.filter(x => x > 50).length, n: t.length }; };
  const rows = [];
  for (const [id, fam] of [['wh40k', 'wh'], ['onepiece', 'op'], ['scrooge', 'sc']]) {
    for (const fx of ['full', 'lite']) {
      await page.evaluate(([id, fx]) => { setTheme(id); S.settings.fx = fx; FX.apply(); }, [id, fx]); await page.waitForTimeout(600);
      const info = await page.evaluate(() => Scene.info());
      const st = stat(await sample()); rows.push({ fam, fx, floaters: info.skulls, parts: info.parts, ...st });
    }
  }
  console.table(rows);
  ok('4x CPU slowdown: average frame under 33 ms in lite mode for every theme', rows.filter(r => r.fx === 'lite').every(r => r.avg < 33), rows.filter(r => r.fx === 'lite'));
  console.log('full-mode averages (info only):', rows.filter(r => r.fx === 'full').map(r => r.fam + ':' + r.avg + 'ms').join('  '));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  ok('no console errors', errors.length === 0, errors);
  console.log(`RESULT pass=${pass} fail=${fail}`);
  await browser.close();
})();
