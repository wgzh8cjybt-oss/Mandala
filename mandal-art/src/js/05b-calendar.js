/* ============================================================
   05b-calendar: срок задачи — выбор даты (год, месяц, день), подписи состояния и сводка сроков.
   Срок хранится строкой «ГГГГ-ММ-ДД» в клетке (c.due), без времени. Состояния — Stats.dueState.
   ============================================================ */
const DUE_LABEL = { over: 'Просрочено', today: 'Сегодня', soon: 'Скоро', later: 'В планах', ok: 'Вовремя', late: 'С опозданием', done: 'Выполнено' };
const Due = {
  /** Короткая подпись срока для строки в редакторе: «25 ноября 2026 · через 4 дня» */
  text(c, today) {
    if (!c || !c.due) return '';
    today = today || dayKey();
    const st = Stats.dueState(c, today), base = Dt.fmt(c.due, true);
    if (st === 'ok') return base + ' · выполнено вовремя';
    if (st === 'late') return base + ' · выполнено с опозданием на ' + Dt.num(Math.max(1, Dt.diff(c.due, dayKey(c.dn))), ['день', 'дня', 'дней']);
    if (st === 'done') return base + ' · выполнено';
    return base + ' · ' + Dt.rel(c.due, today);
  },
  /** Сводка сроков одной мандалы для полоски над сеткой */
  sum(m, today) {
    today = today || dayKey();
    const o = { over: 0, today: 0, soon: 0, later: 0, next: null, n: 0 };
    m.cells.forEach((c, i) => {
      if (!c.text || !c.due || c.completed) return;
      const st = Stats.dueState(c, today); o.n++; o[st]++;
      if (c.due >= today && (!o.next || c.due < o.next.due)) o.next = { due: c.due, text: c.text, i };
    });
    return o;
  }
};

const DatePicker = (() => {
  /** o: { value, title, done, marks: {ГГГГ-ММ-ДД: число}, onPick(значение или '') } → окно поверх редактора */
  function open(o) {
    o = o || {};
    const today = dayKey();
    let sel = isDay(o.value) ? o.value : '';
    const base = sel || today;
    let vy = +base.slice(0, 4), vm = +base.slice(5, 7) - 1, mode = 'days';
    const marks = o.marks || {};
    const rec = Modal.open('<div class="dp" id="dpBody"></div>', { top: true });
    const body = $('#dpBody', rec.el);
    const clampYM = () => { if (vy < 2000) { vy = 2000; vm = 0; } if (vy > 2100) { vy = 2100; vm = 11; } };
    const quick = (label, k) => '<button type="button" class="dp-q' + (sel === k ? ' on' : '') + '" data-dp="set" data-k="' + k + '">' + esc(label) + '</button>';
    const sumLine = () => {
      if (!sel) return '<div class="dp-sum none">Срок не выбран</div>';
      const past = sel < today && !o.done;
      return '<div class="dp-sum">' + I('calendar') + ' <b>' + esc(Dt.fmt(sel, true)) + '</b> · ' + esc(Dt.WD_FULL[Dt.dow(sel)]) + ' · ' + esc(Dt.rel(sel, today)) + '</div>' +
        (past ? '<div class="dp-warn">' + I('warn') + ' Эта дата уже прошла: задача сразу станет просроченной.</div>' : '');
    };
    function draw() {
      clampYM();
      let h = '<h3>' + I('calendar') + ' Срок выполнения</h3>';
      if (o.title) h += '<div class="dp-for">' + esc(o.title) + '</div>';
      h += '<div class="dp-quick">' + quick('Сегодня', today) + quick('Завтра', Dt.add(today, 1)) + quick('+ неделя', Dt.add(today, 7)) + quick('+ месяц', Dt.add(today, 30)) + '</div>';
      if (mode === 'days') {
        h += '<div class="dp-head"><button type="button" class="dp-nav" data-dp="prev" aria-label="Предыдущий месяц">' + I('chevl') + '</button>' +
          '<button type="button" class="dp-title" data-dp="mode" aria-label="Выбрать месяц и год">' + esc(Dt.MONTHS[vm]) + ' ' + vy + '</button>' +
          '<button type="button" class="dp-nav" data-dp="next" aria-label="Следующий месяц">' + I('chevr') + '</button></div>';
        h += '<div class="dp-wd">' + Dt.WD.map(w => '<span>' + w + '</span>').join('') + '</div><div class="dp-grid" role="grid">';
        const first = Dt.make(vy, vm, 1), lead = Dt.dow(first), start = Dt.add(first, -lead);
        for (let j = 0; j < 42; j++) {
          const k = Dt.add(start, j), inM = k.slice(0, 7) === first.slice(0, 7), n = marks[k] || 0;
          h += '<button type="button" role="gridcell" class="dp-d' + (inM ? '' : ' out') + (k === today ? ' today' : '') + (k === sel ? ' sel' : '') + (k < today ? ' past' : '') + '" data-dp="day" data-k="' + k + '" aria-label="' + esc(Dt.fmt(k, true)) + (n ? ', сроков: ' + n : '') + '"' + (k === sel ? ' aria-selected="true"' : '') + '>' + (+k.slice(8)) + (n ? '<i class="dp-dot" data-n="' + Math.min(n, 3) + '"></i>' : '') + '</button>';
        }
        h += '</div>';
      } else {
        h += '<div class="dp-head"><button type="button" class="dp-nav" data-dp="yprev" aria-label="Предыдущий год"' + (vy <= 2000 ? ' disabled' : '') + '>' + I('chevl') + '</button>' +
          '<button type="button" class="dp-title" data-dp="mode" aria-label="Назад к дням">' + vy + '</button>' +
          '<button type="button" class="dp-nav" data-dp="ynext" aria-label="Следующий год"' + (vy >= 2100 ? ' disabled' : '') + '>' + I('chevr') + '</button></div>';
        h += '<div class="dp-months">' + Dt.MONTHS.map((n, q) => '<button type="button" class="dp-m' + (q === vm ? ' on' : '') + (vy === +today.slice(0, 4) && q === +today.slice(5, 7) - 1 ? ' today' : '') + '" data-dp="month" data-m="' + q + '">' + esc(n.charAt(0).toUpperCase() + n.slice(1)) + '</button>').join('') + '</div>';
      }
      h += sumLine();
      h += '<div class="btns"><button type="button" class="btn ghost" data-dp="cancel">Отмена</button><button type="button" class="btn danger" data-dp="clear">Без срока</button><button type="button" class="btn" data-dp="ok"' + (sel || !o.value ? '' : '') + '>Готово</button></div>';
      body.innerHTML = h;
    }
    draw();
    rec.el.addEventListener('click', e => {
      const b = e.target.closest('[data-dp]'); if (!b) return;
      const a = b.dataset.dp;
      if (a === 'prev') { vm--; if (vm < 0) { vm = 11; vy--; } draw(); }
      else if (a === 'next') { vm++; if (vm > 11) { vm = 0; vy++; } draw(); }
      else if (a === 'yprev') { vy--; draw(); }
      else if (a === 'ynext') { vy++; draw(); }
      else if (a === 'mode') { mode = mode === 'days' ? 'months' : 'days'; draw(); }
      else if (a === 'month') { vm = +b.dataset.m; mode = 'days'; draw(); }
      else if (a === 'day' || a === 'set') {
        sel = b.dataset.k; vy = +sel.slice(0, 4); vm = +sel.slice(5, 7) - 1; mode = 'days'; Snd.play('click'); Hap.select(); draw();
      }
      else if (a === 'cancel') Modal.close(rec);
      else if (a === 'clear') { Modal.close(rec); if (o.onPick) o.onPick(''); }
      else if (a === 'ok') { Modal.close(rec); if (o.onPick) o.onPick(sel); }
    });
    return rec;
  }
  return { open };
})();
