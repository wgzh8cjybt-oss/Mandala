// Крупные кадры сценки ремонта (DSF 3) для проверки вида жрецов: node tests/priestzoom.cjs [выходной префикс]
const { launch, URL } = require('./lib.cjs');
const OUT = process.argv[2] || (__dirname + '/shots/pz');
(async () => {
  const { browser, page, errors } = await launch({ dsf: 3 });
  await page.goto(URL); await page.waitForTimeout(500); await page.click('.modal [data-r="1"]');
  await page.evaluate(() => { S.settings.fx = 'full'; S.settings.skulls = true; S.settings.scenes = true; S.unlockedThemes = THEMES.map(t => t.id); save(); FX.apply(); });
  await page.waitForTimeout(500);
  await page.evaluate(() => Scene.malfunction({ x: innerWidth / 2, y: 170 }));
  const vp = page.viewportSize();
  const want = { in: 1, repair: 2, rise: 1 }; const got = {};
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const i = await page.evaluate(() => Scene.info());
    if (!i.scene && Date.now() - t0 > 3000) break;
    const key = i.scene + '-' + (got[i.scene] || 0);
    if (want[i.scene] && (got[i.scene] || 0) < want[i.scene]) {
      const wait = { in: 1800, repair: 1500, rise: 700 }[i.scene];
      await page.waitForTimeout(wait);
      const gy = await page.evaluate(() => Math.round($('#nav').getBoundingClientRect().top));
      await page.screenshot({ path: OUT + '-' + i.scene + '-' + (got[i.scene] || 0) + '.png', clip: { x: 0, y: gy - 150, width: vp.width, height: 170 } });
      got[i.scene] = (got[i.scene] || 0) + 1;
      if (i.scene === 'repair') { await page.waitForTimeout(900); await page.screenshot({ path: OUT + '-repair-1.png', clip: { x: 0, y: gy - 150, width: vp.width, height: 170 } }); got.repair = 2; }
    }
    await page.waitForTimeout(100);
  }
  console.log('errors', errors.length, errors.slice(0, 3));
  await browser.close();
})();
