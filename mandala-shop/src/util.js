// Мелкие общие помощники без внешних зависимостей.
import crypto from 'node:crypto';

/** Ошибка с HTTP-статусом и машинным кодом; сообщение показывается пользователю. */
export class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const randomId = (prefix, bytes = 12) => prefix + crypto.randomBytes(bytes).toString('base64url');
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest();
/** Сравнение секретов за постоянное время (хэшируем, чтобы не светить длину). */
export const safeEqual = (a, b) => crypto.timingSafeEqual(sha256(a), sha256(b));

export const isInt = v => Number.isSafeInteger(v);
export const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export function jsonParse(s, fallback = null) {
  if (s == null || s === '') return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}
/** Обрезка по числу символов (кодовых точек), без разрыва суррогатных пар. */
export function clip(s, max) {
  const a = Array.from(String(s ?? ''));
  return a.length <= max ? a.join('') : a.slice(0, max - 1).join('') + '…';
}
export const byteLen = s => Buffer.byteLength(String(s), 'utf8');

/** Экранирование для HTML-режима Telegram. */
export const escHtml = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/** Дата-ключ в заданном часовом поясе: YYYY-MM-DD / YYYY-MM (для отчётов). */
export function tzParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day };
}
export const dayKey = (ms, tz) => { const t = tzParts(ms, tz); return `${t.y}-${String(t.m).padStart(2, '0')}-${String(t.d).padStart(2, '0')}`; };
export const monthKey = (ms, tz) => dayKey(ms, tz).slice(0, 7);
/** Ключ ISO-недели (понедельник — начало), по локальной дате в поясе. */
export function weekKey(ms, tz) {
  const t = tzParts(ms, tz);
  const d = new Date(Date.UTC(t.y, t.m - 1, t.d));
  const dow = (d.getUTCDay() + 6) % 7;           // 0 = понедельник
  d.setUTCDate(d.getUTCDate() - dow);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
