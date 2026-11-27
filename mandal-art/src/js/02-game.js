/* ============================================================
   02-game: правила игры (XP, огоньки, блоки, дневник, реликвии,
   темы, достижения, серия, сброс, импорт/экспорт)
   ============================================================ */
const Hooks = { xp() {}, level() {}, block() {}, main() {}, relic() {}, ach() {}, theme() {}, change() {}, saved() {} };

const levelIdx = xp => { let l = 0; CONFIG.ranks.forEach((r, i) => { if (xp >= r.xp) l = i; }); return l; };
function rankInfo(xp) {
  const i = levelIdx(xp), cur = CONFIG.ranks[i], nxt = CONFIG.ranks[i + 1];
  return { level: i + 1, name: rankName(i), from: cur.xp, to: nxt ? nxt.xp : null, pct: nxt ? (xp - cur.xp) / (nxt.xp - cur.xp) : 1 };
}
const activeMandala = () => S.mandals.find(m => String(m.id) === String(S.activeId)) || S.mandals[0];

/* --- геометрия мандалы: блоки 3×3, индекс = ряд*9 + колонка --- */
const blockOfIdx = i => Math.floor(Math.floor(i / 9) / 3) * 3 + Math.floor((i % 9) / 3);
function blockCells(b) {
  const br = Math.floor(b / 3), bc = b % 3, out = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push((br * 3 + r) * 9 + bc * 3 + c);
  return out;
}
const blockCenter = b => blockCells(b)[4];
// 8 подцелей центрального блока зеркалятся в центры 8 внешних блоков
const subMirrorTarget = idx => (blockOfIdx(idx) === 4 && idx !== 40) ? blockCenter(blockCells(4).indexOf(idx)) : -1;
const isLocked = (m, idx) => blockOfIdx(idx) !== 4 && !String(m.cells[40].text || '').trim();
function blockTitle(m, b) {
  if (b === 4) return 'Ядро · главная цель';
  const t = m.cells[blockCells(4)[b]].text;
  return t ? t : 'Сектор ' + (b + 1);
}
/* --- комментарий к блоку 3×3: просто текст, без XP (чтобы им нельзя было «фармить») --- */
const blockNote = (m, b) => (m && Array.isArray(m.notes) && m.notes[b]) || '';
function setBlockNote(m, b, text) {
  if (!(b >= 0 && b < 9)) return false;
  text = String(text == null ? '' : text).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, CONFIG.noteMax);
  if (!Array.isArray(m.notes)) m.notes = Array(9).fill('');
  if (m.notes[b] === text) return false;
  m.notes[b] = text; save(); Hooks.change();
  return true;
}

/* --- ресурсы --- */
function addXp(n, origin) {
  if (n <= 0) return;
  const before = levelIdx(S.xp);
  S.xp += n;
  const after = levelIdx(S.xp);
  Hooks.xp(n, origin);
  for (let l = before + 1; l <= after; l++) {
    S.flames += CONFIG.flamesLevel;
    Hooks.level(l + 1, rankName(l), CONFIG.flamesLevel, typeof figsAtRank === 'function' ? figsAtRank(l) : []);
  }
}
const addFlames = n => { S.flames += n; };
const markActivity = () => { const k = dayKey(); S.activity[k] = (S.activity[k] || 0) + 1; };

/* --- ячейки --- */
/** due: не передан — срок не трогаем; '' — убрать срок; 'ГГГГ-ММ-ДД' — поставить. dn (когда выполнена) ставится при выполнении и снимается при отмене. */
function applyCell(m, idx, text, completed, due) {
  text = String(text || '').trim().slice(0, CONFIG.cellMax);
  const c = m.cells[idx], prev = c.text, wasDone = !!c.completed, prevDue = c.due || '';
  const res = { xp: 0, newlyDone: false, blocks: [], main: false };
  c.text = text;
  c.completed = !!completed && text !== '';          // выполнить пустую ячейку нельзя
  if (idx === 40 && text) m.title = text.slice(0, CONFIG.titleMax);
  if (!text) due = '';
  if (due !== undefined) { if (isDay(due)) c.due = due; else delete c.due; }
  if (c.completed && !wasDone) c.dn = Date.now(); else if (!c.completed) delete c.dn;
  const t = subMirrorTarget(idx);
  if (t >= 0) {
    const tc = m.cells[t];
    if ((tc.text === '' || tc.text === prev) && !(tc.completed && !text)) tc.text = text;
    if (!tc.text) { tc.completed = false; delete tc.dn; delete tc.due; }
  }
  if (c.completed && !c.awarded) {                    // XP за ячейку — один раз за всё время
    c.awarded = true; res.newlyDone = true; res.xp = CONFIG.xpCell; markActivity();
  }
  if (c.completed) {
    const b = blockOfIdx(idx);
    if (!m.blockAwards[b] && blockCells(b).every(i => m.cells[i].completed)) { m.blockAwards[b] = true; res.blocks.push(b); }
    if (!m.mainAward && m.cells.every(x => x.completed)) { m.mainAward = true; res.main = true; }
  }
  if (res.xp) addXp(res.xp, { idx, kind: 'cell' });
  res.blocks.forEach(b => { addXp(CONFIG.xpBlock, { kind: 'block', block: b }); addFlames(CONFIG.flamesBlock); Hooks.block(b, CONFIG.xpBlock, CONFIG.flamesBlock); });
  if (res.main) { addXp(CONFIG.xpMain, { kind: 'main' }); addFlames(CONFIG.flamesMain); Hooks.main(CONFIG.xpMain, CONFIG.flamesMain); }
  if (c.completed && !wasDone) Stats.rec('c', m.id, idx);
  else if (!c.completed && wasDone) Stats.rec('u', m.id, idx);
  else if (text !== prev || (c.due || '') !== prevDue) Stats.rec(idx === 40 ? 'g' : 'e', m.id, idx);
  checkAchievements();
  save(); Hooks.change();
  return res;
}

/* --- мандалы --- */
function addMandala() {
  if (S.mandals.length >= CONFIG.maxMandals) return null;
  const m = newMandala('Цель #' + (S.mandals.length + 1));
  S.mandals.push(m); S.activeId = m.id;
  Stats.rec('n', m.id, -1);
  checkAchievements(); save(); Hooks.change();
  return m;
}
function deleteMandala(id) {
  if (S.mandals.length <= 1) return false;
  S.mandals = S.mandals.filter(m => String(m.id) !== String(id));
  if (!S.mandals.some(m => String(m.id) === String(S.activeId))) S.activeId = S.mandals[0].id;
  save(); Hooks.change();
  return true;
}
function switchMandala(id) {
  const m = S.mandals.find(x => String(x.id) === String(id));
  if (!m) return;
  S.activeId = m.id; Stats.open(m.id); save(); Hooks.change();
}

/* --- дневник --- */
const diaryQuota = () => Math.max(0, CONFIG.diaryXpPerDay - (S.diaryRewards[dayKey()] || 0));
function addDiary(text) {
  text = String(text || '').trim().slice(0, 2000);
  if (!text) return null;
  const ts = Date.now(); let id = ts;
  while (S.diary.some(e => e.id === id)) id++;
  const day = dayKey(ts), rewarded = (S.diaryRewards[day] || 0) < CONFIG.diaryXpPerDay;
  S.diary.unshift({ id, ts, date: fmtDate(ts), text, rewarded });
  markActivity();
  if (rewarded) { S.diaryRewards[day] = (S.diaryRewards[day] || 0) + 1; addXp(CONFIG.xpDiary, { kind: 'diary' }); }
  checkAchievements(); save(); Hooks.change();
  return { xp: rewarded ? CONFIG.xpDiary : 0, rewarded };
}
function deleteDiary(id) { S.diary = S.diary.filter(e => e.id !== id); save(); Hooks.change(); }

/* --- серия и статистика --- */
function streakInfo() {
  const a = S.activity, has = k => (a[k] || 0) > 0;
  let cur = 0; const d = new Date(); d.setHours(12, 0, 0, 0);
  if (!has(dayKey(d.getTime()))) d.setDate(d.getDate() - 1);          // сегодня ещё не отметились — серия жива
  while (has(dayKey(d.getTime()))) { cur++; d.setDate(d.getDate() - 1); }
  let best = 0, run = 0, prev = null;
  Object.keys(a).filter(k => a[k] > 0).sort().forEach(k => {
    const t = new Date(k + 'T12:00:00');
    run = (prev && Math.round((t - prev) / 864e5) === 1) ? run + 1 : 1;
    best = Math.max(best, run); prev = t;
  });
  return { cur, best: Math.max(best, cur), today: has(dayKey()), days: Object.keys(a).filter(k => a[k] > 0).length };
}
function statsOfMandala(m) {
  const blocks = Array.from({ length: 9 }, (_, b) => blockCells(b).filter(i => m.cells[i].completed).length);
  return { done: m.cells.filter(c => c.completed).length, blocks, blocksFull: blocks.filter(n => n === 9).length };
}
function totals() {
  let done = 0, blocksFull = 0, goals = 0;
  S.mandals.forEach(m => { const s = statsOfMandala(m); done += s.done; blocksFull += s.blocksFull; if (String(m.cells[40].text).trim()) goals++; });
  return {
    done, blocksFull, goals, diary: S.diary.length, relics: S.unlockedRelics.length, figs: typeof figOwnedCount === 'function' ? figOwnedCount() : 0, level: levelIdx(S.xp) + 1,
    streak: streakInfo().cur, mandals: S.mandals.length, full: S.mandals.some(m => m.cells.every(c => c.completed))
  };
}

/* --- достижения (награда — огоньки, один раз) --- */
const ACHIEVEMENTS = [
  { id: 'goal', ic: 'target', name: 'Цель определена', desc: 'Задайте главную цель в центре', fl: 1, t: t => t.goals >= 1 },
  { id: 'first', ic: 'sword', name: 'Первый сектор', desc: 'Выполните 1 задачу', fl: 1, t: t => t.done >= 1 },
  { id: 'd10', ic: 'shield', name: 'Десяток', desc: 'Выполните 10 задач', fl: 2, t: t => t.done >= 10 },
  { id: 'd40', ic: 'skull', name: 'Сорок секторов', desc: 'Выполните 40 задач', fl: 4, t: t => t.done >= 40 },
  { id: 'blk1', ic: 'gear', name: 'Блок зачищен', desc: 'Выполните все 9 ячеек блока', fl: 2, t: t => t.blocksFull >= 1 },
  { id: 'blk5', ic: 'relic', name: 'Пять блоков', desc: 'Зачистите 5 блоков', fl: 5, t: t => t.blocksFull >= 5 },
  { id: 'full', ic: 'crown', name: 'Мандала завершена', desc: 'Выполните все 81 ячейку', fl: 10, t: t => t.full },
  { id: 'dia1', ic: 'scroll', name: 'Первое донесение', desc: 'Запись в дневнике', fl: 1, t: t => t.diary >= 1 },
  { id: 'dia10', ic: 'book', name: 'Хронист', desc: '10 записей в дневнике', fl: 3, t: t => t.diary >= 10 },
  { id: 'dia30', ic: 'book', name: 'Архивариус', desc: '30 записей в дневнике', fl: 6, t: t => t.diary >= 30 },
  { id: 'st3', ic: 'flame', name: 'Три дня подряд', desc: 'Серия активности 3 дня', fl: 2, t: t => t.streak >= 3 },
  { id: 'st7', ic: 'flame', name: 'Неделя огня', desc: 'Серия 7 дней', fl: 5, t: t => t.streak >= 7 },
  { id: 'st30', ic: 'flame', name: 'Месяц несгибаемых', desc: 'Серия 30 дней', fl: 15, t: t => t.streak >= 30 },
  { id: 'rel2', ic: 'key', name: 'Хранитель', desc: 'Откройте 2 реликвии', fl: 2, t: t => t.relics >= 2 },
  { id: 'relall', ic: 'gem', name: 'Коллекционер', desc: 'Откройте все реликвии', fl: 10, t: t => t.relics >= RELICS.length },
  { id: 'fig1', ic: 'relic', name: 'Первая фигурка', desc: 'Получите любую фигурку-стенд', fl: 3, t: t => t.figs >= 1 },
  { id: 'fig4', ic: 'gem', name: 'Коллекция стендов', desc: 'Соберите 4 фигурки', fl: 6, t: t => t.figs >= 4 },
  { id: 'figall', ic: 'crown', name: 'Полная витрина', desc: 'Соберите все фигурки', fl: 15, t: t => FIGURES.length > 0 && FIGURES.every(f => figOwned(f.id)) },
  { id: 'lv3', ic: 'star', name: 'Ранг III', desc: 'Достигните 3 уровня', fl: 2, t: t => t.level >= 3 },
  { id: 'lv5', ic: 'star', name: 'Ранг V', desc: 'Достигните 5 уровня', fl: 4, t: t => t.level >= 5 },
  { id: 'lv10', ic: 'star', name: 'Ранг X', desc: 'Достигните 10 уровня', fl: 10, t: t => t.level >= 10 },
  { id: 'man2', ic: 'map', name: 'Два фронта', desc: 'Создайте вторую цель', fl: 1, t: t => t.mandals >= 2 }
];
function checkAchievements(silent) {
  const t = totals(), got = [];
  ACHIEVEMENTS.forEach(a => {
    if (!S.achievements[a.id] && a.t(t)) { S.achievements[a.id] = Date.now(); addFlames(a.fl); got.push(a); }
  });
  if (got.length) Hooks.ach(got, !!silent);
  return got;
}

/* --- реликвии и темы --- */
const relicStatus = r => S.unlockedRelics.includes(r.id) ? 'owned' : (S.xp >= r.minXp ? 'ready' : 'locked');
function unlockRelic(id, via) {
  const r = RELICS.find(x => x.id === id);
  if (!r || S.unlockedRelics.includes(id)) return { ok: false, reason: 'already' };
  if (via === 'flames') {
    if (!r.flames) return { ok: false, reason: 'noflames' };
    if (S.flames < r.flames) return { ok: false, reason: 'flames', need: r.flames };
    S.flames -= r.flames;
  } else if (S.xp < r.minXp) return { ok: false, reason: 'xp', need: r.minXp };
  S.unlockedRelics.push(id);
  checkAchievements(); save(); Hooks.relic(r); Hooks.change();
  return { ok: true, relic: r };
}
const themeById = id => THEMES.find(t => t.id === id);
function setTheme(id) {
  if (!themeById(id) || !S.unlockedThemes.includes(id)) return false;
  S.activeTheme = id; save(); Hooks.theme(id); Hooks.change();
  return true;
}
function buyTheme(id) {
  const t = themeById(id);
  if (!t || S.unlockedThemes.includes(id)) return { ok: false, reason: 'already' };
  if (S.flames < t.cost) return { ok: false, reason: 'flames', need: t.cost };
  S.flames -= t.cost; S.unlockedThemes.push(id); S.activeTheme = id;
  save(); Hooks.theme(id); Hooks.change();
  return { ok: true };
}

/* --- сброс / экспорт / импорт (всегда с копией «до») --- */
function resetAll() {
  backupNow('reset');
  const keep = S.settings;
  S = defaults(); S.settings = keep; S.meta.welcome = true;
  persistNow(); Hooks.theme(S.activeTheme); Hooks.change();
}
function restoreBackup() {
  try {
    const b = JSON.parse(Store.read(CONFIG.backupKey) || 'null');
    const st = b && b.raw && tryParse(b.raw, false);
    if (!st) return false;
    const keep = S.settings; S = st; S.settings = keep;
    persistNow(); Hooks.theme(S.activeTheme); Hooks.change();
    return true;
  } catch (e) { return false; }
}
function exportData() { return JSON.stringify({ app: 'mandal-art', schema: 2, exportedAt: Date.now(), data: S }); }
function parseImport(text) {
  let obj;
  try { obj = JSON.parse(String(text).trim()); } catch (e) { return { ok: false, reason: 'json' }; }
  let st = null;
  if (isObj(obj) && obj.app === 'mandal-art' && isObj(obj.data) && Array.isArray(obj.data.mandals)) st = normalizeState(obj.data, false);
  else if (isObj(obj) && obj.schema === 2 && Array.isArray(obj.mandals)) st = normalizeState(obj, false);
  else if (isObj(obj) && Array.isArray(obj.mandals)) st = normalizeState(obj, true);     // экспорт из старых версий
  if (!st) return { ok: false, reason: 'shape' };
  const cs = cellStat(st);
  return { ok: true, state: st, info: { xp: st.xp, done: cs.done, diary: st.diary.length, mandals: st.mandals.length } };
}
function importData(text) {
  const p = parseImport(text);
  if (!p.ok) return p;
  const st = p.state;
  backupNow('import');
  const keep = S.settings; S = st; S.settings = keep;
  persistNow(); checkAchievements(true); Hooks.theme(S.activeTheme); Hooks.change();
  return { ok: true, xp: S.xp };
}
