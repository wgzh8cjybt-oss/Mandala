// Каталог товаров: категории, типы прав, проверка полей, стартовый набор, доступность для пользователя.
import { all, one, run, tx } from './db.js';
import { audit, getSetting, setSetting } from './ctx.js';
import { HttpError, isInt, isPlainObject, jsonParse } from './util.js';

export const CATEGORIES = [
  { id: 'slots', title: 'Слоты мандал' },
  { id: 'universes', title: 'Вселенные' },
  { id: 'wh40k', title: 'Warhammer 40,000' },
  { id: 'onepiece', title: 'One Piece' },
  { id: 'backgrounds', title: 'Фоны' },
  { id: 'animated', title: 'Анимированные фоны' },
  { id: 'effects', title: 'Эффекты' },
  { id: 'characters', title: 'Персонажи и коллекции' },
  { id: 'rewards', title: 'Награды' },
  { id: 'features', title: 'Функции' }
];
export const KINDS = ['slot', 'universe', 'background', 'animated_bg', 'effect', 'relic', 'figure', 'flames', 'feature'];
export const RIGHTS = ['own', 'licensed', 'pending'];   // pending = права на изображения не подтверждены
export const STATUSES = ['active', 'hidden', 'soldout', 'archived'];
export const FAMILIES = ['', 'wh', 'op', 'sc'];
export const MAX_PRICE_STARS = 10000;   // ограничение приложения (не Telegram): защита от опечаток в цене

// Что умеет клиент. Новые значения требуют обновления клиента.
export const BUILTIN_THEMES = ['wh40k', 'purple', 'cyan', 'red', 'amber', 'onepiece', 'scrooge'];
export const BUILTIN_RELICS = ['wh_1', 'wh_2', 'wh_3', 'op_1', 'op_2', 'op_3', 'sc_1', 'sc_2', 'sc_3'];
export const BG_PRESETS = ['forge', 'abyss', 'vault', 'nebula'];
export const ANIM_PRESETS = ['embers', 'waves', 'shimmer', 'aurora'];
export const EFFECT_PRESETS = ['sparks', 'spray', 'coinrain', 'confetti'];
export const FEATURES = ['export_png', 'year_heatmap'];
// Разрешённые CSS-переменные для собственных вселенных (см. стили клиента). Значения — только цвета.
export const PALETTE_VARS = ['--bg1', '--bg2', '--bg-glow', '--accent', '--accent-2', '--accent-hover', '--glow', '--accent-soft', '--accent-soft2', '--panel', '--border', '--border-soft', '--text-accent', '--done-bg', '--done-text', '--done-border', '--eye', '--meta'];

const COLOR_RE = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d{1,3})\s*)?\))$/;
const SLUG_RE = /^[a-z][a-z0-9_]{1,47}$/;

const bad = msg => new HttpError(400, 'bad_product', msg);
const oneOf = (v, list, name) => { if (!list.includes(v)) throw bad(`${name}: допустимо ${list.join(', ') || '(пусто)'}`); return v; };

/** Ссылка на медиа: загруженный файл (/media/…) или абсолютный https. Никаких data:/javascript:. */
export function checkUrl(u, name) {
  if (u == null || u === '') return null;
  if (typeof u !== 'string' || u.length > 500) throw bad(`${name}: слишком длинная ссылка`);
  if (/^\/media\/[A-Za-z0-9_-]{8,64}\.(png|jpg|webp|gif|webm|mp4)$/.test(u)) return u;
  if (/^\/art\/[a-z0-9_/-]{2,80}\.(png|jpg|webp|gif)$/.test(u)) return u;   // встроенные в сервер картинки (public/art)
  if (/^https:\/\/[^\s"'<>\\]+$/i.test(u)) return u;
  throw bad(`${name}: допустима загруженная в админке картинка (/media/…) или https-ссылка`);
}
const dim = v => { const n = v == null ? 0.35 : Number(v); if (!(n >= 0 && n <= 0.85)) throw bad('dim: число от 0 до 0.85'); return Math.round(n * 100) / 100; };

/** Проверка и нормализация grant для типа права. Возвращает «чистый» объект. */
export function validateGrant(kind, g) {
  if (!isPlainObject(g)) throw bad('grant: ожидается объект');
  switch (kind) {
    case 'slot': {
      if (!isInt(g.slots) || g.slots < 1 || g.slots > 5) throw bad('grant.slots: целое 1–5');
      return { slots: g.slots };
    }
    case 'flames': {
      if (!isInt(g.flames) || g.flames < 1 || g.flames > 100000) throw bad('grant.flames: целое 1–100000');
      return { flames: g.flames };
    }
    case 'feature': return { feature: oneOf(g.feature, FEATURES, 'grant.feature') };
    case 'effect': return { preset: oneOf(g.preset, EFFECT_PRESETS, 'grant.preset') };
    case 'background': case 'animated_bg': {
      const presets = kind === 'background' ? BG_PRESETS : ANIM_PRESETS;
      if (g.mode === 'css') return { mode: 'css', preset: oneOf(g.preset, presets, 'grant.preset') };
      const url = checkUrl(g.url, 'grant.url');
      if (g.mode !== (kind === 'background' ? 'image' : 'video') || !url) throw bad(`grant: mode "css" (preset) или "${kind === 'background' ? 'image' : 'video'}" (url)`);
      if (kind === 'background' && !/\.(png|jpg|webp|gif)$|^https:/i.test(url)) throw bad('grant.url: для фона нужна картинка');
      if (kind === 'animated_bg' && !/\.(webm|mp4|gif|webp)$|^https:/i.test(url)) throw bad('grant.url: для анимации нужно видео/gif/webp');
      return { mode: g.mode, url, dim: dim(g.dim) };
    }
    case 'universe': {
      if (g.builtin !== undefined) return { builtin: oneOf(g.builtin, BUILTIN_THEMES, 'grant.builtin') };
      const c = g.custom;
      if (!isPlainObject(c)) throw bad('grant: builtin (готовая тема) или custom (своя вселенная)');
      if (typeof c.id !== 'string' || !/^[a-z][a-z0-9_]{1,23}$/.test(c.id) || BUILTIN_THEMES.includes(c.id)) throw bad('custom.id: 2–24 символа a-z0-9_, не совпадает со встроенными темами');
      if (typeof c.name !== 'string' || !c.name.trim() || c.name.length > 24) throw bad('custom.name: 1–24 символа');
      const family = oneOf(c.family, ['wh', 'op', 'sc'], 'custom.family');
      if (!isPlainObject(c.palette)) throw bad('custom.palette: объект переменная → цвет');
      const palette = {};
      for (const [k, v] of Object.entries(c.palette)) {
        if (!PALETTE_VARS.includes(k)) throw bad(`custom.palette: переменная ${k} не разрешена`);
        if (typeof v !== 'string' || !COLOR_RE.test(v)) throw bad(`custom.palette.${k}: цвет #rgb/#rrggbb/rgba()`);
        palette[k] = v;
      }
      for (const need of ['--accent', '--accent-2', '--bg1', '--bg2']) if (!palette[need]) throw bad(`custom.palette: обязательна переменная ${need}`);
      if (!palette['--meta']) palette['--meta'] = palette['--bg2'];
      return { custom: { id: c.id, name: c.name.trim(), family, palette } };
    }
    case 'relic': {
      if (g.relics !== undefined) {
        if (!Array.isArray(g.relics) || !g.relics.length || g.relics.length > 9) throw bad('grant.relics: список 1–9 id реликвий');
        for (const r of g.relics) oneOf(r, BUILTIN_RELICS, 'grant.relics');
        return { relics: Array.from(new Set(g.relics)) };
      }
      const c = g.custom;
      if (!isPlainObject(c)) throw bad('grant: relics (готовые) или custom (своя реликвия)');
      if (typeof c.id !== 'string' || !/^[a-z][a-z0-9_]{1,23}$/.test(c.id) || BUILTIN_RELICS.includes(c.id)) throw bad('custom.id: 2–24 символа a-z0-9_, не совпадает со встроенными');
      if (typeof c.name !== 'string' || !c.name.trim() || c.name.length > 40) throw bad('custom.name: 1–40 символов');
      const desc = c.desc == null ? '' : String(c.desc);
      if (desc.length > 120) throw bad('custom.desc: до 120 символов');
      return { custom: { id: c.id, name: c.name.trim(), desc, family: oneOf(c.family || 'wh', ['wh', 'op', 'sc'], 'custom.family'), art_url: checkUrl(c.art_url, 'custom.art_url') } };
    }
    case 'figure': {
      const f = g.figure;
      if (!isPlainObject(f)) throw bad('grant.figure: объект фигурки');
      if (typeof f.id !== 'string' || !/^[a-z][a-z0-9_]{1,31}$/.test(f.id)) throw bad('figure.id: 2–32 символа a-z0-9_');
      if (typeof f.name !== 'string' || !f.name.trim() || f.name.length > 40) throw bad('figure.name: 1–40 символов');
      const family = oneOf(f.family || 'wh', ['wh', 'op', 'sc'], 'figure.family');
      const mode = oneOf(f.mode || 'standee', ['standee', 'frames'], 'figure.mode');
      const glow = f.glow == null || f.glow === '' ? null : (COLOR_RE.test(String(f.glow)) ? String(f.glow) : (() => { throw bad('figure.glow: цвет #rrggbb'); })());
      if (mode === 'standee') return { figure: { id: f.id, name: f.name.trim(), family, mode, url: checkUrl(f.url, 'figure.url') || (() => { throw bad('figure.url обязателен'); })(), glow } };
      if (!Array.isArray(f.frames) || f.frames.length < 8 || f.frames.length > 72) throw bad('figure.frames: от 8 до 72 кадров (по кругу)');
      return { figure: { id: f.id, name: f.name.trim(), family, mode, frames: f.frames.map((u, i) => checkUrl(u, 'figure.frames[' + i + ']')), glow } };
    }
    default: throw bad('неизвестный тип права: ' + kind);
  }
}

/** Проверка входных полей товара. При создании нужны все поля; при обновлении — только переданные. */
export function normalizeProduct(input, { create }) {
  if (!isPlainObject(input)) throw bad('ожидается объект');
  const o = {};
  const has = k => input[k] !== undefined;
  if (create) { if (typeof input.id !== 'string' || !SLUG_RE.test(input.id)) throw bad('id: латиница a-z, цифры, _ (2–48 символов, начинается с буквы)'); o.id = input.id; }
  if (create || has('category')) o.category = oneOf(input.category, CATEGORIES.map(c => c.id), 'category');
  if (create || has('kind')) o.kind = oneOf(input.kind, KINDS, 'kind');
  if (create || has('title')) { const t = String(input.title ?? '').trim(); if (!t || t.length > 60) throw bad('title: 1–60 символов'); o.title = t; }
  if (create || has('description')) { const d = String(input.description ?? '').trim(); if (d.length > 255) throw bad('description: до 255 символов'); o.description = d; }
  if (create || has('price_stars')) { if (!isInt(input.price_stars) || input.price_stars < 1 || input.price_stars > MAX_PRICE_STARS) throw bad(`price_stars: целое 1–${MAX_PRICE_STARS}`); o.price_stars = input.price_stars; }
  if (has('status')) o.status = oneOf(input.status, STATUSES, 'status'); else if (create) o.status = 'active';
  if (has('family')) o.family = oneOf(input.family || '', FAMILIES, 'family'); else if (create) o.family = '';
  if (has('rights_status')) o.rights_status = oneOf(input.rights_status, RIGHTS, 'rights_status'); else if (create) o.rights_status = 'own';
  if (has('preview_url')) o.preview_url = checkUrl(input.preview_url, 'preview_url'); else if (create) o.preview_url = null;
  if (has('max_per_user')) { if (!isInt(input.max_per_user) || input.max_per_user < 0 || input.max_per_user > 1000) throw bad('max_per_user: целое 0–1000 (0 = без ограничения)'); o.max_per_user = input.max_per_user; } else if (create) o.max_per_user = 1;
  if (has('sort')) { if (!isInt(input.sort) || Math.abs(input.sort) > 100000) throw bad('sort: целое'); o.sort = input.sort; } else if (create) o.sort = 100;
  if (create || has('grant')) o.grant = input.grant;   // проверяется ниже вместе с kind
  return o;
}

const rowToProduct = r => r && ({
  id: r.id, category: r.category, kind: r.kind, title: r.title, description: r.description, family: r.family, rights_status: r.rights_status,
  preview_url: r.preview_url, price_stars: r.price_stars, status: r.status, grant: jsonParse(r.grant_json, {}),
  max_per_user: r.max_per_user, sort: r.sort, created_at: r.created_at, updated_at: r.updated_at
});

export const getProduct = (ctx, id) => rowToProduct(one(ctx.db, 'SELECT * FROM products WHERE id = ?', id));
export const listAllProducts = ctx => all(ctx.db, 'SELECT * FROM products ORDER BY category, sort, id').map(rowToProduct);

export function createProduct(ctx, input, actor) {
  const o = normalizeProduct(input, { create: true });
  o.grant = validateGrant(o.kind, o.grant);
  return tx(ctx.db, () => {
    if (one(ctx.db, 'SELECT 1 FROM products WHERE id = ?', o.id)) throw new HttpError(409, 'exists', 'Товар с таким id уже есть');
    const t = ctx.now();
    run(ctx.db, `INSERT INTO products(id, category, kind, title, description, family, rights_status, preview_url, price_stars, status, grant_json, max_per_user, sort, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, o.id, o.category, o.kind, o.title, o.description, o.family, o.rights_status, o.preview_url, o.price_stars, o.status, JSON.stringify(o.grant), o.max_per_user, o.sort, t, t);
    audit(ctx, actor, 'product.create', o.id, { price_stars: o.price_stars, kind: o.kind });
    return getProduct(ctx, o.id);
  });
}

export function updateProduct(ctx, id, input, actor) {
  const o = normalizeProduct(input, { create: false });
  return tx(ctx.db, () => {
    const cur = getProduct(ctx, id);
    if (!cur) throw new HttpError(404, 'not_found', 'Товар не найден');
    const next = { ...cur, ...o };
    if (o.kind && o.kind !== cur.kind && one(ctx.db, 'SELECT 1 FROM entitlements WHERE product_id = ?', id)) throw new HttpError(409, 'kind_locked', 'Тип права нельзя менять у товара, который уже покупали или выдавали');
    next.grant = validateGrant(next.kind, o.grant !== undefined ? o.grant : cur.grant);
    run(ctx.db, `UPDATE products SET category=?, kind=?, title=?, description=?, family=?, rights_status=?, preview_url=?, price_stars=?, status=?, grant_json=?, max_per_user=?, sort=?, updated_at=? WHERE id=?`,
      next.category, next.kind, next.title, next.description, next.family, next.rights_status, next.preview_url, next.price_stars, next.status, JSON.stringify(next.grant), next.max_per_user, next.sort, ctx.now(), id);
    const changes = {};
    for (const k of Object.keys(o)) if (JSON.stringify(o[k]) !== JSON.stringify(cur[k])) changes[k] = { from: cur[k], to: o[k] };
    audit(ctx, actor, cur.price_stars !== next.price_stars ? 'product.price' : 'product.update', id, changes);
    return getProduct(ctx, id);
  });
}

/* ---------------- доступность для конкретного пользователя ---------------- */
export const shopEnabled = ctx => getSetting(ctx, 'shop_enabled', '1') === '1';
export const isAdminId = (ctx, tgId) => ctx.cfg.adminIds.has(tgId);
/** Товары с неподтверждёнными правами (rights_status = pending) видят и покупают только администраторы, пока владелец явно не откроет их всем. */
export const rightsVisible = (ctx, tgId, product) => product.rights_status !== 'pending' || isAdminId(ctx, tgId) || getSetting(ctx, 'public_pending_rights', '0') === '1';

/** Сколько активных прав на этот товар у пользователя. */
export const ownedCount = (ctx, tgId, productId) =>
  one(ctx.db, "SELECT COUNT(*) AS n FROM entitlements WHERE tg_id = ? AND product_id = ? AND status = 'active' AND source != 'refund_debit'", tgId, productId).n;

export const extraSlots = (ctx, tgId) => {
  const rows = all(ctx.db, "SELECT grant_json FROM entitlements WHERE tg_id = ? AND kind = 'slot' AND status = 'active'", tgId);
  return rows.reduce((s, r) => s + (jsonParse(r.grant_json, {}).slots || 0), 0);
};

/** Ограничения владения (без учёта статуса товара): null или машинный код причины. */
export function limitCheck(ctx, tgId, product) {
  if (product.max_per_user > 0 && ownedCount(ctx, tgId, product.id) >= product.max_per_user) return 'owned';
  if (product.kind === 'slot' && 1 + extraSlots(ctx, tgId) + (product.grant.slots || 0) > ctx.cfg.maxSlots) return 'slot_limit';
  return null;
}

/** {can, reason}: reason — машинный код для клиента. */
export function availability(ctx, tgId, product) {
  if (!shopEnabled(ctx)) return { can: false, reason: 'shop_paused' };
  if (product.status !== 'active') return { can: false, reason: product.status === 'soldout' ? 'soldout' : 'unavailable' };
  if (!rightsVisible(ctx, tgId, product)) return { can: false, reason: 'unavailable' };
  const r = limitCheck(ctx, tgId, product);
  return r ? { can: false, reason: r } : { can: true };
}

export const REASON_TEXT = {
  shop_paused: 'Магазин временно закрыт.', soldout: 'Товар закончился.', unavailable: 'Товар недоступен.',
  owned: 'Этот товар у вас уже есть.', slot_limit: 'Достигнут максимум слотов мандал.'
};

/** Публичный каталог. Для авторизованного пользователя добавляет owned/can_buy. */
export function publicCatalog(ctx, tgId) {
  const rows = listAllProducts(ctx).filter(p => (p.status === 'active' || p.status === 'soldout') && rightsVisible(ctx, tgId, p));
  return rows.map(p => {
    const out = { id: p.id, category: p.category, kind: p.kind, title: p.title, description: p.description, family: p.family, rights_status: p.rights_status, preview_url: p.preview_url, price_stars: p.price_stars, status: p.status, grant: p.grant, max_per_user: p.max_per_user, sort: p.sort };
    if (tgId) { out.owned = ownedCount(ctx, tgId, p.id); const a = availability(ctx, tgId, p); out.can_buy = a.can; if (!a.can) out.reason = a.reason; }
    return out;
  });
}

/* ---------------- стартовый набор ---------------- */
// Цены — стартовые; их задаёт владелец в админке. Всё перечисленное реализовано в клиенте.
const SEED = [
  { id: 'slot_plus_1', category: 'slots', kind: 'slot', title: '+1 слот мандалы', description: 'Ещё одна мандала со своей вселенной, фоном и прогрессом. Существующие мандалы не затрагиваются.', price_stars: 50, grant: { slots: 1 }, max_per_user: 0, sort: 10 },
  { id: 'slot_plus_3', category: 'slots', kind: 'slot', title: '+3 слота мандалы', description: 'Три дополнительные мандалы по выгодной цене.', price_stars: 120, grant: { slots: 3 }, max_per_user: 0, sort: 20 },
  { id: 'uni_scrooge', category: 'universes', kind: 'universe', family: 'sc', title: 'Вселенная Scrooge Gold', description: 'Золотая тема: ранги магната, монеты на фоне, оформление «Касса».', price_stars: 60, grant: { builtin: 'scrooge' }, sort: 10 },
  { id: 'uni_onepiece', category: 'onepiece', kind: 'universe', family: 'op', title: 'Вселенная One Piece', description: 'Пиратская тема: ранги от юнги до короля пиратов, чайки на фоне, сокровища.', price_stars: 60, grant: { builtin: 'onepiece' }, sort: 10 },
  { id: 'bg_op_abyss', category: 'onepiece', kind: 'background', family: 'op', title: 'Фон «Морская бездна»', description: 'Глубокий морской градиент с лучами света.', price_stars: 30, grant: { mode: 'css', preset: 'abyss' }, sort: 20 },
  { id: 'anim_op_waves', category: 'onepiece', kind: 'animated_bg', family: 'op', title: 'Анимация «Волны»', description: 'Медленные волны за мандалой.', price_stars: 55, grant: { mode: 'css', preset: 'waves' }, sort: 30 },
  { id: 'fx_op_spray', category: 'onepiece', kind: 'effect', family: 'op', title: 'Эффект «Морские брызги»', description: 'Брызги и пузыри при выполнении ячейки.', price_stars: 35, grant: { preset: 'spray' }, sort: 40 },
  { id: 'bg_wh_forge', category: 'wh40k', kind: 'background', family: 'wh', title: 'Фон «Кузня»', description: 'Тёмная кузня с тлеющим свечением и линиями развёртки.', price_stars: 30, grant: { mode: 'css', preset: 'forge' }, sort: 20 },
  { id: 'anim_wh_embers', category: 'wh40k', kind: 'animated_bg', family: 'wh', title: 'Анимация «Угли»', description: 'Тлеющие угли, поднимающиеся над мандалой.', price_stars: 55, grant: { mode: 'css', preset: 'embers' }, sort: 30 },
  { id: 'fx_wh_sparks', category: 'wh40k', kind: 'effect', family: 'wh', title: 'Эффект «Искры кузни»', description: 'Россыпь искр при выполнении ячейки.', price_stars: 35, grant: { preset: 'sparks' }, sort: 40 },
  { id: 'bg_nebula', category: 'backgrounds', kind: 'background', family: '', title: 'Фон «Туманность»', description: 'Фиолетовая туманность со звёздной пылью.', price_stars: 30, grant: { mode: 'css', preset: 'nebula' }, sort: 10 },
  { id: 'anim_shimmer', category: 'animated', kind: 'animated_bg', family: 'sc', title: 'Анимация «Золотой блеск»', description: 'Переливающийся золотой блик.', price_stars: 55, grant: { mode: 'css', preset: 'shimmer' }, sort: 10 },
  { id: 'anim_aurora', category: 'animated', kind: 'animated_bg', family: '', title: 'Анимация «Северное сияние»', description: 'Плавные переливы цветов за мандалой.', price_stars: 55, grant: { mode: 'css', preset: 'aurora' }, sort: 20 },
  { id: 'fx_coinrain', category: 'effects', kind: 'effect', family: 'sc', title: 'Эффект «Золотой дождь»', description: 'Дождь из монет при выполнении ячейки.', price_stars: 35, grant: { preset: 'coinrain' }, sort: 10 },
  { id: 'fx_confetti', category: 'effects', kind: 'effect', family: '', title: 'Эффект «Конфетти»', description: 'Разноцветное конфетти при выполнении ячейки.', price_stars: 25, grant: { preset: 'confetti' }, sort: 20 },
  { id: 'col_wh', category: 'characters', kind: 'relic', family: 'wh', title: 'Коллекция «Империум»', description: 'Две реликвии сразу: Боевой Шагоход и Священный Клинок.', price_stars: 45, grant: { relics: ['wh_2', 'wh_3'] }, sort: 10 },
  { id: 'col_op', category: 'characters', kind: 'relic', family: 'op', title: 'Коллекция «Пиратские моря»', description: 'Три сокровища: Соломенная Шляпа, Три Клинка, Компас Странника.', price_stars: 55, grant: { relics: ['op_1', 'op_2', 'op_3'] }, sort: 20 },
  { id: 'col_sc', category: 'characters', kind: 'relic', family: 'sc', title: 'Коллекция «Золотая лихорадка»', description: 'Три сокровища: Цилиндр Магната, Золотой Сейф, Бриллиант.', price_stars: 55, grant: { relics: ['sc_1', 'sc_2', 'sc_3'] }, sort: 30 },
  { id: 'fig_wh_skull', category: 'characters', kind: 'figure', family: 'wh', rights_status: 'pending', title: 'Фигурка: Сервочереп', description: 'Коллекционная фигурка-стенд: вращайте и рассматривайте со всех сторон.', price_stars: 50, preview_url: '/art/figures/wh_skull.webp', grant: { figure: { id: 'wh_skull', name: 'Сервочереп', family: 'wh', mode: 'standee', url: '/art/figures/wh_skull.webp', glow: '#ff3b30' } }, sort: 30 },
  { id: 'fig_wh_adept', category: 'characters', kind: 'figure', family: 'wh', rights_status: 'pending', title: 'Фигурка: Техножрец-адепт', description: 'Коллекционная фигурка-стенд: молчаливый ремонтник в красной рясе.', price_stars: 60, preview_url: '/art/figures/wh_adept.webp', grant: { figure: { id: 'wh_adept', name: 'Техножрец-адепт', family: 'wh', mode: 'standee', url: '/art/figures/wh_adept.webp', glow: '#d23a2a' } }, sort: 35 },
  { id: 'fig_wh_walker', category: 'characters', kind: 'figure', family: 'wh', rights_status: 'pending', title: 'Фигурка: Дредноут', description: 'Коллекционная фигурка-стенд боевого шагохода.', price_stars: 90, preview_url: '/art/figures/wh_walker.webp', grant: { figure: { id: 'wh_walker', name: 'Дредноут', family: 'wh', mode: 'standee', url: '/art/figures/wh_walker.webp', glow: '#c9a75c' } }, sort: 40 },
  { id: 'fig_wh_trooper', category: 'characters', kind: 'figure', family: 'wh', rights_status: 'pending', title: 'Фигурка: Космодесантник', description: 'Коллекционная фигурка-стенд воина в тяжёлой броне.', price_stars: 80, preview_url: '/art/figures/wh_trooper.webp', grant: { figure: { id: 'wh_trooper', name: 'Космодесантник', family: 'wh', mode: 'standee', url: '/art/figures/wh_trooper.webp', glow: '#8ab04c' } }, sort: 50 },
  { id: 'fig_wh_magos', category: 'characters', kind: 'figure', family: 'wh', rights_status: 'pending', title: 'Фигурка: Магос-техножрец', description: 'Коллекционная фигурка-стенд старшего жреца с манипуляторами.', price_stars: 100, preview_url: '/art/figures/wh_magos.webp', grant: { figure: { id: 'wh_magos', name: 'Магос-техножрец', family: 'wh', mode: 'standee', url: '/art/figures/wh_magos.webp', glow: '#ff5a3a' } }, sort: 55 },
  { id: 'fig_wh_golden', category: 'characters', kind: 'figure', family: 'wh', rights_status: 'pending', title: 'Фигурка: Император', description: 'Редкая золотая фигурка-стенд с сиянием.', price_stars: 150, preview_url: '/art/figures/wh_golden.webp', grant: { figure: { id: 'wh_golden', name: 'Император', family: 'wh', mode: 'standee', url: '/art/figures/wh_golden.webp', glow: '#ffc24a' } }, sort: 60 },
  { id: 'fig_op_captain', category: 'characters', kind: 'figure', family: 'op', rights_status: 'pending', title: 'Фигурка: Капитан', description: 'Коллекционная фигурка-стенд пиратского капитана в соломенной шляпе.', price_stars: 80, preview_url: '/art/figures/op_captain.webp', grant: { figure: { id: 'op_captain', name: 'Капитан', family: 'op', mode: 'standee', url: '/art/figures/op_captain.webp', glow: '#ffd23f' } }, sort: 70 },
  { id: 'fig_op_swordsman', category: 'characters', kind: 'figure', family: 'op', rights_status: 'pending', title: 'Фигурка: Мечник', description: 'Коллекционная фигурка-стенд мечника с тремя клинками.', price_stars: 80, preview_url: '/art/figures/op_swordsman.webp', grant: { figure: { id: 'op_swordsman', name: 'Мечник', family: 'op', mode: 'standee', url: '/art/figures/op_swordsman.webp', glow: '#4fbf5a' } }, sort: 80 },
  { id: 'fig_op_cook', category: 'characters', kind: 'figure', family: 'op', rights_status: 'pending', title: 'Фигурка: Кок', description: 'Коллекционная фигурка-стенд кока.', price_stars: 80, preview_url: '/art/figures/op_cook.webp', grant: { figure: { id: 'op_cook', name: 'Кок', family: 'op', mode: 'standee', url: '/art/figures/op_cook.webp', glow: '#4cc2ff' } }, sort: 90 },
  { id: 'fig_op_doctor', category: 'characters', kind: 'figure', family: 'op', rights_status: 'pending', title: 'Фигурка: Доктор', description: 'Милая коллекционная фигурка-стенд корабельного доктора.', price_stars: 60, preview_url: '/art/figures/op_doctor.webp', grant: { figure: { id: 'op_doctor', name: 'Доктор', family: 'op', mode: 'standee', url: '/art/figures/op_doctor.webp', glow: '#ff6fa6' } }, sort: 100 },
  { id: 'fig_sc_scrooge', category: 'characters', kind: 'figure', family: 'sc', rights_status: 'pending', title: 'Фигурка: Магнат', description: 'Коллекционная фигурка-стенд золотого магната с тростью.', price_stars: 80, preview_url: '/art/figures/sc_scrooge.webp', grant: { figure: { id: 'sc_scrooge', name: 'Магнат', family: 'sc', mode: 'standee', url: '/art/figures/sc_scrooge.webp', glow: '#fbbf24' } }, sort: 110 },
  { id: 'fig_sc_daisy', category: 'characters', kind: 'figure', family: 'sc', rights_status: 'pending', title: 'Фигурка: Модница', description: 'Яркая коллекционная фигурка-стенд в розовом платье с бантом.', price_stars: 60, preview_url: '/art/figures/sc_daisy.webp', grant: { figure: { id: 'sc_daisy', name: 'Модница', family: 'sc', mode: 'standee', url: '/art/figures/sc_daisy.webp', glow: '#f472b6' } }, sort: 120 },
  { id: 'fig_art_coins', category: 'characters', kind: 'figure', family: '', rights_status: 'own', title: 'Артефакт: Золотой столбик', description: 'Оригинальная 3D-модель: столбик золотых монет, который можно вращать и приближать.', price_stars: 40, preview_url: '/art/figures/art_coins.webp', grant: { figure: { id: 'art_coins', name: 'Золотой столбик', family: 'sc', mode: 'standee', url: '/art/figures/art_coins.webp', glow: '#fbbf24' } }, sort: 130 },
  { id: 'fig_art_helm', category: 'characters', kind: 'figure', family: '', rights_status: 'own', title: 'Артефакт: Штурвал', description: 'Оригинальная 3D-модель корабельного штурвала из дерева и латуни.', price_stars: 50, preview_url: '/art/figures/art_helm.webp', grant: { figure: { id: 'art_helm', name: 'Штурвал', family: 'op', mode: 'standee', url: '/art/figures/art_helm.webp', glow: '#38bdf8' } }, sort: 140 },
  { id: 'fig_art_crystal', category: 'characters', kind: 'figure', family: '', rights_status: 'own', title: 'Артефакт: Кристалл фокуса', description: 'Оригинальная 3D-модель прозрачного кристалла с живым свечением.', price_stars: 60, preview_url: '/art/figures/art_crystal.webp', grant: { figure: { id: 'art_crystal', name: 'Кристалл фокуса', family: 'wh', mode: 'standee', url: '/art/figures/art_crystal.webp', glow: '#a78bfa' } }, sort: 150 },
  { id: 'flames_50', category: 'rewards', kind: 'flames', title: '50 огоньков', description: 'Огоньки для покупки реликвий и тем за игровую валюту.', price_stars: 30, grant: { flames: 50 }, max_per_user: 0, sort: 10 },
  { id: 'flames_150', category: 'rewards', kind: 'flames', title: '150 огоньков', description: 'Пачка огоньков с бонусом.', price_stars: 80, grant: { flames: 150 }, max_per_user: 0, sort: 20 },
  { id: 'flames_400', category: 'rewards', kind: 'flames', title: '400 огоньков', description: 'Большая пачка огоньков с бонусом.', price_stars: 180, grant: { flames: 400 }, max_per_user: 0, sort: 30 },
  { id: 'feat_export_png', category: 'features', kind: 'feature', title: 'Экспорт мандалы в PNG', description: 'Сохраните красивую картинку своей мандалы, чтобы поделиться ею.', price_stars: 40, grant: { feature: 'export_png' }, sort: 10 },
  { id: 'feat_heatmap', category: 'features', kind: 'feature', title: 'Годовая карта активности', description: 'Календарь-тепловая карта ваших действий за год.', price_stars: 40, grant: { feature: 'year_heatmap' }, sort: 20 }
];

/** Заполняет пустой каталог стартовым набором. Выполняется один раз (флаг в settings), чтобы удалённые админом товары не возвращались. */
export function seedCatalog(ctx) {
  if (getSetting(ctx, 'catalog_seeded', '0') === '1') return 0;
  let n = 0;
  tx(ctx.db, () => {
    for (const p of SEED) {
      const o = normalizeProduct(p, { create: true });
      o.grant = validateGrant(o.kind, o.grant);
      const t = ctx.now();
      run(ctx.db, `INSERT OR IGNORE INTO products(id, category, kind, title, description, family, rights_status, preview_url, price_stars, status, grant_json, max_per_user, sort, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, o.id, o.category, o.kind, o.title, o.description, o.family, o.rights_status, o.preview_url, o.price_stars, o.status, JSON.stringify(o.grant), o.max_per_user, o.sort, t, t);
      n++;
    }
    setSetting(ctx, 'catalog_seeded', '1');
  });
  return n;
}
