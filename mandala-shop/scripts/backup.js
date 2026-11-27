// Ручная резервная копия: node scripts/backup.js  (можно вызывать из cron; безопасно при работающем сервере)
import path from 'node:path';
import { loadConfig, loadDotEnv } from '../src/config.js';
import { backupDb, openDb } from '../src/db.js';

loadDotEnv();
let cfg;
try { cfg = loadConfig(); } catch (e) { console.error(e.message); process.exit(1); }
const db = openDb(path.join(cfg.dataDir, 'mandala.sqlite'));
const r = await backupDb(db, path.join(cfg.dataDir, 'backups'), { keep: cfg.backupKeep });
console.log('Копия создана:', path.join(cfg.dataDir, 'backups', r.file), r.size, 'байт');
db.close();
