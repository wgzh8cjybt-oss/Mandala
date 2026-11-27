/* Снимки витрины фигурок и окна просмотра (смотрим глазами; проверки — в tests/figures.cjs) */
const { launch, URL } = require('./lib.cjs');
(async () => {
  const { browser, page, errors } = await launch({ dsf: 2 });
  await page.goto(URL); await page.waitForTimeout(800);
  await page.click('.modal [data-r="1"]');
  await page.click('#nav [data-tab="relics"]'); await page.waitForTimeout(300);
  await page.screenshot({ path: __dirname + '/shots/fig-hall-relics.png' });
  await page.click('[data-act="hall"][data-v="figs"]'); await page.waitForTimeout(400);
  await page.screenshot({ path: __dirname + '/shots/fig-hall-figs.png' });
  await page.setViewportSize({ width: 390, height: 1500 }); await page.waitForTimeout(300);
  await page.screenshot({ path: __dirname + '/shots/fig-hall-figs-tall.png' });
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(200);
  // открыть «Сервочереп» (доступен по рангу) — окно просмотра
  await page.click('.fig[data-id="wh_skull"]'); await page.waitForSelector('.fgv'); await page.waitForTimeout(900);
  await page.screenshot({ path: __dirname + '/shots/fig-view-skull-ready.png' });
  const info = await page.evaluate(() => { const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; }; return { stage: r('.fgv-stage'), obj: r('.fgv-obj'), lift: r('.fgv-lift'), slices: document.querySelectorAll('.fgv-sl').length, act: r('#fgvAct'), info: r('.fgv-info') }; });
  console.log(JSON.stringify(info));
  await page.click('[data-v="front"]'); await page.waitForTimeout(900);
  await page.screenshot({ path: __dirname + '/shots/fig-view-front.png' });
  await page.click('[data-v="side"]'); await page.waitForTimeout(900);
  await page.screenshot({ path: __dirname + '/shots/fig-view-side.png' });
  await page.click('[data-v="back"]'); await page.waitForTimeout(900);
  await page.screenshot({ path: __dirname + '/shots/fig-view-back.png' });
  // 3/4
  await page.evaluate(() => 0);
  await page.close();
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})();
