// SQLite (встроенный node:sqlite, без внешних зависимостей): схема, миграции, транзакции, резервные копии.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';

/* ---------------- схема ---------------- */
const SCHEMA_V1 = `
CREATE TABLE users (
  tg_id INTEGER PRIMARY KEY,
  username TEXT, first_name TEXT, last_name TEXT, language_code TEXT,
  terms_version TEXT, terms_accepted_at INTEGER,
  is_blocked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL
);

-- Товары. kind = тип права доступа; category = полка в магазине; grant_json = что именно выдаётся.
CREATE TABLE products (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 2 AND 48),
  category TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  family TEXT NOT NULL DEFAULT '' CHECK (family IN ('','wh','op','sc')),   -- стиль встроенного превью: Warhammer / One Piece / Scrooge
  rights_status TEXT NOT NULL DEFAULT 'own' CHECK (rights_status IN ('own','licensed','pending')),   -- pending: права на изображения не подтверждены, товар скрыт от обычных пользователей
  preview_url TEXT,
  price_stars INTEGER NOT NULL CHECK (price_stars BETWEEN 1 AND 100000),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','hidden','soldout','archived')),
  grant_json TEXT NOT NULL DEFAULT '{}',
  max_per_user INTEGER NOT NULL DEFAULT 1 CHECK (max_per_user >= 0),   -- 0 = без ограничения
  sort INTEGER NOT NULL DEFAULT 100,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

-- Заказ создаётся на сервере; его id уходит в invoice_payload. Цена и товар фиксируются снимком.
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  tg_id INTEGER NOT NULL REFERENCES users(tg_id),
  product_id TEXT NOT NULL REFERENCES products(id),
  product_snapshot TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'XTR' CHECK (currency = 'XTR'),
  status TEXT NOT NULL CHECK (status IN ('created','pending','paid','cancelled','expired','failed','refunded')),
  invoice_link TEXT,
  precheckout_at INTEGER,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  paid_at INTEGER, refunded_at INTEGER, note TEXT
);
CREATE INDEX idx_orders_user ON orders(tg_id, created_at DESC);
CREATE INDEX idx_orders_status ON orders(status, expires_at);

-- Платежи Stars. charge_id (telegram_payment_charge_id) уникален: повторная обработка невозможна.
CREATE TABLE payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  charge_id TEXT NOT NULL UNIQUE,
  provider_charge_id TEXT,
  order_id TEXT REFERENCES orders(id),
  tg_id INTEGER,
  amount INTEGER NOT NULL, currency TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL CHECK (status IN ('succeeded','refund_pending','refunded','anomaly')),
  anomaly TEXT,
  source TEXT NOT NULL DEFAULT 'webhook',
  created_at INTEGER NOT NULL,
  refund_from TEXT, refund_requested_at INTEGER, refunded_at INTEGER, refund_reason TEXT, refunded_by TEXT, refund_error TEXT,
  resolved_at INTEGER, resolve_note TEXT,
  raw_json TEXT
);
CREATE INDEX idx_payments_user ON payments(tg_id, created_at DESC);
CREATE INDEX idx_payments_created ON payments(created_at);
CREATE INDEX idx_payments_order ON payments(order_id);

-- Права доступа. Источник правды о том, что купил/получил пользователь.
CREATE TABLE entitlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL REFERENCES users(tg_id),
  product_id TEXT NOT NULL REFERENCES products(id),
  kind TEXT NOT NULL,
  grant_json TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('purchase','admin','refund_debit')),
  order_id TEXT REFERENCES orders(id),
  payment_id INTEGER REFERENCES payments(id),
  debit_of INTEGER REFERENCES entitlements(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at INTEGER NOT NULL,
  granted_by TEXT,
  revoked_at INTEGER, revoke_reason TEXT, revoked_by TEXT,
  claimed_at INTEGER
);
CREATE INDEX idx_ent_user ON entitlements(tg_id, status);
CREATE UNIQUE INDEX uq_ent_order_product ON entitlements(order_id, product_id) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX uq_ent_debit ON entitlements(debit_of) WHERE debit_of IS NOT NULL;

-- Идемпотентность вебхука: каждое обновление Telegram обрабатывается один раз.
CREATE TABLE processed_updates (update_id INTEGER PRIMARY KEY, kind TEXT, created_at INTEGER NOT NULL);

-- Журнал действий администраторов.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL,
  actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT, details TEXT
);
CREATE INDEX idx_audit_ts ON audit_log(ts DESC);

-- Журнал платёжных событий (создание заказа, pre_checkout, оплата, возврат, аномалии, сверка).
CREATE TABLE events_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL,
  type TEXT NOT NULL, ref TEXT, tg_id INTEGER, data TEXT
);
CREATE INDEX idx_events_ts ON events_log(ts DESC);
CREATE INDEX idx_events_type ON events_log(type, ts DESC);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);

-- Загруженные админом файлы (хранятся на диске в DATA_DIR/media).
CREATE TABLE media (
  id TEXT PRIMARY KEY, mime TEXT NOT NULL, size INTEGER NOT NULL,
  label TEXT, uploaded_by TEXT, created_at INTEGER NOT NULL
);
`;

// v2: напоминания «Возвращение к своему пути». Личные данные (цель, названия направлений) хранятся ТОЛЬКО при включённых
// напоминаниях и удаляются при отключении; в журнал попадает не текст сообщения, а его id из библиотеки.
const SCHEMA_V2 = `
CREATE TABLE reminder_settings (
  tg_id INTEGER PRIMARY KEY REFERENCES users(tg_id),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  tz TEXT NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}',
  chat_state TEXT NOT NULL DEFAULT 'unknown' CHECK (chat_state IN ('unknown','ok','blocked')),   -- можно ли боту писать пользователю
  chat_state_at INTEGER,
  can_write INTEGER NOT NULL DEFAULT 0 CHECK (can_write IN (0,1)),   -- пользователь разрешил писать (requestWriteAccess / allows_write_to_pm)
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX idx_rem_enabled ON reminder_settings(enabled, chat_state);

CREATE TABLE reminder_snapshot (
  tg_id INTEGER PRIMARY KEY REFERENCES users(tg_id),
  snapshot_json TEXT NOT NULL,
  last_active_at INTEGER,
  updated_at INTEGER NOT NULL
);

-- Одна строка на (пользователь, вид, слот): уникальный индекс защищает от повторной отправки.
CREATE TABLE reminder_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('daily','weekly','inactivity','test')),
  slot TEXT NOT NULL,
  day TEXT NOT NULL,
  text_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('sending','sent','failed','blocked','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, sent_at INTEGER
);
CREATE UNIQUE INDEX uq_rem_slot ON reminder_log(tg_id, kind, slot);
CREATE INDEX idx_rem_user ON reminder_log(tg_id, id DESC);
CREATE INDEX idx_rem_created ON reminder_log(created_at);
`;

const MIGRATIONS = [SCHEMA_V1, SCHEMA_V2];
export const SCHEMA_VERSION = MIGRATIONS.length;

export function migrate(db) {
  const cur = db.prepare('PRAGMA user_version').get().user_version;
  if (cur > MIGRATIONS.length) throw new Error(`База создана более новой версией сервера (schema ${cur} > ${MIGRATIONS.length}).`);
  for (let v = cur; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(MIGRATIONS[v]); db.exec(`PRAGMA user_version = ${v + 1}`); db.exec('COMMIT'); }
    catch (e) { try { db.exec('ROLLBACK'); } catch { /* ignore */ } throw e; }
  }
}

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;');
  migrate(db);
  if (file !== ':memory:') { try { fs.chmodSync(file, 0o600); } catch { /* ignore */ } }
  return db;
}

/* ---------------- запросы ---------------- */
const cache = new WeakMap();
function stmt(db, sql) {
  let m = cache.get(db);
  if (!m) { m = new Map(); cache.set(db, m); }
  let s = m.get(sql);
  if (!s) { s = db.prepare(sql); m.set(sql, s); }
  return s;
}
export const one = (db, sql, ...p) => stmt(db, sql).get(...p) ?? null;
export const all = (db, sql, ...p) => stmt(db, sql).all(...p);
export const run = (db, sql, ...p) => stmt(db, sql).run(...p);

const depth = new WeakMap();
/** Транзакция BEGIN IMMEDIATE. Внутри fn нельзя использовать await. Вложенные вызовы идут в той же транзакции. */
export function tx(db, fn) {
  const d = depth.get(db) || 0;
  if (d > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth.set(db, 1);
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally { depth.set(db, 0); }
}

/* ---------------- резервные копии ---------------- */
const pad = n => String(n).padStart(2, '0');
export const stamp = ms => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`; };

export function listBackups(dir) {
  try {
    return fs.readdirSync(dir).filter(f => /^mandala-\d{8}-\d{6}(-\d+)?\.sqlite\.gz$/.test(f)).sort().map(f => {
      const st = fs.statSync(path.join(dir, f));
      return { file: f, size: st.size, mtime: st.mtimeMs };
    });
  } catch { return []; }
}

/** Консистентная копия через VACUUM INTO → проверка integrity_check → gzip → ротация. */
export async function backupDb(db, dir, { keep = 28, now = Date.now() } = {}) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  let base = `mandala-${stamp(now)}`;
  for (let i = 1; fs.existsSync(path.join(dir, base + '.sqlite.gz')) || fs.existsSync(path.join(dir, base + '.sqlite')); i++) base = `mandala-${stamp(now)}-${i}`;
  const raw = path.join(dir, base + '.sqlite');
  db.exec(`VACUUM INTO '${raw.replace(/'/g, "''")}'`);
  try {
    const chk = new DatabaseSync(raw, { readOnly: true });
    try {
      const r = chk.prepare('PRAGMA integrity_check').get();
      if (!r || r.integrity_check !== 'ok') throw new Error('integrity_check копии: ' + JSON.stringify(r));
    } finally { chk.close(); }
    const gz = raw + '.gz';
    await pipeline(fs.createReadStream(raw), zlib.createGzip({ level: 6 }), fs.createWriteStream(gz, { mode: 0o600 }));
    const size = fs.statSync(gz).size;
    const all_ = listBackups(dir);
    for (const b of all_.slice(0, Math.max(0, all_.length - keep))) { try { fs.unlinkSync(path.join(dir, b.file)); } catch { /* ignore */ } }
    return { file: path.basename(gz), size };
  } finally { try { fs.unlinkSync(raw); } catch { /* ignore */ } }
}
