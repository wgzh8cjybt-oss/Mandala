// Загрузки администратора: проверка по содержимому (magic bytes), лимиты размера, случайные имена. SVG не принимается.
import fs from 'node:fs';
import path from 'node:path';
import { all, one, run, tx } from './db.js';
import { audit } from './ctx.js';
import { HttpError, randomId } from './util.js';

export const MEDIA_RE = /^[A-Za-z0-9_-]{8,64}\.(png|jpg|webp|gif|webm|mp4)$/;
export const MIME = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', webm: 'video/webm', mp4: 'video/mp4' };
export const LIMITS = { image: 4 * 1024 * 1024, video: 12 * 1024 * 1024 };

/** Определяет тип по сигнатуре файла. Заголовок Content-Type клиента не учитывается. */
export function sniff(b) {
  if (!Buffer.isBuffer(b) || b.length < 12) return null;
  if (b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (/^GIF8[79]a/.test(b.toString('latin1', 0, 6))) return 'gif';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  if (b.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
  return null;
}

export const mediaDir = ctx => path.join(ctx.cfg.dataDir, 'media');

export function saveMedia(ctx, buf, { label, actor }) {
  const ext = sniff(buf);
  if (!ext) throw new HttpError(415, 'bad_media', 'Допустимы PNG, JPEG, WebP, GIF, WebM, MP4 (по содержимому файла). SVG не принимается.');
  const isVideo = ext === 'webm' || ext === 'mp4';
  if (buf.length > (isVideo ? LIMITS.video : LIMITS.image)) throw new HttpError(413, 'too_large', `Файл слишком большой (максимум ${isVideo ? '12' : '4'} МБ).`);
  const id = randomId('', 12);
  const name = `${id}.${ext}`;
  fs.mkdirSync(mediaDir(ctx), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(mediaDir(ctx), name), buf, { mode: 0o600 });
  tx(ctx.db, () => {
    run(ctx.db, 'INSERT INTO media(id, mime, size, label, uploaded_by, created_at) VALUES (?,?,?,?,?,?)', id, MIME[ext], buf.length, label ? String(label).slice(0, 80) : null, String(actor), ctx.now());
    audit(ctx, actor, 'media.upload', name, { size: buf.length, label: label || null });
  });
  return { id, url: '/media/' + name, mime: MIME[ext], size: buf.length };
}

export const listMedia = (ctx, limit = 200) => all(ctx.db, 'SELECT id, mime, size, label, uploaded_by, created_at FROM media ORDER BY created_at DESC LIMIT ?', limit)
  .map(m => ({ ...m, url: '/media/' + m.id + '.' + Object.keys(MIME).find(k => MIME[k] === m.mime) }));

export function deleteMedia(ctx, id, actor) {
  const m = one(ctx.db, 'SELECT * FROM media WHERE id = ?', id);
  if (!m) throw new HttpError(404, 'not_found', 'Файл не найден');
  const ext = Object.keys(MIME).find(k => MIME[k] === m.mime), url = `/media/${id}.${ext}`;
  if (one(ctx.db, 'SELECT 1 FROM products WHERE preview_url = ? OR grant_json LIKE ?', url, '%' + url + '%')) throw new HttpError(409, 'in_use', 'Файл используется в товаре — сначала замените его.');
  tx(ctx.db, () => { run(ctx.db, 'DELETE FROM media WHERE id = ?', id); audit(ctx, actor, 'media.delete', url); });
  try { fs.unlinkSync(path.join(mediaDir(ctx), `${id}.${ext}`)); } catch { /* уже нет */ }
}
