/* ============================================================
   03-fx: звук, вибрация, фон (частицы + сервочерепа), вспышки
   Сервочерепа — чисто декоративные: pointer-events:none, aria-hidden,
   двигаются только transform (GPU), без filter/blur/backdrop.
   ============================================================ */
const Snd = (() => {
  let ctx = null;
  const SEQ = {
    click: [[300, 0, .07, 'square', .02]],
    xp: [[660, 0, .08, 'sine', .04], [880, .07, .14, 'sine', .04]],
    success: [[440, 0, .12, 'triangle', .05], [554, .09, .12, 'triangle', .05], [659, .18, .22, 'triangle', .05]],
    block: [[330, 0, .12, 'triangle', .05], [440, .1, .12, 'triangle', .05], [554, .2, .12, 'triangle', .05], [880, .3, .3, 'sine', .05]],
    level: [[392, 0, .15, 'triangle', .06], [523, .13, .15, 'triangle', .06], [659, .26, .15, 'triangle', .06], [784, .39, .45, 'triangle', .06]],
    unlock: [[196, 0, .4, 'sawtooth', .025], [294, .1, .35, 'triangle', .05], [392, .25, .5, 'triangle', .05], [587, .4, .7, 'sine', .05]],
    error: [[160, 0, .14, 'square', .035], [120, .12, .2, 'square', .035]]
  };
  function unlock() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { ctx = new AC(); if (ctx.state === 'suspended') ctx.resume().catch(() => {}); } catch (e) { ctx = null; }
  }
  function tone(f, t0, d, type, v) {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime + t0;
    o.type = type; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + .015); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + d + .03);
  }
  function play(name) {
    if (!S || !S.settings.sound) return;
    unlock(); if (!ctx) return;
    try { (SEQ[name] || []).forEach(a => tone(a[0], a[1], a[2], a[3], a[4])); } catch (e) { /* звук не критичен */ }
  }
  return { unlock, play };
})();

const Hap = {
  tg() { return window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.HapticFeedback; },
  on() { return !!(S && S.settings.haptics); },
  impact(s) { if (!this.on()) return; try { const h = this.tg(); if (h) h.impactOccurred(s || 'light'); else if (navigator.vibrate) navigator.vibrate(s === 'heavy' ? 30 : s === 'medium' ? 18 : 9); } catch (e) { /* ignore */ } },
  notify(t) { if (!this.on()) return; try { const h = this.tg(); if (h) h.notificationOccurred(t || 'success'); else if (navigator.vibrate) navigator.vibrate(t === 'error' ? [30, 40, 30] : [14, 30, 14]); } catch (e) { /* ignore */ } },
  select() { if (!this.on()) return; try { const h = this.tg(); if (h) h.selectionChanged(); else if (navigator.vibrate) navigator.vibrate(5); } catch (e) { /* ignore */ } }
};

const cssVar = n => getComputedStyle(document.body).getPropertyValue(n).trim();
const hexA = (hex, a) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return 'rgba(255,200,80,' + a + ')'; const n = parseInt(m[1], 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; };

/* ---------- сервочереп (оригинальный рисунок) ---------- */
const SKULL_SVG = '<svg viewBox="0 0 100 120" aria-hidden="true" focusable="false">' +
  '<circle cx="50" cy="54" r="50" fill="url(#sgHalo)"/>' +
  '<path d="M66 20 L75 5" stroke="#6b7280" stroke-width="2" stroke-linecap="round"/><circle class="beacon" cx="75" cy="5" r="2.6" fill="var(--eye)"/>' +
  '<rect x="5" y="50" width="10" height="18" rx="4" fill="#4b5563" stroke="#1f2937"/><rect x="85" y="50" width="10" height="18" rx="4" fill="#4b5563" stroke="#1f2937"/>' +
  '<ellipse cx="10" cy="74" rx="6" ry="9" fill="url(#sgThrust)"/><ellipse cx="90" cy="74" rx="6" ry="9" fill="url(#sgThrust)"/>' +
  '<path d="M50 10C27 10 15 27 15 45c0 12 5 20 12 25v10c0 4 3 6 7 6h32c4 0 7-2 7-6V70c7-5 12-13 12-25C85 27 73 10 50 10Z" fill="url(#sgBone)" stroke="#2f2a1e" stroke-width="1.5"/>' +
  '<path d="M50 10C37 10 27 16 22 26l28-4 28 4C73 16 63 10 50 10Z" fill="url(#sgBrass)" stroke="#5b3a0a"/>' +
  '<circle cx="33" cy="21" r="1.6" fill="#fde68a"/><circle cx="67" cy="21" r="1.6" fill="#fde68a"/><path d="M39 25l3 9-4 5" stroke="#7a6a4f" fill="none"/>' +
  '<ellipse cx="35" cy="51" rx="10" ry="11" fill="#0b0b0d"/><ellipse cx="65" cy="51" rx="10" ry="11" fill="#0b0b0d"/>' +
  '<circle cx="35" cy="51" r="3" fill="var(--eye)" opacity=".28"/>' +
  '<circle cx="65" cy="51" r="8.6" fill="#1f2937" stroke="#b45309" stroke-width="1.7"/><circle class="eye-lens" cx="65" cy="51" r="5.6" fill="var(--eye)"/><circle cx="63" cy="49" r="1.9" fill="#fff" opacity=".85"/>' +
  '<path d="M50 59l-5 11 5-3 5 3Z" fill="#14100a"/>' +
  '<path d="M31 78h38v5H31Z" fill="#d9d0b8" stroke="#2f2a1e"/><path d="M38 78v5M44 78v5M50 78v5M56 78v5M62 78v5" stroke="#2f2a1e"/>' +
  '<g class="jaw"><path d="M30 86h40l-4 13c-2 6-9 9-16 9s-14-3-16-9Z" fill="url(#sgBrass)" stroke="#5b3a0a" stroke-width="1.2"/><path d="M38 86v8M44 86v10M50 86v10M56 86v10M62 86v8" stroke="#5b3a0a"/></g>' +
  '<ellipse cx="50" cy="114" rx="20" ry="5" fill="url(#sgThrust)"/></svg>';
const SKULL_DEFS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
  '<radialGradient id="sgHalo"><stop offset="0" style="stop-color:var(--eye);stop-opacity:.22"/><stop offset="1" style="stop-color:var(--eye);stop-opacity:0"/></radialGradient>' +
  '<radialGradient id="sgThrust"><stop offset="0" stop-color="#7dd3fc" stop-opacity=".9"/><stop offset="1" stop-color="#7dd3fc" stop-opacity="0"/></radialGradient>' +
  '<linearGradient id="sgBone" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e7dfc9"/><stop offset=".6" stop-color="#bfb494"/><stop offset="1" stop-color="#7d7458"/></linearGradient>' +
  '<linearGradient id="sgBrass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5c451"/><stop offset=".55" stop-color="#b8771a"/><stop offset="1" stop-color="#6b430a"/></linearGradient>' +
  '<linearGradient id="fgGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset=".5" stop-color="#f59e0b"/><stop offset="1" stop-color="#92400e"/></linearGradient>' +
  '<linearGradient id="fgGoldIn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbbf24"/><stop offset="1" stop-color="#b45309"/></linearGradient>' +
  // двигатели сервочерепа: задние сопла — оранжевая плазма, нижний — голубая антигравитационная струя
  '<linearGradient id="flO"><stop offset="0" stop-color="#ff8a24" stop-opacity=".95"/><stop offset=".5" stop-color="#ff4d0d" stop-opacity=".55"/><stop offset="1" stop-color="#b0170a" stop-opacity="0"/></linearGradient>' +
  '<linearGradient id="flM"><stop offset="0" stop-color="#ffe066" stop-opacity="1"/><stop offset=".6" stop-color="#ff9a24" stop-opacity=".78"/><stop offset="1" stop-color="#ff6a10" stop-opacity="0"/></linearGradient>' +
  '<linearGradient id="flC"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset=".5" stop-color="#fff2b8" stop-opacity=".9"/><stop offset="1" stop-color="#ffd36b" stop-opacity="0"/></linearGradient>' +
  '<linearGradient id="hbO"><stop offset="0" stop-color="#58c8ff" stop-opacity=".92"/><stop offset=".5" stop-color="#2d7fff" stop-opacity=".5"/><stop offset="1" stop-color="#1646d9" stop-opacity="0"/></linearGradient>' +
  '<linearGradient id="hbM"><stop offset="0" stop-color="#c4f0ff" stop-opacity="1"/><stop offset=".6" stop-color="#6cb8ff" stop-opacity=".75"/><stop offset="1" stop-color="#4a90ff" stop-opacity="0"/></linearGradient>' +
  '<linearGradient id="hbC"><stop offset="0" stop-color="#fff" stop-opacity="1"/><stop offset="1" stop-color="#d9f5ff" stop-opacity="0"/></linearGradient>' +
  '<radialGradient id="bmO"><stop offset="0" stop-color="#ffb04a" stop-opacity=".85"/><stop offset=".45" stop-color="#ff6a1a" stop-opacity=".35"/><stop offset="1" stop-color="#ff4d0d" stop-opacity="0"/></radialGradient>' +
  '<radialGradient id="bmB"><stop offset="0" stop-color="#a8e4ff" stop-opacity=".9"/><stop offset=".45" stop-color="#4fa8ff" stop-opacity=".35"/><stop offset="1" stop-color="#2d7fff" stop-opacity="0"/></radialGradient>' +
  '<radialGradient id="smG"><stop offset="0" stop-color="#9a9aa3" stop-opacity=".9"/><stop offset=".55" stop-color="#62626a" stop-opacity=".55"/><stop offset="1" stop-color="#3a3a40" stop-opacity="0"/></radialGradient>' +
  '<radialGradient id="smD"><stop offset="0" stop-color="#3a393f" stop-opacity=".95"/><stop offset=".55" stop-color="#2c2b31" stop-opacity=".62"/><stop offset="1" stop-color="#1e1d22" stop-opacity="0"/></radialGradient>' +
  '</defs></svg>';

/* ---------- летающие декорации: у каждого семейства тем свои ----------
   wh — сервочерепа (рисунок выше), op — чайки с машущими крыльями, sc — вращающиеся золотые монеты.
   Все они чисто декоративные: pointer-events:none, aria-hidden, анимируются только transform. */
const GULL_SVG = '<svg viewBox="0 0 120 70" aria-hidden="true" focusable="false">' +
  '<path class="wing wl" d="M56 38C46 18 26 10 4 20c20 2 36 10 54 24Z" fill="#f1f5f9" stroke="#64748b" stroke-width="1.5" stroke-linejoin="round"/>' +
  '<path class="wing wr" d="M60 38C66 16 90 8 114 16c-20 4-34 14-50 28Z" fill="#e2e8f0" stroke="#64748b" stroke-width="1.5" stroke-linejoin="round"/>' +
  '<path d="M30 47C40 38 58 34 74 36c6-6 16-5 19 1l7 3-8 3c-4 7-14 11-26 10-14 0-28-2-36-6Z" fill="#f8fafc" stroke="#64748b" stroke-width="1.5" stroke-linejoin="round"/>' +
  '<path d="M93 37l9 3-9 3Z" fill="#f59e0b" stroke="#b45309" stroke-width="1" stroke-linejoin="round"/>' +
  '<path d="M30 47l-12 4 12 2Z" fill="#cbd5e1" stroke="#64748b" stroke-width="1.2" stroke-linejoin="round"/>' +
  '<circle cx="85" cy="36" r="1.7" fill="#0f172a"/></svg>';
const COIN_SVG = '<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><g class="coin-spin">' +
  '<circle cx="50" cy="50" r="46" fill="url(#fgGold)" stroke="#92400e" stroke-width="3"/>' +
  '<circle cx="50" cy="50" r="37" fill="none" stroke="#b45309" stroke-width="2.4" stroke-dasharray="3 4"/>' +
  '<circle cx="50" cy="50" r="30" fill="url(#fgGoldIn)" stroke="#fde68a" stroke-width="1.5"/>' +
  '<path d="M50 28l5.5 15.5L72 44 59 54l4.5 16.5L50 61 36.5 70.5 41 54 28 44l16.5-.5Z" fill="#fde68a" stroke="#92400e" stroke-width="1.6" stroke-linejoin="round"/>' +
  '<ellipse cx="33" cy="30" rx="11" ry="5" transform="rotate(-35 33 30)" fill="#fff" opacity=".32"/></g></svg>';
// Сервочереп: рисунок присылал владелец (assets/floaters/wh_skull.webp, вшивается сборкой; нарисованный дым с картинки убран tools/clean_skull.py).
// Череп на картинке смотрит влево (facesLeft), поэтому при полёте вправо зеркалится. Поверх рисунка — живые двигатели (SVG + CSS-анимация):
// 2 задних сопла (оранжевая плазма), нижний антигравитационный ствол (голубая струя, кольца поля), дым трубы, провисающие кабели.
// Координаты — в системе картинки 300x335. Сопла: правый блок (270,137), нижнее (266,219), ствол (203,252), труба (238,33).
const f1 = n => (Math.round(n * 10) / 10);
const flameShape = (cls, len, w, grad) => '<path class="' + cls + '" fill="url(#' + grad + ')" d="M0 ' + f1(-w) + 'C' + f1(len * .3) + ' ' + f1(-w * 1.3) + ' ' + f1(len * .66) + ' ' + f1(-w * .7) + ' ' + f1(len) + ' 0C' +
  f1(len * .66) + ' ' + f1(w * .7) + ' ' + f1(len * .3) + ' ' + f1(w * 1.3) + ' 0 ' + f1(w) + 'Z"/>';
// струя вдоль +x с корнем в (0,0): внешний факел, средний, ядро + «ударные алмазы»
const jetSvg = (x, y, ang, len, w, blue, jp, jd, cls) => '<g transform="translate(' + x + ' ' + y + ') rotate(' + ang + ')"><g class="jet ' + (cls || '') + '" style="--jp:' + jp + 's;--jd:' + jd + 's">' +
  flameShape('fo', len, w, blue ? 'hbO' : 'flO') + flameShape('fm', len * .74, w * .62, blue ? 'hbM' : 'flM') + flameShape('fc', len * .48, w * .3, blue ? 'hbC' : 'flC') +
  '<ellipse class="dia" cx="' + f1(len * .3) + '" cy="0" rx="' + f1(w * .5) + '" ry="' + f1(w * .22) + '" fill="#fff"/><ellipse class="dia d2" cx="' + f1(len * .52) + '" cy="0" rx="' + f1(w * .38) + '" ry="' + f1(w * .16) + '" fill="#fff"/></g></g>';
const SK_FX_BACK = '<svg class="sk-fx sk-fxb" viewBox="0 0 300 335" aria-hidden="true" focusable="false">' +
  jetSvg(266, 137, 0, 96, 10, false, .21, 0, 'jr1') + jetSvg(263, 216, 44, 78, 9, false, .17, -.07, 'jr2') + jetSvg(203, 249, 90, 84, 15, true, .26, -.11, 'jh') + '</svg>';
const arc = (d, dl) => '<path class="arc" style="animation-delay:' + dl + 's" d="' + d + '"/>';
const SK_FX_FRONT = '<svg class="sk-fx sk-fxf" viewBox="0 0 300 335" aria-hidden="true" focusable="false">' +
  '<circle class="bloom" cx="271" cy="137" r="17" fill="url(#bmO)"/><circle class="bloom b2" cx="266" cy="217" r="15" fill="url(#bmO)"/><ellipse class="bloom b3" cx="203" cy="252" rx="22" ry="12" fill="url(#bmB)"/>' +
  '<ellipse class="ring" cx="203" cy="266" rx="26" ry="6" fill="none" stroke="#9fdcff" stroke-width="2"/><ellipse class="ring r2" cx="203" cy="266" rx="26" ry="6" fill="none" stroke="#9fdcff" stroke-width="2"/>' +
  '<circle class="sm s1" cx="238" cy="33" r="10" fill="url(#smG)"/><circle class="sm s2" cx="238" cy="33" r="10" fill="url(#smG)"/><circle class="sm s3" cx="238" cy="33" r="10" fill="url(#smG)"/><circle class="sm s4" cx="238" cy="33" r="10" fill="url(#smG)"/>' +
  '<circle class="sm dk d1" cx="238" cy="33" r="13" fill="url(#smD)"/><circle class="sm dk d2" cx="238" cy="33" r="13" fill="url(#smD)"/><circle class="sm dk d3" cx="150" cy="76" r="12" fill="url(#smD)"/><circle class="sm dk d4" cx="262" cy="124" r="11" fill="url(#smD)"/>' +
  '<circle class="spk" style="--sx:46px;--sy:-10px;animation-delay:0s" cx="270" cy="137" r="1.9" fill="#ffd27a"/><circle class="spk" style="--sx:40px;--sy:12px;animation-delay:-.23s" cx="270" cy="137" r="1.6" fill="#fff0b0"/>' +
  '<circle class="spk" style="--sx:34px;--sy:28px;animation-delay:-.4s" cx="266" cy="217" r="1.8" fill="#ffd27a"/><circle class="spk" style="--sx:6px;--sy:44px;animation-delay:-.15s" cx="203" cy="256" r="1.6" fill="#bfeaff"/>' +
  arc('M52 150l9-8-4 10 11-5', 0) + arc('M148 62l-7 9 9-2-5 10', -.17) + arc('M224 148l8-7-3 9 9-3', -.31) + arc('M120 214l-8 6 9 1-6 8', -.09) + '</svg>';
const SKULL_IMG_HTML = SK_FX_BACK + '<div class="sk-body"><div class="sk-img sk-hi wh_skull"></div><div class="sk-img sk-lo wh_skull"></div><i class="sk-eye"></i></div>' + SK_FX_FRONT;
const FLOATERS = {
  wh: (typeof BUILTIN_FLOATERS === 'object' && BUILTIN_FLOATERS.wh_skull)
    ? { svg: SKULL_IMG_HTML, w: 52, h: 58, speed: 1, minf: .5, turn: 1.0, bob: 1, glide: false, facesLeft: true, flip: true }
    : { svg: SKULL_SVG, w: 56, h: 67, speed: 1, minf: .5, turn: 1.0, bob: 1, glide: false, flip: true },
  op: { svg: GULL_SVG, w: 100, h: 58, speed: 2, minf: .85, turn: .9, bob: 1.3, glide: true, flip: true },
  sc: { svg: COIN_SVG, w: 54, h: 54, speed: .85, minf: .4, turn: 1.4, bob: 1.8, glide: false, flip: false }
};

/* ---------- вспышки переднего плана (по требованию) ---------- */
const Burst = (() => {
  let cv, g, W, H, dpr = 1, ps = [], raf = 0, run = false, last = 0, mult = 1;
  function size() { dpr = Math.min(window.devicePixelRatio || 1, mult < 1 ? 1.25 : 2); W = innerWidth; H = innerHeight; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); g.setTransform(dpr, 0, 0, dpr, 0, 0); }
  const cols = () => { const a = cssVar('--accent-2') || '#f59e0b', b = cssVar('--accent') || '#b45309'; return [a, '#ffffff', b, a]; };
  function add(p) { if (ps.length < 260) ps.push(p); }
  function loop(now) {
    if (!ps.length) { run = false; g.clearRect(0, 0, W, H); return; }
    raf = requestAnimationFrame(loop);
    const dt = Math.min(.05, (now - last) / 1000 || .016); last = now;
    g.clearRect(0, 0, W, H);
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i]; p.life -= dt;
      if (p.life <= 0) { ps.splice(i, 1); continue; }
      p.vy += p.g * dt; p.vx *= (1 - p.drag * dt); p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      const a = clamp(p.life / p.max * 1.6, 0, 1) * (p.alpha == null ? 1 : p.alpha);
      if (p.grow) p.size += p.grow * dt;
      g.globalAlpha = a; g.fillStyle = p.c; g.strokeStyle = p.c;
      if (p.shape === 'ring') { p.size += (p.rg || 160) * dt; g.lineWidth = 3; g.beginPath(); g.arc(p.x, p.y, p.size, 0, 6.283); g.stroke(); }
      else if (p.shape === 'rect') { g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.fillRect(-p.size, -p.size * .5, p.size * 2, p.size); g.restore(); }
      else { g.beginPath(); g.arc(p.x, p.y, p.size, 0, 6.283); g.fill(); }
    }
    g.globalAlpha = 1;
  }
  function kick() { if (!run) { run = true; last = performance.now(); raf = requestAnimationFrame(loop); } }
  function radial(x, y, n, sp0, sp1, grav, life, size) {
    const c = cols();
    for (let i = 0; i < Math.round(n * mult); i++) {
      const a = rnd(0, 6.283), v = rnd(sp0, sp1);
      add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - sp0 * .3, g: grav, drag: 1.4, life: rnd(life * .6, life), max: life, size: rnd(1.4, size), c: c[i % c.length], shape: 'dot', rot: 0, vr: 0 });
    }
  }
  return {
    init() { cv = $('#fxCanvas'); g = cv.getContext('2d'); size(); window.addEventListener('resize', size); },
    setLevel(l) { mult = l === 'off' ? 0 : l === 'lite' ? .5 : 1; size(); },
    cell(x, y) { if (!mult) return; radial(x, y, 24, 70, 230, 420, .9, 3.2); kick(); },
    block(x, y) { if (!mult) return; radial(x, y, 56, 90, 320, 380, 1.3, 3.6); add({ x, y, vx: 0, vy: 0, g: 0, drag: 0, life: .7, max: .7, size: 10, c: cols()[0], shape: 'ring', rot: 0, vr: 0 }); kick(); },
    relic(x, y) { if (!mult) return; radial(x, y, 80, 40, 260, 120, 1.8, 4.2); add({ x, y, vx: 0, vy: 0, g: 0, drag: 0, life: 1, max: 1, size: 20, c: cols()[1], shape: 'ring', rot: 0, vr: 0 }); kick(); },
    level() { if (!mult) return; const c = cols(); for (let i = 0; i < Math.round(90 * mult); i++) add({ x: rnd(0, W), y: rnd(-40, -4), vx: rnd(-30, 30), vy: rnd(80, 240), g: 60, drag: .2, life: rnd(1.4, 2.6), max: 2.6, size: rnd(1.6, 4), c: c[i % c.length], shape: 'dot', rot: 0, vr: 0 }); kick(); },
    confetti() { if (!mult) return; const pal = ['#f59e0b', '#ef4444', '#3b82f6', '#22c55e', '#e879f9', '#fde047']; for (let i = 0; i < Math.round(120 * mult); i++) { const left = i % 2 === 0; add({ x: left ? 0 : W, y: H * .75, vx: (left ? 1 : -1) * rnd(120, 420), vy: rnd(-620, -240), g: 520, drag: .6, life: rnd(1.6, 2.8), max: 2.8, size: rnd(3, 5.5), c: pal[i % pal.length], shape: 'rect', rot: rnd(0, 6), vr: rnd(-9, 9) }); } kick(); },
    // --- сценка поломки сервочерепа: искры, дым, обломки, кольцо ---
    sparks(x, y, n, dir, spread) { if (!mult) return; const col = ['#ffd27a', '#fff3c2', '#ff9a24', '#ffffff']; for (let i = 0; i < Math.round(n * mult); i++) { const a = (dir == null ? rnd(0, 6.283) : dir + rnd(-1, 1) * (spread == null ? .9 : spread)), v = rnd(90, 330); add({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, g: 760, drag: .9, life: rnd(.35, .85), max: .85, size: rnd(.8, 1.9), c: col[i % col.length], shape: 'dot', rot: 0, vr: 0 }); } kick(); },
    smoke(x, y, n, dark) { if (!mult) return; for (let i = 0; i < Math.round(n * mult); i++) add({ x: x + rnd(-4, 4), y, vx: rnd(-14, 22), vy: rnd(-46, -22), g: -6, drag: .5, life: rnd(1.1, 1.9), max: 1.9, size: rnd(3, 5), grow: rnd(7, 12), alpha: dark ? .62 : .34, c: dark ? '#3c3b42' : '#6a6a72', shape: 'dot', rot: 0, vr: 0 }); kick(); },
    debris(x, y, n) { if (!mult) return; for (let i = 0; i < Math.round(n * mult); i++) add({ x, y, vx: rnd(-140, 140), vy: rnd(-230, -60), g: 900, drag: .3, life: rnd(.7, 1.3), max: 1.3, size: rnd(1, 2.1), c: i % 3 ? '#6b7280' : '#a8a29e', shape: 'rect', rot: rnd(0, 6), vr: rnd(-12, 12) }); kick(); },
    ring(x, y, col) { if (!mult) return; add({ x, y, vx: 0, vy: 0, g: 0, drag: 0, life: .5, max: .5, size: 4, rg: 62, c: col || cols()[1], shape: 'ring', rot: 0, vr: 0 }); kick(); },
    clear() { ps = []; }
  };
})();

function floatText(x, y, text) {
  const el = document.createElement('div');
  el.className = 'xpfloat'; el.textContent = text;
  el.style.left = clamp(x, 40, innerWidth - 40) + 'px'; el.style.top = clamp(y, 60, innerHeight - 40) + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

const FX = {
  level() {
    const f = S.settings.fx;
    if (f === 'off' || f === 'full' || f === 'lite') return f;
    const rm = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const weak = (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
    return (rm || weak) ? 'lite' : 'full';
  },
  init() { Scene.init(); Burst.init(); },
  apply() {
    const lv = this.level();
    document.body.classList.toggle('fx-off', lv === 'off');
    document.body.classList.toggle('fx-lite', lv === 'lite');
    Scene.configure(lv, !!S.settings.skulls); Burst.setLevel(lv);
  }
};
