/* Проверка расчёта аналитики и сроков без браузера: модули 01-core, 02-game, 02b-stats исполняются в изолированном контексте vm.
   Запуск: node tests/stats.cjs  (часовой пояс можно менять: TZ=America/New_York node tests/stats.cjs) */
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const root = path.join(__dirname, '..');
const src = ['01-core.js', '02-game.js', '02b-stats.js'].map(f => fs.readFileSync(path.join(root, 'src/js', f), 'utf8')).join('\n');

const ls = {};
const ctx = vm.createContext({
  window: { addEventListener() {} }, document: { addEventListener() {}, hidden: false },
  localStorage: { getItem: k => (k in ls ? ls[k] : null), setItem: (k, v) => { ls[k] = String(v); }, removeItem: k => { delete ls[k]; } },
  FIGURES: [], console, setTimeout: () => 1, clearTimeout() {}, Math, Date, JSON, Object, Array, String, Number, Set, RegExp, isFinite, parseInt, parseFloat
});
vm.runInContext(src + '\nvar __ok = 1;', ctx, { filename: 'bundle.js' });
const run = code => vm.runInContext(code, ctx);

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e && e.message || e)); } };
console.log('TZ=' + (process.env.TZ || 'system') + ' · ' + new Date().toString().slice(25, 60));

/* ---------- даты ---------- */
t('Dt.add / diff через переход на летнее время', () => {
  assert.strictEqual(run("Dt.add('2026-03-28', 2)"), '2026-03-30');
  assert.strictEqual(run("Dt.add('2026-03-30', -2)"), '2026-03-28');
  assert.strictEqual(run("Dt.diff('2026-03-28', '2026-03-30')"), 2);
  assert.strictEqual(run("Dt.add('2026-10-24', 3)"), '2026-10-27');
  assert.strictEqual(run("Dt.diff('2026-10-24', '2026-10-27')"), 3);
  assert.strictEqual(run("Dt.add('2026-11-01', 1)"), '2026-11-02');
  assert.strictEqual(run("Dt.add('2026-12-31', 1)"), '2027-01-01');
  assert.strictEqual(run("Dt.add('2028-02-28', 1)"), '2028-02-29');
  assert.strictEqual(run("Dt.diff('2026-01-01', '2027-01-01')"), 365);
});
t('Dt.dow: понедельник = 0', () => {
  assert.strictEqual(run("Dt.dow('2026-11-16')"), 0);   // 16 ноября 2026 — понедельник
  assert.strictEqual(run("Dt.dow('2026-11-22')"), 6);
});
t('Dt.plural / rel / fmt', () => {
  assert.strictEqual(run("Dt.num(1, ['день','дня','дней'])"), '1 день');
  assert.strictEqual(run("Dt.num(2, ['день','дня','дней'])"), '2 дня');
  assert.strictEqual(run("Dt.num(5, ['день','дня','дней'])"), '5 дней');
  assert.strictEqual(run("Dt.num(11, ['день','дня','дней'])"), '11 дней');
  assert.strictEqual(run("Dt.num(21, ['день','дня','дней'])"), '21 день');
  assert.strictEqual(run("Dt.rel('2026-11-21','2026-11-21')"), 'сегодня');
  assert.strictEqual(run("Dt.rel('2026-11-22','2026-11-21')"), 'завтра');
  assert.strictEqual(run("Dt.rel('2026-11-18','2026-11-21')"), 'просрочено на 3 дня');
  assert.strictEqual(run("Dt.fmt('2026-11-05')"), '5 ноября');
  assert.strictEqual(run("Dt.fmt('2026-11-05', true)"), '5 ноября 2026');
});
t('isDay: только настоящие даты 2000–2100', () => {
  assert.ok(run("isDay('2026-11-21')"));
  assert.ok(run("isDay('2028-02-29')"));
  ['2027-02-29', '2026-13-01', '2026-00-10', '2026-11-31', '1999-12-31', '2101-01-01', '2026-1-1', '', null, 5, '2026-11-21T00:00'].forEach(v => assert.ok(!run('isDay(' + JSON.stringify(v) + ')'), String(v)));
});

/* ---------- состояние ---------- */
t('normalizeState хранит due/dn и выбрасывает мусор', () => {
  const r = run(`(() => {
    const st = defaults(), m = st.mandals[0];
    m.cells[40] = { text: 'Цель', completed: true, awarded: true, due: '2026-12-31', dn: 1700000000000 };
    m.cells[1] = { text: 'Плохая дата', completed: false, awarded: false, due: '2026-02-30', dn: 5 };
    m.cells[2] = { text: '', completed: false, awarded: false, due: '2026-12-31' };
    m.cells[3] = { text: 'Без выполнения', completed: false, awarded: false, due: '2026-05-05', dn: 1700000000000 };
    const n = normalizeState(JSON.parse(JSON.stringify(st)), false), c = n.mandals[0].cells;
    return { a: c[40].due, b: c[40].dn, c: c[1].due, d: c[1].dn, e: c[2].due, f: c[3].due, g: c[3].dn };
  })()`);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), { a: '2026-12-31', b: 1700000000000, f: '2026-05-05' });
});
t('normStats ограничивает журнал и чистит поля', () => {
  const r = run(`(() => {
    const ev = []; for (let i = 0; i < 3000; i++) ev.push([1700000000000 + i, 'c', 1, i % 81]);
    ev.push([1, 'z', 1, 1], 'мусор', [0, 'c', 1, 1]);
    const n = normStats({ since: 1700000000000, last: 'x', days: { '2026-11-01': { c: 3, v: -4, e: 'a' }, 'плохо': { c: 1 } }, ev });
    return { len: n.ev.length, days: Object.keys(n.days), d: n.days['2026-11-01'], last: n.last };
  })()`);
  assert.strictEqual(r.len, 2500); assert.deepStrictEqual(r.days, ['2026-11-01']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.d)), { v: 0, c: 3, u: 0, e: 0, a: 0, t: 0 }); assert.strictEqual(r.last, 0);
});

/* ---------- applyCell: срок и дата выполнения ---------- */
t('applyCell: due и dn живут по правилам', () => {
  const r = run(`(() => {
    S = defaults(); const m = S.mandals[0], o = [];
    applyCell(m, 40, 'Главная', false);
    applyCell(m, 0, 'Задача', false, '2026-12-01');            o.push([m.cells[0].due, m.cells[0].dn]);
    applyCell(m, 0, 'Задача', false);                          o.push([m.cells[0].due, m.cells[0].dn]);   // срок не передан — остаётся
    applyCell(m, 0, 'Задача', true);                           o.push([m.cells[0].due, typeof m.cells[0].dn]);
    const dn1 = m.cells[0].dn;
    applyCell(m, 0, 'Задача (правка)', true);                  o.push([m.cells[0].dn === dn1]);            // повторное сохранение не сдвигает дату выполнения
    applyCell(m, 0, 'Задача (правка)', false);                 o.push([m.cells[0].due, m.cells[0].dn]);   // отмена снимает dn, срок остаётся
    applyCell(m, 0, 'Задача (правка)', false, '');             o.push([m.cells[0].due]);                   // '' убирает срок
    applyCell(m, 0, 'Задача', false, 'неправда');              o.push([m.cells[0].due]);
    applyCell(m, 0, 'Задача', false, '2026-12-05');
    applyCell(m, 0, '', true, '2026-12-05');                   o.push([m.cells[0].text, m.cells[0].completed, m.cells[0].due, m.cells[0].dn]);   // пустая ячейка срока не держит
    return o;
  })()`);
  const j = JSON.parse(JSON.stringify(r));
  assert.deepStrictEqual(j[0], ['2026-12-01', undefined].map(x => x === undefined ? null : x));
  assert.deepStrictEqual(j[1], ['2026-12-01', null]);
  assert.deepStrictEqual(j[2], ['2026-12-01', 'number']);
  assert.deepStrictEqual(j[3], [true]);
  assert.deepStrictEqual(j[4], ['2026-12-01', null]);
  assert.deepStrictEqual(j[5], [null]);
  assert.deepStrictEqual(j[6], [null]);
  assert.deepStrictEqual(j[7], ['', false, null, null]);
});
t('applyCell: подцель-зеркало сбрасывает срок вместе с текстом', () => {
  const r = run(`(() => {
    S = defaults(); const m = S.mandals[0];
    applyCell(m, 40, 'Главная', false);
    applyCell(m, 31, 'Подцель', false);               // центр блока 4, зеркалится в центр блока 1 (клетка 10)
    const mirror = subMirrorTarget(31);
    m.cells[mirror].due = '2026-12-01';
    applyCell(m, 31, '', false);
    return [m.cells[mirror].text, m.cells[mirror].due === undefined];
  })()`);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), ['', true]);
});
t('журнал событий: выполнение, отмена, правка, новая цель', () => {
  const r = run(`(() => {
    S = defaults(); const m = S.mandals[0];
    applyCell(m, 40, 'Главная', false);
    applyCell(m, 0, 'А', false); applyCell(m, 0, 'А', true); applyCell(m, 0, 'А', false); applyCell(m, 0, 'Б', false);
    const k = S.stats.ev.map(e => e[1]).join('');
    return { k, day: JSON.stringify(S.stats.days[dayKey()]) };
  })()`);
  assert.ok(/^g?e?/.test(r.k) && r.k.includes('c') && r.k.includes('u'), r.k);
  const d = JSON.parse(r.day); assert.strictEqual(d.c, 1); assert.strictEqual(d.u, 1); assert.ok(d.e >= 1);
});
t('Stats.rec: дубль за 1,5 с отбрасывается; visit — новая сессия после 30 мин', () => {
  const r = run(`(() => {
    S = defaults(); const base = Date.UTC(2026, 10, 10, 9, 0, 0);
    const a = Stats.rec('e', 1, 5, base), b = Stats.rec('e', 1, 5, base + 500), c2 = Stats.rec('e', 1, 5, base + 5000);
    S.stats.last = 0;
    const v1 = Stats.visit(base), v2 = Stats.visit(base + 10 * 60e3), v3 = Stats.visit(base + 50 * 60e3);
    const o1 = Stats.open(7, base), o2 = Stats.open(7, base + 60e3), o3 = Stats.open(7, base + 11 * 60e3);
    const w1 = Stats.viewed(base), w2 = Stats.viewed(base + 60e3), w3 = Stats.viewed(base + 6 * 60e3);
    return { a, b, c2, v1, v2, v3, o1, o2, o3, w1, w2, w3, vis: S.stats.ev.filter(e => e[1] === 'v').length };
  })()`);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), { a: true, b: false, c2: true, v1: true, v2: false, v3: true, o1: true, o2: false, o3: true, w1: true, w2: false, w3: true, vis: 2 });
});
t('dueState: все состояния', () => {
  const r = run(`(() => {
    const today = '2026-11-21', dn = (k, h) => new Date(k + 'T' + (h || '12') + ':00:00').getTime(), o = [];
    o.push(Stats.dueState({ text: 'x' }, today));
    o.push(Stats.dueState({ text: 'x', due: '2026-11-20' }, today));
    o.push(Stats.dueState({ text: 'x', due: '2026-11-21' }, today));
    o.push(Stats.dueState({ text: 'x', due: '2026-11-24' }, today));
    o.push(Stats.dueState({ text: 'x', due: '2026-11-25' }, today));
    o.push(Stats.dueState({ text: 'x', due: '2026-11-20', completed: true, dn: dn('2026-11-20', '23') }, today));
    o.push(Stats.dueState({ text: 'x', due: '2026-11-20', completed: true, dn: dn('2026-11-21', '00') }, today));
    o.push(Stats.dueState({ text: 'x', due: '2026-11-20', completed: true }, today));
    return o;
  })()`);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), ['', 'over', 'today', 'soon', 'later', 'ok', 'late', 'done']);
});

/* ---------- модель ---------- */
/* Строит состояние: список [номер ячейки, день выполнения 'ГГГГ-ММ-ДД' | null] и сроки; today = '2026-11-21' */
function build(spec) {
  return run(`(() => {
    S = defaults(); const m = S.mandals[0], sp = ${JSON.stringify(spec)};
    m.cells[40] = { text: 'Цель', completed: false, awarded: false };
    sp.tasks.forEach(t => {
      const c = { text: 'Задача ' + t.i, completed: !!t.done, awarded: !!t.done };
      if (t.due) c.due = t.due;
      if (t.done && t.on) c.dn = new Date(t.on + 'T12:00:00').getTime();
      m.cells[t.i] = c;
    });
    S.stats.since = new Date(sp.since + 'T08:00:00').getTime();
    (sp.visits || []).forEach(k => { const x = S.stats.days[k] || (S.stats.days[k] = { v: 0, c: 0, u: 0, e: 0, a: 0, t: 0 }); x.v++; });
    (sp.activity || []).forEach(k => { S.activity[k] = (S.activity[k] || 0) + 1; });
    return 1;
  })()`);
}
const TODAY = '2026-11-21', NOW = new Date(TODAY + 'T15:00:00').getTime();
const days = (from, n) => Array.from({ length: n }, (_, j) => run(`Dt.add('${from}', ${j})`));
const cellIds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 33, 34, 35, 36, 37, 38, 39, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67];
const model = (scope, period) => JSON.parse(JSON.stringify(run(`(() => { const m = Stats.model(S, ${NOW}, ${scope ? JSON.stringify(scope) : 'undefined'}, ${period || 30}); const o = Object.assign({}, m); delete o.ctx; delete o.span; delete o.days; delete o.tasks; return o; })()`)));

t('пустая мандала: данных мало, оценки нет, всё конечное', () => {
  build({ since: TODAY, tasks: [] });
  const m = model();
  assert.strictEqual(m.enough, false); assert.strictEqual(m.score, null); assert.ok(m.why.length > 0);
  assert.strictEqual(m.N, 1); assert.strictEqual(m.D, 0);   // в расчёт входит и главная цель (клетка 40)
  assert.ok(Stats_explain().includes('Недостаточно'));
});
function Stats_explain() { return run('Stats.explain(Stats.model(S, ' + NOW + '))'); }

t('регулярная активность за месяц даёт высокую оценку', () => {
  const dd = days('2026-10-22', 31);                 // 22 октября … 21 ноября
  const tasks = dd.slice(0, 30).map((k, j) => ({ i: cellIds[j], done: true, on: k }));
  cellIds.slice(30, 50).forEach(i => tasks.push({ i, done: false }));
  build({ since: '2026-10-20', tasks, visits: dd });
  const m = model();
  assert.strictEqual(m.D, 30); assert.strictEqual(m.N, 51);
  assert.ok(m.enough, m.why);
  assert.ok(m.score >= 70 && m.score <= 99, 'score=' + m.score);
  assert.ok(m.streak.cur >= 20, 'streak=' + m.streak.cur);
  assert.ok(m.pace > 5 && m.pace < 8, 'pace=' + m.pace);
  assert.ok(m.eta && m.eta > TODAY, 'eta=' + m.eta);
  assert.strictEqual(m.deadlines.n, 0); assert.strictEqual(m.cDead, null);
  const sum = m.comps.reduce((a, c) => a + c.we, 0); assert.ok(Math.abs(sum - 1) < 1e-9, 'веса: ' + sum);
  assert.deepStrictEqual(m.comps.map(c => c.id), ['reg', 'pace', 'prog']);
});
t('давняя активность и пауза: оценка низкая, прогноз пропадает', () => {
  const dd = days('2026-09-01', 10);
  const tasks = dd.map((k, j) => ({ i: cellIds[j], done: true, on: k }));
  cellIds.slice(10, 40).forEach(i => tasks.push({ i, done: false }));
  build({ since: '2026-08-30', tasks });
  const m = model();
  assert.ok(m.enough, m.why); assert.ok(m.score < 40, 'score=' + m.score);
  assert.strictEqual(m.streak.cur, 0); assert.ok(m.idle >= 60);
  assert.strictEqual(m.eta, null);
  assert.ok(Stats_explain().includes('снизилась'));
});
t('сроки: вовремя / с опозданием / просрочено / впереди', () => {
  const tasks = [
    { i: 0, done: true, on: '2026-11-10', due: '2026-11-12' },     // вовремя
    { i: 1, done: true, on: '2026-11-15', due: '2026-11-12' },     // с опозданием
    { i: 2, done: false, due: '2026-11-18' },                      // просрочена
    { i: 3, done: false, due: '2026-11-21' },                      // сегодня
    { i: 4, done: false, due: '2026-11-23' },                      // скоро
    { i: 5, done: false, due: '2026-12-30' },                      // позже
    { i: 6, done: true, due: '2026-11-01' },                       // выполнена, когда — неизвестно
    { i: 7, done: true, on: '2026-11-14' }, { i: 8, done: true, on: '2026-11-17' }, { i: 9, done: true, on: '2026-11-19' }
  ];
  cellIds.slice(10, 30).forEach(i => tasks.push({ i, done: false }));
  build({ since: '2026-11-03', tasks, activity: ['2026-11-04'] });
  const m = model(), d = m.deadlines;
  assert.deepStrictEqual([d.ok, d.late, d.over, d.today, d.soon, d.later, d.unknown, d.pending, d.n], [1, 1, 1, 1, 1, 1, 1, 3, 7]);
  assert.ok(d.score != null && d.score > 0 && d.score < 1, 'compliance=' + d.score);
  const over = d.items.find(x => x.st === 'over'); assert.strictEqual(over.P, 0);
  const fut = d.items.filter(x => x.pend && x.due >= TODAY).sort((a, b) => a.due < b.due ? -1 : 1);
  assert.deepStrictEqual(fut.map(x => x.n), [2, 3, 4]);           // 1 просроченная уже висит на очереди, дальше по порядку сроков
  fut.forEach(x => assert.ok(x.P >= 0.02 && x.P <= 0.98));
  assert.ok(m.comps.some(c => c.id === 'dead'));
  const ins = JSON.parse(JSON.stringify(run('Stats.insights(Stats.model(S, ' + NOW + '))')));
  assert.ok(ins.some(x => x.tone === 'bad' && x.title.indexOf('Просрочено') === 0), JSON.stringify(ins.map(x => x.title)));
});
t('старые выполненные задачи без даты распределяются по журналу активности и сходятся в сумме', () => {
  const act = [];
  days('2026-10-25', 10).forEach(k => { act.push(k, k); });
  const tasks = cellIds.slice(0, 12).map(i => ({ i, done: true }));      // выполнено 12, дат нет
  cellIds.slice(12, 30).forEach(i => tasks.push({ i, done: false }));
  build({ since: '2026-11-10', tasks, activity: act });
  const d = run(`(() => { const m = Stats.model(S, ${NOW}); let s = 0; Object.keys(m.days).forEach(k => { s += m.days[k].c; }); return [s, m.D]; })()`);
  assert.ok(Math.abs(d[0] - d[1]) < 1e-6, JSON.stringify(d));
});
t('столбики и сравнение: суммы совпадают с журналом', () => {
  const dd = days('2026-10-22', 31);
  const tasks = dd.slice(0, 30).map((k, j) => ({ i: cellIds[j], done: true, on: k }));
  build({ since: '2026-10-20', tasks });
  const r = JSON.parse(JSON.stringify(run(`(() => { const m = Stats.model(S, ${NOW}), o = {};
    [7, 30, 90, 365].forEach(n => { const b = Stats.bars(m, n); o[n] = [b.length, Math.round(b.reduce((a, x) => a + x.c, 0))]; });
    o.cmp = Stats.compare(m, 7); return o; })()`)));
  assert.strictEqual(r[7][0], 7); assert.strictEqual(r[30][0], 30); assert.strictEqual(r[90][0], 13); assert.strictEqual(r[365][0], 12);
  // задачи закрыты с 22 октября по 20 ноября (30 штук), сегодня — 21 ноября, без задачи
  assert.strictEqual(r[7][1], 6); assert.strictEqual(r[30][1], 29);
  assert.strictEqual(r[90][1], 30); assert.strictEqual(r[365][1], 30);
  assert.strictEqual(r.cmp.tasks.cur, 6); assert.strictEqual(r.cmp.tasks.prev, 7);
});
t('series: две линии, последняя точка равна текущему значению', () => {
  const dd = days('2026-10-22', 31);
  const tasks = dd.slice(0, 30).map((k, j) => ({ i: cellIds[j], done: true, on: k, due: j % 3 === 0 ? dd[Math.min(30, j + 2)] : undefined }));
  cellIds.slice(30, 45).forEach((i, q) => tasks.push({ i, done: false, due: run(`Dt.add('${TODAY}', ${5 + q * 3})`) }));
  build({ since: '2026-10-20', tasks });
  const r = JSON.parse(JSON.stringify(run(`(() => { const m = Stats.model(S, ${NOW}); return { s30: Stats.series(m, 30), s7: Stats.series(m, 7), s365: Stats.series(m, 365), p: m.score, d: m.cDead == null ? null : Math.round(m.cDead * 100) }; })()`)));
  assert.ok(r.s30.length >= 20 && r.s30.length <= 62, 'точек ' + r.s30.length);
  assert.strictEqual(r.s30[r.s30.length - 1].k, TODAY);
  assert.strictEqual(r.s30[r.s30.length - 1].p, r.p); assert.strictEqual(r.s30[r.s30.length - 1].d, r.d);
  r.s30.forEach(x => { if (x.p != null) assert.ok(x.p >= 0 && x.p <= 100); if (x.d != null) assert.ok(x.d >= 0 && x.d <= 100); });
  assert.strictEqual(r.s7.length, 7); assert.ok(r.s365.length <= 62);
});
t('burnup и направления без NaN', () => {
  const dd = days('2026-10-22', 31);
  const tasks = dd.slice(0, 30).map((k, j) => ({ i: cellIds[j], done: true, on: k }));
  cellIds.slice(30, 50).forEach((i, q) => tasks.push({ i, done: false, due: q % 2 ? run(`Dt.add('${TODAY}', ${3 + q})`) : undefined }));
  build({ since: '2026-10-20', tasks });
  const o = run(`(() => { const m = Stats.model(S, ${NOW}); return { b: Stats.burnup(m), ins: Stats.insights(m), blocks: m.blocks, ex: Stats.explain(m) }; })()`);
  const bad = [];
  (function walk(v, p) { if (typeof v === 'number' && !isFinite(v)) bad.push(p); else if (v && typeof v === 'object') Object.keys(v).forEach(k => walk(v[k], p + '.' + k)); })(JSON.parse(JSON.stringify(o)), 'o');
  assert.deepStrictEqual(bad, []);
  assert.strictEqual(o.blocks.length, 8);
  assert.ok(o.b.actual.length > 10 && o.b.ymax >= 1);
  assert.ok(o.b.proj && o.b.proj.length === 2);
});
t('несколько мандал: срез по одной и по всем', () => {
  const r = run(`(() => {
    S = defaults(); const a = S.mandals[0]; applyCell(a, 40, 'Первая', false); applyCell(a, 0, 'А', true);
    const b = addMandala(); applyCell(b, 40, 'Вторая', false); applyCell(b, 1, 'Б', false); applyCell(b, 2, 'В', true);
    const all = Stats.model(S, Date.now(), 'all'), one = Stats.model(S, Date.now(), String(b.id)), first = Stats.model(S, Date.now(), String(a.id));
    return [all.N, all.D, all.total, one.N, one.D, one.total, first.N, first.D, one.scope === String(b.id)];
  })()`);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), [5, 2, 162, 3, 1, 81, 2, 1, true]);
});

console.log('\nИтог: ' + pass + ' ok, ' + fail + ' с ошибками');
process.exit(fail ? 1 : 0);
