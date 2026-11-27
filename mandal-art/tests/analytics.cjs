/* Экран «Аналитика» и сроки задач в настоящем браузере (iPhone 13): выбор срока в календаре, значки на сетке, кольца, графики, календарь сроков. */
const { launch, URL } = require('./lib.cjs');
const assert = require('assert');
let fail = 0;
const ok = (c, msg) => { if (c) console.log('  ok   ' + msg); else { fail++; console.log('  FAIL ' + msg); } };

(async () => {
  const { browser, page, errors } = await launch();
  await page.goto(URL); await page.waitForTimeout(900);
  await page.evaluate(() => { while (Modal.closeTop()); });      // приветствие нового профиля не должно мешать

  // ---------- данные: цель, 8 подцелей, история за 5 недель, сроки в разных состояниях ----------
  await page.evaluate(() => {
    const DAY = 864e5, now = Date.now(), m = activeMandala();
    applyCell(m, 40, 'Стать сильнее', false);
    const subs = { 30: 'Здоровье', 31: 'Деньги', 32: 'Семья', 39: 'Знания', 41: 'Карьера', 48: 'Отдых', 49: 'Друзья', 50: 'Дух' };
    Object.keys(subs).forEach(i => applyCell(m, +i, subs[i], false));
    const free = [];
    for (let i = 0; i < 81; i++) if (!m.cells[i].text && i !== 40 && !isBlockCenter(i) && blockOfIdx(i) !== 4) free.push(i);
    let n = 0;
    for (let j = 34; j >= 1; j--) {                       // история: почти каждый день, с несколькими паузами
      if (j % 7 === 3 || j % 11 === 5) continue;
      const cnt = j % 4 === 0 ? 2 : 1;
      for (let q = 0; q < cnt && n < 40; q++, n++) {
        const i = free[n], c = m.cells[i];
        c.text = 'Сделано ' + (n + 1); c.completed = true; c.awarded = true; c.dn = now - j * DAY + q * 3600e3;
        if (n % 5 === 0) c.due = dayKey(now - (j - (n % 3 === 0 ? 2 : -1)) * DAY);   // выполнено вовремя или с опозданием
      }
    }
    const tasks = [['Сдать отчёт', -3], ['Записаться к врачу', 0], ['Купить билеты', 2], ['Подготовить презентацию', 9], ['Оформить визу', 20], ['Закрыть кредит', 45], ['Прочитать книгу', 5]];
    tasks.forEach((t, q) => { const i = free[n + q], c = m.cells[i]; c.text = t[0]; c.due = dayKey(now + t[1] * DAY); });
    S.stats.since = now - 40 * DAY;
    for (let j = 0; j < 36; j++) { if (j % 3 === 2) continue; const k = dayKey(now - j * DAY); S.stats.days[k] = Object.assign({ v: 0, c: 0, u: 0, e: 0, a: 0, t: 0 }, S.stats.days[k], { v: 1 + (j % 3) }); }
    persistNow(); renderAll();
  });
  const seed = await page.evaluate(() => { const m = activeMandala(); return { done: m.cells.filter(c => c.completed).length, due: m.cells.filter(c => c.due).length }; });
  console.log('seed', JSON.stringify(seed));

  // ---------- сетка: значки сроков ----------
  const badges = await page.evaluate(() => Array.from(document.querySelectorAll('.cell .due')).reduce((a, e) => { a[e.dataset.s] = (a[e.dataset.s] || 0) + 1; return a; }, {}));
  console.log('badges', JSON.stringify(badges));
  ok(badges.over >= 1 && badges.today >= 1 && badges.soon >= 1 && badges.later >= 1, 'на сетке есть метки просрочено / сегодня / скоро / позже');
  ok(await page.locator('#dueStrip:not(.hidden)').count() === 1, 'полоска сроков над сеткой показана');
  await page.screenshot({ path: 'tests/shots/an-01-grid.png' });

  // ---------- редактор: выбор срока в календаре ----------
  const target = await page.evaluate(() => { const m = activeMandala(); let i = 0; while (m.cells[i].text || isBlockCenter(i) || blockOfIdx(i) === 4) i++; return i; });
  await page.locator('.cell[data-i="' + target + '"]').click(); await page.waitForTimeout(300);
  await page.fill('#ceText', 'Написать план');
  ok(await page.locator('#ceDue').isEnabled(), 'строка «Срок» доступна, когда есть текст');
  await page.locator('#ceDue').click(); await page.waitForTimeout(300);
  ok(await page.locator('.dp .dp-grid .dp-d').count() === 42, 'календарь: сетка 6×7 дней');
  await page.screenshot({ path: 'tests/shots/an-02-picker.png' });
  await page.locator('.dp-title').click(); await page.waitForTimeout(150);
  ok(await page.locator('.dp-months .dp-m').count() === 12, 'выбор месяца: 12 кнопок');
  await page.screenshot({ path: 'tests/shots/an-03-months.png' });
  await page.locator('.dp-months .dp-m').nth(11).click(); await page.waitForTimeout(150);
  await page.locator('.dp-nav[data-dp="next"]').click(); await page.waitForTimeout(100);         // январь следующего года
  const yr = await page.locator('.dp-title').textContent();
  ok(/январь \d{4}/.test(yr), 'листание месяцев через год: ' + yr);
  await page.locator('.dp-q', { hasText: '+ неделя' }).click(); await page.waitForTimeout(150);
  ok(await page.locator('.dp-d.sel').count() === 1, 'выбранный день подсвечен');
  await page.locator('.dp [data-dp="ok"]').click(); await page.waitForTimeout(200);
  const v = await page.locator('#ceDueV').textContent();
  ok(/через 7 дней/.test(v), 'в редакторе видно выбранный срок: ' + v);
  await page.locator('[data-r="ok"]').click(); await page.waitForTimeout(300);
  const saved = await page.evaluate(i => { const c = activeMandala().cells[i]; return { due: c.due, today: dayKey() }; }, target);
  ok(saved.due && saved.due > saved.today, 'срок сохранён в клетке: ' + saved.due);
  ok(await page.locator('.cell[data-i="' + target + '"] .due[data-s="later"], .cell[data-i="' + target + '"] .due[data-s="soon"]').count() === 1, 'на клетке появился значок срока');

  // убрать срок крестиком
  await page.locator('.cell[data-i="' + target + '"]').click(); await page.waitForTimeout(250);
  await page.locator('#ceDueX').click(); await page.waitForTimeout(100);
  await page.locator('[data-r="ok"]').click(); await page.waitForTimeout(250);
  ok(await page.evaluate(i => activeMandala().cells[i].due === undefined, target), 'срок снимается крестиком');

  // ---------- режим «Блок»: дата прямо на клетке ----------
  const blk = await page.evaluate(() => { const m = activeMandala(); const i = m.cells.findIndex(c => c.due && !c.completed); return blockOfIdx(i); });
  await page.evaluate(b => setMode('block', b), blk); await page.waitForTimeout(250);
  const txt = await page.evaluate(() => Array.from(document.querySelectorAll('#board.focus .cell .due')).map(e => e.textContent));
  ok(txt.length > 0 && txt.every(t => /^!?\d\d\.\d\d$/.test(t)), 'в режиме «Блок» на клетках видна дата ДД.ММ: ' + txt.join(', '));
  await page.screenshot({ path: 'tests/shots/an-04-block.png' });
  await page.evaluate(() => setMode('all'));

  // ---------- аналитика ----------
  await page.locator('#nav [data-tab="analytics"]').click(); await page.waitForTimeout(500);
  const an = await page.evaluate(() => ({
    rings: document.querySelectorAll('#anScroll .an-ring').length, svgs: document.querySelectorAll('#anScroll .an-svg').length,
    kpis: document.querySelectorAll('#anScroll .an-k').length, nums: Array.from(document.querySelectorAll('#anScroll .an-ring .num')).map(e => e.textContent),
    heat: document.querySelectorAll('#anScroll .hm').length, dl: document.querySelectorAll('#anScroll .an-dl').length, ins: document.querySelectorAll('#anScroll .an-ins').length,
    title: document.querySelector('#anScroll .an-ttl').textContent.trim(), nav: Array.from(document.querySelectorAll('#nav .lb')).map(e => e.textContent)
  }));
  console.log('analytics', JSON.stringify(an));
  ok(an.rings === 2 && an.svgs >= 4 && an.kpis === 6, 'экран: 2 кольца, графики, 6 показателей');
  ok(an.nums.every(t => /\d/.test(t)), 'в кольцах числа (вероятность и сроки): ' + an.nums.join(' / '));
  ok(an.heat >= 91 && an.dl >= 3 && an.ins >= 1, 'календарь активности, список сроков и советы на месте');
  ok(an.nav.length === 5 && an.nav[3] === 'Аналитика', 'в нижней панели 5 разделов: ' + an.nav.join(', '));
  await page.screenshot({ path: 'tests/shots/an-10-top.png' });
  const H = await page.evaluate(() => document.getElementById('anScroll').scrollHeight);
  for (let y = 560, n = 11; y < H && n < 20; y += 560, n++) { await page.evaluate(y => { document.getElementById('anScroll').scrollTop = y; }, y); await page.waitForTimeout(120); await page.screenshot({ path: 'tests/shots/an-' + n + '.png' }); }

  // нажатие на график показывает значения за день
  await page.evaluate(() => { document.getElementById('anScroll').scrollTop = 0; });
  await page.locator('#anPlot svg').scrollIntoViewIfNeeded(); await page.waitForTimeout(150);
  const box = await page.locator('#anPlot svg').boundingBox();
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5); await page.waitForTimeout(150);
  ok(await page.locator('#anTip:not(.hidden)').count() === 1, 'нажатие на график показывает значения за выбранный день');

  // периоды и цели
  for (const r of [7, 90, 365, 30]) { await page.locator('[data-act="an-range"][data-v="' + r + '"]').click(); await page.waitForTimeout(150); }
  ok(await page.locator('.an-rng .active').textContent() === '30 дн', 'период переключается');
  await page.locator('.an-chips button').nth(1).click(); await page.waitForTimeout(150);
  ok(await page.locator('.an-chips button.on').count() === 1, 'выбор отдельной цели работает');
  await page.locator('.an-chips button').nth(0).click();

  // календарь сроков: листание и выбор дня
  await page.locator('[data-act="an-cal"][data-v="next"]').click(); await page.locator('[data-act="an-cal"][data-v="prev"]').click();
  await page.locator('.an-cal .d:not(.out)').first().click(); await page.waitForTimeout(100);
  ok(await page.locator('.an-cal .d.sel').count() === 1, 'в календаре сроков выбирается день');

  // нажатие на срок открывает задачу в мандале
  await page.locator('.an-dl').first().click(); await page.waitForTimeout(450);
  ok(await page.evaluate(() => UI.tab === 'mandala' && !!document.getElementById('ceText')), 'нажатие на срок открывает задачу в мандале');
  await page.screenshot({ path: 'tests/shots/an-20-from-deadline.png' });
  await page.locator('[data-r="cancel"]').click(); await page.waitForTimeout(150);

  // полоска над сеткой ведёт в аналитику на раздел сроков
  await page.locator('#dueStrip').click(); await page.waitForTimeout(400);
  ok(await page.evaluate(() => UI.tab === 'analytics'), 'полоска сроков открывает аналитику');

  // три семейства тем и три образа: ничего не ломается
  for (const th of ['onepiece', 'scrooge', 'purple']) {
    await page.evaluate(t => { S.unlockedThemes = THEMES.map(x => x.id); setTheme(t); }, th); await page.waitForTimeout(250);
    await page.screenshot({ path: 'tests/shots/an-30-' + th + '.png' });
  }
  await page.evaluate(() => { S.settings.look = 'metal'; Look.apply(); scheduleRender(); }); await page.waitForTimeout(250);
  await page.screenshot({ path: 'tests/shots/an-31-metal.png' });

  // журнал событий пишется
  const ev = await page.evaluate(() => { const k = {}; S.stats.ev.forEach(e => { k[e[1]] = (k[e[1]] || 0) + 1; }); return k; });
  console.log('events', JSON.stringify(ev));
  ok(ev.v >= 1 && ev.a >= 1 && ev.e >= 1, 'журнал событий: заход, просмотр аналитики, правка');

  ok(errors.length === 0, 'ошибок в консоли нет' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
  console.log(fail ? '\nПровалов: ' + fail : '\nВсе проверки пройдены');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
