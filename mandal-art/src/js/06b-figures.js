/* ============================================================
   06b-figures: фигурки-стенды.
   Витрина во вкладке «Реликвии → Фигурки», окно просмотра с вращением, получение за ранг / огоньки / Stars.
   Покупку за Stars подтверждает ТОЛЬКО сервер (07b-shop.js): клиент ничего не «засчитывает» сам.
   Честно про «3D»: фигурка — плоская картинка-стенд. Объём даёт толщина из срезов силуэта и вращение вокруг оси
   (2.5D, как акриловый стенд), а не настоящая 3D-модель.
   ============================================================ */
const FIGURES = (typeof FIGURE_DEFS !== 'undefined' && Array.isArray(FIGURE_DEFS) ? FIGURE_DEFS : [])
  .map(f => Object.assign({ glow: '#f59e0b', flames: 0, rank: 0, product: '', eye: null, rights: 'pending', desc: '' }, f));

const shopApi = () => (typeof Shop !== 'undefined' ? Shop : null);
const allFigs = () => { const s = shopApi(); return FIGURES.concat(s ? s.customFigures() : []); };
const figById = id => allFigs().find(f => f.id === id) || null;
const figOwned = id => (Array.isArray(S.unlockedFigs) && S.unlockedFigs.includes(id)) || !!(shopApi() && shopApi().ownsFigure(id));
const figStatus = f => figOwned(f.id) ? 'owned' : (!f.custom && levelIdx(S.xp) >= f.rank ? 'ready' : 'locked');
const figOwnedCount = () => allFigs().filter(f => figOwned(f.id)).length;
const figReadyCount = () => FIGURES.filter(f => figStatus(f) === 'ready').length;
/** названия фигурок, которые становятся доступны при достижении ранга l (индекс с нуля) */
const figsAtRank = l => FIGURES.filter(f => f.rank === l && !figOwned(f.id)).map(f => f.name);
const figArtVar = f => '--fg:url(&quot;' + esc(f.url) + '&quot;)';
/** группы витрины: вселенные + «Артефакты» (оригинальные 3D-модели, собранные кодом) */
const FIG_UNI = Object.assign({}, UNIVERSES, { art: 'Артефакты · оригинал' });

/** Забрать фигурку: via='xp' — за достигнутый ранг (бесплатно), via='flames' — досрочно за огоньки. Stars — только через сервер. */
function unlockFig(id, via) {
  const f = FIGURES.find(x => x.id === id);
  if (!f || figOwned(id)) return { ok: false, reason: 'already' };
  if (via === 'flames') {
    if (!f.flames) return { ok: false, reason: 'noflames' };
    if (S.flames < f.flames) return { ok: false, reason: 'flames', need: f.flames };
    S.flames -= f.flames;
  } else if (levelIdx(S.xp) < f.rank) return { ok: false, reason: 'rank', need: f.rank };
  if (!Array.isArray(S.unlockedFigs)) S.unlockedFigs = [];
  S.unlockedFigs.push(id);
  checkAchievements(); save(); Hooks.change();
  return { ok: true, fig: f };
}

/* ---------- витрина ---------- */
function figReq(f) {
  if (f.custom) return 'Магазин';
  return 'Ранг: ' + esc(rankName(f.rank)) + (f.flames ? '<br>или ' + I('flame') + f.flames : '');
}
function figTile(f) {
  const st = figStatus(f);
  const sub = st === 'owned' ? '<div class="cost">В коллекции</div>'
    : st === 'ready' ? '<div class="cost"><b style="color:var(--accent-2)">Забрать!</b></div>'
      : '<div class="cost">' + figReq(f) + '</div>';
  return '<button class="fig ' + st + '" data-act="fig" data-id="' + esc(f.id) + '" style="--fgc:' + esc(f.glow) + '" aria-label="' + esc(f.name) + '">' +
    '<div class="fg-art"><i class="fgs fgd ' + esc(f.id) + '"' + (f.custom ? ' style="' + figArtVar(f) + '"' : '') + '></i>' + (st === 'locked' ? '<span class="fg-lock">' + I('lock') + '</span>' : '') + '</div>' +
    '<div class="nm">' + esc(f.name) + '</div>' + sub + '</button>';
}
function renderFigs() {
  const all = allFigs(), own = all.filter(f => figOwned(f.id)).length;
  let h = '<div class="box"><div class="h2"><span>' + I('relic') + ' ' + esc(T('figs')) + '</span><span class="sub">' + own + '/' + all.length + '</span></div>' +
    '<div class="note">Нажмите на фигурку — её можно вращать пальцем и рассматривать со всех сторон. Получить: за ранг (бесплатно), за огоньки или за Telegram Stars.</div></div>';
  Object.keys(FIG_UNI).forEach(u => {
    const fs = all.filter(f => f.uni === u), o = fs.filter(f => figOwned(f.id)).length;
    if (u === 'art' && !fs.length) return;
    h += '<div><div class="uni"><span>' + esc(FIG_UNI[u]) + '</span><span class="pill">' + o + '/' + fs.length + '</span></div>' +
      (fs.length ? '<div class="grid3">' + fs.map(figTile).join('') + '</div>' : '<div class="note fg-soon">Фигурки этой вселенной ещё готовятся.</div>') + '</div>';
  });
  return h;
}

/* ---------- нижняя часть окна просмотра: статус, кнопки, пояснение ---------- */
function figFooter(f) {
  const st = figStatus(f), sh = shopApi();
  let status = '', act = '', note = '';
  if (st === 'owned') status = I('check') + ' В вашей коллекции';
  else if (st === 'ready') {
    status = 'Доступна за ранг «' + esc(rankName(f.rank)) + '» — заберите бесплатно';
    act = '<button class="btn block" data-a="claim">' + I('unlock') + ' Забрать фигурку</button>';
  } else {
    if (f.custom) status = 'Продаётся за Telegram Stars';
    else status = 'Откроется на ранге «' + esc(rankName(f.rank)) + '» (ещё ' + Math.max(0, CONFIG.ranks[f.rank].xp - S.xp) + ' XP)';
    const btns = [];
    if (!f.custom && f.flames) btns.push('<button class="btn" data-a="flames"' + (S.flames >= f.flames ? '' : ' disabled') + '>' + I('flame') + ' ' + f.flames + '</button>');
    const pr = sh ? sh.product(f.product) : null, ss = sh ? sh.status() : { ok: false, text: 'Магазин не подключён' };
    const can = !!(ss.ok && pr && pr.can_buy !== false);
    btns.push('<button class="btn' + (btns.length ? ' ghost' : '') + '" data-a="stars"' + (can ? '' : ' disabled') + '>' + I('star') + ' ' + (pr ? pr.price_stars + ' Stars' : 'Stars') + '</button>');
    act = '<div class="fgv-btnrow">' + btns.join('') + '</div>';
    if (!ss.ok) note = esc(ss.text);
    else if (!pr) note = 'Эта фигурка пока не продаётся за Stars.';
    else if (pr.can_buy === false) note = esc(sh.reasonText(pr.reason));
    else note = 'Оплата — Telegram Stars. Фигурка появится в коллекции, когда сервер подтвердит платёж.';
    if (!f.custom && S.flames < f.flames) note = (note ? note + ' ' : '') + 'Огоньков не хватает: нужно ' + f.flames + ', у вас ' + S.flames + '.';
  }
  return { status, act, note };
}

/* ---------- окно просмотра: стенд с вращением ---------- */
function figAspect(f) {
  if (f.w && f.h) return Promise.resolve(f.w / f.h);
  return new Promise(res => { const im = new Image(); im.onload = () => res(im.naturalWidth && im.naturalHeight ? im.naturalWidth / im.naturalHeight : .7); im.onerror = () => res(.7); im.src = f.url; });
}
function openFigViewer(f, o) {
  o = o || {};
  if (UI.fgv) return;
  UI.fgv = true;
  figAspect(f).then(asp => {
    const lvl = FX.level();
    const reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    const nSl = lvl === 'full' ? 12 : lvl === 'lite' ? 6 : 0;
    let sl = ''; for (let i = 0; i < nSl; i++) sl += '<i class="fgv-sl" style="--k:' + ((i / Math.max(1, nSl - 1)) - .5).toFixed(3) + '"></i>';
    const eye = f.eye ? '<i class="fgv-eye" style="left:' + (f.eye[0] * 100).toFixed(1) + '%;top:' + (f.eye[1] * 100).toFixed(1) + '%"></i>' : '';
    const motes = lvl === 'full' ? Array.from({ length: 12 }, (_, i) => '<i class="fgv-mote" style="--x:' + ((i * 37 + 11) % 100) + '%;--d:' + (5 + (i * 7) % 5) + 's;--w:-' + ((i * 53) % 9) + 's"></i>').join('') : '';
    const el = document.createElement('div');
    el.className = 'fgv fx-' + lvl + (o.fresh ? ' fresh' : '');
    el.style.setProperty('--fgc', f.glow); el.style.setProperty('--fgc-a', hexA(f.glow, .34)); el.style.setProperty('--fgc-b', hexA(f.glow, .6)); el.style.setProperty('--fgc-c', hexA(f.glow, .2));
    el.innerHTML =
      '<button class="fgv-x" data-x="1" aria-label="Закрыть">' + I('close') + '</button>' +
      '<div class="fgv-stage" id="fgvStage"><div class="fgv-bg"></div><div class="rays"></div>' + motes +
        '<div class="fgv-cam"><i class="fgv-shadow"></i><i class="fgv-ring"></i>' +
          '<div class="fgv-lift"><div class="fgv-obj fgd ' + esc(f.id) + '"' + (f.custom ? ' style="' + figArtVar(f) + '"' : '') + '>' + sl +
            '<div class="fgv-face fr"><i class="fgs"></i><i class="fgv-sheen"></i><i class="fgv-shade"></i>' + eye + '</div>' +
            '<div class="fgv-face bk"><i class="fgs"></i><i class="fgv-shade"></i></div>' +
          '</div></div></div>' +
        '<div class="fgv-load">Строю 3D-модель…</div><div class="fgv-mode" id="fgvMode"></div><div class="fgv-hint">Тяните, чтобы вращать</div><div class="fgv-prev">Предпросмотр</div>' +
      '</div>' +
      '<div class="fgv-info"><div class="fgv-kick" id="fgvKick"></div><div class="fgv-nm serif">' + esc(f.name) + '</div><div class="fgv-ds">' + esc(f.desc || '') + '</div><div class="fgv-st" id="fgvSt"></div></div>' +
      '<div class="fgv-ctl" role="group" aria-label="Положение фигурки"><button data-v="front">Спереди</button><button data-v="side">Сбоку</button><button data-v="back">Сзади</button><button data-v="auto" class="on" aria-pressed="true">Вращение</button></div>' +
      '<div class="fgv-act" id="fgvAct"></div>';
    const rec = Modal.mount(el, { sticky: true, onClose: () => { stopped = true; cancelAnimationFrame(raf); if (ro) ro.disconnect(); if (g3) { g3.dispose(); g3 = null; } UI.g3 = null; window.removeEventListener('resize', fit); UI.fgv = false; } });
    const stage = $('#fgvStage', el), obj = $('.fgv-obj', el), ring = $('.fgv-ring', el), shadow = $('.fgv-shadow', el), sheen = $('.fgv-sheen', el);
    const shades = $$('.fgv-shade', el);
    let stopped = false, raf = 0, ro = null, g3 = null;

    const footer = () => {
      const st = figStatus(f), ft = figFooter(f);
      el.classList.toggle('locked', st === 'locked'); if (g3) g3.setLocked(st === 'locked');
      $('#fgvKick', el).textContent = (o.fresh && st === 'owned' ? 'Фигурка получена · ' : 'Фигурка · ') + (FIG_UNI[f.uni] || '');
      $('#fgvSt', el).innerHTML = ft.status;
      $('#fgvAct', el).innerHTML = ft.act + (ft.note ? '<div class="fgv-note">' + ft.note + '</div>' : '');
    };
    footer();

    /* размеры: фигурка вписывается в окно, толщина пропорциональна высоте */
    const fit = () => {
      const r = stage.getBoundingClientRect(); if (!r.width || !r.height) return;
      let H = Math.min(r.height * .72, 440), W = H * asp;
      if (W > r.width * .86) { W = r.width * .86; H = W / asp; }
      stage.style.setProperty('--fw', W.toFixed(1) + 'px'); stage.style.setProperty('--fh', H.toFixed(1) + 'px');
      stage.style.setProperty('--th', clamp(H * .055, 7, 20).toFixed(1) + 'px');
      stage.style.setProperty('--rd', clamp(Math.max(W * 1.3, H * .64), 170, r.width * .94).toFixed(1) + 'px');
    };
    fit(); requestAnimationFrame(fit);
    window.addEventListener('resize', fit);
    if (window.ResizeObserver) { ro = new ResizeObserver(fit); ro.observe(stage); }

    /* состояние вращения */
    let ry = -28, rx = 0, vy = 0, drag = false, lastX = 0, lastY = 0, lastT = 0, idle = 0, snap = null, dirty = true, auto = !reduce && lvl !== 'off', last = performance.now(), swPh = 0, swOk = false;
    const apply = () => {
      const rad = ry * Math.PI / 180, s = Math.abs(Math.sin(rad)), c = Math.cos(rad);
      obj.style.transform = 'rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg)';
      ring.style.transform = 'translateX(-50%) rotateX(74deg) rotateZ(' + (-ry).toFixed(1) + 'deg)';
      shadow.style.transform = 'translateX(-50%) scale(' + (.55 + .45 * Math.abs(c)).toFixed(3) + ',1)';
      shadow.style.opacity = (.5 + .35 * Math.abs(c)).toFixed(2);
      sheen.style.backgroundPosition = (50 - Math.sin(rad) * 90).toFixed(1) + '% 0';
      sheen.style.opacity = (.25 + .6 * (1 - s)).toFixed(2);
      const sh = (s * .62).toFixed(2); for (let i = 0; i < shades.length; i++) shades[i].style.opacity = sh;
    };
    const snapTo = (target, dur) => { const b = target + 360 * Math.round((ry - target) / 360); snap = { a: ry, b, t: 0, d: dur || .55 }; vy = 0; idle = 0; swOk = false; };
    const tick = t => {
      if (stopped || !el.isConnected) return;
      raf = requestAnimationFrame(tick);
      const dt = Math.min(.05, (t - last) / 1000); last = t;
      let moved = false;
      if (snap) {
        snap.t += dt; const k = clamp(snap.t / snap.d, 0, 1), e = 1 - Math.pow(1 - k, 3);
        ry = snap.a + (snap.b - snap.a) * e; rx *= Math.pow(.02, dt); moved = true; idle = 0; if (k >= 1) snap = null;
      } else if (!drag) {
        if (Math.abs(vy) > 1.5) { ry += vy * dt; vy *= Math.pow(.05, dt); moved = true; }
        else if (auto && idle > 2.2) {
          if (g3 && g3.swing) {                       // одна картинка: у модели нет настоящей спины — вместо полного оборота качаем ±55° вокруг лица
            if (!swOk) { ry = ((ry + 180) % 360 + 360) % 360 - 180; swPh = Math.asin(clamp(ry / 55, -1, 1)); swOk = true; }
            swPh += dt * .6; ry += (55 * Math.sin(swPh) - ry) * (1 - Math.pow(.02, dt));
          } else ry += 17 * dt;
          moved = true;
        }
        if (Math.abs(rx) > .05) { rx *= Math.pow(.03, dt); moved = true; }
        idle += dt;
      }
      if (g3) { g3.setRot(ry, rx); g3.frame(dt, t / 1000); dirty = false; }
      else if (moved || dirty) { apply(); dirty = false; }
    };
    apply(); raf = requestAnimationFrame(tick);

    /* Настоящий 3D (Three.js, 06c-3d.js): если доступен — рисуем им; иначе остаётся лёгкий CSS-стенд выше. Подпись всегда честная. */
    const modeBox = $('#fgvMode', el), hintBox = $('.fgv-hint', el);
    const setMode = (txt, note) => { modeBox.innerHTML = esc(txt) + (note ? '<small>' + esc(note) + '</small>' : ''); };
    const cssMode = why => setMode('Акриловый стенд', why || 'Плоская картинка с толщиной, не 3D-модель');
    cssMode();
    const dropGL = why => { if (!g3) return; g3.dispose(); g3 = null; UI.g3 = null; el.classList.remove('g3'); el.classList.add('g3f'); cssMode(why); hintBox.textContent = 'Тяните, чтобы вращать'; fit(); dirty = true; };
    const addGlbBtn = () => {
      const row = $('.fgv-ctl', el); if (!row || $('.glb', row)) return;
      const b = document.createElement('button'); b.className = 'glb'; b.dataset.v = 'glb'; b.title = 'Открыть свою 3D-модель (.glb) — только для просмотра, файл никуда не отправляется'; b.textContent = 'GLB…'; row.appendChild(b);
      if (typeof Hull3D !== 'undefined') {
        const vb = document.createElement('button'); vb.className = 'vw'; vb.dataset.v = 'views'; vb.title = 'Построить объём по трём своим картинкам: спереди, сбоку, сзади — только для просмотра, файлы никуда не отправляются'; vb.textContent = 'Виды…'; row.appendChild(vb);
      }
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.glb,model/gltf-binary'; inp.hidden = true; inp.id = 'fgvGlb'; el.appendChild(inp);
      inp.addEventListener('change', async () => {
        const file = inp.files && inp.files[0]; inp.value = ''; if (!file || !g3) return;
        try { await g3.loadGLB(await file.arrayBuffer()); setMode(g3.label, 'Файл ' + file.name + ' · только просмотр'); toast('Модель открыта'); }
        catch (e) { Snd.play('error'); toast('Не удалось открыть GLB-файл', 'err'); }
      });
    };
    if (typeof Fig3D !== 'undefined' && lvl !== 'off' && Fig3D.canOpen(f)) {
      el.classList.add('g3l');
      Fig3D.mount(stage, f, { lvl, reduce, onLost: () => dropGL('Потерян графический контекст') }).then(c => {
        if (stopped || !el.isConnected) { c.dispose(); return; }
        g3 = UI.g3 = c; el.classList.remove('g3l'); el.classList.add('g3'); g3.setLocked(el.classList.contains('locked'));
        setMode(g3.label, g3.note); hintBox.textContent = 'Тяните — вращать · щипок или колесо — приблизить'; addGlbBtn(); dirty = true;
      }).catch(err => { console.warn('3D недоступно:', err && err.message); el.classList.remove('g3l'); el.classList.add('g3f'); cssMode('3D недоступно на этом устройстве'); });
    }

    /* перетаскивание и инерция */
    stage.addEventListener('pointerdown', e => {
      drag = true; vy = 0; snap = null; idle = 0; swOk = false; lastX = e.clientX; lastY = e.clientY; lastT = performance.now();
      try { stage.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      el.classList.add('drag'); $('.fgv-hint', el).classList.add('off');
    });
    stage.addEventListener('pointermove', e => {
      if (!drag || (g3 && g3.pinching)) return;
      const now = performance.now(), dtm = Math.max(1, now - lastT), dx = e.clientX - lastX, dy = e.clientY - lastY;
      ry += dx * .6; rx = clamp(rx - dy * .22, -24, 24);
      vy = vy * .55 + (dx * .6 / dtm * 1000) * .45; lastX = e.clientX; lastY = e.clientY; lastT = now; dirty = true;
    });
    const up = () => { if (!drag) return; drag = false; idle = 0; el.classList.remove('drag'); if (performance.now() - lastT > 90) vy = 0; };
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => stage.addEventListener(ev, up));

    const celebrate = () => {
      el.classList.add('fresh'); o.fresh = true; footer(); if (g3) g3.pulse();
      Snd.play('unlock'); Hap.notify('success');
      ry = -380; snapTo(0, 1.5); idle = 0;
      setTimeout(() => { if (!el.isConnected) return; const b = stage.getBoundingClientRect(); Burst.relic(b.left + b.width / 2, b.top + b.height * .45); }, 650);
    };
    if (o.fresh) { ry = -380; snapTo(0, 1.6); Snd.play('unlock'); Hap.notify('success'); setTimeout(() => { if (!el.isConnected) return; const b = stage.getBoundingClientRect(); Burst.relic(b.left + b.width / 2, b.top + b.height * .45); }, 700); }
    else Snd.play('click');

    el.addEventListener('click', async e => {
      if (e.target.closest('[data-x]')) { Modal.close(rec); return; }
      const v = e.target.closest('[data-v]');
      if (v) {
        Snd.play('click'); Hap.select();
        if (v.dataset.v === 'glb') { const gi = $('#fgvGlb', el); if (gi) gi.click(); return; }
        if (v.dataset.v === 'views') {
          if (g3) openViewsDialog(async V => { await g3.loadViews(V); setMode(g3.label, 'Свои картинки · только просмотр'); hintBox.textContent = 'Тяните — вращать · щипок или колесо — приблизить'; swOk = false; dirty = true; });
          return;
        }
        if (v.dataset.v === 'auto') { auto = !auto; v.classList.toggle('on', auto); v.setAttribute('aria-pressed', String(auto)); idle = auto ? 99 : 0; return; }
        snapTo({ front: 0, side: 90, back: 180 }[v.dataset.v]); return;
      }
      const a = e.target.closest('[data-a]'); if (!a || a.disabled) return;
      if (a.dataset.a === 'claim') {
        const r = unlockFig(f.id, 'xp'); if (r.ok) celebrate(); else { Snd.play('error'); toast('Пока недоступно', 'err'); }
      } else if (a.dataset.a === 'flames') {
        Snd.play('click');
        if (!await Modal.confirm({ title: 'Открыть фигурку?', msg: '«' + f.name + '» — ' + f.flames + ' огоньков (у вас ' + S.flames + ').', ok: 'Открыть' })) return;
        const r = unlockFig(f.id, 'flames'); if (r.ok) celebrate(); else { Snd.play('error'); toast('Не хватает огоньков', 'err'); footer(); }
      } else if (a.dataset.a === 'stars') {
        Snd.play('click'); a.disabled = true;
        const r = await shopApi().buy(f.product, { title: f.name });
        if (!el.isConnected) return;
        if (r.ok && figOwned(f.id)) celebrate(); else footer();
      }
    });
  });
}

/* ---------- один раз после обновления: показать, где фигурки ---------- */
function showFigIntro() {
  if (!FIGURES.length) return;
  const rec = Modal.open('<h3>' + I('relic') + ' Новое: фигурки</h3><div class="msg">В разделе «' + esc(T('hall')) + '» появилась вкладка «' + esc(T('figs')) + '» — ' + FIGURES.length + ' коллекционных фигурок. Их можно вращать пальцем и приближать: объём строится из рисунка, а «Артефакты» — настоящие 3D-модели. Забрать: за ранг (бесплатно), за огоньки или за Telegram Stars.</div>' +
    '<div class="fg-strip">' + FIGURES.slice(0, 6).map(f => '<i class="fgs fgd ' + esc(f.id) + '"></i>').join('') + '</div><div class="btns"><button class="btn ghost" data-r="x">Позже</button><button class="btn" data-r="go">Смотреть</button></div>');
  rec.el.addEventListener('click', e => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    Modal.close(rec);
    if (b.dataset.r === 'go') { UI.hall = 'figs'; switchTab('relics'); }
  });
}

ACT.hall = function (el) { Snd.play('click'); Hap.select(); UI.hall = el.dataset.v === 'figs' ? 'figs' : el.dataset.v === 'shop' ? 'shop' : 'relics'; renderRelics(); const sc = $('#relicsScroll'); if (sc) sc.scrollTop = 0; };
ACT.fig = function (el) { const f = figById(el.dataset.id); if (!f) return; Snd.play('click'); Hap.impact('light'); openFigViewer(f); };

/** Окно «Объём по трём видам»: три картинки одного персонажа -> 3D-форма по силуэтам (06c2-hull.js). Файлы остаются на устройстве. */
function openViewsDialog(build) {
  const pick = { front: null, side: null, back: null }; let faces = 'left', busy = false;
  const slot = (k, t, need) => '<label class="vw-slot" data-k="' + k + '"><input type="file" accept="image/*" hidden data-k="' + k + '"><i class="vw-th"></i><b>' + t + '</b><small>' + (need ? 'нужна' : 'по желанию') + '</small></label>';
  const rec = Modal.open('<h3>' + I('cube') + ' Объём по трём видам</h3>' +
    '<div class="msg">Выберите картинки одного персонажа: спереди, сбоку и (по желанию) сзади — в одном масштабе, от макушки до ног на одной высоте. Фон однотонный или прозрачный. ' +
    'Это не скан и не нейросеть: форма строится по силуэтам, мелкая лепка не восстанавливается. Файлы остаются на вашем устройстве.</div>' +
    '<div class="vw-slots">' + slot('front', 'Спереди', 1) + slot('side', 'Сбоку', 1) + slot('back', 'Сзади', 0) + '</div>' +
    '<div class="vw-faces" role="group" aria-label="Куда смотрит профиль"><span>Профиль смотрит</span><button data-f="left" class="on" aria-pressed="true">влево</button><button data-f="right" aria-pressed="false">вправо</button></div>' +
    '<div class="msg vw-err" id="vwErr" role="status"></div>' +
    '<div class="btns"><button class="btn ghost" data-x="1">Отмена</button><button class="btn" id="vwGo" disabled>Построить</button></div>', { top: true });
  const el = rec.el, go = $('#vwGo', el), err = $('#vwErr', el);
  const sync = () => { go.disabled = busy || !(pick.front && pick.side); };
  el.addEventListener('change', e => {
    const inp = e.target.closest('input[type=file]'); if (!inp) return;
    const file = inp.files && inp.files[0]; inp.value = ''; if (!file) return;
    const k = inp.dataset.k, th = $('.vw-slot[data-k="' + k + '"] .vw-th', el);
    if (!/^image\//.test(file.type)) { err.textContent = 'Это не картинка.'; return; }
    if (file.size > 12 * 1024 * 1024) { err.textContent = 'Файл слишком большой (больше 12 МБ).'; return; }
    err.textContent = ''; pick[k] = file;
    if (th.dataset.u) URL.revokeObjectURL(th.dataset.u);
    th.dataset.u = URL.createObjectURL(file); th.style.backgroundImage = 'url("' + th.dataset.u + '")'; th.classList.add('on'); sync();
  });
  el.addEventListener('click', async e => {
    if (e.target.closest('[data-x]')) { Modal.close(rec); return; }
    const fb = e.target.closest('[data-f]');
    if (fb) { faces = fb.dataset.f; $$('[data-f]', el).forEach(b => { const on = b === fb; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }); Snd.play('click'); return; }
    if (e.target.closest('#vwGo') && !go.disabled) {
      busy = true; sync(); err.textContent = ''; go.textContent = 'Строю…';
      const toImg = f => new Promise((res, rej) => { if (!f) { res(null); return; } const u = URL.createObjectURL(f), im = new Image(); im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('img')); }; im.src = u; });
      try {
        const [fr, sd, bk] = await Promise.all([toImg(pick.front), toImg(pick.side), toImg(pick.back)]);
        await build({ front: fr, side: sd, back: bk, faces });
        $$('.vw-th', el).forEach(t => { if (t.dataset.u) URL.revokeObjectURL(t.dataset.u); });
        Modal.close(rec); toast('Модель построена по вашим картинкам'); Snd.play('success');
      } catch (x) {
        busy = false; go.textContent = 'Построить'; sync(); Snd.play('error');
        err.textContent = /empty/.test(x && x.message) ? 'Не вижу персонажа на картинке: нужен однотонный фон, который не совпадает с цветом персонажа, или прозрачность.' : 'Не получилось построить модель. Проверьте, что картинки одного персонажа, в одном масштабе.';
      }
    }
  });
}
