/* ============================================================
   06c-3d: настоящий 3D-просмотр фигурок на Three.js r187 (MIT, github.com/mrdoob/three.js).
   Бандл (build/three.bundle.js) лежит в странице как <script type="text/plain" id="m3d-src"> и исполняется только при
   первом открытии фигурки: до этого он не стоит ни времени запуска, ни памяти.
   Четыре вида моделей — приложение всегда подписывает, какой именно перед вами:
     volume — «объём из картинки»: карта глубины (Depth Anything V2, tools/atelier/depth.py) + силуэт -> замкнутая сетка
              с освещением. Это НЕ скан: форма сзади достроена по силуэту, цвет сзади — размытый цвет спереди;
     views  — «объём по трём видам» (06c2-hull.js): форма по силуэтам трёх картинок (спереди, сбоку, сзади), цвет проецируется
              с картинок: assets/views/<id>/{front,side,back}.webp. Мелкая лепка не восстанавливается, но это настоящая 3D-форма;
     proc   — оригинальная модель, собранная кодом (06d-3dprocs.js): монеты, штурвал, кристалл;
     glb    — готовая 3D-модель (TRELLIS / Hunyuan3D / Blender): assets/models/<id>.glb или файл, открытый кнопкой «GLB».
   Нет WebGL, эффекты выключены или потерян контекст — окно просмотра остаётся на лёгком CSS-стенде (06b-figures.js).
   ============================================================ */
const Fig3D = (() => {
  const DEPTHS = typeof FIGURE_DEPTH !== 'undefined' ? FIGURE_DEPTH : {};
  const GLBS = typeof FIGURE_GLB !== 'undefined' ? FIGURE_GLB : {};
  const VIEWS = typeof FIGURE_VIEWS !== 'undefined' ? FIGURE_VIEWS : {};
  const TK = 0.13;            // толщина стороны как доля высоты: то же число, что K в tools/atelier/depth.py
  const THICK = 1.5;          // во сколько раз «надуть» карту глубины: при TK само по себе бока выходят плёнкой (см. tests/three.cjs)
  const D2R = Math.PI / 180;
  let lib, glOk;
  const LABEL = { volume: 'Объём из картинки', views: 'Объём по трём видам', proc: 'Оригинальная 3D-модель', glb: '3D-модель GLB' };
  const NOTE = { volume: 'Не скан: спина достроена, поворот лучше в пределах 60°.', views: 'Форма по силуэтам трёх картинок; мелкая лепка не восстановлена.', proc: 'Модель собрана кодом, без картинок.', glb: 'Готовая 3D-модель.' };

  /* ---------- загрузка библиотеки и проверка WebGL ---------- */
  function loadLib() {
    if (lib !== undefined) return lib;
    lib = null;
    try {
      if (!window.M3D) {
        const el = document.getElementById('m3d-src');
        if (!el || !el.textContent) return lib;
        const s = document.createElement('script'); s.text = el.textContent;
        document.head.appendChild(s); s.remove();
      }
      lib = window.M3D || null;
    } catch (e) { console.warn('3D: Three.js не запустился', e); lib = null; }
    return lib;
  }
  function glSupported() {
    if (glOk !== undefined) return glOk;
    try {
      const c = document.createElement('canvas'), g = c.getContext('webgl2');       // Three.js r163+ работает только на WebGL2 (iOS 15+); на WebGL1 остаётся лёгкий CSS-стенд
      glOk = !!g;
      if (g) { const x = g.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); }
    } catch (e) { glOk = false; }
    return glOk;
  }
  const supported = () => !!document.getElementById('m3d-src') && glSupported();
  const modeOf = f => !f ? null : (GLBS[f.id] ? 'glb' : /^proc:/.test(f.model || '') ? 'proc' : VIEWS[f.id] && typeof Hull3D !== 'undefined' ? 'views' : DEPTHS[f.id] ? 'volume' : null);
  const canOpen = f => !!modeOf(f) && supported();

  /* ---------- вспомогательное ---------- */
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const ctex = (m, c) => { const t = new m.CanvasTexture(c); t.colorSpace = m.SRGBColorSpace; return t; };
  const loadImg = url => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('img')); im.src = url; });
  const b64buf = uri => { const s = atob(uri.slice(uri.indexOf(',') + 1)), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
  function spriteUrl(f) {
    if (f.custom && f.url) return f.url;
    const p = document.createElement('i'); p.className = 'fgd ' + f.id; p.style.cssText = 'position:absolute;width:0;height:0;visibility:hidden';
    document.body.appendChild(p);
    const v = getComputedStyle(p).getPropertyValue('--fg'); p.remove();
    const m = /url\(\s*["']?([^"')]+)["']?\s*\)/.exec(v);
    return m ? m[1] : (f.url || '');
  }
  /** билинейная выборка канала o (0..3) из RGBA-массива; x,y — в пикселях (центр пикселя = целое) */
  function bil(d, W, H, x, y, o) {
    x = x < 0 ? 0 : x > W - 1 ? W - 1 : x; y = y < 0 ? 0 : y > H - 1 ? H - 1 : y;
    const x0 = x | 0, y0 = y | 0, x1 = x0 + 1 < W ? x0 + 1 : x0, y1 = y0 + 1 < H ? y0 + 1 : y0, fx = x - x0, fy = y - y0;
    return ((d[(y0 * W + x0) * 4 + o] * (1 - fx) + d[(y0 * W + x1) * 4 + o] * fx) * (1 - fy) + (d[(y1 * W + x0) * 4 + o] * (1 - fx) + d[(y1 * W + x1) * 4 + o] * fx) * fy);
  }
  /** растекание цвета: пиксели с альфой >= 50% остаются как есть, соседние снаружи по кругу заполняются средним цветом соседей */
  function bleedColors(sd, W, H, passes) {
    const n = W * H, out = new Uint8ClampedArray(n * 4);
    let cur = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const o = i * 4; if (sd[o + 3] >= 128) { cur[i] = 1; out[o] = sd[o]; out[o + 1] = sd[o + 1]; out[o + 2] = sd[o + 2]; } else { out[o] = out[o + 1] = out[o + 2] = 27; } out[o + 3] = 255; }
    for (let p = 0; p < passes; p++) {
      const nxt = cur.slice();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x; if (cur[i]) continue;
        let r = 0, g = 0, b = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; const j = yy * W + xx; if (cur[j]) { const o = j * 4; r += out[o]; g += out[o + 1]; b += out[o + 2]; c++; } } }
        if (c) { const o = i * 4; out[o] = r / c; out[o + 1] = g / c; out[o + 2] = b / c; nxt[i] = 1; }
      }
      cur = nxt;
    }
    return out;
  }
  /** быстрое размытие «коробкой» (два прохода со скользящей суммой) */
  function boxBlur(src, W, H, r) {
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H), n = 2 * r + 1, cl = (v, hi) => v < 0 ? 0 : v > hi ? hi : v;
    for (let y = 0; y < H; y++) {
      const row = y * W; let s = 0;
      for (let x = -r; x <= r; x++) s += src[row + cl(x, W - 1)];
      for (let x = 0; x < W; x++) { tmp[row + x] = s / n; s += src[row + cl(x + r + 1, W - 1)] - src[row + cl(x - r, W - 1)]; }
    }
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += tmp[cl(y, H - 1) * W + x];
      for (let y = 0; y < H; y++) { out[y * W + x] = s / n; s += tmp[cl(y + r + 1, H - 1) * W + x] - tmp[cl(y - r, H - 1) * W + x]; }
    }
    return out;
  }
  function disposeObj(o) {
    o.traverse(n => {
      if (n.geometry) n.geometry.dispose();
      const ms = n.material ? (Array.isArray(n.material) ? n.material : [n.material]) : [];
      ms.forEach(mt => { for (const k in mt) { const v = mt[k]; if (v && v.isTexture) v.dispose(); } mt.dispose(); });
    });
  }
  /** «живая» вершинная деформация (дыхание, покачивание) и каёмка по краю (fresnel) поверх стандартного материала.
      X (необязательно): { key, u — uniform'ы, vd/vm — код вершинного шейдера (объявления / после begin_vertex), fd/fm — фрагментного
      (объявления / после color_fragment), noAlpha — без среза по альфа-карте } — так «объём по трём видам» добавляет проекцию цвета. */
  function aliveMat(mat, U, X) {
    X = X || {};
    mat.onBeforeCompile = sh => {
      sh.uniforms.uT = U.t; sh.uniforms.uA = U.a; sh.uniforms.uRim = U.rim;
      if (X.u) for (const k in X.u) sh.uniforms[k] = X.u[k];
      sh.vertexShader = 'uniform float uT;\nuniform float uA;\nvarying float vNzV;\n' + (X.vd || '') + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n' +
        'vNzV = normal.z;\n' + (X.vm || '') +
        'float hy = clamp(position.y + .5, 0., 1.);\n' +
        'transformed.x += sin(uT * 1.15 + hy * 1.4) * uA * .016 * hy * hy;\n' +
        'transformed.z += cos(uT * .85) * uA * .010 * hy;\n' +
        'transformed.y *= 1. + sin(uT * 1.9) * uA * .005;');
      // каёмка: только у самого края и вполсилы, иначе боковой вид светится целиком
      let fs = sh.fragmentShader.replace('#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n' +
        'float frs = pow(1. - clamp(dot(normalize(normal), normalize(vViewPosition)), 0., 1.), 3.2);\n' +
        'totalEmissiveRadiance += uRim * frs * .55;');
      if (X.fm) fs = fs.replace('#include <color_fragment>', '#include <color_fragment>\n' + X.fm);
      // край по альфа-карте строгий только на лицевой и обратной стороне (нормаль модели смотрит по Z); на кромке порог низкий,
      // иначе срез по альфе вырезает её и между лицом и спиной виден зубчатый шов
      if (!X.noAlpha) fs = fs.replace('#include <alphatest_fragment>',
        '#ifdef USE_ALPHATEST\n' +
        'float kz = smoothstep(.3, .75, abs(vNzV)), thr = mix(.004, .5, kz);\n' +
        'diffuseColor.a = smoothstep(thr, thr + mix(.0005, fwidth(diffuseColor.a) + .0005, kz), diffuseColor.a);\n' +
        'if (diffuseColor.a <= 0.) discard;\n' +
        '#endif');
      sh.fragmentShader = 'uniform vec3 uRim;\nvarying float vNzV;\n' + (X.fd || '') + fs;
    };
    mat.customProgramCacheKey = () => X.key || 'fig3d-alive';
  }
  /** цвет спины «достроенной» фигурки: сильно размытый цвет спереди (dark — ещё чуть темнее и бледнее) — без зеркального лица на затылке */
  function backColors(src, W, H, dark) {
    const n = W * H, ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], r = Math.max(3, Math.round(H * .03));
    for (let i = 0; i < n; i++) { ch[0][i] = src[i * 4]; ch[1][i] = src[i * 4 + 1]; ch[2][i] = src[i * 4 + 2]; }
    const bl = ch.map(c => boxBlur(boxBlur(c, W, H, r), W, H, r)), out = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i++) {
      const R = bl[0][i], G = bl[1][i], B = bl[2][i], l = .3 * R + .59 * G + .11 * B, k = dark ? .8 : 1, d = dark ? .3 : 0;
      out[i * 4] = (R + (l - R) * d) * k; out[i * 4 + 1] = (G + (l - G) * d) * k; out[i * 4 + 2] = (B + (l - B) * d) * k; out[i * 4 + 3] = 255;
    }
    return out;
  }

  /* ---------- модель «объём из картинки» ---------- */
  function volumeModel(m, sprite, depth, lvl, f, o) {
    const W = sprite.naturalWidth, H = sprite.naturalHeight, asp = W / H;
    const sc = cv(W, H), sx = sc.getContext('2d', { willReadFrequently: true });
    sx.drawImage(sprite, 0, 0);
    const sd = sx.getImageData(0, 0, W, H).data;                     // RGBA спрайта: нужна альфа
    const dcv = cv(W, H), dx = dcv.getContext('2d', { willReadFrequently: true });
    dx.drawImage(depth, 0, 0, W, H);
    const dd = dx.getImageData(0, 0, W, H).data;                     // R — перед, G — зад (доли K·высоты)

    /* цветовая карта с «растеканием» цвета за край силуэта: кромка и бок получают цвет соседних пикселей, а не тёмный фон */
    const cc = cv(W, H), cx = cc.getContext('2d'), bld = bleedColors(sd, W, H, lvl === 'full' ? 12 : 9);
    cx.putImageData(new ImageData(bld, W, H), 0, 0);
    const bcv = cv(W, H); bcv.getContext('2d').putImageData(new ImageData(backColors(bld, W, H, false), W, H), 0, 0);   // спина и кромка: размытый цвет спереди

    /* карта нормалей из высокочастотной части глубины: мелкий рельеф на полном разрешении, поверх сетки */
    const R = new Float32Array(W * H); for (let i = 0; i < W * H; i++) R[i] = dd[i * 4] / 255;
    const lo = boxBlur(R, W, H, 7);
    const nc = cv(W, H), nx = nc.getContext('2d'), nm = nx.createImageData(W, H), nd = nm.data, S = lvl === 'full' ? 38 : 26;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const x0 = x > 0 ? x - 1 : 0, x1 = x < W - 1 ? x + 1 : x, y0 = y > 0 ? y - 1 : 0, y1 = y < H - 1 ? y + 1 : y;
      const gx = ((R[y * W + x1] - lo[y * W + x1]) - (R[y * W + x0] - lo[y * W + x0])) * .5 * S;
      const gy = ((R[y1 * W + x] - lo[y1 * W + x]) - (R[y0 * W + x] - lo[y0 * W + x])) * .5 * S;
      const l = Math.hypot(gx, gy, 1), i = (y * W + x) * 4;
      nd[i] = (-gx / l * .5 + .5) * 255; nd[i + 1] = (gy / l * .5 + .5) * 255; nd[i + 2] = (1 / l * .5 + .5) * 255; nd[i + 3] = 255;
    }
    nx.putImageData(nm, 0, 0);

    /* сетка: узлы регулярные, а узлы вне силуэта «подтягиваются» к контуру (по линии сетки до пересечения альфы 0.5),
       поэтому лицо и спина сходятся ровно по контуру — замкнутое тело без стенок и без ступенчатых краёв */
    const tk = TK * ((o && o.thick) || THICK) * clamp(Math.pow(Math.max(1, asp / .55), .8), 1, 2.3);   // широкие силуэты (шагоход, трон) толще: глубина растёт вместе с шириной
    const LV = .12, cs = H / (lvl === 'full' ? 170 : 110);   // LV: узлы встают на контур чуть снаружи края; точный край вырезает альфа-карта
    const NX = Math.max(8, Math.ceil(W / cs)), NY = Math.max(8, Math.ceil(H / cs)), nW = NX + 1, N = nW * (NY + 1);
    const PX = new Float32Array(N), PY = new Float32Array(N), A = new Float32Array(N), IN = new Uint8Array(N);
    for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
      const k = j * nW + i, x = i * W / NX, y = j * H / NY;
      PX[k] = x; PY[k] = y; A[k] = bil(sd, W, H, x - .5, y - .5, 3) / 255; IN[k] = A[k] >= .5 ? 1 : 0;
    }
    const cm = new Uint8Array(NX * NY);                              // ячейки с видимыми пикселями (тонкие детали не должны пропасть)
    for (let y = 0; y < H; y++) { const cj = Math.min(NY - 1, (y * NY / H) | 0), row = y * W; for (let x = 0; x < W; x++) if (sd[(row + x) * 4 + 3] > 140) cm[cj * NX + Math.min(NX - 1, (x * NX / W) | 0)] = 1; }
    const cells = [];
    for (let cj = 0; cj < NY; cj++) for (let ci = 0; ci < NX; ci++) {
      const k0 = cj * nW + ci, ks = [k0, k0 + 1, k0 + nW, k0 + nW + 1];
      let any = IN[ks[0]] | IN[ks[1]] | IN[ks[2]] | IN[ks[3]];
      if (!any && cm[cj * NX + ci]) { let b = ks[0]; for (const q of ks) if (A[q] > A[b]) b = q; IN[b] = 1; any = 1; }
      if (any) cells.push(ci, cj);
    }
    const used = new Uint8Array(N);
    for (let q = 0; q < cells.length; q += 2) { const k0 = cells[q + 1] * nW + cells[q]; used[k0] = used[k0 + 1] = used[k0 + nW] = used[k0 + nW + 1] = 1; }
    const SN = new Uint8Array(N), D4 = [1, 0, -1, 0, 0, 1, 0, -1], DG = [1, 1, 1, -1, -1, 1, -1, -1];
    for (let k = 0; k < N; k++) if (used[k] && !IN[k]) {
      const i = k % nW, j = (k / nW) | 0; let best = -1;
      for (const L of [D4, DG]) {
        for (let q = 0; q < 8; q += 2) { const ii = i + L[q], jj = j + L[q + 1]; if (ii < 0 || jj < 0 || ii > NX || jj > NY) continue; const kk = jj * nW + ii; if (IN[kk] && (best < 0 || A[kk] > A[best])) best = kk; }
        if (best >= 0) break;
      }
      SN[k] = 1;
      if (best >= 0) { const t = clamp((A[best] - LV) / (A[best] - A[k] + 1e-4), .12, 1); PX[k] = PX[best] + (PX[k] - PX[best]) * t; PY[k] = PY[best] + (PY[k] - PY[best]) * t; }
    }
    const map = new Int32Array(N).fill(-1); let M = 0; for (let k = 0; k < N; k++) if (used[k]) map[k] = M++;
    const pos = new Float32Array(M * 3), posB = new Float32Array(M * 3), uv = new Float32Array(M * 2), s = 1 / H;
    for (let k = 0; k < N; k++) if (used[k]) {
      const q = map[k], x = PX[k], y = PY[k]; let zf = 0, zb = 0;
      if (!SN[k]) { zf = bil(dd, W, H, x - .5, y - .5, 0) / 255 * tk; zb = bil(dd, W, H, x - .5, y - .5, 1) / 255 * tk; }
      pos[q * 3] = posB[q * 3] = (x - W / 2) * s; pos[q * 3 + 1] = posB[q * 3 + 1] = (H / 2 - y) * s; pos[q * 3 + 2] = zf; posB[q * 3 + 2] = -zb;
      uv[q * 2] = x / W; uv[q * 2 + 1] = 1 - y / H;
    }
    const iF = [], iB = [];
    for (let q = 0; q < cells.length; q += 2) {
      const k0 = cells[q + 1] * nW + cells[q], a = map[k0], b = map[k0 + 1], c = map[k0 + nW], d = map[k0 + nW + 1];
      iF.push(a, c, b, b, c, d); iB.push(a, b, c, b, d, c);
    }
    const mkGeo = (p, idx) => { const g = new m.BufferGeometry(); g.setAttribute('position', new m.BufferAttribute(p, 3)); g.setAttribute('uv', new m.BufferAttribute(uv, 2)); g.setIndex(new m.BufferAttribute(new Uint32Array(idx), 1)); g.computeVertexNormals(); return g; };
    const gF = mkGeo(pos, iF), gB = mkGeo(posB, iB), nF = gF.attributes.normal, nB = gB.attributes.normal;
    for (let k = 0; k < N; k++) if (used[k] && SN[k]) {                // на кромке нормали наружу: лицо и спина переходят плавно
      const i = k % nW, j = (k / nW) | 0; if (i < 1 || j < 1 || i >= NX || j >= NY) continue;
      let ox = -(A[k + 1] - A[k - 1]), oy = A[k + nW] - A[k - nW]; const l = Math.hypot(ox, oy); if (l < 1e-4) continue;
      nF.setXYZ(map[k], ox / l, oy / l, 0); nB.setXYZ(map[k], ox / l, oy / l, 0);
    }

    const U = { t: { value: 0 }, a: { value: 1 }, rim: { value: new m.Color(f.glow || '#f59e0b').multiplyScalar(.5) } };
    const tex = new m.CanvasTexture(cc); tex.colorSpace = m.SRGBColorSpace; tex.anisotropy = 4;
    const btex = new m.CanvasTexture(bcv); btex.colorSpace = m.SRGBColorSpace;
    const ntex = new m.CanvasTexture(nc);
    const ac = cv(W, H), ax = ac.getContext('2d'), am = ax.createImageData(W, H), ad = am.data;   // альфа-карта (канал G) — гладкий край без ступенек сетки
    for (let i = 0; i < W * H; i++) { const a = sd[i * 4 + 3]; ad[i * 4] = ad[i * 4 + 1] = ad[i * 4 + 2] = a; ad[i * 4 + 3] = 255; }
    ax.putImageData(am, 0, 0);
    const atex = new m.CanvasTexture(ac);
    const mF = new m.MeshStandardMaterial({ map: tex, alphaMap: atex, alphaTest: .5, alphaToCoverage: true, normalMap: ntex, normalScale: new m.Vector2(1, 1), roughness: .6, metalness: .12 });
    const mB = new m.MeshStandardMaterial({ map: btex, alphaMap: atex, alphaTest: .5, alphaToCoverage: true, roughness: .85, metalness: .05 });
    // к кромке (нормаль уходит вбок) резкая текстура растягивается полосами — там цвет плавно меняется на размытый; спина к середине темнеет и бледнеет
    aliveMat(mF, U, { key: 'fig3d-vol-f', u: { uBl: { value: btex } }, fd: 'uniform sampler2D uBl;\n',
      fm: 'diffuseColor.rgb = mix(texture2D(uBl, vMapUv).rgb * diffuse, diffuseColor.rgb, smoothstep(.30, .72, abs(vNzV)));\n' });
    aliveMat(mB, U, { key: 'fig3d-vol-b',
      fm: 'float kb = smoothstep(.30, .72, abs(vNzV)), lb = dot(diffuseColor.rgb, vec3(.3, .59, .11));\n' +
        'diffuseColor.rgb = mix(vec3(lb), diffuseColor.rgb, mix(1., .72, kb)) * mix(1., .8, kb);\n' });
    const group = new m.Group(); group.add(new m.Mesh(gF, mF), new m.Mesh(gB, mB));

    let eye = null, eyeL = null;
    if (f.eye) {                                                      // красный глаз сервочерепа: свечение + тёплый свет
      const ex = (f.eye[0] * W - W / 2) * s, ey = (H / 2 - f.eye[1] * H) * s, ez = bil(dd, W, H, f.eye[0] * W, f.eye[1] * H, 0) / 255 * tk + .012;
      const c = cv(64, 64), x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,235,210,1)'); g.addColorStop(.25, 'rgba(255,70,50,.95)'); g.addColorStop(1, 'rgba(255,40,20,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      eye = new m.Sprite(new m.SpriteMaterial({ map: ctex(m, c), transparent: true, depthWrite: false, blending: m.AdditiveBlending }));
      eye.position.set(ex, ey, ez); eye.scale.setScalar(.1); group.add(eye);
      eyeL = new m.PointLight(0xff3a22, .6, .6, 2); eyeL.position.set(ex, ey, ez + .05); group.add(eyeL);
    }
    const hover = f.id === 'wh_skull';
    return {
      group, asp, mode: 'volume', U,
      update(t) {
        if (hover) { group.position.y = Math.sin(t * 1.7) * .018; group.rotation.z = Math.sin(t * 1.1) * .035; }
        if (eye) { const p = .8 + .2 * Math.sin(t * 3.1); eye.scale.setScalar(.1 * p); eyeL.intensity = .45 + .35 * p; }
      },
      swing: true,                                                    // одна картинка: без полного оборота — автодвижение качается в пределах ±55°
      setLocked(b) { [mF, mB].forEach(mt => mt.color.setScalar(b ? .34 : 1)); U.rim.value.setScalar(b ? 0 : 1).multiply(new m.Color(f.glow || '#f59e0b')).multiplyScalar(.5); if (eye) eye.visible = eyeL.visible = !b; },
      dispose() { disposeObj(group); }
    };
  }

  /* ---------- модель из файла GLB ---------- */
  function glbModel(m, buf) {
    return new Promise((res, rej) => {
      const L = new m.GLTFLoader(); try { L.setMeshoptDecoder(m.MeshoptDecoder); } catch (e) { /* без meshopt */ }
      L.parse(buf, '', gltf => {
        const root = gltf.scene || (gltf.scenes && gltf.scenes[0]); if (!root) { rej(new Error('empty')); return; }
        root.updateMatrixWorld(true);
        const box = new m.Box3().setFromObject(root), size = box.getSize(new m.Vector3()), ctr = box.getCenter(new m.Vector3());
        if (!isFinite(size.y) || size.y < 1e-6) { rej(new Error('size')); return; }
        const k = 1 / size.y, inner = new m.Group(), group = new m.Group();
        root.position.sub(ctr); inner.add(root); inner.scale.setScalar(k); group.add(inner);
        root.traverse(n => { if (n.isMesh) { n.frustumCulled = false; [].concat(n.material || []).forEach(mt => { if (mt.map) mt.map.anisotropy = 4; }); } });
        let mixer = null;
        if (gltf.animations && gltf.animations.length) { mixer = new m.AnimationMixer(root); gltf.animations.forEach(c => mixer.clipAction(c).play()); }
        res({ group, asp: Math.max(.3, Math.max(size.x, size.z) * k), mode: 'glb', update(t, dt) { if (mixer) mixer.update(dt); }, setLocked(b) { root.traverse(n => { if (n.isMesh) [].concat(n.material || []).forEach(mt => { if (mt.color) { if (!mt.userData._c) mt.userData._c = mt.color.clone(); mt.color.copy(mt.userData._c).multiplyScalar(b ? .34 : 1); } }); }); }, dispose() { disposeObj(group); } });
      }, rej);
    });
  }

  /* ---------- сцена: свет, окружение, пол ---------- */
  function makeRig(m, renderer, glow) {
    const scene = new m.Scene(), gc = new m.Color(glow || '#f59e0b');
    scene.add(new m.HemisphereLight(0xdde6ff, 0x1a120a, .55));
    const key = new m.DirectionalLight(0xfff0dc, 2.3); key.position.set(-1.4, 1.8, 2.3); scene.add(key);
    const rim = new m.DirectionalLight(gc, 2.6); rim.position.set(1.7, .8, -2); scene.add(rim);
    const fill = new m.PointLight(gc, 3, 4, 2); fill.position.set(0, -.45, .8); scene.add(fill);
    const pm = new m.PMREMGenerator(renderer), envRT = pm.fromScene(new m.RoomEnvironment(), .04);
    scene.environment = envRT.texture; scene.environmentIntensity = .75; pm.dispose();
    const camera = new m.PerspectiveCamera(28, 1, .05, 60);
    return { scene, camera, key, rim, fill, envRT, glow: gc };
  }
  function placeCam(camera, sAsp, mAsp, zoom) {
    const half = Math.tan(camera.fov * Math.PI / 360);
    const d = Math.max(.62 / half, Math.max(mAsp, .5) * .58 / (half * sAsp)) / zoom, el = .17;
    camera.aspect = sAsp; camera.updateProjectionMatrix();
    camera.position.set(0, Math.sin(el) * d - .02, Math.cos(el) * d); camera.lookAt(0, -.02, 0);
    return d * half * sAsp;      // половина видимой ширины на расстоянии модели
  }
  function floorGroup(m, glow, R) {
    const g = new m.Group();
    const sc = cv(128, 128), sx = sc.getContext('2d'), gr = sx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(0,0,0,.75)'); gr.addColorStop(.6, 'rgba(0,0,0,.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); sx.fillStyle = gr; sx.fillRect(0, 0, 128, 128);
    const shadow = new m.Mesh(new m.PlaneGeometry(R * 2.1, R * 2.1), new m.MeshBasicMaterial({ map: ctex(m, sc), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -.502; g.add(shadow);
    const rc = cv(512, 512), rx = rc.getContext('2d'); rx.translate(256, 256);
    const fill = rx.createRadialGradient(0, 0, 40, 0, 0, 238); fill.addColorStop(0, hexA(glow, 0)); fill.addColorStop(.85, hexA(glow, .10)); fill.addColorStop(1, hexA(glow, .22));
    rx.fillStyle = fill; rx.beginPath(); rx.arc(0, 0, 238, 0, 6.2832); rx.fill();
    rx.strokeStyle = hexA(glow, .85); rx.lineWidth = 3; rx.beginPath(); rx.arc(0, 0, 238, 0, 6.2832); rx.stroke();
    rx.strokeStyle = hexA(glow, .5); rx.lineWidth = 1.5; rx.beginPath(); rx.arc(0, 0, 200, 0, 6.2832); rx.stroke();
    for (let i = 0; i < 72; i++) { rx.save(); rx.rotate(i / 72 * 6.2832); rx.fillStyle = hexA(glow, i % 6 === 0 ? .95 : .55); rx.fillRect(-1.5, -238, 3, i % 6 === 0 ? 26 : 14); rx.restore(); }
    const ring = new m.Mesh(new m.PlaneGeometry(R * 2.4, R * 2.4), new m.MeshBasicMaterial({ map: ctex(m, rc), transparent: true, depthWrite: false, blending: m.AdditiveBlending }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = -.5; g.add(ring);
    g.userData.ring = ring;
    return g;
  }
  function moteCloud(m, glow, n, R) {
    const pos = new Float32Array(n * 3), spd = new Float32Array(n);
    const reset = (i, any) => { const a = Math.random() * 6.2832, r = Math.sqrt(Math.random()) * R * .9; pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = any ? -.5 + Math.random() * 1.1 : -.5; pos[i * 3 + 2] = Math.sin(a) * r; spd[i] = .05 + Math.random() * .09; };
    for (let i = 0; i < n; i++) reset(i, true);
    const dc = cv(32, 32), dx = dc.getContext('2d'), g = dx.createRadialGradient(16, 16, 0, 16, 16, 16); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)'); dx.fillStyle = g; dx.fillRect(0, 0, 32, 32);
    const geo = new m.BufferGeometry(); geo.setAttribute('position', new m.BufferAttribute(pos, 3));
    const pts = new m.Points(geo, new m.PointsMaterial({ size: .03, map: ctex(m, dc), color: new m.Color(glow), transparent: true, opacity: .85, depthWrite: false, blending: m.AdditiveBlending }));
    pts.frustumCulled = false;
    return { pts, update(dt) { for (let i = 0; i < n; i++) { pos[i * 3 + 1] += spd[i] * dt; if (pos[i * 3 + 1] > .62) reset(i, false); } geo.attributes.position.needsUpdate = true; } };
  }

  /* ---------- окно: создаёт холст внутри сцены просмотра и возвращает управление ---------- */
  async function buildModel(m, f, mode, lvl, o) {
    if (mode === 'glb') return glbModel(m, b64buf(GLBS[f.id]));
    if (mode === 'views') {
      const V = o.views || VIEWS[f.id]; if (!V || typeof Hull3D === 'undefined') throw new Error('views');
      const L = async u => (u && typeof u === 'object') ? u : u ? loadImg(u) : null;
      const [fr, sd, bk] = await Promise.all([L(V.front), L(V.side), L(V.back)]);
      return Hull3D.build(m, { front: fr, side: sd, back: bk, faces: V.faces || 'left' }, lvl, { cv, boxBlur, bleedColors, backColors, aliveMat, disposeObj, ctex }, f);
    }
    if (mode === 'proc') {
      const kind = String(f.model).slice(5), P = typeof Fig3DProcs !== 'undefined' ? Fig3DProcs[kind] : null;
      if (!P) throw new Error('proc');
      const pm = P(m, f.glow);
      return Object.assign({ mode: 'proc', dispose: () => disposeObj(pm.group) }, pm);
    }
    const [sp, dp] = await Promise.all([loadImg(spriteUrl(f)), loadImg(DEPTHS[f.id])]);
    return volumeModel(m, sp, dp, lvl, f, o);
  }

  /** host — .fgv-stage; o: { lvl, reduce, onLost }. Бросает исключение, если 3D запустить нельзя (вызывающий оставит CSS-стенд). */
  async function mount(host, f, o) {
    o = o || {};
    const m = loadLib(); if (!m || !glSupported()) throw new Error('no3d');
    const lvl = o.lvl === 'lite' ? 'lite' : 'full', mode = o.mode || modeOf(f);
    const tb = performance.now();
    let model = await buildModel(m, f, mode, lvl, o);
    const buildMs = Math.round(performance.now() - tb);
    const canvas = document.createElement('canvas'); canvas.className = 'fgv-gl'; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Трёхмерная модель: ' + (f.name || ''));
    let renderer;
    try { renderer = new m.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); }
    catch (e) { model.dispose(); throw e; }
    renderer.setClearColor(0x000000, 0); renderer.outputColorSpace = m.SRGBColorSpace; renderer.toneMapping = m.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    const rig = makeRig(m, renderer, f.glow), root = new m.Group();
    rig.scene.add(root); root.add(model.group);
    host.insertBefore(canvas, host.querySelector('.fgv-load') || host.querySelector('.fgv-hint'));
    const dpr = Math.min(window.devicePixelRatio || 1, lvl === 'full' ? 2 : 1.25);
    let floor = null, mot = null, floorR = .5, lw = 0, lh = 0, zoom = 1, ry = 0, rx = 0, pulseT = 0, alive = o.reduce ? 0 : (lvl === 'full' ? 1 : .6), disposed = false;
    const rebuildFloor = () => {
      if (floor) { rig.scene.remove(floor); disposeObj(floor); }
      if (mot) { rig.scene.remove(mot.pts); disposeObj(mot.pts); mot = null; }
      const R = floorR = clamp(model.asp * .62, .5, .86);
      floor = floorGroup(m, f.glow || '#f59e0b', R); rig.scene.add(floor);
      if (lvl === 'full' && !o.reduce) { mot = moteCloud(m, f.glow || '#f59e0b', 36, R); rig.scene.add(mot.pts); }
    };
    rebuildFloor();
    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
      lw = w; lh = h; renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); fitView();
    };
    const fitView = () => {
      const vw = placeCam(rig.camera, lw / lh, model.asp, zoom), k = Math.min(1, vw * .94 / (floorR * 1.2));
      if (floor) floor.children.forEach(c => c.scale.set(k, k, 1));
    };
    resize();
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); if (o.onLost) o.onLost(); });

    const setZoom = z => { zoom = clamp(z, .75, 2.4); if (lw) fitView(); };
    const ptr = new Map(); let pd0 = 0, z0 = 1;
    const ctl = { mode, pinching: false, get swing() { return !!model.swing; }, get label() { return LABEL[model.mode] || LABEL[mode]; }, get note() { return NOTE[model.mode] || ''; } };
    host.addEventListener('pointerdown', e => { ptr.set(e.pointerId, [e.clientX, e.clientY]); if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pd0 = Math.hypot(a[0] - b[0], a[1] - b[1]); z0 = zoom; ctl.pinching = true; } });
    host.addEventListener('pointermove', e => { if (!ptr.has(e.pointerId)) return; ptr.set(e.pointerId, [e.clientX, e.clientY]); if (ptr.size === 2 && pd0 > 10) { const [a, b] = [...ptr.values()]; setZoom(z0 * Math.hypot(a[0] - b[0], a[1] - b[1]) / pd0); } });
    const endP = e => { ptr.delete(e.pointerId); if (ptr.size < 2) ctl.pinching = false; };
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => host.addEventListener(ev, endP));
    host.addEventListener('wheel', e => { e.preventDefault(); setZoom(zoom * Math.exp(-e.deltaY * .0015)); }, { passive: false });

    let locked = false;
    ctl.setRot = (a, b) => { ry = a; rx = b; };
    ctl.model = () => model;                        // для проверок и отладки
    ctl.setZoom = setZoom;
    ctl.info = () => ({ buildMs, mode: model.mode, zoom, tris: renderer.info.render.triangles, calls: renderer.info.render.calls, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures });
    ctl.resize = resize;
    ctl.setLocked = b => { locked = !!b; if (model.setLocked) model.setLocked(locked); };
    ctl.pulse = () => { pulseT = 1; };
    ctl.frame = (dt, t) => {
      if (disposed) return;
      if (host.clientWidth !== lw || host.clientHeight !== lh) resize();
      if (model.U) { model.U.t.value = t; model.U.a.value = alive; }
      if (pulseT > 0) { pulseT = Math.max(0, pulseT - dt * .8); rig.rim.intensity = 2.6 + pulseT * 7; rig.fill.intensity = 3 + pulseT * 10; }
      root.rotation.y = ry * D2R; root.rotation.x = -rx * D2R;
      if (floor) floor.userData.ring.rotation.z = ry * D2R;
      if (model.update) model.update(t, dt);
      if (mot) mot.update(dt);
      renderer.render(rig.scene, rig.camera);
    };
    /** подменить модель файлом GLB (проверка своих моделей: TRELLIS / Hunyuan3D / Blender) */
    ctl.loadGLB = async buf => {
      const nm = await glbModel(m, buf);
      root.remove(model.group); model.dispose(); model = nm; root.add(model.group);
      model.setLocked(locked); rebuildFloor(); resize(); return nm;
    };
    /** подменить модель тремя своими картинками (спереди, сбоку, сзади) — «объём по трём видам», 06c2-hull.js */
    ctl.loadViews = async V => {
      const nm = await buildModel(m, f, 'views', lvl, { views: V });
      root.remove(model.group); model.dispose(); model = nm; root.add(model.group);
      model.setLocked(locked); rebuildFloor(); resize(); return nm;
    };
    ctl.dispose = () => {
      if (disposed) return; disposed = true;
      try { disposeObj(root); if (floor) disposeObj(floor); if (mot) disposeObj(mot.pts); rig.envRT.dispose(); renderer.dispose(); renderer.forceContextLoss(); } catch (e) { /* уже освобождено */ }
      canvas.remove();
    };
    return ctl;
  }

  /** Снимок оригинальной модели для плитки коллекции (tools/render_thumbs.cjs). Возвращает PNG data-URI с прозрачным фоном. */
  async function snapshot(kind, glow, H, ang) {
    const m = loadLib(); if (!m) throw new Error('no3d');
    const P = Fig3DProcs[kind]; if (!P) throw new Error('proc ' + kind);
    const model = P(m, glow), W = Math.round(H * Math.max(.55, model.asp) * 1.1), canvas = cv(W, H);
    const r = new m.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setClearColor(0x000000, 0); r.outputColorSpace = m.SRGBColorSpace; r.toneMapping = m.ACESFilmicToneMapping; r.toneMappingExposure = 1.05; r.setPixelRatio(1); r.setSize(W, H, false);
    const rig = makeRig(m, r, glow), root = new m.Group(); root.add(model.group); rig.scene.add(root);
    root.rotation.y = (ang == null ? -.42 : ang);
    placeCam(rig.camera, W / H, model.asp, 1.12);
    if (model.update) model.update(1.1, 0);
    r.render(rig.scene, rig.camera);
    const url = canvas.toDataURL('image/png');
    disposeObj(root); rig.envRT.dispose(); r.dispose(); r.forceContextLoss();
    return url;
  }

  return { supported, canOpen, modeOf, mount, snapshot, LABEL, NOTE, hasGLB: id => !!GLBS[id], hasViews: id => !!VIEWS[id], lib: loadLib, build: (f, mode, lvl, o) => buildModel(loadLib(), f, mode, lvl || 'full', o || {}) };
})();
