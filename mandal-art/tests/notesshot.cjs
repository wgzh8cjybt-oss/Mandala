const { launch, URL } = require('./lib.cjs');
(async () => {
  const { browser, page } = await launch({ dsf: 2 });
  await page.goto(URL); await page.waitForTimeout(700);
  await page.click('.modal [data-r="1"]');
  const ed = async (idx, text) => { await page.click('.cell[data-i="' + idx + '"]'); await page.waitForSelector('#ceText'); await page.fill('#ceText', text); await page.click('.modal [data-r="ok"]'); await page.waitForTimeout(100); };
  await ed(40, 'Создать автономную цифровую бизнес-экосистему');
  await ed(31, 'Разработать полноценное приложение');
  await page.evaluate(() => {
    const m = activeMandala();
    setBlockNote(m, 4, 'Главное — довести до запуска. Сначала прототип и три знакомых тестера, затем оплата, аналитика и первые клиенты.\nКаждую неделю — короткий разбор: что сработало, что нет. Не распыляться на второстепенное.\nМетрика успеха: первые 10 платящих пользователей.');
    setBlockNote(m, 1, 'Нужен дизайнер на макеты и человек для оплаты.');
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: __dirname + '/shots/p-overview.png' });
  await page.evaluate(() => setMode('block', 4)); await page.waitForTimeout(400);
  await page.screenshot({ path: __dirname + '/shots/p-block.png' });
  await page.$eval('#bnTxt', e => { e.scrollTop = e.scrollHeight; }); await page.waitForTimeout(200);
  await page.screenshot({ path: __dirname + '/shots/p-block-end.png' });
  await page.evaluate(() => setMode('all')); await page.waitForTimeout(150);
  await page.click('.cell[data-i="31"]'); await page.waitForSelector('#ceBook'); await page.waitForTimeout(500);
  await page.screenshot({ path: __dirname + '/shots/p-goal-edit.png' });
  await browser.close();
})();
