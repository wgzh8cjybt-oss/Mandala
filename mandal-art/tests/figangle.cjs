// Снимки фигурки под разными углами (для просмотра глазами).
const { launch, URL: APP } = require('./lib.cjs');
(async () => {
  const h = await launch({ device: 'iPhone 13', dsf: 2, storage: { mandal_art_v14: JSON.stringify({ v: 2, xp: 2000, flames: 50, settings: { fx: 'full' } }) } });
  const p = h.page; await p.goto(APP); await p.waitForTimeout(800);
  const w = await p.$('.modal [data-r="1"]'); if (w) await w.click();
  await p.click('#nav [data-tab="relics"]'); await p.waitForTimeout(200);
  await p.click('[data-act="hall"][data-v="figs"]'); await p.waitForTimeout(200);
  for (const id of ['wh_trooper', 'wh_walker']) {
    await p.click('.fig[data-id="' + id + '"]'); await p.waitForSelector('.fgv'); await p.waitForTimeout(500);
    await p.click('[data-v="auto"]');
    const box = await (await p.$('#fgvStage')).boundingBox();
    for (const [name, dx] of [['front', 0], ['a35', 70], ['a60', 130]]) {
      await p.click('[data-v="front"]'); await p.waitForTimeout(700);
      if (dx) { await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.down(); await p.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 8 }); await p.waitForTimeout(80); await p.mouse.up(); await p.waitForTimeout(1600); }
      await p.screenshot({ path: 'tests/shots/fa-' + id + '-' + name + '.png', clip: { x: 0, y: 60, width: box.width + 24, height: box.height - 40 } });
    }
    await p.click('[data-v="side"]'); await p.waitForTimeout(900);
    await p.screenshot({ path: 'tests/shots/fa-' + id + '-side.png', clip: { x: 0, y: 60, width: box.width + 24, height: box.height - 40 } });
    await p.click('.fgv-x'); await p.waitForTimeout(300);
  }
  console.log('errors:', h.errors.length ? h.errors : 'none');
  await h.browser.close();
})();
