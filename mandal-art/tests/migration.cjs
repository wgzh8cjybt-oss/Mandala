// Перенос данных из старых версий (Grimdark: mandal_art_wh40k_v1, Cloud: mandal_art_v13) и восстановление после порчи
const { launch, URL } = require('./lib.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } };
const cells = list => { const a = Array.from({ length: 81 }, () => ({ text: '', completed: false })); list.forEach(([i, t, d]) => { a[i] = { text: t, completed: !!d }; }); return a; };
const GRIM = { activeId: 1, mandals: [{ id: 1, title: 'Моя цель', cells: cells([[40, 'Моя цель', false], [30, 'Спорт', true], [1, 'Бег 5 км', true], [2, 'Йога', false]]) }], xp: 120, flames: 7, activeTheme: 'wh40k', unlockedFigurines: ['wh_1', 'wh_2'], diary: { '1730000000000': { date: '27.10.2026, 10:00', text: 'Запись из Grimdark' } } };
const CLOUD = { activeId: 5, mandals: [
  { id: 5, title: 'Облачная цель', cells: cells([[40, 'Облачная цель', false], [30, 'Финансы', true], [31, 'Накопить', true], [32, 'Доход', true], [39, 'Работа', true], [41, 'Курс', true], [48, 'Сон', true], [49, 'Режим', true], [50, 'Спорт', true]]) },
  { id: 6, title: 'Вторая', cells: cells([[40, 'Вторая', false], [3, 'Чтение', true]]) }], xp: 400, flames: 30, activeTheme: 'purple',
  unlockedFigurines: ['wh_1', 'wh_2', 'wh_3', 'op_1', 'op_2', 'op_3', 'sc_1', 'sc_2', 'sc_3'],
  diary: { '1730500000000': { date: '02.11.2026, 12:00', text: 'Запись из Cloud' }, '1730000000000': { date: '27.10.2026, 10:00', text: 'Запись из Grimdark' } } };
const snap = () => ({ xp: S.xp, fl: S.flames, m: S.mandals.map(m => m.title), done: S.mandals.reduce((a, m) => a + m.cells.filter(c => c.completed).length, 0), diary: S.diary.map(d => d.text), relics: S.unlockedRelics.slice().sort(), themes: S.unlockedThemes.length, theme: S.activeTheme, from: S.meta.migratedFrom, awarded: S.mandals[0].cells.filter(c => c.completed && c.awarded).length, achFl: Object.keys(S.achievements).reduce((a, id) => a + (ACHIEVEMENTS.find(x => x.id === id) || { fl: 0 }).fl, 0), ach: Object.keys(S.achievements).length });
async function boot(storage) {
  const h = await launch({ storage, dsf: 1 });
  await h.page.goto(URL); await h.page.waitForTimeout(900);
  return h;
}
(async () => {
  // A. только Grimdark
  let h = await boot({ mandal_art_wh40k_v1: JSON.stringify(GRIM) });
  let s = await h.page.evaluate(snap);
  ok('A: Grimdark data migrated (xp, title, done cells); flames = old 7 + retro achievement rewards', s.xp === 120 && s.fl === 7 + s.achFl && s.achFl > 0 && s.m[0] === 'Моя цель' && s.done === 2, s);
  ok('A: legacy diary object -> array entry', s.diary.length === 1 && s.diary[0] === 'Запись из Grimdark', s.diary);
  ok('A: figurine ids became relics, old themes stay available', s.relics.join() === 'wh_1,wh_2' && s.themes === 7, s);
  ok('A: completed cells keep awarded flag (no double XP after migration)', s.awarded === 2, s.awarded);
  ok('A: migratedFrom recorded', s.from.join() === 'mandal_art_wh40k_v1', s.from);
  await h.page.waitForTimeout(400);
  const keys = await h.page.evaluate(() => ({ v14: !!localStorage.getItem('mandal_art_v14'), legacy: localStorage.getItem('mandal_art_wh40k_v1') }));
  ok('A: new key written, legacy key untouched', keys.v14 && keys.legacy === JSON.stringify(GRIM));
  // повторное открытие: новая запись, а не повторная миграция/дублирование
  await h.page.reload(); await h.page.waitForTimeout(700);
  s = await h.page.evaluate(snap);
  ok('A: reload keeps data without duplicating', s.xp === 120 && s.diary.length === 1 && s.m.length === 1, s);
  // завершение задачи после миграции: XP за уже выполненную ячейку не начисляется повторно
  const xpBefore = await h.page.evaluate(() => { const m = activeMandala(); applyCell(m, 30, m.cells[30].text, true); return S.xp; });
  ok('A: re-completing a migrated cell gives no XP', xpBefore === 120, xpBefore);
  ok('A: no console errors', h.errors.length === 0, h.errors);
  await h.browser.close();

  // B. обе старые версии сразу
  h = await boot({ mandal_art_wh40k_v1: JSON.stringify(GRIM), mandal_art_v13: JSON.stringify(CLOUD) });
  s = await h.page.evaluate(snap);
  ok('B: best save is the base (Cloud) with max XP and max flames (30) + retro achievement rewards', s.xp === 400 && s.fl === 30 + s.achFl && s.m[0] === 'Облачная цель', s);
  ok('B: other save appended as extra goal with source suffix', s.m.length === 3 && s.m.some(t => t.includes('Моя цель') && t.includes('Grimdark')), s.m);
  ok('B: diary union without duplicates', s.diary.length === 2, s.diary);
  ok('B: relics union (all 9)', s.relics.length === 9, s.relics);
  ok('B: both sources recorded', s.from.length === 2, s.from);
  const raw = await h.page.evaluate(() => [localStorage.getItem('mandal_art_wh40k_v1'), localStorage.getItem('mandal_art_v13')]);
  ok('B: legacy keys untouched', raw[0] === JSON.stringify(GRIM) && raw[1] === JSON.stringify(CLOUD));
  ok('B: no console errors', h.errors.length === 0, h.errors);
  await h.browser.close();

  // C. битый основной ключ + хорошая резервная копия
  const good = { schema: 2, xp: 777, flames: 21, activeId: 9, mandals: [{ id: 9, title: 'Из копии', cells: cells([[40, 'Из копии', false]]) }], diary: [], unlockedRelics: ['wh_1'], unlockedThemes: ['wh40k'], activeTheme: 'wh40k', meta: { welcome: true } };
  h = await boot({ mandal_art_v14: '{"xp": 5, broken', mandal_art_v14_bak: JSON.stringify({ ts: Date.now() - 1000, reason: 'auto', raw: JSON.stringify(good) }) });
  s = await h.page.evaluate(snap);
  const corrupt = await h.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('mandal_art_v14_corrupt_')).map(k => localStorage.getItem(k)));
  ok('C: corrupted main key -> restored from backup', s.xp === 777 && s.m[0] === 'Из копии', s);
  ok('C: corrupted raw data kept aside, not deleted', corrupt.length === 1 && corrupt[0].includes('broken'), corrupt);
  ok('C: user is told about the restore', await h.page.$$eval('.toast', t => t.some(x => x.textContent.includes('резервная копия'))));
  await h.browser.close();

  // D. всё сломано -> чистый профиль, без падения
  h = await boot({ mandal_art_v14: 'not json', mandal_art_v13: '[[[' });
  s = await h.page.evaluate(snap);
  ok('D: garbage everywhere -> fresh profile (250 XP, 15 flames), app alive', s.xp === 250 && s.fl === 15 && s.done === 0, s);
  ok('D: no uncaught errors', h.errors.length === 0, h.errors);
  await h.browser.close();

  // E. полностью новый пользователь
  h = await boot({});
  s = await h.page.evaluate(snap);
  ok('E: new user gets 250 XP / 15 flames per ТЗ + welcome dialog', s.xp === 250 && s.fl === 15 && (await h.page.$('.modal')) !== null, s);
  await h.browser.close();
  console.log(`RESULT pass=${pass} fail=${fail}`);
})();
