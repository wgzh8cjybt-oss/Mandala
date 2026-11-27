/* ============================================================
   03b-skull: фон — частицы + летающие декорации (сервочерепа / чайки / монеты) в одном rAF-цикле.
   Полёт — рулёжка с ограничением скорости поворота и путевыми точками впереди по курсу: без остановок и рывков.
   Разворот — настоящий поворот вокруг вертикальной оси в перспективе (CSS perspective + rotateY): обратная сторона — зеркальный
   рисунок; на лету добавляются лёгкое покачивание и «кивок» (2.5D из плоского рендера, не 3D-модель).
   Сценка поломки и ремонта (только тема WH и режим «полные»): сбой → падение → лежит → приходят два техножреца (картинки владельца)
   → сварка кабелями-механодендритами → череп оживает и взлетает → жрецы уходят. Всё чисто декоративное: pointer-events:none, aria-hidden.
   ============================================================ */
const Scene = (() => {
  let W = innerWidth, H = innerHeight, cv, g, dpr = .75, sprite = null, parts = [], skulls = [];
  let raf = 0, running = false, last = 0, t = 0, lite = false, enabled = false, slow = 1, paused = false, reduced = false;
  let fam = 'wh', specs0 = [], scenesOn = true;
  const PI = Math.PI, TAU = PI * 2;
  const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > PI) d -= TAU; else if (d < -PI) d += TAU; return d; };
  const ease = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);

  function makeSprite() {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const x = c.getContext('2d'), col = cssVar('--accent-2') || '#f59e0b', gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, hexA(col, 1)); gr.addColorStop(.35, hexA(col, .45)); gr.addColorStop(1, hexA(col, 0));
    x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
    sprite = c;
  }
  function size() {
    W = innerWidth; H = innerHeight;
    if (!cv) return;
    dpr = lite ? .5 : .75;
    cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function spawnParts(n) {
    parts = Array.from({ length: n }, () => ({ x: rnd(0, W), y: rnd(0, H), r: rnd(1.2, 3.2), vy: rnd(5, 20), ph: rnd(0, 6.28), fq: rnd(.4, 1.5), amp: rnd(4, 16), fl: rnd(.8, 2.2), a: rnd(.3, .75) }));
  }

  /* ---------- полёт ---------- */
  const margin = k => Math.max(18, k.w * .5);
  const inside = (k, x, y) => { const m = margin(k); return x > m && x < W - m && y > m && y < H - m; };
  // Новая путевая точка — всегда впереди по курсу (конус ±70°), поэтому курс меняется плавно, без разворотов на месте.
  function pickTarget(k) {
    if (k.glide) {                       // чайки пересекают экран по горизонтали, высота меняется плавно
      k.tx = k.x < W * .5 ? rnd(W * .72, W * 1.1) : rnd(-W * .1, W * .28);
      k.ty = clamp(k.y + rnd(-110, 110), H * .06, H * .72);
      return;
    }
    const m = margin(k) + 10, tries = k.layer === 'front' ? 7 : 4;
    let best = null, bs = -1;
    for (let i = 0; i < tries; i++) {
      const a = k.hd + rnd(-1.2, 1.2), d = rnd(150, 380);
      const x = clamp(k.x + Math.cos(a) * d, m, W - m), y = clamp(k.y + Math.sin(a) * d, m, H - m);
      // главный (передний) череп держится ближе к краям экрана, чтобы не закрывать мандалу
      const sc = k.layer === 'front' ? Math.abs(x - W / 2) / W + .25 * Math.abs(y - H / 2) / H + rnd(0, .25) : rnd(0, 1);
      if (sc > bs) { bs = sc; best = [x, y]; }
    }
    k.tx = best[0]; k.ty = best[1];
  }
  function buildSkulls(specs) {
    sceneAbort();
    specs0 = specs;
    skulls.forEach(k => k.el.remove()); skulls = [];
    const F = FLOATERS[fam] || FLOATERS.wh, back = $('#skulls'), front = $('#skullsFront');
    specs.forEach(sp => {
      const el = document.createElement('div'); el.className = 'skull ' + fam + (sp.layer === 'front' ? ' sk-hero' : ' sk-bg');
      const sc = sp.layer === 'front' ? 1.15 : .5 + .5 * sp.z;
      const w = Math.round(F.w * sc), h = Math.round(F.h * sc);
      el.style.width = w + 'px'; el.style.height = h + 'px';
      el.style.opacity = sp.layer === 'front' ? '.7' : String(.3 + .46 * sp.z);
      el.style.zIndex = String(Math.round(sp.z * 10));
      el.style.setProperty('--d', (-rnd(0, 6)).toFixed(2) + 's');
      el.style.setProperty('--thr', '.8');
      el.innerHTML = F.svg;
      (sp.layer === 'front' ? front : back).appendChild(el);
      const cruise = (18 + 26 * sp.z) * F.speed;
      const k = { el, w, h, s: sc, z: sp.z, layer: sp.layer, x: rnd(W * .1, W * .9), y: rnd(H * .1, H * .9), vx: 0, vy: 0, tx: 0, ty: 0, ph: rnd(0, 6.28),
        hd: rnd(0, TAU), sp: cruise * .6, w2: 0, cruise, minf: F.minf, turn: F.turn, arrive: Math.max(46, cruise * 1.25), bob: F.bob, glide: !!F.glide,
        flip: !!F.flip, nat: F.facesLeft ? -1 : 1, fl: 0, mt: 0, tilt: 0, thrQ: .8, mode: 'fly', rot: 0, rv: 0, sxc: 1, rotc: 0, thr: true };
      k.fl = k.mt = (Math.cos(k.hd) * k.nat < 0) ? 1 : 0;
      pickTarget(k); skulls.push(k);
    });
  }
  function drawParts(dt) {
    g.clearRect(0, 0, W, H);
    const sp = sprite; if (!sp) return;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      p.y -= p.vy * dt * slow;
      if (p.y < -12) { p.y = H + 12; p.x = rnd(0, W); }
      g.globalAlpha = p.a * (.55 + .45 * Math.sin(t * p.fl + p.ph));
      const sz = p.r * 6;
      g.drawImage(sp, p.x + Math.sin(t * p.fq + p.ph) * p.amp - sz / 2, p.y - sz / 2, sz, sz);
    }
    g.globalAlpha = 1;
  }
  function steer(k, dt, spMul) {
    if (!k.glide && !inside(k, k.x, k.y)) {             // вылетел за край — мягко возвращаем точку внутрь экрана
      const m = margin(k) + 40; k.tx = clamp(k.x, m, W - m); k.ty = clamp(k.y, m, H - m);
    } else if (Math.hypot(k.tx - k.x, k.ty - k.y) < k.arrive) pickTarget(k);
    const da = angDiff(Math.atan2(k.ty - k.y, k.tx - k.x), k.hd);
    const wDes = clamp(da * 1.5, -k.turn, k.turn);
    k.w2 += (wDes - k.w2) * (1 - Math.exp(-dt * 3));      // угловая скорость меняется плавно
    k.hd += k.w2 * dt;
    // скорость: «дыхание» ±8 %, на крутых виражах чуть ниже, но череп никогда не останавливается
    const breathe = .92 + .16 * Math.sin(t * .35 + k.ph), turnSlow = 1 - (1 - k.minf) * Math.min(1, Math.abs(k.w2) / k.turn) * .6;
    k.sp += (k.cruise * breathe * turnSlow * slow * (spMul == null ? 1 : spMul) - k.sp) * (1 - Math.exp(-dt * 1.1));
    k.vx = Math.cos(k.hd) * k.sp; k.vy = Math.sin(k.hd) * k.sp;
    k.x += k.vx * dt; k.y += k.vy * dt;
  }
  // Положение и «3D»: перспективный разворот (th = 0…180°, обратная сторона — зеркальный рисунок) + покачивание yaw и «кивок» pit.
  function paint(k, rot, bx, by, yaw, pit) {
    const th = k.flip ? 180 * k.fl * k.fl * (3 - 2 * k.fl) : 0;       // плавный старт и финиш поворота, быстрый проход через «ребро»
    k.sxc = k.flip ? Math.cos(th * PI / 180) : 1; k.rotc = rot;
    let tr = 'translate3d(' + (k.x + bx - k.w / 2).toFixed(1) + 'px,' + (k.y + by - k.h / 2).toFixed(1) + 'px,0) rotate(' + rot.toFixed(2) + 'deg)';
    if (k.flip) tr += ' perspective(' + Math.round(k.w * 5) + 'px) rotateX(' + (pit || 0).toFixed(2) + 'deg) rotateY(' + (th + (yaw || 0)).toFixed(2) + 'deg)';
    k.el.style.transform = tr;
  }
  // тяга двигателей: CSS-переменная пишется только при изменении на шаг .1 (а не каждый кадр)
  function setThrust(k, v) { const q = Math.round(clamp(v, 0, 1.2) * 10) / 10; if (q !== k.thrQ) { k.thrQ = q; k.el.style.setProperty('--thr', q); } }
  function stepSkull(k, dt) {
    if (k.mode === 'fly' || k.mode === 'glitch') {
      steer(k, dt, k.mode === 'glitch' ? SC.slowK : 1);
      // разворот вокруг вертикальной оси: гистерезис по горизонтальной скорости, угол сглаживается (см. paint)
      if (k.flip) {
        if (Math.abs(k.vx) > k.cruise * .3) k.mt = k.vx * k.nat < 0 ? 1 : 0;
        k.fl += clamp(k.mt - k.fl, -dt / .62, dt / .62);
      }
      const ds = clamp(k.vx / (k.cruise * .4 + 1), -1, 1);
      const tiltT = k.glide ? clamp(k.vy * .22, -9, 9) * ds : ds * (2.5 + clamp(k.vy / (k.cruise + 1) * 14, -8, 8));
      k.tilt += (tiltT - k.tilt) * (1 - Math.exp(-dt * 3));
      const bx = Math.sin(t * .9 + k.ph) * 2.2 * k.s * k.bob, by = Math.sin(t * 1.7 + k.ph * 1.3) * 3.6 * k.s * k.bob;
      const yaw = k.flip ? clamp(k.w2 * 11, -9, 9) + Math.sin(t * .8 + k.ph) * 4.5 : 0, pit = k.flip ? Math.sin(t * .95 + k.ph * 1.7) * 3.2 + clamp(k.vy / (k.cruise + 1) * 8, -6, 6) : 0;
      paint(k, k.tilt + Math.sin(t * 1.1 + k.ph) * 1.6, bx, by, yaw, pit);
      if (k.mode === 'fly' && k.layer) setThrust(k, k.sp / ((k.cruise * slow) || 1));
    } else stepHero(k, dt);
  }

  /* ---------- сценка: поломка → падение → ремонт техножрецами → взлёт ---------- */
  const SC = { on: false, st: '', tm: 0, k: null, cool: 55, pr: [], weld: [], cab: null, gy: 0, bounces: 0, rest: 0, restY: 0, slowK: 1, ev: 0, ev2: 0, PH: 88, from: 0, startRot: 0, doneArrive: 0 };
  const hero = () => (fam === 'wh' ? skulls.find(k => k.layer === 'front') : null) || null;
  const canScene = () => scenesOn && enabled && !lite && !reduced && fam === 'wh' && !!hero() && typeof PRIEST_LAYOUT === 'object' && !!PRIEST_LAYOUT.hood;
  const groundY = () => { const n = $('#nav'), r = n && n.getBoundingClientRect(); return (r && r.height > 0 && r.top > H * .4) ? r.top + 2 : H - 66; };
  const CLS = ['sk-glitch', 'sk-sputter', 'sk-fault', 'sk-dmg', 'sk-dead', 'sk-boot'];
  function setCls(k, on) { CLS.forEach(c => k.el.classList.toggle(c, on.indexOf(c) >= 0)); }
  // точка рисунка (в координатах 300x335) -> экран, с учётом отражения и поворота
  function spt(k, px, py) {
    const ox = (px - 150) / 300 * k.w * k.sxc, oy = (py - 167.5) / 335 * k.h, a = k.rotc * PI / 180, c = Math.cos(a), s = Math.sin(a);
    return [k.x + ox * c - oy * s, k.y + ox * s + oy * c];
  }
  /* --- техножрецы: слои из картинок владельца (03c-priests.js) --- */
  function makePriest(kind, side) {            // side -1: приходит слева, +1: справа
    const r = priestBuild(kind, SC.PH, side);
    if (!r) return null;
    $('#skullsFront').appendChild(r.el);
    return Object.assign(r, { side, x: side < 0 ? -r.w : W + r.w, tx: 0, sp: 60, ph: Math.random(), yaw: 0, st: 'in', near: PRIEST_NEAR_ARM[kind](side), aim: false, tgx: 0, tgy: 0, cab: 0, ev: 0, rs: Math.random() * 6.28, cabEl: null, weldEl: null });
  }
  function prState(p, st) { p.st = st; p.el.classList.toggle('walk', st === 'in' || st === 'leave'); p.el.classList.toggle('work', st === 'work'); p.el.classList.toggle('idle', st === 'idle' || st === 'work'); }
  // положение, ход, поворот в перспективе, крен, парение и прицеливание манипулятора
  function paintPriest(p, dt) {
    const K = p.K, k = p.k, mov = p.st === 'in' || p.st === 'leave';
    if (mov) p.ph += dt * p.sp / (p.h * K.stride);
    const dir = mov ? (p.st === 'leave' ? p.side : -p.side) : -p.side;       // куда смотрит: в пути — по ходу, на месте — на череп
    p.yaw += (dir * (mov ? 13 : 19) - p.yaw) * (1 - Math.exp(-dt * 5));
    const sw = Math.sin(p.ph * PI), hover = K.hover * p.h;
    const bob = K.hover ? Math.sin(t * (mov ? 2.4 : 1.9) + p.rs) * p.h * K.bob : (mov ? Math.abs(sw) * p.h * K.bob : Math.sin(t * 1.4 + p.rs) * .35);
    const roll = mov ? (K.hover ? Math.sin(t * 1.7 + p.rs) * 1.1 : sw * 1.7) + dir * 2.2 : Math.sin(t * 1.1 + p.rs) * .5;
    const fx = p.x - p.w / 2, fy = SC.gy - p.h + 3 - hover - bob;
    p.el.style.transform = 'translate3d(' + fx.toFixed(1) + 'px,' + (SC.gy - p.h + 3).toFixed(1) + 'px,0)';
    p.d3.style.transform = 'perspective(' + Math.round(p.h * 4.2) + 'px) rotateY(' + p.yaw.toFixed(2) + 'deg) rotate(' + roll.toFixed(2) + 'deg)';
    p.bob.style.transform = 'translateY(' + (-(hover + bob)).toFixed(2) + 'px)';
    Object.keys(p.arms).forEach(id => {
      const a = p.arms[id], d = a.def, on = id === p.near && p.aim;
      let want = Math.sin(t * 1.2 + p.rs + (id === 'ar' ? 1.7 : 0)) * 3.2;
      if (on) {                                                              // осью к цели: угол «кончик → цель» минус угол «кончик в покое»
        const ox = p.mir < 0 ? p.w - (d.x + d.px) * k : (d.x + d.px) * k, oy = (d.y + d.py) * k;
        const rx = (d.tx - d.px) * k * p.mir, ry = (d.ty - d.py) * k;
        let da = Math.atan2(p.tgy - (fy + oy), p.tgx - (fx + ox)) - Math.atan2(ry, rx);
        da = Math.atan2(Math.sin(da), Math.cos(da)) * 180 / PI;
        want = clamp(da, -62, 62) * p.mir + Math.sin(t * 38 + p.rs) * .9;   // в зеркальном слое знак поворота обратный
      }
      a.ang += (want - a.ang) * (1 - Math.exp(-dt * 7));
      a.ext += ((on ? 1 : 0) - a.ext) * (1 - Math.exp(-dt * 6));
      a.el.style.transform = 'rotate(' + a.ang.toFixed(2) + 'deg) scale(' + (1 + .24 * a.ext).toFixed(3) + ')';
    });
  }
  /* --- кабель-механодендрит от манипулятора к черепу + световой «сварочный» шарик на конце --- */
  function cablesInit() {
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'pr-cables'); svg.setAttribute('aria-hidden', 'true');
    SC.pr.forEach(p => {
      p.cabEl = ['co', 'ci'].map(c => { const e = document.createElementNS(NS, 'path'); e.setAttribute('class', c); svg.appendChild(e); return e; });
      const w = document.createElement('div'); w.className = 'weld'; w.style.visibility = 'hidden'; p.weldEl = w; SC.weld.push(w);
    });
    const host = $('#skullsFront'); host.appendChild(svg); SC.weld.forEach(w => host.appendChild(w)); SC.cab = svg;
  }
  function cableStep(p, dt) {
    if (!p.cabEl) return;
    p.cab += clamp((p.aim ? 1 : 0) - p.cab, -dt / .35, dt / .65);        // выдвигается ~.65 с, втягивается ~.35 с
    if (p.cab <= .004) { p.cabEl.forEach(e => e.setAttribute('d', '')); p.weldEl.style.visibility = 'hidden'; return; }
    const r = p.arms[p.near].tip.getBoundingClientRect(), x0 = r.left, y0 = r.top, x1 = p.tgx, y1 = p.tgy, dx = x1 - x0, dy = y1 - y0;
    const wob = Math.sin(t * 8 + p.rs) * 1.8, sag = 10 + Math.min(22, Math.abs(dx) * .18);
    const c1x = x0 + dx * .14, c1y = y0 + Math.max(8, dy * .32), c2x = x0 + dx * .68 + wob, c2y = y0 + dy * .86 + sag;
    const u1 = p.cab * p.cab * (3 - 2 * p.cab);
    let d = '';
    for (let i = 0; i <= 14; i++) {
      const u = u1 * i / 14, v = 1 - u, a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, e = u * u * u;
      d += (i ? 'L' : 'M') + (a * x0 + b * c1x + c * c2x + e * x1).toFixed(1) + ' ' + (a * y0 + b * c1y + c * c2y + e * y1).toFixed(1);
    }
    p.cabEl.forEach(e => e.setAttribute('d', d));
    const live = p.cab > .92 && p.aim;
    p.weldEl.style.visibility = live ? 'visible' : 'hidden';
    if (live) p.weldEl.style.transform = 'translate3d(' + x1.toFixed(1) + 'px,' + y1.toFixed(1) + 'px,0)';
  }
  function sceneStart(opts) {
    if (SC.on || !canScene()) return false;
    const k = hero(); if (!k || k.mode !== 'fly') return false;
    opts = opts || {};
    if (opts.x != null) { k.x = opts.x; if (opts.y != null) k.y = opts.y; }
    SC.on = true; SC.k = k; SC.st = 'glitch'; SC.tm = 0; SC.bounces = 0; SC.slowK = 1; SC.ev = SC.ev2 = 0;
    SC.gy = groundY(); SC.PH = clamp(Math.round(H * .105), 78, 100);
    k.mode = 'glitch'; k.el.style.opacity = '.95'; setCls(k, ['sk-glitch', 'sk-sputter', 'sk-fault', 'sk-dmg']);
    setThrust(k, .5);
    return true;
  }
  function sceneEnd() {
    const k = SC.k;
    SC.pr.forEach(p => p.el.remove()); SC.pr = [];
    SC.weld.forEach(w => w.remove()); SC.weld = [];
    if (SC.cab) { SC.cab.remove(); SC.cab = null; }
    if (k) { setCls(k, []); k.mode = 'fly'; k.el.style.opacity = '.7'; setThrust(k, .8); }
    SC.on = false; SC.st = ''; SC.k = null; SC.cool = rnd(150, 290);
  }
  function sceneAbort() { if (SC.on) { const k = SC.k; if (k && k.mode !== 'fly') { k.sp = 10; k.w2 = 0; k.hd = -PI / 2; pickTarget(k); } sceneEnd(); } }
  function landing(k) {                         // ударом о «землю» (верх навигации): искры, обломки, дым, кольцо
    const p = spt(k, 150, 250);
    Burst.sparks(p[0], SC.gy - 2, 9, -PI / 2, 1.1); Burst.debris(p[0], SC.gy - 4, 6); Burst.smoke(p[0], SC.gy - 10, 4, true); Burst.ring(p[0], SC.gy - 2, 'rgba(255,190,110,.9)');
  }
  // движение главного черепа в режимах падения/лежания/подъёма
  function stepHero(k, dt) {
    const gy = SC.gy, floor = gy - k.h * .34;
    if (k.mode === 'fall') {
      k.vy += 1500 * dt; k.x += k.vx * dt; k.y += k.vy * dt; k.rot += k.rv * dt;
      if (k.y >= floor) {
        k.y = floor;
        if (k.vy > 95 && SC.bounces < 3) { SC.bounces++; landing(k); k.vy = -k.vy * .34; k.vx *= .55; k.rv = -k.rv * .45 + rnd(-40, 40); }
        else { k.vy = 0; k.vx = 0; k.rv = 0; landing(k); k.mode = 'lying'; SC.st = 'lying'; SC.tm = 0; SC.startRot = ((k.rot + 540) % 360) - 180; k.rot = SC.startRot; SC.rest = (Math.random() < .5 ? -1 : 1) * rnd(14, 24); SC.restY = floor; }
      }
      paint(k, k.rot, 0, 0);
    } else if (k.mode === 'lying') {
      const e = ease(SC.tm / .55);
      k.rot = SC.startRot + (SC.rest - SC.startRot) * e;
      k.y = SC.restY; paint(k, k.rot, 0, 0);
    } else if (k.mode === 'rise') {
      const p = ease(SC.tm / 1.5), shake = SC.tm < .55 ? (Math.random() - .5) * 2.2 : 0;
      k.rot = SC.rest * (1 - p); k.y = SC.restY - 54 * p * p * (3 - 2 * p) - 8 * Math.sin(SC.tm * 3) * p;
      paint(k, k.rot, shake, shake * .6);
    }
  }
  function sceneStep(dt) {
    const k = SC.k; SC.tm += dt; SC.ev -= dt; SC.ev2 -= dt;
    if (!k) { sceneEnd(); return; }
    if (SC.st === 'glitch') {                   // ~1 с: череп дёргается, двигатели чихают, из трубы валит чёрный дым
      SC.slowK = 1 - .65 * ease(SC.tm / 1);
      if (SC.ev <= 0) { SC.ev = .16; const p = spt(k, 238, 33); Burst.smoke(p[0], p[1], 1, true); }
      if (SC.ev2 <= 0) { SC.ev2 = rnd(.18, .4); const p = spt(k, rnd(60, 250), rnd(60, 230)); Burst.sparks(p[0], p[1], 4); }
      if (SC.tm >= 1) { SC.st = 'fall'; SC.tm = 0; k.mode = 'fall'; k.vx *= .7; k.vy = -25; k.rot = k.tilt; k.rv = (Math.random() < .5 ? -1 : 1) * rnd(70, 170); setCls(k, ['sk-dead', 'sk-dmg', 'sk-fault']); }
    } else if (SC.st === 'fall') {
      if (SC.ev <= 0) { SC.ev = .14; const p = spt(k, 238, 33); Burst.smoke(p[0], p[1], 1, true); }
      if (SC.ev2 <= 0) { SC.ev2 = .12; const p = spt(k, rnd(80, 230), rnd(70, 220)); Burst.sparks(p[0], p[1], 2); }
    } else if (SC.st === 'lying') {             // ~1.5 с: лежит, искрит и дымит
      if (SC.ev <= 0) { SC.ev = .22; const p = spt(k, 238, 33); Burst.smoke(p[0], p[1], 1, true); }
      if (SC.ev2 <= 0) { SC.ev2 = rnd(.22, .5); const p = spt(k, rnd(60, 240), rnd(60, 220)); Burst.sparks(p[0], p[1], 5); }
      if (SC.tm >= 1.5) {
        SC.st = 'in'; SC.tm = 0;
        // старший (шире, на платформе) приходит со стороны, где больше места; жрец в капюшоне — с другой
        const bs = W - k.x >= k.x ? 1 : -1;
        SC.pr = [makePriest('hood', -bs), makePriest('big', bs)].filter(Boolean);
        if (!SC.pr.length) { sceneEnd(); return; }
        SC.pr.forEach(p => {
          p.tx = clamp(k.x + p.side * (k.w * .5 + p.w * .5 + 2), p.w * .5, W - p.w * .5);
          p.sp = clamp(Math.abs(p.tx - p.x) / 3.2, 50, 100);
        });
      }
    } else if (SC.st === 'in') {                // жрецы подходят с двух сторон
      let done = 0;
      SC.pr.forEach(p => {
        if (p.st === 'in') { const d = p.tx - p.x; if (Math.abs(d) <= p.sp * dt) { p.x = p.tx; p.sp = 0; prState(p, 'idle'); } else p.x += Math.sign(d) * p.sp * dt; }
        if (p.st !== 'in') done++;
        paintPriest(p, dt);
      });
      if (done === SC.pr.length) {
        SC.st = 'repair'; SC.tm = 0; SC.ev = 0; SC.ev2 = 0;
        cablesInit(); SC.pr.forEach(p => { prState(p, 'work'); p.aim = true; });
      }
    } else if (SC.st === 'repair') {            // ~3.4 с: кабели к черепу, сварка и искры; на середине гаснут разряды и дым, в конце — перезапуск глаза
      const pe = spt(k, 90, 172), pb = spt(k, 238, 142), leftFirst = pe[0] <= pb[0];
      SC.pr.forEach(p => {
        const tp = (p.side < 0) === leftFirst ? pe : pb;
        p.tgx = tp[0]; p.tgy = tp[1];
        p.ev -= dt;
        if (p.cab > .92 && p.ev <= 0) { p.ev = rnd(.08, .15); Burst.sparks(p.tgx, p.tgy, 5, -PI / 2, 1.3); }
      });
      if (SC.tm > 1.4 && k.el.classList.contains('sk-fault')) setCls(k, ['sk-dead', 'sk-dmg']);
      if (SC.tm > 2.4 && k.el.classList.contains('sk-dmg')) setCls(k, ['sk-dead']);
      SC.pr.forEach(pp => { paintPriest(pp, dt); cableStep(pp, dt); });
      if (SC.tm >= 3.4) {
        SC.st = 'rise'; SC.tm = 0; k.mode = 'rise'; setCls(k, ['sk-boot']); setThrust(k, 1);
        const e = spt(k, 60, 157); Burst.ring(e[0], e[1], 'rgba(255,90,60,.95)'); Burst.sparks(e[0], e[1], 8);
        SC.pr.forEach(pp => { pp.aim = false; prState(pp, 'idle'); });
      }
    } else if (SC.st === 'rise') {              // ~1.5 с: череп поднимается, кабели втягиваются
      SC.pr.forEach(pp => { paintPriest(pp, dt); cableStep(pp, dt); });
      if (SC.tm >= 1.5) {
        k.mode = 'fly'; k.hd = -PI / 2 + (k.x > W / 2 ? -.45 : .45); k.sp = 14; k.w2 = 0; k.tilt = 0; k.mt = (Math.cos(k.hd) * k.nat < 0) ? 1 : 0; pickTarget(k);
        k.el.style.opacity = '.7';
        SC.st = 'leave'; SC.tm = 0;
        SC.pr.forEach(pp => { pp.sp = 62; prState(pp, 'leave'); });
      }
    } else if (SC.st === 'leave') {             // жрецы уходят к своему краю экрана
      let gone = 0;
      SC.pr.forEach(pp => {
        if (Math.abs(pp.yaw - pp.side * 13) < 5) pp.x += pp.side * pp.sp * dt;    // сначала разворачиваются по ходу
        if (pp.x < -pp.w || pp.x > W + pp.w) gone++;
        paintPriest(pp, dt); cableStep(pp, dt);
      });
      if (gone === SC.pr.length || SC.tm > 14) sceneEnd();
    }
  }
  function sceneTick(dt) {
    if (SC.on) { sceneStep(dt); return; }
    if (!canScene()) return;
    SC.cool -= dt;
    if (SC.cool <= 0) { const k = hero(); if (k.mode === 'fly' && k.x > W * .22 && k.x < W * .78) sceneStart(); }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (lite && now - last < 30) return;
    const dt = Math.min(.05, (now - last) / 1000 || .016); last = now; t += dt;
    drawParts(dt);
    for (let i = 0; i < skulls.length; i++) stepSkull(skulls[i], dt);
    sceneTick(dt);
  }
  function start() { if (running || !enabled || paused || document.hidden) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
  function stop() { running = false; cancelAnimationFrame(raf); }
  return {
    init() {
      cv = $('#bgCanvas'); g = cv.getContext('2d');
      document.body.insertAdjacentHTML('afterbegin', SKULL_DEFS);
      window.addEventListener('resize', () => { size(); if (SC.on) sceneAbort(); });
      document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
    },
    configure(level, skullsOn) {
      stop(); sceneAbort();
      enabled = level !== 'off'; lite = level === 'lite';
      reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
      slow = reduced ? .4 : 1;
      scenesOn = !S || S.settings.scenes !== false;
      size(); makeSprite();
      if (!enabled) { skulls.forEach(k => k.el.remove()); skulls = []; parts = []; if (g) g.clearRect(0, 0, W, H); return; }
      spawnParts(lite ? 14 : 34);
      const specs = !skullsOn ? [] : lite ? [{ z: .6, layer: 'back' }, { z: .9, layer: 'back' }, { z: 1, layer: 'front' }]
        : [{ z: .55, layer: 'back' }, { z: .7, layer: 'back' }, { z: .85, layer: 'back' }, { z: 1, layer: 'front' }];
      buildSkulls(specs);
      start();
    },
    setFamily(f) { if (!FLOATERS[f] || f === fam) return; fam = f; if (enabled) buildSkulls(specs0); },
    setScenes(on) { scenesOn = !!on; if (!scenesOn) sceneAbort(); },
    recolor() { makeSprite(); },
    pause() { paused = true; stop(); }, resume() { paused = false; start(); },
    // запуск сценки вручную (проверка и показ); возвращает false, если сценка сейчас невозможна
    malfunction(opts) { return sceneStart(opts); },
    skipCooldown() { SC.cool = 0; },
    info() { return { running, skulls: skulls.length, parts: parts.length, lite, scene: SC.on ? SC.st : '', cool: Math.round(SC.cool), priests: SC.pr.length, canScene: canScene() }; }
  };
})();
