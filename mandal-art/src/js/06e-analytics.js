/* ============================================================
   06e-analytics: экран «Аналитика» (ТЗ №4).
   Расчёт — в 02b-stats.js (Stats.*). Здесь только отрисовка: кольца, графики на SVG, календарь активности, сроки, советы.
   Весь пользовательский текст идёт через esc(); графики рисуются без внешних библиотек.
   ============================================================ */
const AN = { scope: 'all', range: 30, calY: 0, calM: 0, sel: '', ser: null, bound: false };

const An = (() => {
  let gid = 0;
  const f1 = x => (Math.round(x * 10) / 10).toString().replace('.', ',');
  const pc = x => Math.round(x * 100);
  const px = n => (Math.round(n * 10) / 10).toString();

  /* ---------- графики ---------- */
  /** Гладкая монотонная кривая (без «перелётов» за значения) через точки [[x,y],…] */
  function mono(p) {
    const n = p.length;
    if (!n) return '';
    if (n === 1) return 'M' + px(p[0][0]) + ' ' + px(p[0][1]);
    const dx = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = p[i + 1][0] - p[i][0] || 1e-6; m[i] = (p[i + 1][1] - p[i][1]) / dx[i]; }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
      if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    let d = 'M' + px(p[0][0]) + ' ' + px(p[0][1]);
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += 'C' + px(p[i][0] + h) + ' ' + px(p[i][1] + t[i] * h) + ' ' + px(p[i + 1][0] - h) + ' ' + px(p[i + 1][1] - t[i + 1] * h) + ' ' + px(p[i + 1][0]) + ' ' + px(p[i + 1][1]);
    }
    return d;
  }
  /** Разбивает ряд [{x,v}] на непрерывные отрезки (пустые значения — разрыв линии) */
  function runs(pts) {
    const out = []; let cur = [];
    pts.forEach(q => { if (q.v == null) { if (cur.length) out.push(cur); cur = []; } else cur.push(q); });
    if (cur.length) out.push(cur);
    return out;
  }
  /** Кольцо с градиентом. p: 0..100 или null (нет данных) */
  function ring(p, o) {
    const r = 44, c = 2 * Math.PI * r, id = 'rg' + (++gid), has = p != null, v = has ? clamp(p, 0, 100) : 0;
    return '<svg viewBox="0 0 100 100" class="an-ring ' + (o.k || 'a') + (has ? '' : ' empty') + '" role="img" aria-label="' + esc(o.aria) + '">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--an-' + (o.k || 'a') + '1)"/><stop offset="1" style="stop-color:var(--an-' + (o.k || 'a') + '2)"/></linearGradient></defs>' +
      '<circle cx="50" cy="50" r="' + r + '" class="trk"/>' +
      (has && v > 0 ? '<circle cx="50" cy="50" r="' + r + '" class="arc" stroke="url(#' + id + ')" stroke-dasharray="' + px(c * v / 100) + ' ' + px(c) + '" transform="rotate(-90 50 50)"/>' : '') +
      '<text x="50" y="55" class="num" text-anchor="middle">' + (has ? Math.round(v) + '<tspan class="pc">%</tspan>' : '—') + '</text></svg>';
  }
  /** Линейный график с областью. o: { n, lines: [{k:'a'|'b', pts:[{x:0..1, v:0..100|null}], area}], xl: [[x, подпись], …], h } */
  function lineChart(o) {
    const w = 320, h = o.h || 150, L = 28, R = 10, T = 10, B = 22, iw = w - L - R, ih = h - T - B;
    const X = x => L + iw * x, Y = v => T + ih * (1 - v / 100);
    let s = '<svg viewBox="0 0 ' + w + ' ' + h + '" class="an-svg" role="img" aria-label="' + esc(o.aria || 'График') + '"><defs>';
    const ids = o.lines.map(() => 'lg' + (++gid));
    o.lines.forEach((ln, i) => { s += '<linearGradient id="' + ids[i] + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--an-' + ln.k + '2);stop-opacity:.55"/><stop offset="1" style="stop-color:var(--an-' + ln.k + '2);stop-opacity:0"/></linearGradient>'; });
    s += '</defs>';
    [0, 25, 50, 75, 100].forEach(v => { s += '<line x1="' + L + '" x2="' + (w - R) + '" y1="' + px(Y(v)) + '" y2="' + px(Y(v)) + '" class="gl' + (v === 0 ? ' base' : '') + '"/><text x="' + (L - 6) + '" y="' + px(Y(v) + 3) + '" class="yl" text-anchor="end">' + v + '</text>'; });
    (o.xl || []).forEach(q => { s += '<text x="' + px(X(q[0])) + '" y="' + (h - 5) + '" class="xl" text-anchor="' + (q[0] < 0.08 ? 'start' : q[0] > 0.92 ? 'end' : 'middle') + '">' + esc(q[1]) + '</text>'; });
    o.lines.forEach((ln, i) => {
      runs(ln.pts).forEach(rn => {
        const P = rn.map(q => [X(q.x), Y(q.v)]), d = mono(P);
        if (ln.area && P.length > 1) s += '<path d="' + d + 'L' + px(P[P.length - 1][0]) + ' ' + px(Y(0)) + 'L' + px(P[0][0]) + ' ' + px(Y(0)) + 'Z" fill="url(#' + ids[i] + ')" stroke="none"/>';
        s += '<path d="' + d + '" class="ln ' + ln.k + '" fill="none"/>';
        if (P.length === 1) s += '<circle cx="' + px(P[0][0]) + '" cy="' + px(P[0][1]) + '" r="2.6" class="pt ' + ln.k + '"/>';
      });
      const last = ln.pts.filter(q => q.v != null).pop();
      if (last) s += '<circle cx="' + px(X(last.x)) + '" cy="' + px(Y(last.v)) + '" r="4" class="dot ' + ln.k + '"/><circle cx="' + px(X(last.x)) + '" cy="' + px(Y(last.v)) + '" r="8" class="halo ' + ln.k + '"/>';
    });
    s += '<line class="cur" x1="0" x2="0" y1="' + T + '" y2="' + (T + ih) + '" style="display:none"/>';
    return s + '</svg>';
  }
  /** Столбики с градиентом. vals: числа, labels: подписи (показываются выборочно) */
  function bars(vals, labels, o) {
    o = o || {};
    const w = 320, h = o.h || 110, L = 24, R = 6, T = 8, B = 18, iw = w - L - R, ih = h - T - B, n = vals.length;
    const mx = Math.max(o.min || 1, Math.max.apply(null, vals)), step = iw / n, bw = Math.max(2, Math.min(18, step * 0.62)), id = 'bg' + (++gid);
    const top = Math.ceil(mx), mid = top > 1 ? Math.round(top / 2) : 0;
    let s = '<svg viewBox="0 0 ' + w + ' ' + h + '" class="an-svg" role="img" aria-label="' + esc(o.aria || 'Столбики') + '"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--an-' + (o.k || 'a') + '1)"/><stop offset="1" style="stop-color:var(--an-' + (o.k || 'a') + '2)"/></linearGradient></defs>';
    [[top, T], [mid, T + ih * (1 - mid / top)], [0, T + ih]].forEach(q => { if (q[0] === mid && (mid === 0 || mid === top)) return; s += '<line x1="' + L + '" x2="' + (w - R) + '" y1="' + px(q[1]) + '" y2="' + px(q[1]) + '" class="gl' + (q[0] === 0 ? ' base' : '') + '"/><text x="' + (L - 5) + '" y="' + px(q[1] + 3) + '" class="yl" text-anchor="end">' + q[0] + '</text>'; });
    vals.forEach((v, i) => {
      const bh = v > 0 ? Math.max(2.5, ih * v / top) : 0, x = L + step * i + (step - bw) / 2;
      if (bh) s += '<rect x="' + px(x) + '" y="' + px(T + ih - bh) + '" width="' + px(bw) + '" height="' + px(bh) + '" rx="' + px(Math.min(4, bw / 2)) + '" fill="url(#' + id + ')"/>';
    });
    const every = n <= 8 ? 1 : n <= 14 ? 2 : n <= 31 ? 7 : Math.ceil(n / 5);
    labels.forEach((t, i) => { if ((n - 1 - i) % every === 0) s += '<text x="' + px(L + step * i + step / 2) + '" y="' + (h - 4) + '" class="xl" text-anchor="middle">' + esc(t) + '</text>'; });
    return s + '</svg>';
  }
  /** График выполнения: факт, прогноз, нужный путь к срокам */
  function burnChart(b, m) {
    const w = 320, h = 168, L = 30, R = 12, T = 12, B = 22, iw = w - L - R, ih = h - T - B;
    const span = Math.max(1, Dt.diff(b.startKey, b.endKey)), ymax = Math.max(1, b.ymax);
    const X = k => L + iw * clamp(Dt.diff(b.startKey, k) / span, 0, 1), Y = v => T + ih * (1 - clamp(v / ymax, 0, 1));
    const id = 'ba' + (++gid);
    let s = '<svg viewBox="0 0 ' + w + ' ' + h + '" class="an-svg" role="img" aria-label="График выполнения: факт, прогноз и путь к срокам"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--an-a2);stop-opacity:.5"/><stop offset="1" style="stop-color:var(--an-a2);stop-opacity:0"/></linearGradient></defs>';
    [0, 0.5, 1].forEach(q => { const y = T + ih * (1 - q); s += '<line x1="' + L + '" x2="' + (w - R) + '" y1="' + px(y) + '" y2="' + px(y) + '" class="gl' + (q === 0 ? ' base' : '') + '"/><text x="' + (L - 6) + '" y="' + px(y + 3) + '" class="yl" text-anchor="end">' + Math.round(ymax * q) + '</text>'; });
    const xs = [b.startKey, Dt.add(b.startKey, Math.round(span / 2)), b.endKey];
    xs.forEach((k, i) => { s += '<text x="' + px(X(k)) + '" y="' + (h - 5) + '" class="xl" text-anchor="' + (i === 0 ? 'start' : i === 2 ? 'end' : 'middle') + '">' + esc(Dt.fmtS(k)) + '</text>'; });
    const tx = X(m.today);
    s += '<line x1="' + px(tx) + '" x2="' + px(tx) + '" y1="' + T + '" y2="' + (T + ih) + '" class="today"/><text x="' + px(tx) + '" y="' + (T - 2) + '" class="xl" text-anchor="middle">сегодня</text>';
    if (b.plan.length > 1) {
      let d = ''; b.plan.forEach((q, i) => { const x = X(q[0]), y = Y(q[1]); d += (i ? 'H' + px(x) + 'V' + px(y) : 'M' + px(x) + ' ' + px(y)); });
      s += '<path d="' + d + '" class="ln plan" fill="none"/>';
    }
    const A = b.actual.map(q => [X(q[0]), Y(q[1])]);
    if (A.length > 1) { const d = mono(A); s += '<path d="' + d + 'L' + px(A[A.length - 1][0]) + ' ' + px(Y(0)) + 'L' + px(A[0][0]) + ' ' + px(Y(0)) + 'Z" fill="url(#' + id + ')"/><path d="' + d + '" class="ln a" fill="none"/>'; }
    if (b.proj) s += '<path d="M' + px(X(b.proj[0][0])) + ' ' + px(Y(b.proj[0][1])) + 'L' + px(X(b.proj[1][0])) + ' ' + px(Y(b.proj[1][1])) + '" class="ln proj" fill="none"/>';
    Object.keys(b.flags).forEach(k => { if (k < b.startKey || k > b.endKey) return; const x = X(k); s += '<path d="M' + px(x) + ' ' + (T + ih) + 'V' + px(T + ih - 14) + 'l7 3.5-7 3.5" class="flag"/>'; });
    if (A.length) s += '<circle cx="' + px(A[A.length - 1][0]) + '" cy="' + px(A[A.length - 1][1]) + '" r="4" class="dot a"/>';
    return s + '</svg>';
  }
  /** Точки-привычки: колонки — недели, строки — дни недели (как «сетка привычек») */
  function heat(m, weeks) {
    const today = m.today, endDow = Dt.dow(today), endMon = Dt.add(today, -endDow), startMon = Dt.add(endMon, -(weeks - 1) * 7);
    let s = '<div class="an-heat w' + weeks + '" style="--wk:' + weeks + '" role="img" aria-label="Календарь активности: каждая точка — один день"><div class="hm-g">';
    for (let w = 0; w < weeks; w++) for (let d = 0; d < 7; d++) {
      const k = Dt.add(startMon, w * 7 + d);
      if (k > today) { s += '<i class="hm fut"></i>'; continue; }
      const x = m.days[k], lv = Stats.level(x);
      s += '<i class="hm l' + lv + (k === today ? ' now' : '') + '" title="' + esc(Dt.fmt(k)) + (x && x.c >= 0.5 ? ': задач ' + Math.round(x.c) : '') + '"></i>';
    }
    s += '</div></div>';
    return s;
  }
  /** Сравнение с предыдущим периодом: проценты — только если база не слишком мала, иначе разница в штуках */
  const delta = (cur, prev) => {
    cur = Math.round(cur * 10) / 10; prev = Math.round(prev * 10) / 10;
    if (cur === prev) return '<span class="dl eq">как раньше</span>';
    if (prev === 0) return '<span class="dl up">впервые</span>';
    const d = cur - prev, small = prev < 4;
    return '<span class="dl ' + (d > 0 ? 'up' : 'dn') + '">' + (d > 0 ? '+' : '−') + (small ? f1(Math.abs(d)) : Math.round(Math.abs(d) / prev * 100) + '%') + '</span>';
  };
  const clip = (t, n) => { t = String(t); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

  /* ---------- разделы экрана ---------- */
  function controls(m) {
    let h = '<div class="an-top"><div class="an-ttl">' + I('chart') + ' <span>Аналитика</span></div>' +
      '<div class="seg an-rng" role="group" aria-label="Период">' + [[7, '7 дн'], [30, '30 дн'], [90, '90 дн'], [365, 'Год']].map(q => '<button class="' + (AN.range === q[0] ? 'active' : '') + '" data-act="an-range" data-v="' + q[0] + '">' + q[1] + '</button>').join('') + '</div></div>';
    h += '<div class="an-chips" role="group" aria-label="Что анализировать"><button class="' + (m.scope === 'all' ? 'on' : '') + '" data-act="an-scope" data-v="all">Все цели</button>' +
      S.mandals.map(x => '<button class="' + (m.scope === String(x.id) ? 'on' : '') + '" data-act="an-scope" data-v="' + esc(x.id) + '">' + esc(clip(x.title || 'Цель', 22)) + '</button>').join('') + '</div>';
    return h;
  }
  function hero(m) {
    const dl = m.deadlines, hasDl = m.cDead != null, ser = Stats.series(m, AN.range);
    AN.ser = ser;
    const n0 = AN.range === 365 ? 365 : AN.range;
    const x = q => 1 - Dt.diff(q.k, m.today) / Math.max(1, n0 - 1);
    const lines = [{ k: 'a', area: true, pts: ser.map(q => ({ x: x(q), v: q.p })) }];
    if (hasDl) lines.push({ k: 'b', area: false, pts: ser.map(q => ({ x: x(q), v: q.d })) });
    const xl = [[0, Dt.fmtS(Dt.add(m.today, -(n0 - 1)))], [0.5, Dt.fmtS(Dt.add(m.today, -Math.round((n0 - 1) / 2)))], [1, 'сегодня']];
    AN.xs = ser.map(q => x(q));
    const capA = m.enough ? (m.complete ? 'мандала выполнена' : 'при текущей активности') : 'нужно больше данных';
    let capB;
    if (hasDl) { const dec = dl.ok + dl.late + dl.over + dl.pending; capB = dl.ok + ' из ' + dec + ' — вовремя'; } else capB = dl.n ? 'ждём выполнения задач со сроком' : 'поставьте сроки задачам';
    let h = '<div class="an-hero">' +
      '<div class="an-rings"><div class="rg A">' + ring(m.enough ? m.score : null, { k: 'a', aria: 'Вероятность достижения целей: ' + (m.enough ? m.score + ' процентов' : 'недостаточно данных') }) + '<div class="cap"><b>Вероятность достичь целей</b><span>' + esc(capA) + '</span></div></div>' +
      '<div class="rg B">' + ring(hasDl ? pc(m.cDead) : null, { k: 'b', aria: 'Соблюдение сроков: ' + (hasDl ? pc(m.cDead) + ' процентов' : 'нет сроков') }) + '<div class="cap"><b>Соблюдение сроков</b><span>' + esc(capB) + '</span></div></div></div>';
    if (m.enough) h += '<p class="an-expl">' + esc(Stats.explain(m)) + '</p>';
    else h += '<div class="an-need"><p class="an-expl">' + esc(Stats.explain(m)) + '</p><div class="an-prog"><div><span>Дней истории</span><b>' + Math.min(m.spanDays, 7) + ' / 7</b><i style="--p:' + clamp(m.spanDays / 7, 0, 1) * 100 + '%"></i></div><div><span>Выполнено задач</span><b>' + Math.min(Math.floor(m.D), 3) + ' / 3</b><i style="--p:' + clamp(m.D / 3, 0, 1) * 100 + '%"></i></div></div></div>';
    h += '<div class="an-leg"><span class="k a"><i></i>Вероятность достижения' + (m.enough ? ' <b>' + m.score + '%</b>' : '') + '</span>' + (hasDl ? '<span class="k b"><i></i>Соблюдение сроков <b>' + pc(m.cDead) + '%</b></span>' : '<span class="k off"><i></i>Сроки не заданы</span>') + '</div>';
    h += '<div class="an-plot" id="anPlot">' + lineChart({ lines, xl, aria: 'История двух показателей: вероятность достижения целей и соблюдение сроков' }) + '<div class="an-tip hidden" id="anTip"></div></div>';
    if (!m.enough || ser.every(q => q.p == null)) h += '<div class="note">Линия вероятности появится, когда накопится минимум данных (7 дней и 3 выполненные задачи).</div>';
    return h + '</div>';
  }
  function kpis(m) {
    const p = AN.range, c = Stats.compare(m, p), pace = m.pace;
    const tile = (cls, k, v, sub) => '<div class="an-k ' + cls + '"><span class="k">' + k + '</span><b class="v">' + v + '</b><span class="s">' + sub + '</span></div>';
    return '<div class="an-kpis">' +
      tile('', 'Выполнено', Math.floor(m.D) + '<small> / ' + m.N + '</small>', pc(m.pct) + '% от всех ' + m.total + ' клеток') +
      tile('', 'За ' + Dt.num(p, ['день', 'дня', 'дней']), Math.round(c.tasks.cur) + '<small> ' + Dt.plural(Math.round(c.tasks.cur), ['задача', 'задачи', 'задач']) + '</small>', delta(c.tasks.cur, c.tasks.prev) + ' к пред. периоду') +
      tile('', 'Активных дней', c.active.cur + '<small> из ' + p + '</small>', delta(c.active.cur, c.active.prev) + ' к пред. периоду') +
      tile('', 'Серия', m.streak.cur + '<small> ' + Dt.plural(m.streak.cur, ['день', 'дня', 'дней']) + '</small>', 'рекорд ' + m.streak.best) +
      tile('', 'Заходов', c.visits.cur, delta(c.visits.cur, c.visits.prev) + ' к пред. периоду') +
      tile('', 'Темп', f1(pace) + '<small> в неделю</small>', m.enough ? (m.trend > 0.1 ? 'растёт' : m.trend < -0.1 ? 'снижается' : 'стабильно') : 'мало данных') + '</div>';
  }
  function forecast(m) {
    const b = Stats.burnup(m), dl = m.deadlines;
    let h = '<div class="an-leg"><span class="k a"><i></i>Факт</span>' + (b.proj ? '<span class="k proj"><i></i>Прогноз</span>' : '') + (b.plan.length > 1 ? '<span class="k plan"><i></i>Нужно к срокам</span>' : '') + '</div>';
    h += '<div class="an-plot">' + burnChart(b, m) + '</div>';
    let t;
    if (m.R === 0 && m.N > 0) t = 'Все запланированные задачи выполнены.';
    else if (!m.enough) t = 'Прогноз появится, когда накопится минимум данных.';
    else if (m.eta) t = 'Осталось ' + Dt.num(m.R, ['задача', 'задачи', 'задач']) + '. При темпе ' + f1(m.pace) + ' в неделю всё запланированное будет закрыто примерно ' + Dt.fmt(m.eta, true) + ' (' + Dt.rel(m.eta, m.today) + ').';
    else t = 'При текущем темпе (' + f1(m.pace) + ' в неделю) прогноз не строится: выполните несколько задач, и он появится.';
    h += '<p class="an-expl">' + esc(t) + '</p>';
    if (dl.pending) h += '<p class="an-expl">' + esc('Чтобы успеть ко всем срокам, нужно около ' + f1(dl.need) + ' задач в неделю' + (dl.minP != null ? '; самый рискованный срок — с шансом ' + pc(dl.minP) + '%.' : '.')) + '</p>';
    return h;
  }
  function activity(m) {
    const weeks = AN.range === 365 ? 52 : AN.range === 90 ? 26 : 13;
    const wd = [0, 0, 0, 0, 0, 0, 0]; let tot = 0;
    Object.keys(m.days).forEach(k => { const c = m.days[k].c; if (c > 0) { wd[Dt.dow(k)] += c; tot += c; } });
    const mx = Math.max.apply(null, wd.concat([1]));
    const act = m.span(AN.range === 365 ? 364 : AN.range, 0).active;
    return '<div class="an-sub">' + Dt.num(act, ['активный день', 'активных дня', 'активных дней']) + ' за ' + (AN.range === 365 ? 'год' : Dt.num(AN.range, ['день', 'дня', 'дней'])) + '</div>' + heat(m, weeks) +
      '<div class="an-hl"><span>меньше</span><i class="hm l0"></i><i class="hm l1"></i><i class="hm l2"></i><i class="hm l3"></i><i class="hm l4"></i><span>больше</span></div>' +
      '<div class="an-wd" role="img" aria-label="Выполненные задачи по дням недели">' + wd.map((v, i) => '<div><i style="height:' + Math.max(v ? 6 : 2, Math.round(v / mx * 44)) + 'px"></i><span>' + Dt.WD[i] + '</span></div>').join('') + '</div>' +
      (tot >= 5 ? '<div class="note">Чаще всего задачи закрываются по ' + esc(Dt.WD_ACC[wd.indexOf(mx)]) + '.</div>' : '<div class="note">Когда накопится больше данных, здесь появится самый продуктивный день недели.</div>');
  }
  function volume(m) {
    const b = Stats.bars(m, AN.range), unit = AN.range === 365 ? 'по месяцам' : AN.range === 90 ? 'по неделям' : 'по дням';
    const tot = b.reduce((a, x) => a + x.c, 0), vis = b.reduce((a, x) => a + x.v, 0);
    return '<div class="an-sub">Выполнено задач ' + unit + ': <b>' + Math.round(tot) + '</b></div>' + bars(b.map(x => x.c), b.map(x => x.label), { k: 'a', aria: 'Выполненные задачи ' + unit }) +
      '<div class="an-sub" style="margin-top:6px">Заходы в приложение ' + unit + ': <b>' + vis + '</b></div>' + bars(b.map(x => x.v), b.map(x => x.label), { k: 'b', h: 84, aria: 'Заходы ' + unit }) +
      '<div class="note">Заходы считаются с начала ведения журнала (' + esc(Dt.fmt(dayKey(S.stats.since), true)) + ') и показывают активность, а не прогресс: в оценку вероятности они не входят.</div>';
  }
  function dirs(m) {
    const bl = m.blocks.slice().sort((a, b) => b.pct - a.pct || b.per - a.per);
    return '<div class="an-sub">Сектор мандалы «' + esc(clip(m.blocksTitle, 30)) + '»</div>' + bl.map(b => {
      const when = b.last ? 'последняя задача ' + Dt.rel(dayKey(b.last), m.today).replace('просрочено на ', '') + (Dt.diff(dayKey(b.last), m.today) > 1 ? ' назад' : '') : (b.done ? 'дата не записана' : 'пока без выполненных');
      return '<div class="an-dir"><div class="hd"><b>' + esc(clip(b.title, 26)) + '</b><span>' + b.done + ' / 9</span></div><div class="bar"><i style="width:' + pc(b.pct) + '%"></i></div><div class="ft"><span>' + esc(when) + '</span><span>' + (b.per ? '+' + b.per + ' за период' : '') + '</span></div></div>';
    }).join('');
  }
  function calendar(m) {
    const items = m.deadlines.items;
    if (!AN.calY) { AN.calY = +m.today.slice(0, 4); AN.calM = +m.today.slice(5, 7) - 1; }
    const first = Dt.make(AN.calY, AN.calM, 1), start = Dt.add(first, -Dt.dow(first)), by = {};
    items.forEach(t => { (by[t.due] = by[t.due] || []).push(t); });
    const RANK = { over: 6, today: 5, soon: 4, later: 3, late: 2, ok: 1, done: 0 };
    let g = '<div class="an-cal"><div class="hd"><button data-act="an-cal" data-v="prev" aria-label="Предыдущий месяц">' + I('chevl') + '</button><b>' + esc(Dt.MONTHS[AN.calM]) + ' ' + AN.calY + '</b><button data-act="an-cal" data-v="next" aria-label="Следующий месяц">' + I('chevr') + '</button></div><div class="wd">' + Dt.WD.map(w => '<span>' + w + '</span>').join('') + '</div><div class="gr">';
    for (let j = 0; j < 42; j++) {
      const k = Dt.add(start, j), L = by[k] || [], worst = L.length ? L.slice().sort((a, b) => RANK[b.st] - RANK[a.st])[0].st : '';
      g += '<button class="d' + (k.slice(0, 7) !== first.slice(0, 7) ? ' out' : '') + (k === m.today ? ' today' : '') + (k === AN.sel ? ' sel' : '') + '" data-act="an-cal" data-v="day" data-k="' + k + '"' + (L.length ? ' aria-label="' + esc(Dt.fmt(k) + ', сроков: ' + L.length) + '"' : '') + '>' + (+k.slice(8)) + (L.length ? '<i class="pt" data-s="' + worst + '" data-n="' + Math.min(L.length, 3) + '"></i>' : '') + '</button>';
    }
    g += '</div></div>';
    const row = t => '<button class="an-dl" data-act="an-task" data-mid="' + esc(t.mid) + '" data-i="' + t.i + '"><span class="dd" data-s="' + t.st + '"><b>' + (+t.due.slice(8)) + '</b><i>' + Dt.MONTHS_S[+t.due.slice(5, 7) - 1] + '</i></span><span class="tx"><b>' + esc(clip(t.text, 44)) + '</b><i>' + esc((m.mans.length > 1 ? clip(t.mt, 18) + ' · ' : '') + (t.done ? (t.st === 'ok' ? 'выполнено вовремя' : t.st === 'late' ? 'выполнено с опозданием' : 'выполнено') : Dt.rel(t.due, m.today)) + (t.pend && t.due >= m.today && t.P != null ? ' · шанс успеть ' + pc(t.P) + '%' : '')) + '</i></span><span class="st-chip" data-s="' + t.st + '">' + esc(DUE_LABEL[t.st] || '') + '</span></button>';
    const sum = m.deadlines;
    let h = '<div class="an-chips2">' + [['over', 'Просрочено', sum.over], ['today', 'Сегодня', sum.today], ['soon', 'Скоро', sum.soon], ['later', 'В планах', sum.later], ['ok', 'Вовремя', sum.ok], ['late', 'С опозданием', sum.late]].filter(q => q[2]).map(q => '<span class="st-chip" data-s="' + q[0] + '">' + q[1] + ' <b>' + q[2] + '</b></span>').join('') + '</div>';
    h += g;
    const sel = AN.sel ? (by[AN.sel] || []) : null;
    if (sel) h += '<div class="an-sub">' + esc(Dt.fmt(AN.sel, true)) + ': ' + (sel.length ? Dt.num(sel.length, ['срок', 'срока', 'сроков']) : 'сроков нет') + '</div>' + sel.map(row).join('');
    const next = items.filter(t => t.pend).sort((a, b) => a.due < b.due ? -1 : a.due > b.due ? 1 : 0).slice(0, 8);
    if (next.length) h += '<div class="an-sub">Ближайшие сроки</div>' + next.map(row).join('');
    else if (!items.length) h += '<div class="an-empty">Сроков пока нет. Откройте любую задачу в мандале и нажмите «Срок выполнения»: календарь и расчёт соблюдения сроков заработают сами.<button class="btn sm" data-act="an-go" style="margin-top:8px">' + I('target') + ' К мандале</button></div>';
    return h;
  }
  function advice(m) {
    const list = Stats.insights(m);
    return list.map(x => '<div class="an-ins ' + x.tone + '"><b>' + esc(x.title) + '</b><span>' + esc(x.text) + '</span></div>').join('');
  }
  function how() {
    return '<details class="an-how"><summary>Как считается вероятность</summary><div class="note">' +
      'Это оценка по вашему текущему темпу, а не гарантия. Складывается из четырёх частей: регулярность (30%), темп выполнения (30%), доля выполненного (25%), соблюдение сроков (15%). ' +
      'Если сроков нет, их вес распределяется между остальными. Регулярность — активные дни за последние 4 недели, свежие 2 недели важнее. Темп — выполненные задачи в неделю против нужного для остатка за 12 недель или для ближайших сроков. ' +
      'Для срока считается шанс успеть: сколько задач нужно закрыть к дате и сколько вы закроете при своём темпе. Открытие приложения и правки на оценку почти не влияют: считается результат. ' +
      'Для оценки нужны минимум 7 дней истории и 3 выполненные задачи. Выполненные ранее задачи без даты разносятся по вашему журналу активности. Все расчёты идут на устройстве.</div></details>';
  }
  const card = (id, icon, title, sub, html) => Glass.card({ icon, title, sub, html, cls: 'an-card', data: id ? { an: id } : null });

  function render() {
    if (AN.scope !== 'all' && !S.mandals.some(x => String(x.id) === String(AN.scope))) AN.scope = 'all';
    const m = Stats.model(S, Date.now(), AN.scope, AN.range);
    let h = controls(m);
    h += '<div class="box g-card an-card an-heroCard">' + hero(m) + '</div>';
    h += kpis(m);
    h += card('forecast', 'target', 'Прогноз и путь к срокам', m.title, forecast(m));
    h += card('dead', 'calendar', 'Сроки', m.deadlines.n ? Dt.num(m.deadlines.n, ['срок', 'срока', 'сроков']) : '', '<div id="anDeadlines"></div>' + calendar(m));
    h += card('act', 'flame', 'Календарь активности', '', activity(m));
    h += card('vol', 'chart', 'Выполнение и заходы', '', volume(m));
    h += card('dirs', 'gear', 'Направления', '', dirs(m));
    h += card('tips', 'sparkle', 'Выводы и советы', '', advice(m));
    h += how();
    setScrollHTML('#anScroll', h);
  }

  /* ---------- нажатие на график: показываем значения за выбранный день ---------- */
  function bind() {
    if (AN.bound) return; AN.bound = true;
    const at = (e) => {
      const plot = e.target.closest ? e.target.closest('#anPlot') : null; if (!plot || !AN.ser) return;
      const svg = plot.querySelector('svg'), tip = $('#anTip', plot), cur = svg.querySelector('.cur'); if (!svg || !tip || !cur) return;
      const r = svg.getBoundingClientRect(), vx = (e.clientX - r.left) / r.width * 320, fx = clamp((vx - 28) / (320 - 28 - 10), 0, 1);
      let bi = 0, bd = 9; AN.xs.forEach((x, i) => { const d = Math.abs(x - fx); if (d < bd) { bd = d; bi = i; } });
      const q = AN.ser[bi], xx = 28 + (320 - 38) * AN.xs[bi];
      cur.setAttribute('x1', xx); cur.setAttribute('x2', xx); cur.style.display = '';
      tip.classList.remove('hidden');
      tip.innerHTML = '<b>' + esc(Dt.fmt(q.k)) + '</b><span class="a">Вероятность: ' + (q.p == null ? 'нет данных' : q.p + '%') + '</span>' + (q.d == null ? '' : '<span class="b">Сроки: ' + q.d + '%</span>');
      tip.style.left = clamp(xx / 320 * 100, 18, 82) + '%';
    };
    const sc = $('#anScroll');
    sc.addEventListener('pointerdown', at); sc.addEventListener('pointermove', e => { if (e.buttons || e.pointerType === 'touch') at(e); });
  }
  return { render, bind };
})();

function renderAnalytics() { An.bind(); An.render(); }

Object.assign(ACT, {
  'an-range'(el) { const v = +el.dataset.v; if (![7, 30, 90, 365].includes(v)) return; AN.range = v; Snd.play('click'); Hap.select(); renderAnalytics(); },
  'an-scope'(el) { AN.scope = String(el.dataset.v); Snd.play('click'); Hap.select(); renderAnalytics(); },
  'an-cal'(el) {
    const v = el.dataset.v;
    if (v === 'prev') { AN.calM--; if (AN.calM < 0) { AN.calM = 11; AN.calY--; } }
    else if (v === 'next') { AN.calM++; if (AN.calM > 11) { AN.calM = 0; AN.calY++; } }
    else if (v === 'day') AN.sel = AN.sel === el.dataset.k ? '' : el.dataset.k;
    Snd.play('click'); Hap.select(); renderAnalytics();
  },
  'an-task'(el) {
    const mid = el.dataset.mid, i = +el.dataset.i;
    if (!S.mandals.some(x => String(x.id) === String(mid)) || !(i >= 0 && i < 81)) return;
    switchMandala(mid); setMode('all'); switchTab('mandala'); Snd.play('click'); Hap.impact('light');
    setTimeout(() => openCellEditor(i), 60);
  },
  'an-go'() { switchTab('mandala'); },
  'goto-deadlines'() {
    AN.scope = String(activeMandala().id); AN.sel = '';
    switchTab('analytics'); Snd.play('click'); Hap.impact('light');
    requestAnimationFrame(() => { const el = $('#anDeadlines'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' }); });
  }
});
