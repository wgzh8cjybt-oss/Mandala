// Раздача клиента и статики: метка «магазин на этом же адресе», заголовки безопасности, кэш, перечитывание файла.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withSelfMeta } from '../src/http.js';
import { startServer } from './helpers.js';

let t;
before(async () => {
  t = await startServer({});
  fs.writeFileSync(path.join(t.publicDir, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>client</title></head><body>клиент</body></html>');
});
after(async () => { await t.close(); });
const raw = async (p, method = 'GET') => { const r = await fetch(t.base + p, { method }); return { status: r.status, headers: r.headers, text: await r.text() }; };

test('главная страница отдаёт клиент с меткой shop-self один раз', async () => {
  const r = await raw('/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/html; charset=utf-8/);
  assert.equal((r.text.match(/name="shop-self"/g) || []).length, 1);
  assert.ok(r.text.indexOf('shop-self') < r.text.toLowerCase().indexOf('</head>'), 'метка внутри <head>');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('cache-control'), 'no-cache');
  assert.equal(Number(r.headers.get('content-length')), Buffer.byteLength(r.text));
  assert.equal((await raw('/index.html')).text, r.text, '/index.html — то же самое');
});

test('HEAD не отдаёт тело, но заголовки те же', async () => {
  const g = await raw('/');
  const h = await raw('/', 'HEAD');
  assert.equal(h.status, 200);
  assert.equal(h.text, '');
  assert.equal(h.headers.get('content-length'), g.headers.get('content-length'));
});

test('метка не дублируется, если клиент уже её содержит; изменённый файл перечитывается', async () => {
  const file = path.join(t.publicDir, 'index.html');
  fs.writeFileSync(file, '<!doctype html><html><head><meta name="shop-self" content="1"><title>v2</title></head><body>два</body></html>');
  const future = new Date(Date.now() + 5000); fs.utimesSync(file, future, future);
  const r = await raw('/');
  assert.equal((r.text.match(/shop-self/g) || []).length, 1);
  assert.match(r.text, /v2/);
  fs.writeFileSync(file, '<!doctype html><html><HEAD><title>v3</title></HEAD><body>три</body></html>');
  const future2 = new Date(Date.now() + 10000); fs.utimesSync(file, future2, future2);
  const r3 = await raw('/');
  assert.match(r3.text, /v3/);
  assert.equal((r3.text.match(/shop-self/g) || []).length, 1, 'метка добавлена и в верхнем регистре </HEAD>');
});

test('клиент без файла на диске — аккуратная 404 в формате ошибок API', async () => {
  const file = path.join(t.publicDir, 'index.html');
  const keep = fs.readFileSync(file);
  fs.unlinkSync(file);
  const r = await raw('/');
  assert.equal(r.status, 404);
  assert.equal(JSON.parse(r.text).error.code, 'not_found');
  fs.writeFileSync(file, keep);
});

test('другие страницы и методы: админка отдаётся, неизвестное — 404, POST на главную — 404', async () => {
  assert.equal((await raw('/admin')).status, 200);
  assert.equal((await raw('/nope')).status, 404);
  assert.equal((await raw('/', 'POST')).status, 404);
});

test('withSelfMeta: разные варианты разметки', () => {
  const has = h => (h.match(/name="shop-self"/g) || []).length;
  assert.equal(has(withSelfMeta('<html><head></head></html>')), 1);
  assert.equal(has(withSelfMeta('<html><HEAD lang="ru"><title>x</title></html>')), 1, 'без закрывающего head — после открывающего');
  assert.ok(withSelfMeta('<!DOCTYPE html><title>x</title>').startsWith('<!DOCTYPE html><meta name="shop-self"'), 'совсем без head — после doctype');
  assert.ok(withSelfMeta('просто текст').startsWith('<meta name="shop-self"'));
  const twice = withSelfMeta(withSelfMeta('<head></head>'));
  assert.equal(has(twice), 1, 'повторный вызов не дублирует');
  assert.equal(withSelfMeta('<head>$&</head>').includes('$&'), true, 'спецсимволы замены в самом файле не ломаются');
});
