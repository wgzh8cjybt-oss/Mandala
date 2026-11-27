/* ============================================================
   06c2-hull: «Объём по трём видам» — настоящая 3D-форма по трём картинкам одного персонажа: спереди, сбоку (профиль), сзади.
   Метод — «форма по силуэтам» (visual hull, Laurentini 1994) с округлением сечений:
     1) картинки вырезаются по альфе (если фон сплошной и альфы нет — фон убирается заливкой от краёв) и приводятся к одной высоте;
     2) для каждой высоты берутся отрезки силуэта спереди (по X) и сбоку (по Z): их пересечение — сечение тела; сечение
        округляется суперэллипсом, потому что настоящие тела не квадратные (а силуэты спереди и сбоку при этом сохраняются);
     3) воксельная сетка размывается и из неё «поверхностными узлами» (naive surface nets) строится гладкая замкнутая сетка;
     4) цвет не запекается в вершины: в шейдере каждая точка берёт цвет с картинки спереди, сзади или сбоку по направлению нормали.
   Это не скан и не нейросеть: мелкая лепка (складки, пальцы) не восстанавливается, форма — только то, что видно по силуэтам.
   Для пары «фотография + нейросеть» остаётся маршрут GLB (06c-3d.js). Подписи в приложении честные: «Объём по трём видам».
   ============================================================ */
const Hull3D = (() => {
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const P = 2.35;             // показатель суперэллипса: 2 — эллипс, больше — «полнее» (как у настоящих тел)
  const ISO = .45;            // порог поверхности после размытия: чуть ниже половины, чтобы тонкие детали не пропадали

  /* ---------- подготовка картинок ---------- */
  /** фон одного цвета по краям картинки -> прозрачный: заливка от границы, пока цвет близок к цвету углов (персонаж не должен быть цвета фона) */
  function keyBackground(d, W, H) {
    const pt = Math.max(2, Math.min(6, (Math.min(W, H) / 20) | 0)); let r = 0, g = 0, b = 0, n = 0;
    for (const [px, py] of [[0, 0], [W - pt, 0], [0, H - pt], [W - pt, H - pt]]) for (let y = 0; y < pt; y++) for (let x = 0; x < pt; x++) { const o = ((py + y) * W + px + x) * 4; r += d[o]; g += d[o + 1]; b += d[o + 2]; n++; }
    r /= n; g /= n; b /= n;
    const T = 46 * 46, seen = new Uint8Array(W * H), q = new Int32Array(W * H); let qh = 0, qt = 0;
    const push = i => { if (seen[i]) return; const o = i * 4, dr = d[o] - r, dg = d[o + 1] - g, db = d[o + 2] - b; if (dr * dr + dg * dg + db * db < T) { seen[i] = 1; q[qt++] = i; } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
    while (qh < qt) { const i = q[qh++], x = i % W, y = (i / W) | 0; if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (y > 0) push(i - W); if (y < H - 1) push(i + W); }
    for (let i = 0; i < W * H; i++) d[i * 4 + 3] = seen[i] ? 0 : 255;
  }
  /** картинка -> { w, h, d: RGBA, A: альфа 0..1 } обрезанная по силуэту; прозрачности нет — вырезаем фон */
  function prep(img, maxH) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    if (!iw || !ih) throw new Error('empty');
    const k = Math.min(1, maxH / ih), W = Math.max(8, Math.round(iw * k)), H = Math.max(8, Math.round(ih * k));
    const c = cv(W, H), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data;
    let op = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 245) op++;
    if (op > .985 * W * H) keyBackground(d, W, H);
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) if (d[(y * W + xx) * 4 + 3] >= 128) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < x0 || y1 < y0) throw new Error('empty');
    const w = x1 - x0 + 1, h = y1 - y0 + 1, out = new Uint8ClampedArray(w * h * 4), A = new Float32Array(w * h);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) {
      const so = ((y0 + yy) * W + x0 + xx) * 4, o = (yy * w + xx) * 4;
      out[o] = d[so]; out[o + 1] = d[so + 1]; out[o + 2] = d[so + 2]; out[o + 3] = d[so + 3]; A[yy * w + xx] = d[so + 3] / 255;
    }
    return { w, h, d: out, A };
  }
  const bil1 = (A, w, h, x, y) => {
    x = x < 0 ? 0 : x > w - 1 ? w - 1 : x; y = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
    const x0 = x | 0, y0 = y | 0, x1 = x0 + 1 < w ? x0 + 1 : x0, y1 = y0 + 1 < h ? y0 + 1 : y0, fx = x - x0, fy = y - y0;
    return (A[y0 * w + x0] * (1 - fx) + A[y0 * w + x1] * fx) * (1 - fy) + (A[y1 * w + x0] * (1 - fx) + A[y1 * w + x1] * fx) * fy;
  };
  /** отрезки подряд идущих единиц: [начало, конец, начало, конец, ...] */
  function runs(a, n) { const r = []; let s = -1; for (let i = 0; i <= n; i++) { const on = i < n && a[i]; if (on && s < 0) s = i; else if (!on && s >= 0) { r.push(s, i - 1); s = -1; } } return r; }

  /* ---------- воксели: сечения по силуэтам ---------- */
  function carve(pf, ps, sgn, NX, NY, NZ, wf, ws) {
    const F = new Float32Array(NX * NY * NZ), vs = 1 / NY, fa = new Uint8Array(NX), sa = new Uint8Array(NZ), XR = [], ZR = [];
    let maxAx = 1;
    for (let j = 0; j < NY; j++) {                                   // проход 1: отрезки силуэтов по каждой высоте
      const y = (j + .5) / NY - .5, pyf = (.5 - y) * pf.h - .5, pys = (.5 - y) * ps.h - .5;
      for (let i = 0; i < NX; i++) { const x = (i + .5 - NX / 2) * vs, px = (x / wf + .5) * pf.w - .5; fa[i] = px >= -.5 && px <= pf.w - .5 && bil1(pf.A, pf.w, pf.h, px, pyf) >= .5 ? 1 : 0; }
      for (let k = 0; k < NZ; k++) { const z = (k + .5 - NZ / 2) * vs, px = (.5 + sgn * z / ws) * ps.w - .5; sa[k] = px >= -.5 && px <= ps.w - .5 && bil1(ps.A, ps.w, ps.h, px, pys) >= .5 ? 1 : 0; }
      const xr = runs(fa, NX); XR.push(xr); ZR.push(runs(sa, NZ));
      for (let a = 0; a < xr.length; a += 2) maxAx = Math.max(maxAx, (xr[a + 1] - xr[a] + 1) / 2);
    }
    for (let j = 0; j < NY; j++) {                                   // проход 2: сечения-суперэллипсы
      const xr = XR[j]; if (!xr.length) continue;
      const zr = ZR[j];
      for (let a = 0; a < xr.length; a += 2) {
        const x0 = xr[a], x1 = xr[a + 1], cx = (x0 + x1 + 1) / 2, ax = (x1 - x0 + 1) / 2;
        let zs = zr;
        if (!zs.length) { const hh = Math.max(2, Math.min(NZ / 2 - 3, ax * .7)), c = NZ / 2; zs = [Math.floor(c - hh), Math.ceil(c + hh) - 1]; }   // боковой силуэт тут пуст — круглое сечение
        const thin = ax < .42 * maxAx;                              // руки и ноги: профиль захватывает и голову, и торс, поэтому тонкая часть иначе становится «плавником»
        for (let b = 0; b < zs.length; b += 2) {
          const z0 = zs[b], z1 = zs[b + 1], cz = (z0 + z1 + 1) / 2; let bz = (z1 - z0 + 1) / 2;
          if (thin) bz = Math.min(bz, Math.max(2.5, 1.3 * ax));
          const wi = new Float32Array(x1 - x0 + 1); for (let i = x0; i <= x1; i++) wi[i - x0] = Math.pow(Math.abs((i + .5 - cx) / ax), P);
          const k0 = Math.max(0, Math.floor(cz - bz)), k1 = Math.min(NZ - 1, Math.ceil(cz + bz) - 1);
          for (let k = k0; k <= k1; k++) {
            const wk = Math.pow(Math.abs((k + .5 - cz) / bz), P); if (wk > 1) continue;
            const row = NX * (j + NY * k);
            for (let i = x0; i <= x1; i++) if (wi[i - x0] + wk <= 1) F[row + i] = 1;
          }
        }
      }
    }
    return F;
  }
  /** сглаживание поля: [1 2 1]/4 по каждой оси, iters раз */
  function blur3(F, NX, NY, NZ, iters) {
    let a = F, b = new Float32Array(F.length); const S = [1, NX, NX * NY], D = [NX, NY, NZ];
    for (let it = 0; it < iters; it++) for (let ax = 0; ax < 3; ax++) {
      const st = S[ax], n = D[ax];
      for (let idx = 0; idx < a.length; idx++) {
        const c = ((idx / st) | 0) % n, lo = c > 0 ? a[idx - st] : a[idx], hi = c < n - 1 ? a[idx + st] : a[idx];
        b[idx] = (lo + 2 * a[idx] + hi) * .25;
      }
      const t = a; a = b; b = t;
    }
    return a;
  }

  /* ---------- поверхностные узлы (naive surface nets, по Мико Лисенко) ---------- */
  const CUBE_E = new Int32Array(24), EDGE_T = new Int32Array(256);
  (() => {
    let k = 0; for (let i = 0; i < 8; i++) for (let j = 1; j <= 4; j <<= 1) { const p = i ^ j; if (i <= p) { CUBE_E[k++] = i; CUBE_E[k++] = p; } }
    for (let i = 0; i < 256; i++) { let em = 0; for (let j = 0; j < 24; j += 2) { const a = !!(i & (1 << CUBE_E[j])), b = !!(i & (1 << CUBE_E[j + 1])); em |= a !== b ? (1 << (j >> 1)) : 0; } EDGE_T[i] = em; }
  })();
  function surfaceNets(F, NX, NY, NZ, iso) {
    const SY = NX, SZ = NX * NY, St = [1, SY, SZ], N = NX * NY * NZ;
    const vid = new Int32Array(N).fill(-1), emk = new Uint16Array(N), in0 = new Uint8Array(N), gv = new Float32Array(8), pos = [];
    for (let k = 0; k < NZ - 1; k++) for (let j = 0; j < NY - 1; j++) for (let i = 0; i < NX - 1; i++) {
      const base = i + SY * j + SZ * k; let mask = 0, g = 0;
      for (let dk = 0; dk < 2; dk++) for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++, g++) { const v = F[base + di + dj * SY + dk * SZ] - iso; gv[g] = v; if (v > 0) mask |= 1 << g; }
      if (mask === 0 || mask === 255) continue;
      const em = EDGE_T[mask]; let vx = 0, vy = 0, vz = 0, ec = 0;
      for (let e = 0; e < 12; e++) {
        if (!(em & (1 << e))) continue; ec++;
        const e0 = CUBE_E[e << 1], e1 = CUBE_E[(e << 1) + 1], g0 = gv[e0], g1 = gv[e1], dd = g0 - g1, t = Math.abs(dd) > 1e-6 ? g0 / dd : .5;
        for (let a = 0, kb = 1; a < 3; a++, kb <<= 1) { const c0 = e0 & kb, c1 = e1 & kb, v = c0 !== c1 ? (c0 ? 1 - t : t) : (c0 ? 1 : 0); if (a === 0) vx += v; else if (a === 1) vy += v; else vz += v; }
      }
      const s = 1 / ec; vid[base] = pos.length / 3; pos.push(i + vx * s, j + vy * s, k + vz * s); emk[base] = em; in0[base] = mask & 1;
    }
    const idx = [];
    for (let k = 1; k < NZ - 1; k++) for (let j = 1; j < NY - 1; j++) for (let i = 1; i < NX - 1; i++) {
      const base = i + SY * j + SZ * k, va = vid[base]; if (va < 0) continue;
      const em = emk[base];
      for (let a = 0; a < 3; a++) {
        if (!(em & (1 << a))) continue;
        const du = St[(a + 1) % 3], dv = St[(a + 2) % 3], vb = vid[base - du], vc = vid[base - du - dv], vd = vid[base - dv];
        if (vb < 0 || vc < 0 || vd < 0) continue;
        if (in0[base]) idx.push(va, vb, vc, va, vc, vd); else idx.push(va, vd, vc, va, vc, vb);
      }
    }
    // направление обхода: нормаль грани должна смотреть против градиента поля (наружу); при ошибке переворачиваем всё сразу
    let agree = 0;
    for (let t = 0; t < idx.length; t += 3 * Math.max(1, (idx.length / 3 / 400) | 0)) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2], wx = pos[c] - pos[a], wy = pos[c + 1] - pos[a + 1], wz = pos[c + 2] - pos[a + 2];
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const cx = Math.round((pos[a] + pos[b] + pos[c]) / 3), cy = Math.round((pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3), cz = Math.round((pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3);
      const ci = Math.min(NX - 2, Math.max(1, cx)) + SY * Math.min(NY - 2, Math.max(1, cy)) + SZ * Math.min(NZ - 2, Math.max(1, cz));
      const gx = F[ci + 1] - F[ci - 1], gy = F[ci + SY] - F[ci - SY], gz = F[ci + SZ] - F[ci - SZ];
      agree += -(nx * gx + ny * gy + nz * gz) > 0 ? 1 : -1;
    }
    if (agree < 0) for (let t = 0; t < idx.length; t += 3) { const q = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = q; }
    return { pos, idx };
  }


  /** первая видимая точка поверхности вдоль каждой проекции: спереди (+z), сзади (−z), сбоку (+x и −x). Нужна, чтобы цвет закрытых мест
      (под рукой, за головой) не брался с картинки, где их закрывает другая часть. */
  function firstHits(F, NX, NY, NZ, iso) {
    const zf = new Int16Array(NX * NY).fill(-1), zb = new Int16Array(NX * NY).fill(NZ), xp = new Int16Array(NY * NZ).fill(-1), xm = new Int16Array(NY * NZ).fill(NX);
    for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) { const row = NX * (j + NY * k); for (let i = 0; i < NX; i++) if (F[row + i] >= iso) {
      const a = i + NX * j, b = j + NY * k;
      if (k > zf[a]) zf[a] = k; if (k < zb[a]) zb[a] = k; if (i > xp[b]) xp[b] = i; if (i < xm[b]) xm[b] = i;
    } }
    return { zf, zb, xp, xm };
  }

  /* ---------- сборка модели ---------- */
  function flipX(src, W, H) { const o = new Uint8ClampedArray(src.length); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const a = (y * W + x) * 4, b = (y * W + (W - 1 - x)) * 4; o[b] = src[a]; o[b + 1] = src[a + 1]; o[b + 2] = src[a + 2]; o[b + 3] = 255; } return o; }
  /** V: { front, side, back|null, faces: 'left'|'right' } (картинки или холсты); lvl: 'full'|'lite'; Hh: помощники из 06c-3d.js */
  function build(m, V, lvl, Hh, f) {
    const NY = lvl === 'full' ? 132 : 92, MAXH = 720;
    const pf = prep(V.front, MAXH), ps = prep(V.side, MAXH), pb = V.back ? prep(V.back, MAXH) : null;
    const wf = pf.w / pf.h, ws = ps.w / ps.h, wb = pb ? pb.w / pb.h : wf, sgn = V.faces === 'right' ? 1 : -1;
    const NX = Math.ceil(wf * NY) + 6, NZ = Math.ceil(ws * NY) + 6, vs = 1 / NY;
    const t0 = performance.now();
    const F = blur3(carve(pf, ps, sgn, NX, NY, NZ, wf, ws), NX, NY, NZ, 2);
    const { pos, idx } = surfaceNets(F, NX, NY, NZ, ISO);
    if (idx.length < 300) throw new Error('hull-empty');
    const nv = pos.length / 3, P3 = new Float32Array(nv * 3);
    for (let v = 0; v < nv; v++) { P3[v * 3] = (pos[v * 3] + .5 - NX / 2) * vs; P3[v * 3 + 1] = (pos[v * 3 + 1] + .5) / NY - .5; P3[v * 3 + 2] = (pos[v * 3 + 2] + .5 - NZ / 2) * vs; }
    const geo = new m.BufferGeometry();
    geo.setAttribute('position', new m.BufferAttribute(P3, 3)); geo.setIndex(new m.BufferAttribute(nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1)); geo.computeVertexNormals();
    {   // видимость каждой вершины с проекций (1 — видна, 0 — закрыта другой частью): в шейдере умножается на вес по нормали
      const H = firstHits(F, NX, NY, NZ, ISO), NN = geo.attributes.normal.array, vis = new Float32Array(nv * 3), tol = 1.7, cl = (v, n) => v < 0 ? 0 : v > n - 1 ? n - 1 : v;
      for (let v = 0; v < nv; v++) {
        const fx = pos[v * 3], fy = pos[v * 3 + 1], fz = pos[v * 3 + 2], ix = cl(Math.round(fx), NX), iy = cl(Math.round(fy), NY), iz = cl(Math.round(fz), NZ), a = ix + NX * iy, b = iy + NY * iz;
        vis[v * 3] = fz >= H.zf[a] - tol ? 1 : 0; vis[v * 3 + 1] = fz <= H.zb[a] + tol ? 1 : 0;
        vis[v * 3 + 2] = NN[v * 3] >= 0 ? (fx >= H.xp[b] - tol ? 1 : 0) : (fx <= H.xm[b] + tol ? 1 : 0);
      }
      geo.setAttribute('aVis', new m.BufferAttribute(vis, 3));
    }
    const buildMs = Math.round(performance.now() - t0);

    /* текстуры: цвет растекается за силуэт (на кромке нет тёмной каёмки), спина без картинки — размытый цвет спереди, отражённый */
    const tex = (w, h, rgba) => { const c = cv(w, h); c.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0); const t = new m.CanvasTexture(c); t.colorSpace = m.SRGBColorSpace; t.anisotropy = 4; return t; };
    const bf = Hh.bleedColors(pf.d, pf.w, pf.h, 10), bs = Hh.bleedColors(ps.d, ps.w, ps.h, 10);
    const bb = pb ? Hh.bleedColors(pb.d, pb.w, pb.h, 10) : flipX(Hh.backColors(bf, pf.w, pf.h, true), pf.w, pf.h);
    const tF = tex(pf.w, pf.h, bf), tS = tex(ps.w, ps.h, bs), tB = tex(pb ? pb.w : pf.w, pb ? pb.h : pf.h, bb);
    const U = { t: { value: 0 }, a: { value: 1 }, rim: { value: new m.Color((f && f.glow) || '#f59e0b').multiplyScalar(.5) } };
    const X = {
      key: 'fig3d-hull', noAlpha: true,
      u: { uTF: { value: tF }, uTB: { value: tB }, uTS: { value: tS }, uDim: { value: new m.Vector3(wf, wb, ws) }, uSide: { value: sgn } },
      vd: 'attribute vec3 aVis;\nvarying vec3 vOP;\nvarying vec3 vON;\nvarying vec3 vVis;\n', vm: 'vOP = position;\nvON = normal;\nvVis = aVis;\n',
      fd: 'uniform sampler2D uTF;\nuniform sampler2D uTB;\nuniform sampler2D uTS;\nuniform vec3 uDim;\nuniform float uSide;\nvarying vec3 vOP;\nvarying vec3 vON;\nvarying vec3 vVis;\n',
      // цвет точки = картинка спереди / сзади / сбоку (с другой стороны — зеркально) по направлению нормали; на верхних и нижних гранях — среднее
      fm: 'vec3 pn = normalize(vON);\n' +
        'vec3 fc = vec3(max(pn.z, 0.), max(-pn.z, 0.), abs(pn.x)), vv = clamp(vVis, 0., 1.);\n' +
        'vec3 ws = pow(fc, vec3(6.)) * vv;\n' +                                   // строго: проекция, на которую смотрит поверхность, и она эту точку видит
        'vec3 wl = pow(fc + .05, vec3(2.)) * vv + vec3(1e-5);\n' +                  // запасной вариант: любая проекция, которая точку видит (цвет с края вместо цвета закрывающей части)
        'float ss = ws.x + ws.y + ws.z;\n' +
        'vec3 wg = mix(wl / (wl.x + wl.y + wl.z), ws / max(ss, 1e-5), smoothstep(.01, .06, ss));\n' +
        'float us = .5 + uSide * vOP.z / uDim.z;\n' +
        'if (pn.x < 0.) us = 1. - us;\n' +
        'vec3 tcol = texture2D(uTF, vec2(vOP.x / uDim.x + .5, vOP.y + .5)).rgb * wg.x + texture2D(uTB, vec2(.5 - vOP.x / uDim.y, vOP.y + .5)).rgb * wg.y + texture2D(uTS, vec2(us, vOP.y + .5)).rgb * wg.z;\n' +
        'diffuseColor.rgb *= tcol;\n'
    };
    const mat = new m.MeshStandardMaterial({ roughness: .62, metalness: .1 }); Hh.aliveMat(mat, U, X);
    const group = new m.Group(); group.add(new m.Mesh(geo, mat));
    const glow = new m.Color((f && f.glow) || '#f59e0b');
    return {
      group, asp: Math.max(.45, wf, ws), mode: 'views', U, buildMs, tris: idx.length / 3, verts: nv, dims: [NX, NY, NZ],
      setLocked(b) { mat.color.setScalar(b ? .34 : 1); U.rim.value.setScalar(b ? 0 : 1).multiply(glow).multiplyScalar(.5); },
      dispose() { geo.dispose(); mat.dispose(); tF.dispose(); tB.dispose(); tS.dispose(); }
    };
  }

  return { build, prep, keyBackground };
})();
