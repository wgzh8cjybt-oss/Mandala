/* ============================================================
   05-ui: модалки, тосты, шапка, сетка мандалы, дневник
   Весь пользовательский текст попадает в DOM только через
   textContent / esc() — XSS из старых версий закрыт.
   ============================================================ */
const UI = { tab: 'mandala', mode: 'all', focus: 4, px: innerWidth / 2, py: innerHeight / 2, rq: false, hall: 'relics', fgv: false };
let cellEls = [], blkEls = [];
const isBlockCenter = i => (Math.floor(i / 9) % 3 === 1) && (i % 9 % 3 === 1);
const kindOf = i => i === 40 ? 'main' : (blockOfIdx(i) === 4 || isBlockCenter(i)) ? 'sub' : 'task';

/* ---------- тосты ---------- */
function toast(msg, kind) {
  const root = $('#toasts'), t = document.createElement('div');
  t.className = 'toast' + (kind === 'err' ? ' err' : '');
  // токены {ic:ключ} → иконка текущей темы; остальной текст добавляется только текстовыми узлами (без innerHTML)
  String(msg).split(/(\{ic:[a-z0-9]+\})/).forEach(p => {
    const m = /^\{ic:([a-z0-9]+)\}$/.exec(p);
    if (m) { const i = document.createElement('i'); i.className = 'ic'; i.setAttribute('data-i', m[1]); i.setAttribute('aria-hidden', 'true'); t.appendChild(i); }
    else if (p) t.appendChild(document.createTextNode(p));
  });
  root.appendChild(t);
  while (root.children.length > 3) root.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, kind === 'long' ? 5200 : 2600);
}

/* ---------- модальные окна (стек, Esc, кнопка «Назад» Telegram) ---------- */
const Modal = {
  stack: [],
  mount(el, o) {
    o = o || {};
    $('#modalRoot').appendChild(el);
    const rec = { el, onClose: o.onClose, sticky: !!o.sticky };
    if (!o.sticky) el.addEventListener('pointerdown', e => { if (e.target === el) Modal.close(rec); });
    Modal.stack.push(rec);
    if (typeof Tg !== 'undefined') Tg.syncBack();
    return rec;
  },
  open(html, o) {
    const ov = document.createElement('div');
    ov.className = 'overlay' + (o && o.top ? ' top' : '');
    ov.innerHTML = '<div class="modal panel rivets g-modal" role="dialog" aria-modal="true">' + html + '</div>';
    return Modal.mount(ov, o);
  },
  close(rec) {
    const i = Modal.stack.indexOf(rec);
    if (i < 0) return;
    Modal.stack.splice(i, 1); rec.el.remove();
    if (rec.onClose) rec.onClose();
    if (typeof Tg !== 'undefined') Tg.syncBack();
  },
  closeTop() { const r = Modal.stack[Modal.stack.length - 1]; if (!r) return false; Modal.close(r); return true; },
  confirm(o) {
    return new Promise(res => {
      const rec = Modal.open('<h3>' + esc(o.title || 'Подтверждение') + '</h3><div class="msg">' + esc(o.msg || '') + '</div><div class="btns"><button class="btn ghost" data-r="0">' + esc(o.cancel || 'Отмена') + '</button><button class="btn' + (o.danger ? ' danger' : '') + '" data-r="1">' + esc(o.ok || 'Да') + '</button></div>', { onClose: () => res(false) });
      rec.el.addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (!b) return; rec.onClose = null; Modal.close(rec); res(b.dataset.r === '1'); });
    });
  },
  alert(title, msg) {
    return new Promise(res => {
      const rec = Modal.open('<h3>' + esc(title) + '</h3><div class="msg">' + esc(msg) + '</div><div class="btns"><button class="btn" data-r="1">Понятно</button></div>', { onClose: () => res() });
      rec.el.addEventListener('click', e => { if (e.target.closest('[data-r]')) Modal.close(rec); });
    });
  }
};
document.addEventListener('keydown', e => { if (e.key === 'Escape') Modal.closeTop(); });

/* ---------- тема ---------- */
function applyTheme(id) {
  const b = document.body, fam = famOfTheme(id);
  Array.from(b.classList).forEach(c => { if (c.indexOf('theme-') === 0 || c.indexOf('fam-') === 0) b.classList.remove(c); });
  b.classList.add('theme-' + id, 'fam-' + fam);
  Look.apply(id);
  FAM = fam;
  if (typeof Scene !== 'undefined') { Scene.setFamily(fam); Scene.recolor(); }
  applyLabels();
  if (typeof Tg !== 'undefined') Tg.applyColors();
  scheduleRender();
}
/* подписи, зависящие от семейства темы (Warhammer / One Piece / Scrooge) */
function applyLabels() {
  $$('#nav .lb').forEach(el => { el.textContent = T('nav')[+el.dataset.nav]; });
  const dt = $('#diaryTitle'); if (dt) dt.innerHTML = I('scroll') + ' ' + esc(T('diary'));
  const di = $('#diaryInput'); if (di) di.placeholder = T('diaryPh');
}

/* ---------- шапка и вкладки целей ---------- */
function renderHeader() {
  const m = activeMandala(), r = rankInfo(S.xp);
  $('#mTitle').textContent = m.title || 'Главная цель Империума';
  $('#rankLine').textContent = 'Ур. ' + r.level + ' · ' + r.name + (r.to ? ' · ' + S.xp + '/' + r.to : '');
  $('#xpFill').style.width = Math.round(r.pct * 100) + '%';
  $('#flameCount').textContent = S.flames;
  $('#xpCount').textContent = S.xp + ' XP';
  const tabs = $('#mandalaTabs');
  const sig = S.mandals.map(x => x.id + ':' + x.title).join('|') + '#' + S.activeId;
  if (tabs._sig !== sig) {
    tabs._sig = sig;
    tabs.innerHTML = S.mandals.map(x => '<button class="tab-btn' + (String(x.id) === String(S.activeId) ? ' active' : '') + '" role="tab" data-act="mandala" data-id="' + esc(x.id) + '">' + esc(x.title || 'Цель') + '</button>').join('');
    const a = $('.tab-btn.active', tabs);
    if (a && a.scrollIntoView) { try { a.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (e) { /* ignore */ } }
  }
  const dot = $('#dotRelics');
  const ready = RELICS.some(x => relicStatus(x) === 'ready') || figReadyCount() > 0;
  dot.classList.toggle('on', ready); dot.textContent = ready ? '!' : '';
}

/* ---------- сетка 9×9 (DOM создаётся один раз, дальше только diff) ---------- */
function buildGrid() {
  const grid = $('#grid'); grid.innerHTML = '';
  cellEls = new Array(81); blkEls = [];
  for (let b = 0; b < 9; b++) {
    const blk = document.createElement('div');
    blk.className = 'blk' + (b === 4 ? ' core' : ''); blk.dataset.b = b;
    blockCells(b).forEach(idx => {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'cell'; btn.dataset.i = idx;
      btn.appendChild(document.createElement('span')).className = 't';
      cellEls[idx] = btn; blk.appendChild(btn);
    });
    // значок «у блока есть комментарий» (только индикатор, нажатия пропускает — ячейки под ним остаются нажимаемыми)
    const fl = document.createElement('i'); fl.className = 'bn-flag'; fl.setAttribute('aria-hidden', 'true'); fl.innerHTML = I('note'); blk.appendChild(fl);
    grid.appendChild(blk); blkEls[b] = blk;
  }
  const ring = document.createElement('i'); ring.className = 'pct'; ring.setAttribute('aria-hidden', 'true');
  cellEls[40].appendChild(ring);
}
function renderCells() {
  const m = activeMandala(), goalSet = String(m.cells[40].text).trim() !== '', today = dayKey();
  let done = 0;
  for (let idx = 0; idx < 81; idx++) {
    const c = m.cells[idx], el = cellEls[idx], k = kindOf(idx);
    const locked = blockOfIdx(idx) !== 4 && !goalSet;
    if (c.completed) done++;
    const ds = c.due && c.text && !locked ? Stats.dueState(c, today) : '';
    const key = (locked ? 'L' : '') + (c.completed ? 'D' : '') + k + '|' + c.text + (ds ? '|' + ds + c.due : '');
    if (el._k === key) continue;
    el._k = key;
    el.className = 'cell' + (k === 'main' ? ' main' : k === 'sub' ? ' sub' : '') + (locked ? ' locked' : '') + (c.completed ? ' done' : '');
    const t = el.firstChild;
    if (locked) { t.className = 't'; t.innerHTML = '<i class="ic" data-i="lock" aria-hidden="true"></i>'; }
    else if (c.text) { t.className = 't'; t.textContent = c.text; }
    else { t.className = 't ph'; t.textContent = k === 'main' ? 'Главная цель' : k === 'sub' ? 'Подцель' : 'Задача'; }
    // класс длины текста: в режиме «Блок» длинная формулировка уменьшается, чтобы читалась целиком, а не обрезалась «…»
    t.dataset.l = c.text.length > 60 ? '4' : c.text.length > 40 ? '3' : c.text.length > 24 ? '2' : '1';
    // значок срока: цветная точка (в режиме «Блок» — дата ДД.ММ); цвет — состояние, а не только оттенок: у просроченных ещё и восклицательный знак
    let bd = el._bd;
    if (ds) {
      if (!bd) { bd = el._bd = document.createElement('i'); bd.className = 'due'; bd.setAttribute('aria-hidden', 'true'); el.appendChild(bd); }
      bd.dataset.s = ds; bd.textContent = (ds === 'over' ? '!' : '') + Dt.dm(c.due);
    } else if (bd) { bd.remove(); el._bd = null; }
    el.setAttribute('aria-label', (k === 'main' ? 'Главная цель' : k === 'sub' ? 'Подцель' : 'Задача') + ': ' + (locked ? 'заблокировано' : (c.text || 'пусто')) + (c.completed ? ', выполнено' : '') + (ds ? ', срок ' + Dt.fmt(c.due) + (c.completed ? '' : ', ' + (DUE_LABEL[ds] || '').toLowerCase()) : ''));
  }
  for (let b = 0; b < 9; b++) { blkEls[b].classList.toggle('full', blockCells(b).every(i => m.cells[i].completed)); blkEls[b].classList.toggle('has-note', !!blockNote(m, b)); }
  $('.pct', cellEls[40]).style.setProperty('--p', Math.round(done / 81 * 100) + '%');
  $('#statTop').textContent = done + ' / 81';
  if (UI.mode === 'block') $('#focusName').textContent = blockTitle(m, UI.focus);
  renderBlockNote();
  renderDueStrip(m, today);
}
/* полоска над сеткой: сколько сроков горит и какой ближайший (нажатие открывает «Аналитику» на разделе сроков) */
function renderDueStrip(m, today) {
  const el = $('#dueStrip'); if (!el) return;
  const d = Due.sum(m, today), parts = [];
  if (d.over) parts.push('<b class="s-over">Просрочено ' + d.over + '</b>');
  if (d.today) parts.push('<b class="s-today">Сегодня ' + d.today + '</b>');
  if (d.next && !(d.next.due === today)) parts.push('Ближайший: <b>' + esc(Dt.fmt(d.next.due)) + '</b>');
  const key = d.n ? d.over + '|' + d.today + '|' + (d.next ? d.next.due : '') + '|' + today : '';
  el.classList.toggle('hidden', !d.n);
  if (el._k === key) return;
  el._k = key;
  if (d.n) el.innerHTML = I('calendar') + '<span class="tx">' + (parts.length ? parts.join(' · ') : 'Сроков в ближайшие дни нет') + '</span><span class="go">' + I('chevr') + '</span>';
}
function applyMode() {
  const f = UI.mode === 'block';
  $('#board').classList.toggle('focus', f);
  $('#focusNav').classList.toggle('hidden', !f);
  $('#modeAll').classList.toggle('active', !f); $('#modeBlock').classList.toggle('active', f);
  blkEls.forEach((el, b) => { el.style.display = (!f || b === UI.focus) ? '' : 'none'; });
  if (f) $('#focusName').textContent = blockTitle(activeMandala(), UI.focus);
  renderBlockNote();
}
function setMode(mode, b) { UI.mode = mode; if (b != null) UI.focus = b; applyMode(); }

/* ---------- комментарий к блоку: окошко под названием блока (только в режиме «Блок») ---------- */
function noteFade() {   // затухание сверху/снизу и стрелка «ниже есть ещё», если текст длиннее окошка
  const tx = $('#bnTxt'), box = $('#bnBox'); if (!tx || !box) return;
  const over = tx.scrollHeight - tx.clientHeight > 2;
  const more = over && tx.scrollTop + tx.clientHeight < tx.scrollHeight - 2;
  tx.classList.toggle('ft', over && tx.scrollTop > 2);
  tx.classList.toggle('fb', more);
  box.classList.toggle('more', more);
}
function renderBlockNote() {
  const box = $('#blockNote'); if (!box) return;
  const f = UI.mode === 'block';
  box.classList.toggle('hidden', !f);
  if (!f) return;
  const m = activeMandala(), t = blockNote(m, UI.focus), tx = $('#bnTxt'), key = m.id + '|' + UI.focus + '|' + t;
  if (box._k !== key) {
    box._k = key;
    tx.classList.toggle('ph', !t);
    tx.textContent = t || 'Комментарий к блоку — нажмите, чтобы написать';
    tx.scrollTop = 0;
  }
  noteFade();
}
function bindNote() {
  const tx = $('#bnTxt'), box = $('#bnBox'); if (!tx || !box) return;
  tx.addEventListener('scroll', noteFade, { passive: true });
  box.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); Snd.play('click'); openBlockNote(UI.focus); } });
  window.addEventListener('resize', noteFade);
}
function openBlockNote(b) {
  const m = activeMandala(); if (b == null) b = UI.focus;
  const rec = Modal.open(
    '<h3>' + I('note') + ' Комментарий · ' + esc(blockTitle(m, b)) + '</h3>' +
    '<textarea id="bnInput" class="field bn-input" rows="7" maxlength="' + CONFIG.noteMax + '" placeholder="Мысли, условия, ссылки — всё, что важно помнить по этому блоку..." autocapitalize="sentences"></textarea>' +
    '<div class="note bn-count" id="bnCount"></div>' +
    '<div class="btns"><button class="btn ghost" data-r="cancel">Отмена</button><button class="btn danger" data-r="clear">Очистить</button><button class="btn" data-r="ok">Сохранить</button></div>',
    { top: true });
  const ta = $('#bnInput', rec.el), cnt = $('#bnCount', rec.el);
  ta.value = blockNote(m, b);
  const upd = () => { cnt.textContent = ta.value.length + ' / ' + CONFIG.noteMax; };
  upd(); ta.addEventListener('input', upd);
  rec.el.addEventListener('click', e => {
    const x = e.target.closest('[data-r]'); if (!x) return;
    if (x.dataset.r === 'cancel') Modal.close(rec);
    else if (x.dataset.r === 'clear') { ta.value = ''; upd(); ta.focus(); }
    else {
      const changed = setBlockNote(m, b, ta.value);
      Modal.close(rec); Snd.play('click'); Hap.impact('light');
      if (changed) toast('{ic:check} Комментарий сохранён');
    }
  });
  try { ta.focus({ preventScroll: true }); const L = ta.value.length; ta.setSelectionRange(L, L); } catch (e) { /* ignore */ }
}

/* ---------- дневник ---------- */
function renderDiary() {
  const q = diaryQuota();
  $('#diaryQuota').textContent = 'XP сегодня: ' + (CONFIG.diaryXpPerDay - q) + '/' + CONFIG.diaryXpPerDay;
  $('#btnDiary').textContent = q > 0 ? T('diaryBtn') + ' (+' + CONFIG.xpDiary + ' XP)' : T('diaryBtn') + ' (лимит XP на сегодня исчерпан)';
  const list = $('#diaryList');
  if (!S.diary.length) { list.innerHTML = '<div class="empty">' + esc(T('diaryEmpty')) + '</div>'; return; }
  list.innerHTML = S.diary.map(e => '<div class="entry"><div class="meta"><span>' + esc(e.date) + '</span><button class="link-del" data-act="del-diary" data-id="' + e.id + '">Удалить</button></div><p>' + esc(e.text) + '</p></div>').join('');
}

/* ---------- общий рендер ---------- */
function renderAll() {
  UI.rq = false;
  renderHeader(); renderCells();
  if (UI.tab === 'diary') renderDiary();
  else if (UI.tab === 'relics') renderRelics();
  else if (UI.tab === 'analytics') renderAnalytics();
  else if (UI.tab === 'hq') renderHQ();
}
function scheduleRender() { if (UI.rq) return; UI.rq = true; requestAnimationFrame(renderAll); }

const VIEW_ID = { mandala: 'viewMandala', diary: 'viewDiary', relics: 'viewRelics', analytics: 'viewAnalytics', hq: 'viewHQ' };
function switchTab(tab) {
  if (!VIEW_ID[tab]) tab = 'mandala';
  UI.tab = tab;
  if (tab === 'analytics') Stats.viewed();
  Object.keys(VIEW_ID).forEach(t => document.getElementById(VIEW_ID[t]).classList.toggle('hidden', t !== tab));
  $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  renderAll();
  const sc = $('#' + VIEW_ID[tab] + ' .scroll'); if (sc) sc.scrollTop = 0;
}

/* ---------- редактор ячейки ---------- */
function cellCenter(idx) { const r = cellEls[idx].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
/** Чей «блокнот» у этой ячейки-цели: главная цель → ядро; подцель в центре → блок, который она возглавляет; центр внешнего блока → этот блок. Для задач -1. */
function goalBlockOf(idx) {
  if (blockOfIdx(idx) === 4) return blockCells(4).indexOf(idx);
  if (isBlockCenter(idx)) return blockOfIdx(idx);
  return -1;
}
function openCellEditor(idx) {
  const m = activeMandala(), c = m.cells[idx], k = kindOf(idx), gb = goalBlockOf(idx);
  const name = k === 'main' ? 'Главная цель' : k === 'sub' ? 'Подцель' : 'Задача';
  const rec = Modal.open(
    '<h3>' + name + ' · ряд ' + (Math.floor(idx / 9) + 1) + ', колонка ' + (idx % 9 + 1) + '</h3>' +
    '<textarea id="ceText" class="field ce-text" rows="3" maxlength="' + CONFIG.cellMax + '" placeholder="' + (k === 'task' ? 'Введите задачу...' : 'Введите формулировку...') + '" enterkeyhint="done" autocomplete="off" autocapitalize="sentences"></textarea>' +
    '<label class="chk"><span id="ceLbl"></span><input id="ceDone" type="checkbox"' + (c.completed ? ' checked' : '') + '></label>' +
    '<div class="ce-due" id="ceDueRow"><button type="button" class="ce-due-btn" id="ceDue" data-s="">' + I('calendar') + '<span class="tx"><span class="k">Срок выполнения</span><b class="v" id="ceDueV"></b></span><span class="go">' + I('chevr') + '</span></button><button type="button" class="ce-due-x" id="ceDueX" aria-label="Убрать срок">' + I('close') + '</button></div>' +
    (gb >= 0 ? '<div class="ce-book-l">' + I('note') + ' Блокнот цели</div><textarea id="ceBook" class="field ce-book" rows="3" maxlength="' + CONFIG.noteMax + '" placeholder="Заметки к этой цели: детали, условия, ссылки..." autocapitalize="sentences"></textarea>' : '') +
    '<div class="note" id="ceNote"></div>' +
    '<div class="btns"><button class="btn ghost" data-r="cancel">Отмена</button><button class="btn danger" data-r="clear">Очистить</button><button class="btn" data-r="ok">Готово</button></div>',
    { top: true });
  const inp = $('#ceText', rec.el), chk = $('#ceDone', rec.el), note = $('#ceNote', rec.el), lbl = $('#ceLbl', rec.el);
  inp.value = c.text;   // поле многострочное: длинная формулировка переносится и читается целиком, а не уезжает за край
  const book = $('#ceBook', rec.el); if (book) book.value = blockNote(m, gb);
  let dueVal = c.due || '';
  const dueBtn = $('#ceDue', rec.el), dueV = $('#ceDueV', rec.el), dueX = $('#ceDueX', rec.el);
  const drawDue = () => {
    const has = inp.value.trim() !== '';
    const view = { text: 'x', due: dueVal, completed: chk.checked, dn: c.completed && c.dn ? c.dn : (chk.checked ? Date.now() : 0) };
    dueBtn.disabled = !has; dueX.classList.toggle('hidden', !dueVal);
    dueBtn.dataset.s = dueVal && has ? Stats.dueState(view, dayKey()) : '';
    dueV.textContent = !has ? 'сначала впишите текст' : dueVal ? Due.text(view) : 'не задан · нажмите, чтобы выбрать дату';
  };
  const sync = () => {
    const has = inp.value.trim() !== '';
    chk.disabled = !has; if (!has) chk.checked = false;
    drawDue();
    lbl.textContent = c.awarded ? 'Выполнено (XP уже получен)' : 'Завершить задачу (+' + CONFIG.xpCell + ' XP)';
    note.textContent = !has ? 'Сначала впишите текст — пустую ячейку выполнить нельзя.' : (k === 'sub' && blockOfIdx(idx) === 4 && idx !== 40 ? 'Подцель автоматически копируется в центр соответствующего блока, если там пусто.' : '');
  };
  sync();
  inp.addEventListener('input', () => { if (/[\r\n]/.test(inp.value)) inp.value = inp.value.replace(/\s*[\r\n]+\s*/g, ' '); sync(); });   // перенос строки (вставка) → пробел: ячейка однострочная по смыслу
  const submit = () => {
    const text = inp.value, done = chk.checked, bk = book ? book.value : null;
    Modal.close(rec);
    if (bk !== null) setBlockNote(m, gb, bk);
    const res = applyCell(m, idx, text, done, dueVal);
    if (res.newlyDone) {
      const el = cellEls[idx]; el.classList.remove('just'); void el.offsetWidth; el.classList.add('just'); setTimeout(() => el.classList.remove('just'), 700);
      const p = cellCenter(idx); Burst.cell(p.x, p.y); Snd.play('success'); Hap.notify('success');
    } else { Snd.play('click'); Hap.impact('light'); }
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  rec.el.addEventListener('click', e => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    if (b.dataset.r === 'cancel') Modal.close(rec);
    else if (b.dataset.r === 'clear') { inp.value = ''; chk.checked = false; dueVal = ''; sync(); inp.focus(); }
    else if (b.dataset.r) submit();
  });
  chk.addEventListener('change', drawDue);
  dueX.addEventListener('click', () => { dueVal = ''; Snd.play('click'); Hap.select(); drawDue(); });
  dueBtn.addEventListener('click', () => {
    if (dueBtn.disabled) return;
    const marks = {}; m.cells.forEach((x, i) => { if (x.text && x.due && !x.completed && i !== idx) marks[x.due] = (marks[x.due] || 0) + 1; });
    Snd.play('click'); Hap.impact('light');
    DatePicker.open({ value: dueVal, title: inp.value.trim(), done: chk.checked, marks, onPick: v => { dueVal = v; drawDue(); } });
  });
  try { inp.focus({ preventScroll: true }); if (inp.value) inp.select(); } catch (e) { /* ignore */ }
}

/* ---------- обработка нажатий по сетке (клик + долгое нажатие = режим «Блок») ---------- */
function bindGrid() {
  const grid = $('#grid');
  bindNote();
  let timer = 0, sx = 0, sy = 0, longDone = false;
  const clear = () => { clearTimeout(timer); timer = 0; };
  grid.addEventListener('pointerdown', e => {
    const c = e.target.closest('.cell'); if (!c) return;
    sx = e.clientX; sy = e.clientY; longDone = false; clear();
    timer = setTimeout(() => {
      longDone = true; timer = 0;
      const b = blockOfIdx(+c.dataset.i);
      Hap.impact('medium'); Snd.play('click');
      if (UI.mode === 'block') setMode('all'); else setMode('block', b);
    }, 480);
  });
  grid.addEventListener('pointermove', e => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) clear(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => grid.addEventListener(ev, clear));
  grid.addEventListener('contextmenu', e => e.preventDefault());
  grid.addEventListener('click', e => {
    const c = e.target.closest('.cell'); if (!c) return;
    if (longDone) { longDone = false; return; }
    const idx = +c.dataset.i, m = activeMandala();
    if (isLocked(m, idx)) { Snd.play('error'); Hap.notify('warning'); toast('{ic:lock} Сектор заблокирован! Сначала задайте главную цель в центре.'); return; }
    Snd.play('click'); Hap.impact('light'); openCellEditor(idx);
  });
}

/* ---------- эффекты событий игры ---------- */
const lvQueue = []; let lvBusy = false;
function showLevelUp(lvl, name, fl, figs) { lvQueue.push({ lvl, name, fl, figs: figs || [] }); if (!lvBusy) nextLevelUp(); }
function nextLevelUp() {
  const q = lvQueue.shift();
  if (!q) { lvBusy = false; return; }
  lvBusy = true;
  setTimeout(() => {
    const el = document.createElement('div'); el.className = 'levelup';
    el.innerHTML = '<div class="rw">' + esc(T('levelKicker')) + '</div><div class="big serif">Уровень ' + q.lvl + '</div><div class="rk">' + esc(q.name) + '</div><div class="rw">+' + q.fl + ' ' + I('flame') + ' огоньков</div>' + (q.figs && q.figs.length ? '<div class="rw">' + I('relic') + ' Доступна фигурка: ' + esc(q.figs.join(', ')) + '</div>' : '') + '<div class="note">Нажмите, чтобы продолжить</div>';
    document.body.appendChild(el);
    Snd.play('level'); Hap.notify('success'); Burst.level();
    let tm = 0; const done = () => { clearTimeout(tm); el.remove(); nextLevelUp(); };
    tm = setTimeout(done, 4200); el.addEventListener('click', done);
  }, 500);
}
function wireHooks() {
  Hooks.change = scheduleRender;
  Hooks.xp = (n, o) => {
    let x = UI.px, y = UI.py;
    if (o && o.idx != null && cellEls[o.idx] && UI.tab === 'mandala') { const p = cellCenter(o.idx); x = p.x; y = p.y - 8; }
    floatText(x, y - 10, '+' + n + ' XP');
  };
  Hooks.level = (lvl, name, fl, figs) => showLevelUp(lvl, name, fl, figs);
  Hooks.block = (b, xp, fl) => {
    setTimeout(() => {
      const el = blkEls[b]; if (!el) return;
      const r = el.getBoundingClientRect(); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1000);
      Burst.block(r.left + r.width / 2, r.top + r.height / 2);
    }, 250);
    Snd.play('block'); toast('{ic:gear} ' + T('blockDone') + ' +' + xp + ' XP, +' + fl + ' {ic:flame}');
  };
  Hooks.main = (xp, fl) => { setTimeout(() => Burst.confetti(), 400); Snd.play('level'); toast('{ic:crown} ' + T('mainDone') + ' +' + xp + ' XP, +' + fl + ' {ic:flame}', 'long'); };
  Hooks.ach = (list, silent) => {
    if (silent) { const fl = list.reduce((a, x) => a + x.fl, 0); toast('{ic:star} Награды за прошлые заслуги: ' + list.length + ' дост., +' + fl + ' {ic:flame}', 'long'); return; }
    list.forEach((a, i) => setTimeout(() => { toast('{ic:' + a.ic + '} ' + a.name + ' · +' + a.fl + ' {ic:flame}'); Snd.play('success'); }, 700 + i * 900));
  };
  Hooks.theme = id => applyTheme(id);
  Hooks.saved = ok => { if (!ok && !UI.warnedSave) { UI.warnedSave = true; toast('{ic:warn} Не удалось сохранить на устройстве — включите облако Telegram или сделайте экспорт.', 'err'); } };
}
