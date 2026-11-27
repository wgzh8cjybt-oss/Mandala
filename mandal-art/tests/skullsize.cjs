// Череп в реальном размере (и крупнее для просмотра деталей), поверх настоящего экрана приложения.
const { launch, URL } = require('./lib.cjs');
const OUT = __dirname + '/shots/';
(async () => {
  const { browser, page, errors } = await launch({ dsf: 3 });
  await page.goto(URL); await page.waitForTimeout(600);
  await page.click('.modal [data-r="1"]');
  await page.evaluate(() => { S.settings.fx = 'full'; S.settings.skulls = true; save(); FX.apply(); Scene.pause(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const els = $$('#skullsFront .skull, #skulls .skull'); const pos = [[40, 140], [140, 150], [240, 140], [60, 260]];
    els.forEach((el, i) => { const w = el.offsetWidth, h = el.offsetHeight; el.style.transform = 'translate3d(' + pos[i][0] + 'px,' + pos[i][1] + 'px,0) scale(' + (i === 2 ? -1 : 1) + ',1)'; el.style.opacity = i === 3 ? '.7' : '1'; });
  });
  for (let i = 0; i < 2; i++) { await page.waitForTimeout(210 + i * 130); await page.screenshot({ path: OUT + 'size-' + (i + 1) + '.png', clip: { x: 0, y: 100, width: 390, height: 280 } }); }
  console.log(JSON.stringify(await page.evaluate(() => $$('.skull').map(e => e.offsetWidth + 'x' + e.offsetHeight))), 'errors', JSON.stringify(errors));
  await browser.close();
})();
