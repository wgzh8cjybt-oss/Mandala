import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig, loadDotEnv, parseEnvFile } from '../src/config.js';
import { BOT_TOKEN, WEBHOOK_SECRET } from './helpers.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const good = { BOT_TOKEN, WEBHOOK_SECRET, PUBLIC_URL: 'https://shop.test', ADMIN_IDS: '1001' };
const problems = env => { try { loadConfig(env); return []; } catch (e) { assert.ok(e instanceof ConfigError, 'ожидалась ConfigError, а не ' + e); return e.problems; } };
const has = (list, re) => list.some(p => re.test(p));

test('корректные настройки загружаются, значения по умолчанию безопасны', () => {
  const c = loadConfig(good);
  assert.equal(c.publicUrl, 'https://shop.test');
  assert.equal(c.port, 8080);
  assert.equal(c.maxSlots, 10);
  assert.equal(c.orderTtlSec, 3600);
  assert.equal(c.initDataMaxAgeSec, 86400);
  assert.equal(c.trustProxy, false, 'X-Forwarded-For по умолчанию не доверяем');
  assert.equal(c.autoSetWebhook, false);
  assert.equal(c.telegramApiBase, 'https://api.telegram.org');
  assert.ok(c.adminIds.has(1001));
  assert.equal(c.adminToken, '');
});

test('без обязательных параметров сервер не стартует и объясняет почему', () => {
  assert.ok(has(problems({ ...good, BOT_TOKEN: '' }), /BOT_TOKEN не задан/));
  assert.ok(has(problems({ ...good, WEBHOOK_SECRET: '' }), /WEBHOOK_SECRET/));
  assert.ok(has(problems({ ...good, PUBLIC_URL: '' }), /PUBLIC_URL не задан/));
  assert.ok(has(problems({ ...good, ADMIN_IDS: '' }), /администратор/));
});

test('значение-заглушка из .env.example и кривой токен отклоняются', () => {
  assert.ok(has(problems({ ...good, BOT_TOKEN: '123456789:replace_with_real_token' }), /BOT_TOKEN/));
  assert.ok(has(problems({ ...good, BOT_TOKEN: 'не-токен' }), /BOT_TOKEN выглядит неверно/));
});

test('секрет вебхука: допустимые символы и длина', () => {
  assert.ok(has(problems({ ...good, WEBHOOK_SECRET: 'short' }), /WEBHOOK_SECRET/));
  assert.ok(has(problems({ ...good, WEBHOOK_SECRET: 'a'.repeat(20) + ' !' }), /WEBHOOK_SECRET/));
  assert.ok(has(problems({ ...good, WEBHOOK_PATH: 'a/b' }), /WEBHOOK_PATH/));
});

test('PUBLIC_URL: только https (и localhost для разработки)', () => {
  assert.ok(has(problems({ ...good, PUBLIC_URL: 'http://shop.example.com' }), /https/));
  assert.deepEqual(problems({ ...good, PUBLIC_URL: 'http://localhost:8080' }), []);
  assert.equal(loadConfig({ ...good, PUBLIC_URL: 'https://shop.test///' }).publicUrl, 'https://shop.test', 'слэши в конце убираются');
});

test('администраторы: числа и длина токена', () => {
  assert.ok(has(problems({ ...good, ADMIN_IDS: 'abc' }), /ADMIN_IDS/));
  assert.ok(has(problems({ ...good, ADMIN_IDS: '-5' }), /ADMIN_IDS/));
  assert.ok(has(problems({ ...good, ADMIN_IDS: '', ADMIN_TOKEN: 'short' }), /ADMIN_TOKEN короче 32/));
  assert.deepEqual(problems({ ...good, ADMIN_IDS: '', ADMIN_TOKEN: 'x'.repeat(40) }), []);
  assert.deepEqual([...loadConfig({ ...good, ADMIN_IDS: '1, 2 ,3' }).adminIds], [1, 2, 3]);
});

test('числовые параметры проверяются по границам', () => {
  assert.ok(has(problems({ ...good, PORT: '0' }), /PORT/));
  assert.ok(has(problems({ ...good, PORT: 'abc' }), /PORT/));
  assert.ok(has(problems({ ...good, ORDER_TTL_SEC: '5' }), /ORDER_TTL_SEC/));
  assert.ok(has(problems({ ...good, MAX_SLOTS: '999' }), /MAX_SLOTS/));
  assert.ok(has(problems({ ...good, STAR_USD_ESTIMATE: '-1' }), /STAR_USD_ESTIMATE/));
  assert.ok(has(problems({ ...good, STATS_TZ: 'Mars/Olympus' }), /STATS_TZ/));
});

test('несколько ошибок показываются сразу, а не по одной', () => {
  const p = problems({ BOT_TOKEN: '', WEBHOOK_SECRET: '', PUBLIC_URL: '', ADMIN_IDS: '' });
  assert.ok(p.length >= 4);
});

test('parseEnvFile: комментарии, кавычки, пробелы, значение с «=»', () => {
  const r = parseEnvFile('# комментарий\n\nA=1\nB = "два words"\nC=\'три\'\nD=x=y\n  E=5  \nбез_равно\n=пусто');
  assert.deepEqual(r, { A: '1', B: 'два words', C: 'три', D: 'x=y', E: '5' });
});

test('loadDotEnv читает файл и не перетирает уже заданные переменные окружения', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'envtest-'));
  const f = path.join(dir, '.env');
  fs.writeFileSync(f, 'FOO=из_файла\nBAR=из_файла');
  const env = { FOO: 'из_окружения' };
  assert.equal(loadDotEnv(f, env), true);
  assert.equal(env.FOO, 'из_окружения');
  assert.equal(env.BAR, 'из_файла');
  assert.equal(loadDotEnv(path.join(dir, 'нет.env'), {}), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('.env.example описывает все параметры, которые читает код (и ничего лишнего не обещает)', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'config.js'), 'utf8');
  const used = new Set([...src.matchAll(/env\.([A-Z][A-Z0-9_]+)/g)].map(m => m[1]));
  const example = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  const documented = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map(m => m[1]));
  for (const k of used) assert.ok(documented.has(k), `параметр ${k} читается кодом, но не описан в .env.example`);
  for (const k of documented) assert.ok(used.has(k), `параметр ${k} описан в .env.example, но код его не читает`);
});

test('.env.example после подстановки секретов проходит проверку; токены не лежат в репозитории', () => {
  const env = { ...parseEnvFile(fs.readFileSync(path.join(root, '.env.example'), 'utf8')), BOT_TOKEN, WEBHOOK_SECRET };
  assert.deepEqual(problems(env), []);
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /^\.env$/m, '.env должен быть в .gitignore');
  assert.match(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), /^data\/?$/m, 'каталог data (база, копии) должен быть в .gitignore');
});
