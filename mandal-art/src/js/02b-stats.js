/* ============================================================
   02b-stats: даты, журнал событий и расчёт аналитики (Mandala Analytics, ТЗ №4)
   Без DOM: чистые функции от состояния s и времени now, поэтому расчёт можно проверять отдельно (tests/stats.cjs).

   Что считается прогрессом: выполнение задач (вес 1). Правка задачи (0,35) и запись в дневнике (0,5) — слабее.
   Простое открытие приложения в оценку НЕ входит: посещения только показываются в карточках.

   Success Score = взвешенное среднее доступных составляющих (веса из ТЗ):
     регулярность 30 · темп 30 · прогресс 25 · соблюдение сроков 15 (если у задач есть сроки; иначе веса пересчитываются).
   Это аналитическая оценка текущего темпа, а не гарантированная вероятность успеха.
   ============================================================ */
const Dt = (() => {
  const DAY = 864e5;
  const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const MONTHS_G = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const MONTHS_S = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const WD_FULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
  const WD_ACC = ['понедельникам', 'вторникам', 'средам', 'четвергам', 'пятницам', 'субботам', 'воскресеньям'];
  const p2 = n => String(n).padStart(2, '0');
  const parse = k => { const p = String(k).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).getTime(); };   // локальная полночь
  const key = ts => dayKey(ts);
  const make = (y, m, d) => y + '-' + p2(m + 1) + '-' + p2(d);                     // m — 0..11
  const add = (k, n) => { const d = new Date(parse(k) + 12 * 36e5); d.setDate(d.getDate() + n); return dayKey(d.getTime()); };
  const diff = (a, b) => Math.round((parse(b) - parse(a)) / DAY);                  // b − a в календарных днях
  const dow = k => (new Date(parse(k) + 12 * 36e5).getDay() + 6) % 7;              // понедельник = 0
  const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
  const plural = (n, f) => { n = Math.abs(Math.round(n)); const a = n % 10, b = n % 100; return f[(b > 10 && b < 20) ? 2 : a === 1 ? 0 : (a >= 2 && a <= 4) ? 1 : 2]; };
  const num = (n, f) => Math.round(n) + ' ' + plural(n, f);
  const fmt = (k, withYear) => { const p = String(k).split('-'); return (+p[2]) + ' ' + MONTHS_G[+p[1] - 1] + (withYear ? ' ' + p[0] : ''); };
  const fmtS = (k, withYear) => { const p = String(k).split('-'); return (+p[2]) + ' ' + MONTHS_S[+p[1] - 1] + (withYear ? ' ' + p[0] : ''); };
  const dm = k => { const p = String(k).split('-'); return p[2] + '.' + p[1]; };
  /** «сегодня», «завтра», «через 5 дн.», «просрочено на 2 дн.» */
  function rel(k, today) {
    const d = diff(today || dayKey(), k);
    if (d === 0) return 'сегодня'; if (d === 1) return 'завтра'; if (d === -1) return 'вчера';
    return d > 0 ? 'через ' + num(d, ['день', 'дня', 'дней']) : 'просрочено на ' + num(-d, ['день', 'дня', 'дней']);
  }
  return { DAY, MONTHS, MONTHS_G, MONTHS_S, WD, WD_FULL, WD_ACC, p2, parse, key, make, add, diff, dow, daysIn, plural, num, fmt, fmtS, dm, rel };
})();

const Stats = (() => {
  const GAP = 30 * 60e3, EV_MAX = 2500, OPEN_GAP = 10 * 60e3;
  const KINDS = 'vocuegna';
  const FIELD = { v: 'v', c: 'c', u: 'u', e: 'e', g: 'e', a: 'a' };      // 'g' (смена главной цели) считается правкой
  let lastSig = '', lastAt = 0;
  const ensure = () => { if (!isObj(S.stats)) S.stats = newStats(); return S.stats; };
  const bucket = (st, k) => st.days[k] || (st.days[k] = { v: 0, c: 0, u: 0, e: 0, a: 0, t: 0 });

  /* ---------- журнал ---------- */
  /** Записать событие: v визит, o открытие мандалы, c выполнено, u отмена, e правка задачи, g смена главной цели, n новая мандала, a просмотр аналитики.
      Повтор того же события в течение 1,5 с игнорируется (двойной вызов, дребезг). */
  function rec(kind, mid, idx, ts) {
    if (!S || KINDS.indexOf(kind) < 0 || kind.length !== 1) return false;
    ts = ts || Date.now();
    const sig = kind + '|' + mid + '|' + idx;
    if (sig === lastSig && ts - lastAt < 1500) return false;
    lastSig = sig; lastAt = ts;
    const st = ensure();
    st.ev.push([ts, kind, mid == null ? 0 : mid, idx == null ? -1 : idx]);
    if (st.ev.length > EV_MAX) st.ev.splice(0, st.ev.length - EV_MAX);
    const b = bucket(st, dayKey(ts)), f = FIELD[kind];
    if (f) b[f]++;
    b.t = ts; st.last = ts;
    return true;
  }
  /** Визит = новая сессия: прошло больше 30 минут с последнего действия. Перезагрузка страницы внутри сессии визитом не считается. */
  function visit(now) {
    now = now || Date.now();
    const st = ensure(), fresh = !st.last || now - st.last > GAP;
    if (fresh) rec('v', 0, -1, now); else st.last = now;
    save();
    return fresh;
  }
  /** Лёгкая отметка «пользователь рядом» (не пишет на диск): держит сессию живой. */
  function touch(now) { const st = ensure(); now = now || Date.now(); if (now - st.last > 20000) st.last = now; }
  /** Открытие мандалы: не чаще раза в 10 минут для одной и той же. */
  function open(mid, now) {
    now = now || Date.now();
    const ev = ensure().ev;
    for (let i = ev.length - 1; i >= 0 && now - ev[i][0] < OPEN_GAP; i--) if (ev[i][1] === 'o' && String(ev[i][2]) === String(mid)) return false;
    return rec('o', mid, -1, now);   // сохраняет вызывающий (переключение мандалы)
  }
  /** Просмотр аналитики: не чаще раза в 5 минут. */
  function viewed(now) {
    now = now || Date.now();
    const ev = ensure().ev;
    for (let i = ev.length - 1; i >= 0 && now - ev[i][0] < 5 * 60e3; i--) if (ev[i][1] === 'a') return false;
    const r = rec('a', 0, -1, now); if (r) save();
    return r;
  }

  /* ---------- срок задачи ---------- */
  /** '' нет срока · ok выполнена вовремя · late выполнена с опозданием · done выполнена (когда — неизвестно) · over просрочена · today сегодня · soon 1–3 дня · later дальше */
  function dueState(c, today) {
    if (!c || !c.due) return '';
    today = today || dayKey();
    if (c.completed) return !c.dn ? 'done' : (dayKey(c.dn) <= c.due ? 'ok' : 'late');
    const d = Dt.diff(today, c.due);
    return d < 0 ? 'over' : d === 0 ? 'today' : d <= 3 ? 'soon' : 'later';
  }

  /* ---------- математика ---------- */
  const erf = x => { const s = x < 0 ? -1 : 1; x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); };
  const phi = z => 0.5 * (1 + erf(z / Math.SQRT2));
  /** Вероятность, что «ёмкость» с ожиданием E задач (разброс 1,5: активность неровная) покроет n задач */
  const prob = (n, E) => n <= 0 ? 1 : clamp(phi((E + 0.5 - n) / Math.sqrt(1.5 * Math.max(E, 1))), 0.02, 0.98);

  /** Посуточная картина по выбранным задачам: c выполнено, e правки, v визиты, d записи дневника, act общая активность, t время последнего действия */
  function dayMap(s, tasks) {
    const st = s.stats || newStats(), days = {};
    const D = k => days[k] || (days[k] = { c: 0, e: 0, v: 0, d: 0, act: 0, t: 0 });
    const sinceKey = dayKey(st.since), diaryN = {};
    s.diary.forEach(e => { const k = dayKey(e.ts); diaryN[k] = (diaryN[k] || 0) + 1; D(k).d++; });
    let legacy = 0;
    tasks.forEach(t => { if (!t.done) return; if (t.dn) D(dayKey(t.dn)).c++; else legacy++; });
    // выполненное до появления журнала: даты задач неизвестны, распределяем по журналу активности (за вычетом записей дневника)
    if (legacy > 0) {
      const raw = []; let sum = 0;
      Object.keys(s.activity || {}).forEach(k => {
        if (k > sinceKey) return;
        const v = Math.max(0, (s.activity[k] || 0) - (diaryN[k] || 0) - (days[k] ? days[k].c : 0));
        if (v > 0) { raw.push([k, v]); sum += v; }
      });
      if (sum > 0) raw.forEach(r => { D(r[0]).c += r[1] * legacy / sum; }); else D(sinceKey).c += legacy;
    }
    Object.keys(st.days).forEach(k => { const x = st.days[k], d = D(k); d.e += x.e; d.v += x.v; d.t = Math.max(d.t, x.t); });
    Object.keys(days).forEach(k => { const d = days[k]; d.act = d.c + 0.35 * d.e + 0.5 * d.d; });
    return days;
  }

  /** Контекст расчёта: задачи выбранных целей и посуточная картина. Общий для текущего значения и истории. */
  function context(s, scope) {
    const mans = (scope && scope !== 'all') ? s.mandals.filter(m => String(m.id) === String(scope)) : s.mandals.slice();
    if (!mans.length) mans.push(s.mandals[0]);
    const tasks = [];
    mans.forEach(m => m.cells.forEach((c, i) => { if (c.text) tasks.push({ mid: m.id, i, text: c.text, done: !!c.completed, dn: c.dn || 0, due: c.due || '', b: blockOfIdx(i), mt: m.title }); }));
    const days = dayMap(s, tasks), st = s.stats || newStats();
    const keys = Object.keys(days).sort();
    const act = keys.filter(k => days[k].act >= 0.3);
    return { s, mans, tasks, days, keys, N: tasks.length, D: tasks.filter(t => t.done).length, total: 81 * mans.length, firstKey: act.length ? act[0] : dayKey(st.since), act };
  }

  /** Все показатели «как на конец дня k»: из них складывается и текущее значение (k = сегодня), и линия истории на графике. */
  function calcAt(ctx, k, today) {
    const { days, tasks, N, total } = ctx;
    const sp = (n, off) => { const o = { c: 0, act: 0, active: 0 }; for (let j = 0; j < n; j++) { const x = days[Dt.add(k, -(off + j))]; if (!x) continue; o.c += x.c; o.act += x.act; if (x.act >= 0.3) o.active++; } return o; };
    let D = 0;
    if (k >= today) D = ctx.D; else { for (let i = 0; i < ctx.keys.length && ctx.keys[i] <= k; i++) D += days[ctx.keys[i]].c; D = Math.min(N, D); }
    const R = Math.max(0, N - D);
    const spanDays = k >= ctx.firstKey ? Dt.diff(ctx.firstKey, k) + 1 : 0;
    let why = '';
    if (N === 0) why = 'Добавьте задачи в мандалу: без них прогноз невозможен.';
    else if (spanDays < 7) why = 'Накопите хотя бы 7 дней истории: сейчас ' + Math.max(spanDays, 1) + ' из 7.';
    else if (D < 3) why = 'Отметьте хотя бы 3 выполненные задачи: сейчас ' + Math.floor(D) + ' из 3.';
    const enough = !why;
    // темп: последние 14 дней весят больше предыдущих 14
    const s14 = sp(14, 0), s28 = sp(14, 14);
    const pace = (0.6 * s14.c + 0.4 * s28.c) / 2, daily = pace / 7;
    const trend = s28.c > 0 ? (s14.c - s28.c) / s28.c : (s14.c > 0 ? 1 : 0);
    const reg = clamp(0.6 * Math.min(1, s14.active / 10) + 0.4 * Math.min(1, (s14.active + s28.active) / 20), 0, 1);
    // сроки как на день k
    const items = [];
    tasks.forEach(t => {
      if (!t.due) return;
      if (t.done) {
        if (!t.dn) { items.push(Object.assign({}, t, { st: 'done' })); return; }     // выполнена до появления журнала: когда — неизвестно, в расчёт не берём
        const cd = dayKey(t.dn);
        if (cd <= k) { items.push(Object.assign({}, t, { st: cd <= t.due ? 'ok' : 'late' })); return; }
      }
      items.push(Object.assign({}, t, { st: t.due < k ? 'over' : t.due === k ? 'today' : Dt.diff(k, t.due) <= 3 ? 'soon' : 'later', pend: true }));
    });
    const pend = items.filter(t => t.pend).sort((a, b) => a.due < b.due ? -1 : a.due > b.due ? 1 : 0);
    const overBack = pend.filter(t => t.due < k).length;
    let cum = overBack;
    pend.forEach(t => {
      if (t.due < k) { t.P = 0; t.n = overBack; return; }
      cum++; t.n = cum;
      t.P = prob(cum, daily * (Dt.diff(k, t.due) + 1));
    });
    const cnt = x => items.filter(t => t.st === x).length;
    const ok = cnt('ok'), late = cnt('late'), over = cnt('over'), fut = pend.filter(t => t.due >= k);
    const decided = ok + late + over + fut.length;
    const cDead = decided > 0 ? (ok + fut.reduce((a, t) => a + t.P, 0)) / decided : null;
    let need = 0;
    fut.forEach(t => { need = Math.max(need, t.n / ((Dt.diff(k, t.due) + 1) / 7)); });
    const deadlines = { n: items.length, ok, late, over, today: cnt('today'), soon: cnt('soon'), later: cnt('later'), unknown: cnt('done'), pending: fut.length, items, need, minP: fut.length ? Math.min.apply(null, fut.map(t => t.P)) : null, score: cDead };
    // Success Score
    const target = R === 0 ? 0 : clamp(Math.max(R / 12, need), 3, 21);
    const cPace = R === 0 ? 1 : clamp(pace / target, 0, 1);
    const cProg = total ? clamp(D / total, 0, 1) : 0;
    const comps = [{ id: 'reg', w: 30, v: reg }, { id: 'pace', w: 30, v: cPace }, { id: 'prog', w: 25, v: cProg }, { id: 'dead', w: 15, v: cDead }].filter(c => c.v != null);
    const wsum = comps.reduce((a, c) => a + c.w, 0);
    comps.forEach(c => { c.we = c.w / wsum; });
    const complete = N > 0 && R === 0 && D >= total;
    let score = null;
    if (enough) { score = Math.round(comps.reduce((a, c) => a + c.v * c.we, 0) * 100); score = complete ? 100 : Math.min(score, 99); }
    return { k, D, R, spanDays, why, enough, a14: s14.active, a28: s14.active + s28.active, pace, daily, trend, reg, need, target, cPace, cProg, cDead, comps, score, complete, deadlines, activity: (30 * reg + 30 * cPace) / 60, tasks14: s14.c };
  }

  function model(s, now, scope, period) {
    now = now || Date.now();
    period = period || 30;
    const today = dayKey(now), st = s.stats || newStats();
    const ctx = context(s, scope), c = calcAt(ctx, today, today);
    const { days, tasks, N, total, mans } = ctx;
    const get = k => days[k] || null;
    /** сумма по n дням, последний из них — off дней назад от сегодня (off = 0 → включая сегодня) */
    function span(n, off) {
      const o = { c: 0, e: 0, v: 0, d: 0, act: 0, active: 0 };
      for (let j = 0; j < n; j++) { const x = get(Dt.add(today, -(off + j))); if (!x) continue; o.c += x.c; o.e += x.e; o.v += x.v; o.d += x.d; o.act += x.act; if (x.act >= 0.3) o.active++; }
      return o;
    }
    // серии
    const isAct = k => !!(days[k] && days[k].act >= 0.3);
    let cur = 0, kk = today; if (!isAct(kk)) kk = Dt.add(kk, -1);
    while (isAct(kk) && cur < 4000) { cur++; kk = Dt.add(kk, -1); }
    let best = 0, run = 0, prevK = null;
    ctx.act.forEach(k => { run = (prevK && Dt.diff(prevK, k) === 1) ? run + 1 : 1; best = Math.max(best, run); prevK = k; });
    best = Math.max(best, cur);
    const lastActive = ctx.act.length ? ctx.act[ctx.act.length - 1] : '';
    const idle = lastActive ? Dt.diff(lastActive, today) : null;
    // прогноз завершения запланированных задач
    let eta = null;
    if (c.R === 0) eta = today; else if (c.daily >= 0.03) { const dd = Math.ceil(c.R / c.daily); eta = dd <= 730 ? Dt.add(today, dd) : null; }
    // направления (8 секторов выбранной или активной мандалы)
    const bm = mans.length === 1 ? mans[0] : (s.mandals.find(m => String(m.id) === String(s.activeId)) || s.mandals[0]);
    const blocks = [], since = Dt.parse(Dt.add(today, -(period - 1)));
    for (let b = 0; b < 9; b++) {
      if (b === 4) continue;
      let done = 0, filled = 0, last = 0, per = 0;
      blockCells(b).forEach(i => { const cl = bm.cells[i]; if (cl.text) filled++; if (cl.completed) { done++; if (cl.dn) { last = Math.max(last, cl.dn); if (cl.dn >= since) per++; } } });
      blocks.push({ b, title: bm.cells[blockCells(4)[b]].text || ('Сектор ' + (b + 1)), done, filled, left: 9 - done, pct: done / 9, last, per, pend: filled - done });
    }
    return Object.assign({}, c, {
      ctx, now, today, scope: mans.length === 1 && scope && scope !== 'all' ? String(mans[0].id) : 'all', mans: mans.map(m => m.id), title: mans.length === 1 ? mans[0].title : 'Все цели', period,
      N, total, pct: total ? c.D / total : 0, days, span, tasks, firstKey: ctx.firstKey,
      streak: { cur, best }, idle, lastActive, eta, blocks, blocksTitle: bm.title, blocksMid: bm.id, lastVisit: st.last || 0
    });
  }

  /** История двух главных значений: вероятность достижения целей (Success Score) и соблюдение сроков. Точки — «как на конец дня»; null — данных ещё мало. */
  function series(m, range) {
    const n = range === 7 ? 7 : range === 90 ? 90 : range === 365 ? 365 : 30;
    const step = Math.max(1, Math.ceil(n / 60)), out = [];
    for (let j = n - 1; j >= 0; j -= step) {
      const k = Dt.add(m.today, -j), c = j === 0 ? m : calcAt(m.ctx, k, m.today);
      out.push({ k, p: c.enough ? c.score : null, d: c.cDead == null ? null : Math.round(c.cDead * 100) });
    }
    if (out[out.length - 1].k !== m.today) out.push({ k: m.today, p: m.enough ? m.score : null, d: m.cDead == null ? null : Math.round(m.cDead * 100) });
    return out;
  }

  /* ---------- ряды для графиков ---------- */
  /** Столбики по периодам: 7/30 дней — по суткам, 90 — по неделям, 365 — по месяцам */
  function bars(m, range) {
    const out = [];
    if (range === 365) {
      const t = new Date(m.now);
      for (let j = 11; j >= 0; j--) {
        const d = new Date(t.getFullYear(), t.getMonth() - j, 1), y = d.getFullYear(), mo = d.getMonth(), n = Dt.daysIn(y, mo);
        const o = { c: 0, v: 0, active: 0, label: Dt.MONTHS_S[mo], from: Dt.make(y, mo, 1) };
        for (let q = 1; q <= n; q++) { const x = m.days[Dt.make(y, mo, q)]; if (x) { o.c += x.c; o.v += x.v; if (x.act >= 0.3) o.active++; } }
        out.push(o);
      }
    } else if (range === 90) {
      for (let j = 12; j >= 0; j--) {
        const o = { c: 0, v: 0, active: 0, label: '', from: Dt.add(m.today, -(j * 7 + 6)) };
        for (let q = 0; q < 7; q++) { const k = Dt.add(m.today, -(j * 7 + q)); const x = m.days[k]; if (x) { o.c += x.c; o.v += x.v; if (x.act >= 0.3) o.active++; } }
        o.label = Dt.dm(o.from); out.push(o);
      }
    } else {
      for (let j = range - 1; j >= 0; j--) {
        const k = Dt.add(m.today, -j), x = m.days[k];
        out.push({ c: x ? x.c : 0, v: x ? x.v : 0, active: x && x.act >= 0.3 ? 1 : 0, label: Dt.dm(k), from: k });
      }
    }
    out.forEach(o => { o.c = Math.round(o.c * 10) / 10; });
    return out;
  }
  /** Сравнение с предыдущим таким же периодом */
  function compare(m, p) {
    const a = m.span(p, 0), b = m.span(p, p);
    const d = (x, y) => y > 0 ? (x - y) / y : (x > 0 ? null : 0);
    return { p, tasks: { cur: a.c, prev: b.c, d: d(a.c, b.c) }, visits: { cur: a.v, prev: b.v, d: d(a.v, b.v) }, active: { cur: a.active, prev: b.active, d: d(a.active, b.active) } };
  }
  /** Уровень клетки календаря активности 0..4 */
  const level = x => !x || x.act < 0.3 ? 0 : x.act < 1 ? 1 : x.act < 2 ? 2 : x.act < 4 ? 3 : 4;
  /** Кумулятивный график выполнения: факт, прогноз при нынешнем темпе и «нужный» путь к срокам */
  function burnup(m) {
    const startKey = Dt.diff(m.firstKey, m.today) > 28 ? m.firstKey : Dt.add(m.today, -28);
    const nd = Dt.diff(startKey, m.today), step = Math.max(1, Math.ceil(nd / 80));
    const actual = []; let cum = 0;
    for (let j = 0, k = startKey; j <= nd; j++, k = Dt.add(k, 1)) {
      const x = m.days[k]; if (x) cum += x.c;
      if (j % step === 0 || j === nd) actual.push([k, Math.round(cum * 10) / 10]);
    }
    const sum = actual.length ? actual[actual.length - 1][1] : 0;
    if (sum !== m.D && actual.length) actual[actual.length - 1][1] = m.D;
    const dueMax = m.deadlines.items.filter(t => !t.done && t.due >= m.today).reduce((a, t) => t.due > a ? t.due : a, '');
    let endKey = Dt.add(m.today, 28);
    if (dueMax && dueMax > endKey) endKey = dueMax;
    if (m.eta && m.eta > endKey && Dt.diff(m.today, m.eta) <= 365) endKey = m.eta;
    if (Dt.diff(m.today, endKey) > 400) endKey = Dt.add(m.today, 400);
    let proj = null;
    if (m.R > 0 && m.daily >= 0.03) {
      const h = Dt.diff(m.today, endKey), reach = Math.min(h, Math.ceil(m.R / m.daily));
      proj = [[m.today, m.D], [Dt.add(m.today, reach), Math.min(m.N, m.D + m.daily * reach)]];
    }
    const plan = [];
    const pend = m.deadlines.items.filter(t => !t.done).sort((a, b) => a.due < b.due ? -1 : 1);
    if (pend.length) {
      const back = pend.filter(t => t.due < m.today).length;
      plan.push([m.today, m.D + back]);
      pend.filter(t => t.due >= m.today).forEach(t => plan.push([t.due, m.D + t.n]));
    }
    const flags = {}; pend.forEach(t => { const k = t.due < m.today ? m.today : t.due; flags[k] = (flags[k] || 0) + 1; });
    let ymax = Math.max(m.N, m.D, 1, plan.length ? plan[plan.length - 1][1] : 0);
    return { startKey, endKey, actual, proj, plan, flags, ymax };
  }

  /** Советы строятся только из реальных показателей */
  function insights(m) {
    const out = [], P = (tone, title, text, w) => out.push({ tone, title, text, w: w || 0 });
    if (!m.enough) { P('info', 'Пока мало данных', m.why + ' После этого появится прогноз и советы.', 100); }
    const dl = m.deadlines;
    const over = dl.items.filter(t => t.st === 'over').sort((a, b) => a.due < b.due ? -1 : 1);
    if (over.length) P('bad', 'Просрочено: ' + over.length, '«' + clip(over[0].text, 40) + '» — срок был ' + Dt.fmt(over[0].due) + ' (' + Dt.rel(over[0].due, m.today) + '). Закройте её или перенесите срок.', 90);
    const risk = dl.items.filter(t => !t.done && t.due >= m.today && t.P < 0.5).sort((a, b) => a.due < b.due ? -1 : 1)[0];
    if (risk && m.enough) P('warn', 'Срок под угрозой', 'К ' + Dt.fmt(risk.due) + ' нужно закрыть ' + Dt.num(risk.n, ['задачу', 'задачи', 'задач']) + ': при вашем темпе (' + perWeek(m.pace) + ') шанс успеть около ' + Math.round(risk.P * 100) + '%. Нужно примерно ' + perWeek(dl.need) + '.', 85);
    if (m.enough) {
      const cm = compare(m, 30);
      if (cm.tasks.d != null && Math.abs(cm.tasks.d) >= 0.15 && (cm.tasks.cur + cm.tasks.prev) >= 4)
        P(cm.tasks.d > 0 ? 'good' : 'warn', cm.tasks.d > 0 ? 'Темп растёт' : 'Темп снизился', 'За 30 дней выполнено ' + Math.round(cm.tasks.cur) + ' задач против ' + Math.round(cm.tasks.prev) + ' в предыдущие 30 дней (' + (cm.tasks.d > 0 ? '+' : '−') + Math.round(Math.abs(cm.tasks.d) * 100) + '%).', 60);
      const idleB = m.blocks.filter(b => b.pend > 0 && (b.last ? Dt.diff(Dt.key(b.last), m.today) >= 21 : m.spanDays >= 21)).sort((a, b) => (a.last || 0) - (b.last || 0))[0];
      if (idleB) P('warn', 'Направление без движения', '«' + clip(idleB.title, 28) + '»: ' + (idleB.last ? 'последняя задача закрыта ' + Dt.rel(Dt.key(idleB.last), m.today).replace('просрочено на ', '') + ' назад' : 'пока нет закрытых задач') + ', ждёт ' + Dt.num(idleB.pend, ['задача', 'задачи', 'задач']) + '.', 70);
      const wd = [0, 0, 0, 0, 0, 0, 0]; let tot = 0;
      Object.keys(m.days).forEach(k => { const c = m.days[k].c; if (c > 0) { wd[Dt.dow(k)] += c; tot += c; } });
      if (tot >= 10) { const bi = wd.indexOf(Math.max.apply(null, wd)); P('info', 'Самый продуктивный день', 'Чаще всего задачи закрываются по ' + Dt.WD_ACC[bi] + ': ' + Math.round(wd[bi]) + ' из ' + Math.round(tot) + ' (' + Math.round(wd[bi] / tot * 100) + '%). Ставьте сложное на этот день.', 40);
      }
      if (m.R > 0) P('info', 'Темп на неделю', 'Чтобы сохранить текущий темп, достаточно ' + perWeek(Math.max(m.pace, 1)) + '. Чтобы закрыть остаток (' + m.R + ') за 12 недель, нужно ' + perWeek(m.R / 12) + '.', 45);
      const nextW = dl.items.filter(t => !t.done && t.due >= m.today && Dt.diff(m.today, t.due) <= 7).length;
      if (nextW) P('info', 'На ближайшие 7 дней', 'Со сроками на этой неделе: ' + Dt.num(nextW, ['задача', 'задачи', 'задач']) + '. Начните с самых близких.', 55);
    }
    if (m.streak.cur >= 3) P('good', 'Серия ' + Dt.num(m.streak.cur, ['день', 'дня', 'дней']), 'Вы действуете ' + Dt.num(m.streak.cur, ['день', 'дня', 'дней']) + ' подряд (рекорд ' + m.streak.best + '). Не прерывайте: достаточно одной задачи в день.', 50);
    else if (m.idle != null && m.idle >= 3) P('warn', 'Пауза в действиях', 'Уже ' + Dt.num(m.idle, ['день', 'дня', 'дней']) + ' без выполненных задач и правок. Выполните одну небольшую задачу, чтобы вернуть ритм.', 80);
    out.sort((a, b) => b.w - a.w);
    return out.slice(0, 6);
  }
  /** «6,1 задачи в неделю», «5 задач в неделю» */
  const perWeek = x => fmt1(x) + ' ' + (Math.abs(x - Math.round(x)) > 0.05 ? 'задачи' : Dt.plural(Math.round(x), ['задача', 'задачи', 'задач'])) + ' в неделю';
  const clip = (t, n) => String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t);
  const fmt1 = x => (Math.round(x * 10) / 10).toString().replace('.', ',');

  /** Текст-пояснение к Success Score (по ТЗ: без выдуманных выводов, только по показателям) */
  function explain(m) {
    if (!m.enough) return 'Недостаточно данных для прогноза. ' + m.why;
    if (m.complete) return 'Мандала выполнена полностью. Цель достигнута.';
    const t = m.trend, wk = perWeek(m.pace);
    if (m.score >= 70) return 'Твоя текущая активность оценивается как высокая. Ты регулярно выполняешь задачи (' + wk + ', активных дней за 2 недели: ' + m.a14 + ')' + (t >= -0.1 ? ' и сохраняешь положительную динамику.' : ', но темп последних дней немного снизился.');
    if (m.score >= 40) return 'Темп средний: ' + wk + ', активных дней за 2 недели: ' + m.a14 + '. ' + (t > 0.1 ? 'Динамика растёт, продолжайте.' : t < -0.1 ? 'Динамика снижается, добавьте одну задачу в неделю.' : 'Чтобы ускориться, закрывайте задачи в одни и те же дни.');
    return 'Твоя активность снизилась. При текущем темпе (' + wk + ') продвижение к цели может занять больше времени. ' + (m.eta ? 'Прогноз завершения: ' + Dt.fmt(m.eta, true) + '.' : 'Выполните несколько задач, чтобы появился прогноз.');
  }

  return { rec, visit, touch, open, viewed, dueState, model, series, bars, compare, level, burnup, insights, explain, prob, fmt1 };
})();
