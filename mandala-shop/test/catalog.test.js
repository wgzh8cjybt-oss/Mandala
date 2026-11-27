import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_RELICS, BUILTIN_THEMES, MAX_PRICE_STARS, checkUrl, createProduct, getProduct, listAllProducts, normalizeProduct, updateProduct, validateGrant } from '../src/catalog.js';
import { ADMIN_ID, startServer } from './helpers.js';

const code = fn => { try { fn(); } catch (e) { return e.code || e.message; } return null; };

/* ---------------- проверка выдаваемых прав ---------------- */
test('слот: 1–5, только целое', () => {
  assert.deepEqual(validateGrant('slot', { slots: 3, мусор: 1 }), { slots: 3 });
  for (const bad of [0, 6, 1.5, '2', null, -1]) assert.equal(code(() => validateGrant('slot', { slots: bad })), 'bad_product', String(bad));
  assert.equal(code(() => validateGrant('slot', null)), 'bad_product');
  assert.equal(code(() => validateGrant('slot', [])), 'bad_product');
});

test('огоньки: 1–100000', () => {
  assert.deepEqual(validateGrant('flames', { flames: 50 }), { flames: 50 });
  for (const bad of [0, 100001, -5, 0.5, 'много']) assert.equal(code(() => validateGrant('flames', { flames: bad })), 'bad_product');
});

test('вселенная: только встроенные темы или полностью описанная своя палитра', () => {
  assert.deepEqual(validateGrant('universe', { builtin: 'scrooge' }), { builtin: 'scrooge' });
  assert.equal(code(() => validateGrant('universe', { builtin: 'нет_такой' })), 'bad_product');
  const ok = { custom: { id: 'my_uni', name: ' Моя ', family: 'wh', palette: { '--accent': '#ff0000', '--accent-2': 'rgba(1,2,3,.5)', '--bg1': '#000', '--bg2': '#111' } } };
  const r = validateGrant('universe', ok);
  assert.equal(r.custom.name, 'Моя');
  assert.equal(r.custom.palette['--meta'], '#111', '--meta по умолчанию = --bg2');
  const withVar = (k, v) => ({ custom: { ...ok.custom, palette: { ...ok.custom.palette, [k]: v } } });
  assert.equal(code(() => validateGrant('universe', withVar('--accent', 'url(javascript:alert(1))'))), 'bad_product', 'в цвет нельзя подсунуть url()');
  assert.equal(code(() => validateGrant('universe', withVar('--accent', 'red; background:url(//evil)'))), 'bad_product');
  assert.equal(code(() => validateGrant('universe', withVar('--accent', 'expression(1)'))), 'bad_product');
  assert.equal(code(() => validateGrant('universe', withVar('background', '#fff'))), 'bad_product', 'произвольные CSS-свойства запрещены');
  assert.equal(code(() => validateGrant('universe', withVar('--evil', '#fff'))), 'bad_product');
  assert.equal(code(() => validateGrant('universe', { custom: { ...ok.custom, id: 'wh40k' } })), 'bad_product', 'нельзя затенить встроенную тему');
  assert.equal(code(() => validateGrant('universe', { custom: { ...ok.custom, id: 'Bad Id!' } })), 'bad_product');
  assert.equal(code(() => validateGrant('universe', { custom: { ...ok.custom, family: 'xx' } })), 'bad_product');
  const noAccent = { custom: { ...ok.custom, palette: { '--bg1': '#000', '--bg2': '#111' } } };
  assert.equal(code(() => validateGrant('universe', noAccent)), 'bad_product', 'обязательны --accent --accent-2 --bg1 --bg2');
  for (const t of BUILTIN_THEMES) assert.deepEqual(validateGrant('universe', { builtin: t }), { builtin: t });
});

test('фон и анимация: css-пресет либо загруженный файл, но не произвольные адреса', () => {
  assert.deepEqual(validateGrant('background', { mode: 'css', preset: 'forge' }), { mode: 'css', preset: 'forge' });
  assert.equal(code(() => validateGrant('background', { mode: 'css', preset: 'embers' })), 'bad_product', 'пресет анимации не годится для фона');
  assert.deepEqual(validateGrant('background', { mode: 'image', url: '/media/abcdefgh1234.webp', dim: 0.5 }), { mode: 'image', url: '/media/abcdefgh1234.webp', dim: 0.5 });
  assert.equal(validateGrant('background', { mode: 'image', url: 'https://cdn.example.com/a.png' }).dim, 0.35, 'затемнение по умолчанию');
  assert.equal(code(() => validateGrant('background', { mode: 'image', url: 'http://evil.example/a.png' })), 'bad_product', 'только https');
  assert.equal(code(() => validateGrant('background', { mode: 'image', url: 'javascript:alert(1)' })), 'bad_product');
  assert.equal(code(() => validateGrant('background', { mode: 'image', url: 'data:image/png;base64,AAAA' })), 'bad_product');
  assert.equal(code(() => validateGrant('background', { mode: 'image', url: '/media/abcdefgh1234.webm' })), 'bad_product', 'видео не годится для статичного фона');
  assert.equal(code(() => validateGrant('background', { mode: 'image', url: '/media/abcdefgh1234.png', dim: 0.99 })), 'bad_product');
  assert.deepEqual(validateGrant('animated_bg', { mode: 'video', url: '/media/abcdefgh1234.webm' }).mode, 'video');
  assert.equal(code(() => validateGrant('animated_bg', { mode: 'video', url: '/media/abcdefgh1234.png' })), 'bad_product');
  assert.deepEqual(validateGrant('animated_bg', { mode: 'css', preset: 'aurora' }), { mode: 'css', preset: 'aurora' });
});

test('эффект и функция: только известные клиенту значения', () => {
  assert.deepEqual(validateGrant('effect', { preset: 'sparks' }), { preset: 'sparks' });
  assert.equal(code(() => validateGrant('effect', { preset: 'meteor' })), 'bad_product');
  assert.deepEqual(validateGrant('feature', { feature: 'export_png' }), { feature: 'export_png' });
  assert.equal(code(() => validateGrant('feature', { feature: 'root_access' })), 'bad_product');
});

test('реликвии: готовые id либо своя реликвия с безопасной картинкой', () => {
  assert.deepEqual(validateGrant('relic', { relics: ['wh_2', 'wh_2', 'wh_3'] }), { relics: ['wh_2', 'wh_3'] });
  assert.equal(code(() => validateGrant('relic', { relics: [] })), 'bad_product');
  assert.equal(code(() => validateGrant('relic', { relics: ['zz_9'] })), 'bad_product');
  const c = { custom: { id: 'my_relic', name: 'Реликвия', desc: 'Описание', family: 'op', art_url: '/media/abcdefgh1234.webp' } };
  assert.equal(validateGrant('relic', c).custom.art_url, '/media/abcdefgh1234.webp');
  assert.equal(code(() => validateGrant('relic', { custom: { ...c.custom, art_url: 'https://x.y/a.svg"onload="x' } })), 'bad_product');
  assert.equal(code(() => validateGrant('relic', { custom: { ...c.custom, id: BUILTIN_RELICS[0] } })), 'bad_product');
  assert.equal(code(() => validateGrant('relic', { custom: { ...c.custom, desc: 'я'.repeat(121) } })), 'bad_product');
});

test('фигурка: стенд (одна картинка) или кадры по кругу (8–72)', () => {
  const f = { id: 'fig_a', name: 'Фигурка', family: 'wh', mode: 'standee', url: '/art/figures/x.webp', glow: '#ffc24a' };
  assert.equal(validateGrant('figure', { figure: f }).figure.mode, 'standee');
  assert.equal(code(() => validateGrant('figure', { figure: { ...f, url: null } })), 'bad_product');
  assert.equal(code(() => validateGrant('figure', { figure: { ...f, glow: 'red;x' } })), 'bad_product');
  const frames = Array.from({ length: 12 }, (_, i) => `/media/frame${String(i).padStart(4, '0')}abcd.webp`);
  assert.equal(validateGrant('figure', { figure: { ...f, mode: 'frames', frames } }).figure.frames.length, 12);
  assert.equal(code(() => validateGrant('figure', { figure: { ...f, mode: 'frames', frames: frames.slice(0, 7) } })), 'bad_product');
  assert.equal(code(() => validateGrant('figure', { figure: { ...f, mode: 'frames', frames: [...frames.slice(0, 11), 'javascript:1'] } })), 'bad_product');
  assert.equal(code(() => validateGrant('figure', { figure: { ...f, mode: 'cube', url: '/art/figures/x.webp' } })), 'bad_product');
});

test('неизвестный тип права отклоняется', () => assert.equal(code(() => validateGrant('admin', {})), 'bad_product'));

test('checkUrl: пути /media и /art только нужной формы, без «..» и чужих схем', () => {
  assert.equal(checkUrl('', 'u'), null);
  assert.equal(checkUrl(null, 'u'), null);
  assert.equal(checkUrl('/media/abcdefgh1234.png', 'u'), '/media/abcdefgh1234.png');
  assert.equal(checkUrl('/art/figures/wh_golden.webp', 'u'), '/art/figures/wh_golden.webp');
  for (const bad of ['/art/../../etc/passwd.png', '/media/../x.png', '/media/short.png', '//evil.com/a.png', 'ftp://x/a.png', 'https://x.y/a b.png', 'https://x.y/a"b.png', '/art/x.svg', '/media/abcdefgh1234.svg', 'x'.repeat(501), 123]) {
    assert.equal(code(() => checkUrl(bad, 'u')), 'bad_product', String(bad).slice(0, 40));
  }
});

/* ---------------- поля товара ---------------- */
const base = { id: 'test_item', category: 'features', kind: 'feature', title: 'Тест', description: 'Описание', price_stars: 10, grant: { feature: 'export_png' } };

test('normalizeProduct при создании требует всё и подставляет безопасные значения', () => {
  const o = normalizeProduct(base, { create: true });
  assert.equal(o.status, 'active'); assert.equal(o.rights_status, 'own'); assert.equal(o.max_per_user, 1); assert.equal(o.family, '');
  for (const [k, v] of Object.entries({ id: 'Bad-Id', category: 'нет', kind: 'нет', title: '  ', price_stars: 0 })) {
    assert.equal(code(() => normalizeProduct({ ...base, [k]: v }, { create: true })), 'bad_product', k);
  }
});

test('цена: целое число Stars от 1 до MAX_PRICE_STARS', () => {
  for (const bad of [0, -1, 1.5, '10', MAX_PRICE_STARS + 1, NaN, null]) assert.equal(code(() => normalizeProduct({ ...base, price_stars: bad }, { create: true })), 'bad_product', String(bad));
  assert.equal(normalizeProduct({ ...base, price_stars: MAX_PRICE_STARS }, { create: true }).price_stars, MAX_PRICE_STARS);
});

test('название ≤ 60, описание ≤ 255 (лимит Telegram для счёта)', () => {
  assert.equal(code(() => normalizeProduct({ ...base, title: 'я'.repeat(61) }, { create: true })), 'bad_product');
  assert.equal(code(() => normalizeProduct({ ...base, description: 'я'.repeat(256) }, { create: true })), 'bad_product');
  assert.equal(normalizeProduct({ ...base, description: 'я'.repeat(255) }, { create: true }).description.length, 255);
});

/* ---------------- товары в базе ---------------- */
let t;
before(async () => { t = await startServer(); });
after(async () => { await t.close(); });

test('стартовый набор товаров создан, все товары проходят собственную проверку', () => {
  const list = listAllProducts(t.ctx);
  assert.ok(list.length >= 28, 'ожидался каталог из 28+ товаров, получено ' + list.length);
  const ids = new Set(list.map(p => p.id));
  assert.equal(ids.size, list.length);
  for (const p of list) {
    assert.deepEqual(validateGrant(p.kind, p.grant), p.grant, 'grant товара ' + p.id + ' должен быть уже «чистым»');
    assert.ok(Number.isInteger(p.price_stars) && p.price_stars >= 1 && p.price_stars <= MAX_PRICE_STARS, p.id);
    assert.ok(p.description.length <= 255 && p.title.length <= 60, p.id);
  }
  for (const kind of ['slot', 'universe', 'background', 'animated_bg', 'effect', 'relic', 'figure', 'flames', 'feature']) assert.ok(list.some(p => p.kind === kind), 'нет товара типа ' + kind);
  for (const cat of ['slots', 'universes', 'wh40k', 'onepiece', 'backgrounds', 'animated', 'effects', 'characters', 'rewards', 'features']) assert.ok(list.some(p => p.category === cat), 'нет товаров в категории ' + cat);
});

test('повторный запуск не пересоздаёт удалённые админом товары (посев один раз)', async () => {
  const { seedCatalog } = await import('../src/catalog.js');
  assert.equal(seedCatalog(t.ctx), 0);
});

test('фигурки с неподтверждёнными правами скрыты от обычных пользователей и открыты администратору', async () => {
  const user = (await t.as(5001).get('/api/catalog')).json.products;
  const admin = (await t.admin.get('/api/catalog')).json.products;
  const anon = (await t.req('GET', '/api/catalog')).json.products;
  const pending = p => p.kind === 'figure' && p.rights_status === 'pending';
  assert.equal(user.filter(pending).length, 0);
  assert.equal(anon.filter(pending).length, 0);
  assert.ok(admin.filter(pending).length >= 7);
  assert.equal(user.filter(p => p.id.startsWith('fig_art_')).length, 3, 'оригинальные модели (rights: own) видят все');
  assert.ok(user.length > 15);
});

test('скрытый товар нельзя купить, даже зная его id', async () => {
  await t.acceptTerms(5002);
  const r = await t.as(5002).post('/api/orders', { product_id: 'fig_wh_golden' });
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, 'unavailable');
  assert.equal(t.q1("SELECT COUNT(*) AS n FROM orders WHERE product_id = 'fig_wh_golden'").n, 0);
});

test('владелец может открыть такие товары всем настройкой (после подтверждения прав)', async () => {
  assert.equal((await t.admin.put('/api/admin/settings', { public_pending_rights: true })).status, 200);
  const user = (await t.as(5001).get('/api/catalog')).json.products;
  assert.ok(user.filter(p => p.kind === 'figure').length >= 7);
  const p = user.find(x => x.id === 'fig_wh_golden');
  assert.equal(p.can_buy, true);
  assert.equal(p.rights_status, 'pending', 'клиент видит, что права ещё не подтверждены');
  await t.admin.put('/api/admin/settings', { public_pending_rights: false });
  assert.equal((await t.as(5001).get('/api/catalog')).json.products.filter(x => x.kind === 'figure' && x.rights_status === 'pending').length, 0);
});

test('создание товара: проверки, дубликат, журнал аудита', () => {
  const p = createProduct(t.ctx, { ...base, id: 'new_feat' }, 'tester');
  assert.equal(p.price_stars, 10);
  assert.equal(code(() => createProduct(t.ctx, { ...base, id: 'new_feat' }, 'tester')), 'exists');
  assert.equal(code(() => createProduct(t.ctx, { ...base, id: 'bad_one', grant: { feature: 'x' } }, 'tester')), 'bad_product');
  assert.equal(getProduct(t.ctx, 'bad_one'), null, 'при ошибке проверки товар не создаётся');
  assert.ok(t.q1("SELECT 1 AS x FROM audit_log WHERE action = 'product.create' AND target = 'new_feat'"));
});

test('смена цены пишется в журнал отдельным действием; тип права у проданного товара менять нельзя', async () => {
  updateProduct(t.ctx, 'new_feat', { price_stars: 25 }, 'tester');
  const row = t.q1("SELECT * FROM audit_log WHERE action = 'product.price' AND target = 'new_feat'");
  assert.ok(row);
  assert.deepEqual(JSON.parse(row.details).price_stars, { from: 10, to: 25 });
  assert.equal(code(() => updateProduct(t.ctx, 'new_feat', { price_stars: 0 }, 'tester')), 'bad_product');
  assert.equal(code(() => updateProduct(t.ctx, 'нет_такого', { price_stars: 5 }, 'tester')), 'not_found');
  // продаём товар → менять kind нельзя
  const r = await t.buy(5003, 'new_feat');
  assert.equal(r.paid, true);
  assert.equal(code(() => updateProduct(t.ctx, 'new_feat', { kind: 'effect', grant: { preset: 'sparks' } }, 'tester')), 'kind_locked');
  assert.equal(getProduct(t.ctx, 'new_feat').kind, 'feature');
});

test('смена цены не влияет на уже созданный заказ (цена зафиксирована снимком)', async () => {
  const o = await t.order(5004, 'new_feat');          // создан по 25 Stars
  assert.equal(o.amount, 25);
  updateProduct(t.ctx, 'new_feat', { price_stars: 99 }, 'tester');
  const inv = t.mock.invoices.get(o.invoice_link);
  assert.equal(inv.amount, 25);
  const r = await t.pay(o.invoice_link, 5004);
  assert.equal(r.paid, true);
  assert.equal(t.q1('SELECT amount FROM payments WHERE charge_id = ?', r.chargeId).amount, 25);
  // новый заказ — уже по новой цене
  const fresh = await t.order(5005, 'new_feat');
  assert.equal(fresh.amount, 99);
});

test('админ-API: ошибки проверки возвращаются понятным JSON, а не падением', async () => {
  const r = await t.admin.post('/api/admin/products', { id: 'x', category: 'features', kind: 'feature', title: 'Т', price_stars: 5, grant: { feature: 'export_png' } });
  assert.equal(r.status, 400);
  assert.equal(r.json.ok, false);
  assert.equal(r.json.error.code, 'bad_product');
  assert.match(r.json.error.message, /id/);
  assert.equal(ADMIN_ID, 1001);
});
