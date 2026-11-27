import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyInitData } from '../src/telegram.js';
import { BOT_TOKEN, signInitData, signParams, tgUser } from './helpers.js';

const NOW = 1794139200;   // 2026-11-08 12:00:00 UTC
const sign = (user, o = {}) => signInitData(user, { authDate: NOW, ...o });
const fails = (fn, re) => assert.throws(fn, e => re.test(e.reason || e.message));

test('эталонный вектор, посчитанный независимой реализацией на Python (hmac/hashlib), совпадает', () => {
  const initData = 'auth_date=1794139200&query_id=AAHdF6IQAAAAAN0XohDhrOrc&user=%7B%22id%22%3A777%2C%22first_name%22%3A%22Test%22%2C%22username%22%3A%22tester%22%7D&hash=c75229525b65c26c44965210fe4331051cc19e1ad347c513a4f3f4b5b0d93f34';
  const r = verifyInitData(initData, BOT_TOKEN, { nowSec: NOW });
  assert.equal(r.user.id, 777);
  assert.equal(r.user.username, 'tester');
  assert.equal(r.authDate, NOW);
});

test('подпись из тестового помощника совпадает с серверной проверкой', () => {
  const r = verifyInitData(sign(tgUser(42)), BOT_TOKEN, { nowSec: NOW + 10 });
  assert.equal(r.user.id, 42);
});

test('подмена пользователя в подписанных данных отклоняется', () => {
  const qs = new URLSearchParams(sign(tgUser(42)));
  qs.set('user', JSON.stringify(tgUser(1001)));   // «стать администратором»
  fails(() => verifyInitData(qs.toString(), BOT_TOKEN, { nowSec: NOW }), /подпись/);
});

test('подмена auth_date, добавление и удаление полей отклоняется', () => {
  const base = sign(tgUser(42));
  let q = new URLSearchParams(base); q.set('auth_date', String(NOW + 5)); fails(() => verifyInitData(q.toString(), BOT_TOKEN, { nowSec: NOW }), /подпись/);
  q = new URLSearchParams(base); q.set('start_param', 'evil'); fails(() => verifyInitData(q.toString(), BOT_TOKEN, { nowSec: NOW }), /подпись/);
  q = new URLSearchParams(base); q.delete('query_id'); fails(() => verifyInitData(q.toString(), BOT_TOKEN, { nowSec: NOW }), /подпись/);
});

test('чужой токен бота: подпись другого бота не принимается', () => {
  fails(() => verifyInitData(sign(tgUser(42), { token: '999999999:AAH_other_bot_token_abcdefghijklmn' }), BOT_TOKEN, { nowSec: NOW }), /подпись/);
});

test('порядок параметров в строке не важен', () => {
  const q = new URLSearchParams(sign(tgUser(42)));
  const reversed = new URLSearchParams([...q.entries()].reverse()).toString();
  assert.equal(verifyInitData(reversed, BOT_TOKEN, { nowSec: NOW }).user.id, 42);
});

test('поле signature входит в проверяемую строку, исключается только hash', () => {
  const extra = { signature: 'c2lnbmF0dXJlLXRlc3Q', start_param: 'ref1' };
  const r = verifyInitData(sign(tgUser(42), { extra }), BOT_TOKEN, { nowSec: NOW });
  assert.equal(r.user.id, 42);
  assert.equal(r.startParam, 'ref1');
});

test('устаревшие данные (старше INITDATA_MAX_AGE_SEC) и «из будущего» отклоняются', () => {
  const d = sign(tgUser(42));
  assert.equal(verifyInitData(d, BOT_TOKEN, { nowSec: NOW + 86400 }).user.id, 42, 'ровно сутки ещё можно');
  fails(() => verifyInitData(d, BOT_TOKEN, { nowSec: NOW + 86401 }), /устарели/);
  fails(() => verifyInitData(d, BOT_TOKEN, { nowSec: NOW - 301 }), /будущего/);
  assert.equal(verifyInitData(d, BOT_TOKEN, { nowSec: NOW - 60 }).user.id, 42, 'небольшой разброс часов допустим');
  fails(() => verifyInitData(d, BOT_TOKEN, { nowSec: NOW + 700, maxAgeSec: 600 }), /устарели/);
});

test('пустое, без hash, с неверным hash, слишком длинное', () => {
  fails(() => verifyInitData('', BOT_TOKEN), /пусто/);
  fails(() => verifyInitData(undefined, BOT_TOKEN), /пусто/);
  fails(() => verifyInitData('a'.repeat(9000), BOT_TOKEN), /длинно/);
  fails(() => verifyInitData('auth_date=1&user=%7B%7D', BOT_TOKEN), /hash/);
  fails(() => verifyInitData('auth_date=1&hash=zzz', BOT_TOKEN), /hash/);
  fails(() => verifyInitData('auth_date=1&hash=' + '0'.repeat(64), BOT_TOKEN, { nowSec: 5 }), /подпись/);
});

test('подписано верно, но пользователя нет или id некорректный', () => {
  const params = { auth_date: String(NOW) };
  fails(() => verifyInitData(new URLSearchParams({ ...params, hash: signParams(params) }).toString(), BOT_TOKEN, { nowSec: NOW }), /user/);
  for (const bad of [{ id: 0 }, { id: -5 }, { id: 1.5 }, { id: '42' }, {}]) {
    const p = { auth_date: String(NOW), user: JSON.stringify(bad) };
    fails(() => verifyInitData(new URLSearchParams({ ...p, hash: signParams(p) }).toString(), BOT_TOKEN, { nowSec: NOW }), /user/);
  }
  const p = { auth_date: String(NOW), user: '{не json' };
  fails(() => verifyInitData(new URLSearchParams({ ...p, hash: signParams(p) }).toString(), BOT_TOKEN, { nowSec: NOW }), /user/);
});

test('auth_date должен быть положительным целым', () => {
  for (const ad of ['0', '-1', 'abc', '1.5', '']) {
    const p = { auth_date: ad, user: JSON.stringify(tgUser(1)) };
    fails(() => verifyInitData(new URLSearchParams({ ...p, hash: signParams(p) }).toString(), BOT_TOKEN, { nowSec: NOW }), /auth_date/);
  }
});
