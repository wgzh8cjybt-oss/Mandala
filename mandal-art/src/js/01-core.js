'use strict';
/* ============================================================
   MANDAL-ART · WH40K GRIMDARK · v3
   01-core: конфиг, утилиты, хранение, миграция старых версий
   Все игровые числа — в CONFIG ниже.
   ============================================================ */
const CONFIG = {
  version: '3.0.0',
  storageKey: 'mandal_art_v14',
  backupKey: 'mandal_art_v14_bak',
  legacyKeys: ['mandal_art_v11', 'mandal_art_v12', 'mandal_art_v13', 'mandal_art_wh40k_v1'],
  cloudPrefix: 'ma14',
  // --- стартовые значения нового профиля (из ТЗ: 250 XP и 15 огоньков) ---
  startXp: 250,
  startFlames: 15,
  // --- XP ---
  xpCell: 15,          // за ячейку, один раз за всё время (раньше начислялось при каждом «Подтвердить»)
  xpDiary: 20,         // за запись в дневнике
  diaryXpPerDay: 3,    // сколько записей в день дают XP (защита от накрутки; поставьте 999, чтобы убрать)
  xpBlock: 30,         // бонус за полностью зачищенный блок 3×3
  xpMain: 200,         // бонус за все 81 ячейку одной мандалы
  // --- огоньки ---
  flamesBlock: 2, flamesLevel: 3, flamesMain: 20,
  defaultTheme: 'wh40k',
  maxMandals: 12,
  cellMax: 80,
  titleMax: 40,
  noteMax: 600,        // длина комментария к блоку 3×3
  // картинки реликвий: { wh_1: 'https://… или data:image/…' }; встроенные берутся из assets/relics при сборке
  relicImages: (typeof BUILTIN_RELIC_IMAGES === 'object' && BUILTIN_RELIC_IMAGES) || {},   // собирается из assets/relics (build.py)
  ranks: [
    { xp: 0, name: 'Послушник' }, { xp: 150, name: 'Аколит' }, { xp: 350, name: 'Скаут' },
    { xp: 650, name: 'Ветеран' }, { xp: 1050, name: 'Сержант' }, { xp: 1600, name: 'Капитан' },
    { xp: 2300, name: 'Инквизитор' }, { xp: 3200, name: 'Лорд-Командор' },
    { xp: 4400, name: 'Магистр Ордена' }, { xp: 6000, name: 'Властелин Мандалы' }
  ]
};

const THEMES = [
  { id: 'wh40k', name: 'WH40K', c: '#b45309', cost: 0, meta: '#05070a' },
  { id: 'purple', name: 'Фиолет', c: '#8b5cf6', cost: 0, meta: '#090514' },
  { id: 'cyan', name: 'Изумруд', c: '#10b981', cost: 0, meta: '#021a12' },
  { id: 'red', name: 'Алый', c: '#f43f5e', cost: 0, meta: '#2a020d' },
  { id: 'amber', name: 'Золото', c: '#f59e0b', cost: 0, meta: '#240a00' },
  { id: 'onepiece', name: 'One Piece', c: '#0ea5e9', cost: 10, meta: '#04202f' },
  { id: 'scrooge', name: 'Scrooge Gold', c: '#fbbf24', cost: 10, meta: '#160800' }
];
const FREE_THEMES = THEMES.filter(t => !t.cost).map(t => t.id);

// minXp — порог XP (XP не тратится), flames — альтернативная цена в огоньках
const UNIVERSES = { wh40k: 'Империум · WH40K', onepiece: 'Пиратские моря · One Piece', scrooge: 'Золотая лихорадка · Scrooge Gold' };
const RELICS = [
  { id: 'wh_1', uni: 'wh40k', name: 'Шлем Ветерана', desc: 'Реликвия Ордена', minXp: 0, flames: 0 },
  { id: 'wh_2', uni: 'wh40k', name: 'Боевой Шагоход', desc: 'Даже в смерти я служу долгу', minXp: 50, flames: 5 },
  { id: 'wh_3', uni: 'wh40k', name: 'Священный Клинок', desc: 'Воля человечества', minXp: 120, flames: 10 },
  { id: 'op_1', uni: 'onepiece', name: 'Соломенная Шляпа', desc: 'Сокровище морей', minXp: 300, flames: 8 },
  { id: 'op_2', uni: 'onepiece', name: 'Три Клинка', desc: 'Путь мечника', minXp: 450, flames: 12 },
  { id: 'op_3', uni: 'onepiece', name: 'Компас Странника', desc: 'Курс на мечту', minXp: 700, flames: 18 },
  { id: 'sc_1', uni: 'scrooge', name: 'Цилиндр Магната', desc: 'Сокровище магната', minXp: 900, flames: 15 },
  { id: 'sc_2', uni: 'scrooge', name: 'Золотой Сейф', desc: 'Богатство не спит', minXp: 1200, flames: 20 },
  { id: 'sc_3', uni: 'scrooge', name: 'Бриллиант', desc: 'Огранка упорства', minXp: 1600, flames: 30 }
];

/* ---------- утилиты ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rnd = (a, b) => a + Math.random() * (b - a);
let _uid = 0;
const uid = () => Date.now() * 100 + (_uid++ % 100);
const dayKey = (ts) => { const d = new Date(ts == null ? Date.now() : ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const fmtDate = ts => new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

/* ---------- семейства тем: иконки, подписи, ранги и «летуны» зависят от темы ----------
   wh — Warhammer 40K (и четыре цветовые палитры к нему), op — One Piece, sc — Scrooge Gold.
   Иконки — это SVG-маски (см. build.py / src/icons.py): <i class="ic" data-i="ключ">,
   рисунок выбирается классом fam-* на <body>. Эмодзи в интерфейсе не используются. */
const I = (k, cls) => '<i class="ic' + (cls ? ' ' + cls : '') + '" data-i="' + k + '" aria-hidden="true"></i>';
const THEME_FAM = { onepiece: 'op', scrooge: 'sc' };
const famOfTheme = id => THEME_FAM[id] || 'wh';
let FAM = 'wh';
const FAMS = {
  wh: {
    ranks: null,   // названия берутся из CONFIG.ranks
    nav: ['Мандала', 'Архив', 'Реликвии', 'Аналитика', 'Штаб'],
    diary: 'Журнал боевых донесений', diaryBtn: 'Внести в архивы', diaryEmpty: 'Архивы донесений пусты.', diaryPh: 'Опишите хроники текущего дня...',
    hall: 'Зал реликвий', relicsTab: 'Реликвии', figs: 'Фигурки', shopTab: 'Магазин', store: 'Серво-склад', themes: 'Темы оформления', ach: 'Достижения', status: 'Статус кампании',
    fx: 'Эффекты и звук', data: 'Архивы данных', about: 'О приложении', floaters: 'Сервочерепа на фоне', scenes: 'Сценки: поломка и ремонт черепа',
    levelKicker: 'НОВЫЙ РАНГ', relicNew: 'Реликвия обретена', relicOld: 'Священный артефакт',
    welcome: 'Добро пожаловать, Послушник', reset: 'Сбросить протоколы (очистить всё)', blockDone: 'Блок зачищен!', mainDone: 'Мандала завершена!'
  },
  op: {
    ranks: ['Юнга', 'Матрос', 'Боцман', 'Штурман', 'Первый помощник', 'Капитан', 'Суперновичок', 'Шичибукай', 'Йонко', 'Король пиратов'],
    nav: ['Карта', 'Журнал', 'Сокровища', 'Аналитика', 'Каюта'],
    diary: 'Судовой журнал', diaryBtn: 'Записать в журнал', diaryEmpty: 'Судовой журнал пока пуст.', diaryPh: 'Что случилось в плавании сегодня...',
    hall: 'Сокровищница', relicsTab: 'Сокровища', store: 'Трюм', themes: 'Флаги и паруса', ach: 'Награды за голову', status: 'Состояние экипажа',
    fx: 'Волны и звук', data: 'Сундук с картами', about: 'О корабле', floaters: 'Чайки на фоне',
    levelKicker: 'НОВАЯ НАГРАДА', relicNew: 'Сокровище найдено', relicOld: 'Сокровище морей',
    welcome: 'Добро пожаловать на борт, юнга', reset: 'Затопить корабль (очистить всё)', blockDone: 'Остров покорён!', mainDone: 'Гранд Лайн пройден!'
  },
  sc: {
    ranks: ['Копейка', 'Грош', 'Рубль', 'Купец', 'Делец', 'Банкир', 'Магнат', 'Миллионер', 'Олигарх', 'Золотой Король'],
    nav: ['План', 'Бухгалтерия', 'Сокровища', 'Аналитика', 'Контора'],
    diary: 'Бухгалтерская книга', diaryBtn: 'Внести в книгу', diaryEmpty: 'В книге пока нет записей.', diaryPh: 'Что принесло прибыль сегодня...',
    hall: 'Хранилище', relicsTab: 'Сокровища', store: 'Касса', themes: 'Оформление', ach: 'Золотые медали', status: 'Баланс кампании',
    fx: 'Блеск и звук', data: 'Сейф с данными', about: 'О компании', floaters: 'Монеты на фоне',
    levelKicker: 'НОВЫЙ ТИТУЛ', relicNew: 'Сокровище получено', relicOld: 'Золотая реликвия',
    welcome: 'Добро пожаловать в контору', reset: 'Обанкротиться (очистить всё)', blockDone: 'Сделка закрыта!', mainDone: 'Состояние собрано!'
  }
};
const T = k => { const f = FAMS[FAM]; return f[k] != null ? f[k] : FAMS.wh[k]; };
const rankName = i => { const f = FAMS[FAM]; return (f.ranks && f.ranks[i]) || CONFIG.ranks[i].name; };

/* ---------- безопасное хранилище ---------- */
const Store = {
  ok: true,
  read(k) { try { return localStorage.getItem(k); } catch (e) { this.ok = false; return null; } },
  write(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { this.ok = false; return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
};

/* ---------- модель данных ---------- */
/* Срок задачи хранится строкой «ГГГГ-ММ-ДД» (локальная дата, без времени). Проверяем, что такая дата существует в календаре. */
const isDay = v => {
  if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(v)) return false;
  const y = +v.slice(0, 4), m = +v.slice(5, 7), d = +v.slice(8, 10), t = new Date(y, m - 1, d);
  return y >= 2000 && y <= 2100 && t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
};
/* Журнал аналитики: days — сводки по дням (хранятся всегда), ev — последние события [время, тип, id мандалы, ячейка] (кольцо на 2500) */
const newStats = () => ({ v: 1, since: Date.now(), last: 0, days: {}, ev: [] });
function normStats(src) {
  const st = newStats();
  if (!isObj(src)) return st;
  const n = (v, mx) => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.min(Math.floor(v), mx || 1e13) : 0);
  st.since = n(src.since) || st.since; st.last = n(src.last);
  if (isObj(src.days)) Object.keys(src.days).slice(0, 4000).forEach(k => {
    const d = src.days[k]; if (!isDay(k) || !isObj(d)) return;
    st.days[k] = { v: n(d.v, 999), c: n(d.c, 999), u: n(d.u, 999), e: n(d.e, 9999), a: n(d.a, 999), t: n(d.t) };
  });
  if (Array.isArray(src.ev)) st.ev = src.ev.filter(e => Array.isArray(e) && typeof e[0] === 'number' && e[0] > 0 && typeof e[1] === 'string' && 'vocuegna'.indexOf(e[1]) >= 0 && e[1].length === 1)
    .slice(-2500).map(e => [Math.floor(e[0]), e[1], (typeof e[2] === 'number' || typeof e[2] === 'string') ? e[2] : 0, typeof e[3] === 'number' ? Math.floor(e[3]) : -1]);
  return st;
}
const newCells = () => Array.from({ length: 81 }, () => ({ text: '', completed: false, awarded: false }));
function newMandala(title) {
  return { id: uid(), title: title || 'Главная цель Империума', cells: newCells(), blockAwards: Array(9).fill(false), mainAward: false, notes: Array(9).fill(''), createdAt: Date.now() };
}
function defaults() {
  const m = newMandala('Главная цель Империума');
  return {
    schema: 2, ver: CONFIG.version, createdAt: Date.now(), updatedAt: Date.now(),
    xp: CONFIG.startXp, flames: CONFIG.startFlames,
    activeId: m.id, mandals: [m], diary: [],
    unlockedRelics: ['wh_1'], unlockedFigs: [], unlockedThemes: FREE_THEMES.slice(), activeTheme: CONFIG.defaultTheme,
    achievements: {}, activity: {}, diaryRewards: {},
    settings: { sound: true, haptics: true, fx: 'auto', look: 'auto', skulls: true, scenes: true, autoSync: true },
    meta: { lastPush: 0, lastPull: 0, syncedTs: 0, migratedFrom: [], welcome: false, figIntro: false },
    shopApplied: { fl: [] },   // номера уже зачисленных пачек огоньков из магазина (защита от повторного зачисления)
    stats: newStats()
  };
}

/* Приводит ЛЮБОЙ объект (старые версии, импорт, облако) к текущей схеме. Не бросает исключений. */
function normalizeState(src, legacy) {
  if (!isObj(src)) return null;
  const d = defaults();
  const out = d;
  const num = (v, def) => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.floor(v) : def);
  out.xp = num(src.xp, legacy ? 0 : CONFIG.startXp);
  out.flames = num(src.flames, legacy ? CONFIG.startFlames : CONFIG.startFlames);
  out.createdAt = num(src.createdAt, Date.now());
  out.updatedAt = num(src.updatedAt, Date.now());
  { const fl = isObj(src.shopApplied) && Array.isArray(src.shopApplied.fl) ? src.shopApplied.fl : []; out.shopApplied = { fl: Array.from(new Set(fl.filter(n => Number.isSafeInteger(n) && n > 0))).slice(-500) }; }

  const srcM = Array.isArray(src.mandals) ? src.mandals.filter(isObj) : [];
  const seen = new Set();
  const mandals = srcM.slice(0, 40).map(m => {
    let id = (typeof m.id === 'number' || typeof m.id === 'string') ? m.id : uid();
    while (seen.has(String(id))) id = uid();
    seen.add(String(id));
    const cells = newCells();
    const sc = Array.isArray(m.cells) ? m.cells : [];
    for (let i = 0; i < 81; i++) {
      const c = sc[i];
      if (!isObj(c)) continue;
      const text = String(c.text == null ? '' : c.text).slice(0, CONFIG.cellMax);
      const completed = !!c.completed && text.trim() !== '';
      cells[i] = { text, completed, awarded: c.awarded != null ? !!c.awarded : !!c.completed };
      if (text && isDay(c.due)) cells[i].due = c.due;                                   // срок (ГГГГ-ММ-ДД)
      if (completed && typeof c.dn === 'number' && isFinite(c.dn) && c.dn > 0) cells[i].dn = Math.floor(c.dn);   // когда отмечена выполненной
    }
    const ba = Array.isArray(m.blockAwards) ? m.blockAwards.slice(0, 9).map(Boolean) : [];
    while (ba.length < 9) ba.push(false);
    // комментарии к блокам: в старых данных их нет — подставляем пустые
    const notes = Array.from({ length: 9 }, (_, i) => (Array.isArray(m.notes) && m.notes[i] != null ? String(m.notes[i]).replace(/\r\n?/g, '\n').slice(0, CONFIG.noteMax) : ''));
    return { id, title: String(m.title || '').slice(0, 60) || 'Главная цель Империума', cells, blockAwards: ba, mainAward: !!m.mainAward, notes, createdAt: num(m.createdAt, Date.now()) };
  });
  if (mandals.length) out.mandals = mandals;
  out.activeId = out.mandals.some(m => String(m.id) === String(src.activeId)) ? out.mandals.find(m => String(m.id) === String(src.activeId)).id : out.mandals[0].id;

  // дневник: старый формат — объект {timestamp: {date,text}}, новый — массив
  let diary = [];
  if (Array.isArray(src.diary)) diary = src.diary.filter(isObj).map(e => ({ id: e.id, ts: e.ts, date: e.date, text: e.text, rewarded: e.rewarded }));
  else if (isObj(src.diary)) diary = Object.keys(src.diary).map(k => ({ id: Number(k), ts: Number(k), date: src.diary[k] && src.diary[k].date, text: src.diary[k] && src.diary[k].text, rewarded: true }));
  const dIds = new Set();
  out.diary = diary.filter(e => e.text != null && String(e.text).trim() !== '').map(e => {
    let id = Number(e.id) || Number(e.ts) || uid();
    while (dIds.has(id)) id++;
    dIds.add(id);
    const ts = Number(e.ts) || id;
    return { id, ts, date: String(e.date || fmtDate(ts)), text: String(e.text).slice(0, 2000), rewarded: e.rewarded !== false };
  }).sort((a, b) => b.ts - a.ts).slice(0, 2000);

  const knownRelic = new Set(RELICS.map(r => r.id));
  const ur = (Array.isArray(src.unlockedRelics) ? src.unlockedRelics : Array.isArray(src.unlockedFigurines) ? src.unlockedFigurines : []).filter(id => knownRelic.has(id));
  out.unlockedRelics = Array.from(new Set(['wh_1'].concat(ur)));
  // фигурки-стенды: только безопасные идентификаторы, без повторов (какие из них известны этой сборке — решает витрина)
  out.unlockedFigs = Array.from(new Set((Array.isArray(src.unlockedFigs) ? src.unlockedFigs : []).filter(id => typeof id === 'string' && /^[a-z][a-z0-9_]{1,31}$/.test(id)))).slice(0, 60);

  const knownTheme = new Set(THEMES.map(t => t.id));
  let ut = Array.isArray(src.unlockedThemes) ? src.unlockedThemes.filter(id => knownTheme.has(id)) : FREE_THEMES.slice();
  if (legacy) ut = THEMES.map(t => t.id);   // в старых версиях все темы были доступны — доступ сохраняем
  out.unlockedThemes = Array.from(new Set(FREE_THEMES.concat(ut)));
  out.activeTheme = knownTheme.has(src.activeTheme) && out.unlockedThemes.includes(src.activeTheme) ? src.activeTheme : CONFIG.defaultTheme;

  if (isObj(src.achievements)) Object.keys(src.achievements).forEach(k => { if (typeof src.achievements[k] === 'number') out.achievements[k] = src.achievements[k]; });
  if (isObj(src.activity)) Object.keys(src.activity).forEach(k => { if (/^\d{4}-\d\d-\d\d$/.test(k)) out.activity[k] = num(src.activity[k], 0); });
  if (isObj(src.diaryRewards)) Object.keys(src.diaryRewards).forEach(k => { if (/^\d{4}-\d\d-\d\d$/.test(k)) out.diaryRewards[k] = num(src.diaryRewards[k], 0); });
  // активность по датам записей дневника (для настоящего стрика)
  out.diary.forEach(e => { const k = dayKey(e.ts); if (!out.activity[k]) out.activity[k] = 1; });
  if (isObj(src.settings)) {
    const s = src.settings;
    if (typeof s.sound === 'boolean') out.settings.sound = s.sound;
    if (typeof s.haptics === 'boolean') out.settings.haptics = s.haptics;
    if (typeof s.skulls === 'boolean') out.settings.skulls = s.skulls;
    if (typeof s.scenes === 'boolean') out.settings.scenes = s.scenes;
    if (typeof s.autoSync === 'boolean') out.settings.autoSync = s.autoSync;
    if (['auto', 'full', 'lite', 'off'].includes(s.fx)) out.settings.fx = s.fx;
    if (['auto', 'glass', 'metal', 'classic'].includes(s.look)) out.settings.look = s.look;
  }
  if (isObj(src.meta)) {
    out.meta.lastPush = num(src.meta.lastPush, 0); out.meta.lastPull = num(src.meta.lastPull, 0); out.meta.syncedTs = num(src.meta.syncedTs, 0);
    out.meta.welcome = !!src.meta.welcome; out.meta.figIntro = !!src.meta.figIntro;
    if (Array.isArray(src.meta.migratedFrom)) out.meta.migratedFrom = src.meta.migratedFrom.filter(x => typeof x === 'string').slice(0, 8);
  }
  out.stats = normStats(src.stats);
  return out;
}

/* ---------- миграция из старых ключей ---------- */
const cellStat = s => s.mandals.reduce((a, m) => { m.cells.forEach(c => { if (c.completed) a.done++; if (c.text) a.filled++; }); return a; }, { done: 0, filled: 0 });
const hasContent = s => { const c = cellStat(s); return c.done > 0 || c.filled > 0 || s.diary.length > 0 || s.xp > 0; };
const scoreOf = s => { const c = cellStat(s); return s.xp + c.done * 15 + c.filled + s.diary.length * 20; };
const sigOf = m => m.cells.map(c => (c.text || '') + (c.completed ? '1' : '0')).join('|');
const srcName = k => ({ mandal_art_wh40k_v1: 'Grimdark', mandal_art_v13: 'Cloud', mandal_art_v12: 'v12', mandal_art_v11: 'v11' }[k] || k);

function readLegacy() {
  const list = [];
  CONFIG.legacyKeys.forEach(key => {
    const raw = Store.read(key);
    if (!raw) return;
    let obj; try { obj = JSON.parse(raw); } catch (e) { return; }
    const n = normalizeState(obj, true);
    if (!n) return;
    n._src = key; n._score = scoreOf(n);
    list.push(n);
  });
  return list;
}
function mergeLegacy(list) {
  const items = list.filter(hasContent).sort((a, b) => b._score - a._score);
  if (!items.length) return null;
  const base = items[0];
  items.slice(1).forEach(o => {
    const ids = new Set(base.diary.map(d => d.id));
    o.diary.forEach(d => { if (!ids.has(d.id)) base.diary.push(d); });
    base.diary.sort((a, b) => b.ts - a.ts);
    o.unlockedRelics.forEach(id => { if (!base.unlockedRelics.includes(id)) base.unlockedRelics.push(id); });
    base.xp = Math.max(base.xp, o.xp);
    base.flames = Math.max(base.flames, o.flames);
    o.mandals.forEach(m => {
      if (!m.cells.some(c => c.text || c.completed)) return;
      if (base.mandals.some(b => sigOf(b) === sigOf(m))) return;
      m.title = (m.title + ' · ' + srcName(o._src)).slice(0, 60);
      m.id = uid();
      base.mandals.push(m);
    });
  });
  base.meta.migratedFrom = items.map(x => x._src);
  delete base._src; delete base._score;
  return base;
}

/* ---------- загрузка / сохранение ---------- */
function tryParse(raw, legacy) { try { return normalizeState(JSON.parse(raw), legacy); } catch (e) { return null; } }

function loadState() {
  const raw = Store.read(CONFIG.storageKey);
  if (raw) {
    const st = tryParse(raw, false);
    if (st) return { state: st, how: 'v14' };
    Store.write(CONFIG.storageKey + '_corrupt_' + Date.now(), raw);          // битые данные не теряем
    const bak = Store.read(CONFIG.backupKey);
    if (bak) { try { const b = JSON.parse(bak); const st2 = b && b.raw && tryParse(b.raw, false); if (st2) return { state: st2, how: 'backup' }; } catch (e) { /* ignore */ } }
  }
  const merged = mergeLegacy(readLegacy());
  if (merged) { merged.meta.welcome = false; return { state: merged, how: 'migrated' }; }
  return { state: defaults(), how: 'new' };
}

let S = null;
let _saveT = 0, _lastBackup = 0;
function persistNow(keepTs) {
  if (!S) return false;
  if (!keepTs) S.updatedAt = Date.now();
  S.ver = CONFIG.version;
  const json = JSON.stringify(S);
  // авто-копия предыдущего состояния не чаще раза в 6 часов
  const prev = Store.read(CONFIG.storageKey);
  const now = Date.now();
  if (prev && now - _lastBackup > 6 * 3600e3) {
    let ts = 0; try { ts = (JSON.parse(Store.read(CONFIG.backupKey) || '{}').ts) || 0; } catch (e) { /* ignore */ }
    if (now - ts > 6 * 3600e3) Store.write(CONFIG.backupKey, JSON.stringify({ ts: now, reason: 'auto', raw: prev }));
    _lastBackup = now;
  }
  const ok = Store.write(CONFIG.storageKey, json);
  clearTimeout(_saveT); _saveT = 0;
  if (!keepTs && typeof Hooks !== 'undefined' && Hooks.saved) Hooks.saved(ok);
  return ok;
}
function save() { if (!_saveT) _saveT = setTimeout(persistNow, 120); }
function backupNow(reason) {
  try { Store.write(CONFIG.backupKey, JSON.stringify({ ts: Date.now(), reason: reason || 'manual', raw: JSON.stringify(S) })); _lastBackup = Date.now(); } catch (e) { /* ignore */ }
}
function readBackupInfo() {
  try { const b = JSON.parse(Store.read(CONFIG.backupKey) || 'null'); if (!b || !b.raw) return null; const st = tryParse(b.raw, false); return st ? { ts: b.ts, reason: b.reason, xp: st.xp, cells: cellStat(st).done, diary: st.diary.length } : null; } catch (e) { return null; }
}
window.addEventListener('pagehide', () => { if (_saveT) persistNow(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && _saveT) persistNow(); });
