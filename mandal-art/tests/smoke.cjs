const { launch, URL } = require('./lib.cjs');
(async () => {
  const { browser, page, errors } = await launch();
  await page.goto(URL); await page.waitForTimeout(900);
  const info = await page.evaluate(() => ({ xp: S.xp, flames: S.flames, theme: S.activeTheme, cells: document.querySelectorAll('.cell').length, skulls: Scene.info(), how: Object.keys(localStorage) }));
  console.log(JSON.stringify(info));
  await page.screenshot({ path: 'tests/shots/01-start.png' });
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})();
