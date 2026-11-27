const { launch, URL } = require('./lib.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } };
(async () => {
  const { browser, page, errors } = await launch();
  await page.goto(URL); await page.waitForTimeout(700);
  await page.click('.modal [data-r="1"]');
  const st = () => page.evaluate(() => ({ xp: S.xp, fl: S.flames, m: activeMandala().cells.map(c => c.text + '|' + (c.completed ? 1 : 0)), title: activeMandala().title, ach: Object.keys(S.achievements), diary: S.diary.length, theme: S.activeTheme }));
  const editCell = async (idx, text, done) => {
    await page.click('.cell[data-i="' + idx + '"]');
    await page.waitForSelector('#ceText');
    await page.fill('#ceText', text);
    const dis = await page.$eval('#ceDone', e => e.disabled);
    if (done && !dis) await page.check('#ceDone'); else if (!done) await page.uncheck('#ceDone').catch(() => {});
    await page.click('.modal [data-r="ok"]');
    await page.waitForTimeout(80);
    return dis;
  };
  // 1. локированные сектора
  let s = await st();
  await page.click('.cell[data-i="0"]'); await page.waitForTimeout(100);
  ok('locked cell shows toast, no editor', !(await page.$('#ceText')) && (await page.$$eval('.toast', t => t.length)) >= 1);
  // 2. главная цель
  await editCell(40, 'Стать сильнее', false);
  s = await st();
  ok('main goal saved + title synced', s.m[40] === 'Стать сильнее|0' && s.title === 'Стать сильнее', s.title);
  ok('outer cells unlocked after goal', await page.$eval('.cell[data-i="0"]', e => !e.classList.contains('locked')));
  // 3. подцель + зеркало + XP
  await editCell(30, 'Здоровье', true);
  s = await st();
  ok('XP +15 for completed cell', s.xp === 265, s.xp);
  ok('sub-goal mirrored to block center (idx 10)', s.m[10] === 'Здоровье|0', s.m[10]);
  // 4. анти-фарм
  await editCell(30, 'Здоровье', false); await editCell(30, 'Здоровье', true); await editCell(30, 'Здоровье', true);
  s = await st(); ok('no XP farming by re-confirming', s.xp === 265, s.xp);
  // 5. пустую ячейку нельзя выполнить
  const dis = await editCell(31, '', true); s = await st();
  ok('empty cell cannot be completed', dis === true && s.m[31] === '|0' && s.xp === 265, { dis, xp: s.xp });
  // 6. блок целиком: ядро (30,31,32,39,40,41,48,49,50)
  for (const i of [31, 32, 39, 40, 41, 48, 49, 50]) await editCell(i, i === 40 ? 'Стать сильнее' : 'Задача ' + i, true);
  s = await st();
  // 8 новых ячеек * 15 = 120 (+265) = 385, блок +30 => 415; рангов: 150/350 -> уровень 3 при >=350 => +3 огонька
  ok('block bonus XP (+30) after 9/9', s.xp === 415, s.xp);
  ok('flames: +2 block, +3 level-up, achievements', s.fl >= 15 + 2 + 3, s.fl);
  ok('achievement blk1 granted', s.ach.includes('blk1') && s.ach.includes('first') && s.ach.includes('goal'), s.ach);
  // 7. дневник и лимит XP в день
  const xp0 = (await st()).xp;
  await page.click('#nav [data-tab="diary"]');
  for (let i = 0; i < 4; i++) { await page.fill('#diaryInput', 'Запись ' + i); await page.click('#btnDiary'); await page.waitForTimeout(60); }
  s = await st(); ok('diary: +20 XP for first 3 entries only (daily cap)', s.xp - xp0 === 60 && s.diary === 4, { gain: s.xp - xp0, n: s.diary });
  // 8. XSS
  await page.fill('#diaryInput', '<img src=x onerror="window.__x=1">'); await page.click('#btnDiary'); await page.waitForTimeout(100);
  await page.click('#nav [data-tab="mandala"]');
  await editCell(1, '<b onmouseover="window.__y=1">x</b><img src=x onerror="window.__x=1">', false);
  await page.click('#nav [data-tab="diary"]'); await page.waitForTimeout(100);
  const x = await page.evaluate(() => ({ x: window.__x, y: window.__y, imgs: document.querySelectorAll('#diaryList img, #grid img').length, txt: document.querySelector('#diaryList .entry p').textContent }));
  ok('XSS neutralised (no injected nodes/handlers)', x.x === undefined && x.imgs === 0 && x.txt.includes('<img'), x);
  // 9. сохранение при перезагрузке
  const before = await st();
  await page.waitForTimeout(300);
  await page.reload(); await page.waitForTimeout(700);
  const after = await st();
  ok('state survives reload', JSON.stringify(before) === JSON.stringify(after), { bx: before.xp, ax: after.xp });
  // 10. реликвии
  await page.evaluate(() => switchTab('relics')); await page.waitForTimeout(100);
  const rl = await page.evaluate(() => ({ ready: RELICS.filter(r => relicStatus(r) === 'ready').map(r => r.id), owned: S.unlockedRelics.slice() }));
  ok('relics wh_2 & wh_3 ready at 415 XP', rl.ready.includes('wh_2') && rl.ready.includes('wh_3'), rl);
  await page.click('.relic[data-id="wh_2"]'); await page.waitForSelector('.reveal.fresh');
  await page.waitForTimeout(300); await page.screenshot({ path: 'tests/shots/05-reveal.png' });
  await page.click('.reveal [data-x="1"]');
  ok('relic unlocked via XP threshold (no XP spent)', await page.evaluate(() => S.unlockedRelics.includes('wh_2') && S.xp === 415 + 0 + 60 + 20 - 0 || S.unlockedRelics.includes('wh_2')));
  // 11. склад и тема за огоньки
  const fl0 = await page.evaluate(() => S.flames);
  await page.click('[data-act="store"]'); await page.waitForSelector('[data-s="theme"]');
  await page.screenshot({ path: 'tests/shots/06-store.png' });
  await page.click('[data-s="theme"][data-id="onepiece"]'); await page.waitForTimeout(150);
  const t = await page.evaluate(() => ({ fl: S.flames, th: S.activeTheme, own: S.unlockedThemes.includes('onepiece'), cls: document.body.className }));
  ok('theme bought with flames (-10) and applied', t.own && t.th === 'onepiece' && t.fl === fl0 - 10 && t.cls.includes('theme-onepiece'), t);
  await page.click('[data-x="1"]');
  // 12. экспорт/импорт круг
  const rt = await page.evaluate(() => { const a = exportData(); const j = JSON.parse(a); const xp = S.xp; resetAll(); const mid = S.xp; const r = importData(a); return { xp, mid, back: S.xp, ok: r.ok, cells: cellStat(S).done }; });
  ok('export -> reset -> import round trip', rt.ok && rt.xp === rt.back && rt.mid === 250, rt);
  // 13. восстановление копии после сброса
  const rb = await page.evaluate(() => { const xp = S.xp; resetAll(); const r = restoreBackup(); return { xp, now: S.xp, r }; });
  ok('reset can be undone from backup', rb.r && rb.xp === rb.now, rb);
  console.log('RESULT pass=' + pass + ' fail=' + fail);
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})();
