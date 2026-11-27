/* Собирает src/js/07c-showcase.js из стартового набора товаров сервера магазина (витрина без сервера).
   Товары с неподтверждёнными правами на изображения (rights_status = pending) в витрину не попадают: сервер их тоже прячет от обычных пользователей. */
const fs = require('fs'), vm = require('vm'), path = require('path');
const src = fs.readFileSync(process.argv[2] || '/home/claude/mandala-shop/src/catalog.js', 'utf8');
const a = src.indexOf('const SEED = ['), b = src.indexOf('\n];', a);
const arr = vm.runInNewContext('(' + src.slice(a + 'const SEED = '.length, b + 2) + ')');
const keep = arr.filter(p => (p.rights_status || 'own') !== 'pending').map(p => ({
  id: p.id, category: p.category, kind: p.kind, family: p.family || '', title: p.title, description: p.description, price_stars: p.price_stars, sort: p.sort || 100,
  grant: p.kind === 'slot' ? { slots: p.grant.slots } : p.kind === 'flames' ? { flames: p.grant.flames } : p.kind === 'universe' ? { builtin: (p.grant || {}).builtin || '' } : p.kind === 'relic' ? { relics: (p.grant || {}).relics || [] } : p.kind === 'feature' ? { feature: p.grant.feature } : {}
}));
const out = '/* Сгенерировано tools/gen_showcase.cjs из стартового набора сервера магазина. Не править вручную.\n   Это ВИТРИНА для показа каталога, пока приложение не подключено к серверу оплаты; купить по ней нельзя. */\nconst SHOWCASE = ' + JSON.stringify(keep, null, 1).replace(/\n\s*/g, ' ').replace(/\{ "id"/g, '\n  { "id"').replace(/\]$/, '\n]') + ';\n';
fs.writeFileSync(path.join(__dirname, '..', 'src/js/07c-showcase.js'), out);
console.log('products:', keep.length, 'of', arr.length, '; skipped pending:', arr.length - keep.length);
