// JSON-логгер. Все известные секреты (токен бота, секрет вебхука, токен админа) вычищаются из каждой строки.
const ORDER = { debug: 10, info: 20, warn: 30, error: 40 };

function replacer(_k, v) {
  if (v instanceof Error) return { name: v.name, message: v.message, code: v.code, status: v.status, stack: v.stack };
  if (typeof v === 'bigint') return String(v);
  return v;
}

export function createLogger({ secrets = [], level = 'info', sink } = {}) {
  const min = ORDER[level] ?? ORDER.info;
  const out = sink || (line => process.stdout.write(line + '\n'));
  const list = () => secrets.filter(s => s && String(s).length >= 6).map(String);
  const scrub = str => { let r = str; for (const s of list()) r = r.split(s).join('***'); return r; };
  const emit = (lvl, msg, data) => {
    if (ORDER[lvl] < min) return;
    const rec = { t: new Date().toISOString(), level: lvl, msg };
    if (data !== undefined) rec.data = data;
    let line;
    try { line = JSON.stringify(rec, replacer); } catch { line = JSON.stringify({ t: rec.t, level: lvl, msg }); }
    out(scrub(line));
  };
  return {
    debug: (m, d) => emit('debug', m, d),
    info: (m, d) => emit('info', m, d),
    warn: (m, d) => emit('warn', m, d),
    error: (m, d) => emit('error', m, d),
    scrub,
    addSecret: s => { if (s) secrets.push(s); }
  };
}
