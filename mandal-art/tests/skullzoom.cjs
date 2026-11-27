// Крупный план сервочерепа: проверка совпадения двигателей/дыма с рисунком и покадровая съёмка анимации.
const { launch, URL } = require('./lib.cjs');
const OUT = __dirname + '/shots/';
(async () => {
  const { browser, page, errors } = await launch({ dsf: 2 });
  await page.goto(URL); await page.waitForTimeout(600);
  await page.click('.modal [data-r="1"]');
  await page.evaluate(() => { S.settings.fx = 'full'; S.settings.skulls = true; save(); FX.apply(); Scene.pause(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    document.body.style.background = '#16161c';
    const el = $$('#skullsFront .skull')[0];
    el.style.opacity = '1'; el.style.width = '300px'; el.style.height = '335px'; el.style.transform = 'translate3d(20px,110px,0) scale(-1,1)';
    el.style.transform = 'translate3d(20px,110px,0)';
  });
  const clip = { x: 0, y: 90, width: 390, height: 380 };
  for (let i = 0; i < 3; i++) { await page.waitForTimeout(173 + i * 91); await page.screenshot({ path: OUT + 'zoom-' + (i + 1) + '.png', clip }); }
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})();
