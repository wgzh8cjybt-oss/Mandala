const { launch, URL } = require('./lib.cjs');
const OUT = __dirname + '/shots/';
(async () => {
  const { browser, page, errors } = await launch({ dsf: 2 });
  await page.goto(URL); await page.waitForTimeout(700);
  await page.click('.modal [data-r="1"]');
  await page.evaluate(() => { S.settings.fx = 'full'; S.settings.skulls = true; save(); FX.apply(); });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: OUT + 'skull-1.png' });
  const info = await page.evaluate(() => ({ skulls: $$('.skull').map(e => e.className + ' ' + e.offsetWidth + 'x' + e.offsetHeight), img: getComputedStyle($('.skull .sk-img')).backgroundImage.slice(0, 40), scene: Scene.info() }));
  console.log(JSON.stringify(info));
  await page.waitForTimeout(3500);
  await page.screenshot({ path: OUT + 'skull-2.png' });
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})();
