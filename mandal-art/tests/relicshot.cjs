// Снимки зала реликвий и окна просмотра с встроенными картинками (assets/relics)
const { launch, URL } = require('./lib.cjs');
const OUT = __dirname + '/shots/';
(async () => {
  const { browser, page, errors } = await launch({ dsf: 2 });
  await page.goto(URL); await page.waitForTimeout(700);
  await page.click('.modal [data-r="1"]');
  await page.evaluate(() => { S.unlockedRelics = ['wh_1', 'wh_2', 'wh_3', 'op_1', 'sc_1']; S.xp = 900; save(); scheduleRender(); });
  await page.waitForTimeout(400);
  for (let i = 0; i < 12; i++) {
    const busy = await page.evaluate(() => lvQueue.length > 0 || !!document.querySelector('.levelup'));
    if (!busy) break;
    await page.evaluate(() => { const e = document.querySelector('.levelup'); if (e) e.click(); });
    await page.waitForTimeout(700);
  }
  await page.evaluate(() => { $('#toasts').innerHTML = ''; switchTab('relics'); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + 'relics-hall.png' });
  const imgs = await page.evaluate(() => $$('.relic .art img').map(i => ({ ok: i.complete && i.naturalWidth > 0, w: i.naturalWidth })));
  console.log('imgs', JSON.stringify(imgs));
  for (const id of ['wh_1', 'wh_2', 'wh_3']) {
    await page.evaluate(id => { openReveal(RELICS.find(r => r.id === id), false); }, id);
    await page.waitForTimeout(900);
    await page.screenshot({ path: OUT + 'reveal-' + id + '.png' });
    await page.evaluate(() => { Modal.closeTop(); });
    await page.waitForTimeout(300);
  }
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})();
