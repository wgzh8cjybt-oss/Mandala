/* Комментарий к блоку 3×3: окошко под названием блока, прокрутка, текст по центру, сохранение, индикатор в обзоре,
   экспорт/импорт, старые данные без notes + многострочный редактор ячейки и читаемость длинного текста в режиме «Блок». */
const { launch, URL } = require('./lib.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } };
const LONG = 'Первый этап: описать идею, собрать требования и нарисовать макеты. Второй этап: сделать рабочий прототип и показать трём знакомым. ' +
  'Третий этап: исправить замечания, подключить оплату и аналитику. Четвёртый: запуск, первые клиенты, отзывы и разбор ошибок. ' +
  'Пятый: стабильный доход и автоматизация рутины, чтобы система работала без постоянного участия.';
(async () => {
  const { browser, page, errors } = await launch({ dsf: 2 });
  await page.goto(URL); await page.waitForTimeout(700);
  await page.click('.modal [data-r="1"]');
  const editCell = async (idx, text) => {
    await page.click('.cell[data-i="' + idx + '"]');
    await page.waitForSelector('#ceText');
    await page.fill('#ceText', text);
    await page.click('.modal [data-r="ok"]');
    await page.waitForTimeout(80);
  };
  await editCell(40, 'Создать автономную цифровую бизнес-экосистему');

  // --- видимость: в обзоре окошка нет, в режиме «Блок» оно под названием блока ---
  ok('overview: note window hidden', await page.$eval('#blockNote', e => getComputedStyle(e).display === 'none'));
  await page.click('#modeBlock'); await page.waitForTimeout(150);
  const g = await page.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(); return { nav: r('#focusNav'), box: r('#bnBox'), board: r('#board'), vh: innerHeight }; });
  ok('block mode: note window visible', g.box.height > 40, g.box);
  ok('note window is under the block title', g.box.top >= g.nav.bottom - 1, { nav: g.nav.bottom, box: g.box.top });
  ok('board stays below the note window and inside the screen', g.board.top >= g.box.bottom - 1 && g.board.bottom <= g.vh, { box: g.box.bottom, board: [g.board.top, g.board.bottom], vh: g.vh });
  ok('empty note shows a hint', (await page.$eval('#bnTxt', e => e.textContent)).includes('Комментарий') && await page.$eval('#bnTxt', e => e.classList.contains('ph')));

  // --- запись длинного комментария ---
  await page.click('#bnBox'); await page.waitForSelector('#bnInput');
  ok('editor: multiline textarea with counter', await page.$eval('#bnInput', e => e.tagName === 'TEXTAREA' && e.rows >= 5) && (await page.$eval('#bnCount', e => e.textContent)).includes('/ 600'));
  await page.fill('#bnInput', LONG); await page.waitForTimeout(50);
  ok('editor: counter follows the text', (await page.$eval('#bnCount', e => e.textContent)).startsWith(String(LONG.length)));
  await page.screenshot({ path: __dirname + '/shots/notes-edit.png' });
  await page.click('.modal [data-r="ok"]'); await page.waitForTimeout(200);
  const n = await page.evaluate(() => { const t = document.querySelector('#bnTxt'), b = document.querySelector('#bnBox'); const cs = getComputedStyle(t); return { txt: t.textContent, scroll: t.scrollHeight, h: t.clientHeight, align: cs.textAlign, ov: cs.overflowY, fb: t.classList.contains('fb'), more: b.classList.contains('more'), boxH: b.getBoundingClientRect().height, stored: activeMandala().notes[4] }; });
  ok('note saved to the block (index 4)', n.stored === LONG && n.txt === LONG, { l: n.stored && n.stored.length });
  ok('note window scrolls (text longer than window)', n.scroll > n.h + 20 && n.ov === 'auto', n);
  ok('text is centered', n.align === 'center', n.align);
  ok('"more below" hint is on', n.fb && n.more, n);
  ok('window height is fixed (layout does not jump)', n.boxH === g.box.height, { was: g.box.height, now: n.boxH });
  await page.screenshot({ path: __dirname + '/shots/notes-block.png' });
  // прокрутка вниз: исчезает подсказка «ниже», появляется затухание сверху
  await page.$eval('#bnTxt', e => { e.scrollTop = e.scrollHeight; });
  await page.waitForTimeout(120);
  const sc = await page.evaluate(() => { const t = document.querySelector('#bnTxt'); return { ft: t.classList.contains('ft'), fb: t.classList.contains('fb'), more: document.querySelector('#bnBox').classList.contains('more'), end: Math.abs(t.scrollTop + t.clientHeight - t.scrollHeight) <= 2 }; });
  ok('scrolled to the end: top fade on, "more" off', sc.end && sc.ft && !sc.fb && !sc.more, sc);
  await page.screenshot({ path: __dirname + '/shots/notes-block-end.png' });

  // --- прокрутка пальцем не открывает редактор (клик — открывает) ---
  ok('no editor opened while scrolling', !(await page.$('#bnInput')));

  // --- сохранение между перезапусками ---
  await page.waitForTimeout(700);   // дебаунс записи
  await page.reload(); await page.waitForTimeout(700);
  ok('note survives a reload', await page.evaluate(t => activeMandala().notes[4] === t, LONG));

  // --- у каждого блока свой комментарий ---
  await page.click('#modeBlock').catch(() => {}); await page.waitForTimeout(100);
  await page.evaluate(() => setMode('block', 4)); await page.waitForTimeout(100);
  ok('block 4 shows its note after reload', (await page.$eval('#bnTxt', e => e.textContent)) === LONG);
  await page.click('[data-act="focus-next"]'); await page.waitForTimeout(120);
  ok('next block has its own (empty) note', await page.$eval('#bnTxt', e => e.classList.contains('ph')) && await page.evaluate(() => UI.focus === 5));
  await page.click('#bnBox'); await page.waitForSelector('#bnInput');
  await page.fill('#bnInput', '  Ждать ответа клиента\r\n\r\n\r\n\r\n\r\nне раньше пятницы  '); await page.click('.modal [data-r="ok"]'); await page.waitForTimeout(150);
  const n5 = await page.evaluate(() => ({ five: activeMandala().notes[5], four: activeMandala().notes[4].length }));
  ok('block 5 note trimmed, CRLF and empty lines normalized', n5.five === 'Ждать ответа клиента\n\n\nне раньше пятницы', n5.five);
  ok('block 4 note untouched', n5.four === LONG.length);
  // очистка
  await page.click('#bnBox'); await page.waitForSelector('#bnInput');
  await page.click('.modal [data-r="clear"]'); await page.click('.modal [data-r="ok"]'); await page.waitForTimeout(120);
  ok('clear removes the note', await page.evaluate(() => activeMandala().notes[5] === '') && await page.$eval('#bnTxt', e => e.classList.contains('ph')));
  // отмена не меняет
  await page.click('#bnBox'); await page.waitForSelector('#bnInput'); await page.fill('#bnInput', 'временно'); await page.click('.modal [data-r="cancel"]'); await page.waitForTimeout(100);
  ok('cancel keeps the old note', await page.evaluate(() => activeMandala().notes[5] === ''));
  // клавиатура (доступность)
  await page.focus('#bnBox'); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
  ok('keyboard Enter opens the editor', !!(await page.$('#bnInput'))); await page.click('.modal [data-r="cancel"]');

  // --- обзор: индикатор у блока с комментарием, нажатия он не перехватывает ---
  await page.click('#modeAll'); await page.waitForTimeout(150);
  ok('overview: note window hidden again', await page.$eval('#blockNote', e => getComputedStyle(e).display === 'none'));
  const fl = await page.evaluate(() => {
    const flags = [...document.querySelectorAll('.blk')].map(b => getComputedStyle(b.querySelector('.bn-flag')).display);
    const f = document.querySelector('.blk[data-b="4"] .bn-flag').getBoundingClientRect();
    const hit = document.elementFromPoint(f.left + f.width / 2, f.top + f.height / 2);
    return { flags, hitIsFlag: !!(hit && hit.closest('.bn-flag')), pe: getComputedStyle(document.querySelector('.bn-flag')).pointerEvents };
  });
  ok('overview: only block 4 has the note flag', fl.flags.map((d, i) => (d !== 'none') === (i === 4)).every(Boolean), fl.flags);
  ok('flag does not intercept taps', !fl.hitIsFlag && fl.pe === 'none', fl);
  await page.screenshot({ path: __dirname + '/shots/notes-overview.png' });

  // --- экспорт / импорт / старые данные ---
  const io = await page.evaluate(() => {
    const exp = exportData(); const p = parseImport(exp);
    const old = normalizeState({ mandals: [{ id: 1, title: 'старая', cells: [] }] }, true);
    const odd = normalizeState({ mandals: [{ id: 2, cells: [], notes: ['a', 5, null, 'x'.repeat(2000)] }] }, false);
    setBlockNote(activeMandala(), 2, 'z'.repeat(1000));
    return { imp: p.ok && p.state.mandals[0].notes[4], oldN: old.mandals[0].notes, oddN: odd.mandals[0].notes.map(x => x.length), clip: activeMandala().notes[2].length, fresh: newMandala('q').notes.length };
  });
  ok('export → import keeps notes', io.imp && io.imp.length === LONG.length, io.imp && io.imp.length);
  ok('old data without notes loads with 9 empty notes', Array.isArray(io.oldN) && io.oldN.length === 9 && io.oldN.every(x => x === ''), io.oldN);
  ok('broken notes array is repaired (numbers/null/oversize)', io.oddN.length === 9 && io.oddN[0] === 1 && io.oddN[1] === 1 && io.oddN[2] === 0 && io.oddN[3] === 600, io.oddN);
  ok('note length is capped at 600', io.clip === 600, io.clip);
  ok('new mandala has 9 note slots', io.fresh === 9);

  // --- блокнот прямо в окне цели ---
  await page.evaluate(() => setMode('all')); await page.waitForTimeout(100);
  await page.click('.cell[data-i="31"]'); await page.waitForSelector('#ceText');
  ok('goal editor: sub-goal has a notepad', !!(await page.$('#ceBook')) && await page.$eval('#ceBook', e => e.tagName === 'TEXTAREA'));
  await page.screenshot({ path: __dirname + '/shots/goal-edit.png' });
  await page.fill('#ceBook', 'Заметка к подцели 2'); await page.click('.modal [data-r="ok"]'); await page.waitForTimeout(120);
  ok('sub-goal notepad is saved to the block it heads (cell 31 → block 1)', await page.evaluate(() => activeMandala().notes[1] === 'Заметка к подцели 2' && activeMandala().notes[4].length > 100));
  await page.click('.cell[data-i="13"]'); await page.waitForSelector('#ceBook');
  ok('center of block 1 opens the same notepad', await page.$eval('#ceBook', e => e.value === 'Заметка к подцели 2'));
  await page.click('.modal [data-r="cancel"]'); await page.waitForTimeout(60);
  await page.click('.cell[data-i="30"]'); await page.waitForSelector('#ceBook');
  ok('core cell 30 is the sub-goal of block 0 (own empty notepad)', await page.$eval('#ceBook', e => e.value === '') && await page.evaluate(() => goalBlockOf(30) === 0 && goalBlockOf(40) === 4 && goalBlockOf(10) === 0 && goalBlockOf(50) === 8));
  await page.click('.modal [data-r="cancel"]'); await page.waitForTimeout(60);
  await page.click('.cell[data-i="40"]'); await page.waitForSelector('#ceBook');
  ok('main goal editor shows the core notepad', await page.$eval('#ceBook', e => e.value.length > 100));
  await page.click('.modal [data-r="cancel"]'); await page.waitForTimeout(60);
  await page.click('.cell[data-i="0"]'); await page.waitForSelector('#ceText');
  ok('task editor has no notepad', !(await page.$('#ceBook')) && await page.evaluate(() => goalBlockOf(0) === -1 && goalBlockOf(5) === -1));
  await page.click('.modal [data-r="cancel"]'); await page.waitForTimeout(60);
  await page.click('.cell[data-i="31"]'); await page.waitForSelector('#ceBook'); await page.fill('#ceBook', 'не сохранять'); await page.click('.modal [data-r="cancel"]'); await page.waitForTimeout(80);
  ok('cancel in the goal editor keeps the old notepad', await page.evaluate(() => activeMandala().notes[1] === 'Заметка к подцели 2'));
  await page.evaluate(() => setMode('block', 1)); await page.waitForTimeout(120);
  ok('block mode shows the note written in the goal editor', (await page.$eval('#bnTxt', e => e.textContent)) === 'Заметка к подцели 2');
  await page.evaluate(() => { setBlockNote(activeMandala(), 1, ''); setMode('all'); }); await page.waitForTimeout(100);

  // --- редактор ячейки: многострочное поле, длинный текст виден целиком ---
  await page.evaluate(() => setBlockNote(activeMandala(), 2, ''));
  const T80 = 'Разработать полноценное приложение с оплатой и аналитикой для первых клиентов';
  await page.click('.cell[data-i="41"]'); await page.waitForSelector('#ceText');
  ok('cell editor: wrapped textarea', await page.$eval('#ceText', e => e.tagName === 'TEXTAREA'));
  await page.fill('#ceText', T80); await page.screenshot({ path: __dirname + '/shots/cell-edit.png' });
  await page.fill('#ceText', 'строка1\nстрока2'); await page.waitForTimeout(40);
  ok('cell editor: pasted line break becomes a space', await page.$eval('#ceText', e => e.value === 'строка1 строка2'), await page.$eval('#ceText', e => e.value));
  await page.fill('#ceText', T80); await page.keyboard.press('Enter'); await page.waitForTimeout(120);
  ok('cell editor: Enter saves the cell', await page.evaluate(t => activeMandala().cells[41].text === t, T80) && !(await page.$('#ceText')));
  await editCell(39, 'Здоровье');
  await page.evaluate(() => setMode('block', 4)); await page.waitForTimeout(150);
  const fit = await page.evaluate(() => {
    const t = document.querySelector('.cell[data-i="41"] .t'), s = document.querySelector('.cell[data-i="39"] .t');
    return { l: t.dataset.l, over: t.scrollHeight - t.clientHeight, fs: parseFloat(getComputedStyle(t).fontSize), fs1: parseFloat(getComputedStyle(s).fontSize), sL: s.dataset.l };
  });
  ok('block mode: 78-char goal is shown whole (not cut with an ellipsis)', fit.l === '4' && fit.over <= 1, fit);
  ok('block mode: long text uses a smaller font than short text', fit.fs < fit.fs1 && fit.fs >= 10, fit);
  await page.screenshot({ path: __dirname + '/shots/notes-block-cells.png' });

  ok('no console errors', errors.length === 0, errors);
  console.log(pass + ' passed, ' + fail + ' failed');
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
