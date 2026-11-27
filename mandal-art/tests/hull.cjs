// «Объём по трём видам» (06c2-hull.js): проверка на синтетической фигурке с известной формой.
// Три картинки (спереди, сбоку, сзади) снимаются с «настоящей» модели, из них строится форма, потом форма и оригинал
// снимаются под теми же углами: силуэты должны совпадать, а цвета — оказываться на нужной стороне (нос спереди, рюкзак сзади,
// поднятая рука слева в виде спереди и справа в виде сзади). Спутанные стороны, зеркальный профиль и вывернутая сетка здесь ловятся.
// Скорость на настоящем телефоне не проверить: Chromium в песочнице рисует программно (SwiftShader).
const { launch, URL: APP } = require('./lib.cjs');
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const h = await launch({ dsf: 1, w: 420, h: 560 });
  const p = h.page; await p.goto(APP); await p.waitForTimeout(800);
  await p.evaluate(() => { while (Modal.closeTop()); });

  const res = await p.evaluate(async () => {
    const m = Fig3D.lib(); if (!m) return { err: 'нет three' };
    const W = 360, H = 540, ANG = [0, 45, 90, 135, 180, 225, 270, 315];
    /* «настоящая» фигурка: у каждой части свой цвет и своё место, чтобы любая путаница сторон была видна */
    const figure = unlit => {
      const g = new m.Group(), mat = c => unlit ? new m.MeshBasicMaterial({ color: c }) : new m.MeshStandardMaterial({ color: c, roughness: .6, metalness: .1 });
      const add = (geo, c, x, y, z, rx, ry, rz, sx, sy, sz) => { const me = new m.Mesh(geo, mat(c)); me.position.set(x, y, z); me.rotation.set(rx || 0, ry || 0, rz || 0); me.scale.set(sx || 1, sy || 1, sz || 1); g.add(me); };
      add(new m.CylinderGeometry(.045, .045, .38, 20), 0x495057, -.07, -.31, 0);              // ноги
      add(new m.CylinderGeometry(.045, .045, .38, 20), 0x495057, .07, -.31, 0);
      add(new m.BoxGeometry(.1, .06, .17), 0x5c3a21, -.07, -.47, .035);                       // сапоги: носки вперёд (+z)
      add(new m.BoxGeometry(.1, .06, .17), 0x5c3a21, .07, -.47, .035);
      add(new m.CylinderGeometry(.13, .13, .3, 28), 0xf08c00, 0, .03, 0, 0, 0, 0, 1, 1, .6); // торс-эллипс
      add(new m.BoxGeometry(.16, .2, .08), 0x2f9e44, 0, .05, -.118);                         // рюкзак сзади (−z)
      add(new m.SphereGeometry(.1, 28, 20), 0xffc9a8, 0, .3, 0);                              // голова
      add(new m.ConeGeometry(.025, .06, 16), 0xe03131, 0, .295, .125, Math.PI / 2, 0, 0);    // нос вперёд
      add(new m.SphereGeometry(.015, 12, 10), 0x1c7ed6, -.04, .32, .088);
      add(new m.SphereGeometry(.015, 12, 10), 0x1c7ed6, .04, .32, .088);
      add(new m.BoxGeometry(.12, .035, .12), 0xfcc419, .03, .405, .01, 0, 0, -.2);            // кепка
      add(new m.CylinderGeometry(.035, .035, .28, 16), 0x1c7ed6, .185, .04, 0);              // левая рука (+x) вдоль тела
      add(new m.SphereGeometry(.04, 16, 12), 0x1c7ed6, .185, -.12, 0);
      add(new m.CylinderGeometry(.035, .035, .3, 16), 0xe64980, -.246, .226, 0, 0, 0, Math.PI / 4);   // правая рука (−x) поднята в сторону
      add(new m.SphereGeometry(.04, 16, 12), 0xe64980, -.352, .332, 0);
      const box = new m.Box3().setFromObject(g), c = box.getCenter(new m.Vector3()), k = 1 / (box.max.y - box.min.y);
      const wrap = new m.Group(); g.position.sub(c); wrap.add(g); wrap.scale.setScalar(k); const out = new m.Group(); out.add(wrap); return out;
    };
    const cvs = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const rc = cvs(W, H), r = new m.WebGLRenderer({ canvas: rc, antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.outputColorSpace = m.SRGBColorSpace; r.setSize(W, H, false);
    const cam = new m.PerspectiveCamera(6, W / H, 1, 100), dist = .5 / Math.tan(3 * Math.PI / 180) / .88; cam.position.set(0, 0, dist); cam.lookAt(0, 0, 0);
    const shot = (obj, ry, lit, bg) => {
      const sc = new m.Scene(); if (lit) { sc.add(new m.HemisphereLight(0xffffff, 0x666666, 1.3)); const dl = new m.DirectionalLight(0xffffff, 2); dl.position.set(-1, 2, 3); sc.add(dl); }
      const root = new m.Group(); root.add(obj); root.rotation.y = ry; sc.add(root);
      r.setClearColor(bg == null ? 0x000000 : bg, bg == null ? 0 : 1); r.render(sc, cam);
      const c = cvs(W, H), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(rc, 0, 0); return c;
    };
    const px = c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    const mask = c => { const d = px(c), o = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) o[i] = d[i * 4 + 3] > 127 ? 1 : 0; return o; };
    const iou = (a, b) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { if (a[k] || b[k]) u++; if (a[k] && b[k]) i++; } return u ? i / u : 0; };
    const hsv = (R, G, B) => { R /= 255; G /= 255; B /= 255; const mx = Math.max(R, G, B), mn = Math.min(R, G, B), dl = mx - mn; let hh = 0; if (dl) { if (mx === R) hh = ((G - B) / dl + 6) % 6; else if (mx === G) hh = (B - R) / dl + 2; else hh = (R - G) / dl + 4; } return [hh * 60, mx ? dl / mx : 0, mx]; };
    /** сколько пикселей данного оттенка и где их центр по горизонтали (в долях ширины) */
    const colorStat = (c, h0, h1) => { const d = px(c); let n = 0, sx = 0; for (let i = 0; i < W * H; i++) { if (d[i * 4 + 3] < 200) continue; const [hh, s, v] = hsv(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); if (s > .5 && v > .35 && hh >= h0 && hh <= h1) { n++; sx += (i % W); } } return { n, cx: n ? sx / n / W : null }; };

    const truthLit = figure(false), flat = figure(true);
    const views = { front: shot(flat, 0, false), side: shot(flat, -Math.PI / 2, false), back: shot(flat, Math.PI, false), faces: 'left' };
    const out = { dims: [W, H] };
    out.viewPngs = { front: views.front.toDataURL('image/png'), side: views.side.toDataURL('image/png'), back: views.back.toDataURL('image/png'), empty: cvs(64, 64).toDataURL('image/png') };
    const t0 = performance.now(); const mdl = await Fig3D.build({ id: 'hull_test', glow: '#f59e0b' }, 'views', 'full', { views }); out.buildMsAll = Math.round(performance.now() - t0);
    out.tris = mdl.tris; out.verts = mdl.verts; out.grid = mdl.dims; out.buildMs = mdl.buildMs; mdl.U.a.value = 0;
    // сетка наружу: нормаль вершины против вектора от центра
    const g = mdl.group.children[0].geometry, P = g.attributes.position.array, N = g.attributes.normal.array, IX = g.index.array; let bad = 0, vol = 0;
    for (let v = 0; v < P.length; v++) if (!isFinite(P[v]) || !isFinite(N[v])) bad++;
    for (let t = 0; t < IX.length; t += 3) { const a = IX[t] * 3, b = IX[t + 1] * 3, c = IX[t + 2] * 3; vol += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6; }
    out.volume = vol; out.nan = bad;
    // сравнение под разными углами
    const iouBy = {}, imgs = { truth: [], hull: [] };
    for (const a of ANG) {
      const ry = a * Math.PI / 180, ct = shot(truthLit, ry, true), ch = shot(mdl.group, ry, true);
      iouBy[a] = +iou(mask(ct), mask(ch)).toFixed(3); imgs.truth.push(ct.toDataURL('image/png')); imgs.hull.push(ch.toDataURL('image/png'));
    }
    out.iou = iouBy; out.imgs = imgs;
    // цвета по сторонам
    const f0 = shot(mdl.group, 0, true), f180 = shot(mdl.group, Math.PI, true);
    out.red0 = colorStat(f0, 354, 360).n + colorStat(f0, 0, 9).n; out.red180 = colorStat(f180, 354, 360).n + colorStat(f180, 0, 9).n;
    out.green0 = colorStat(f0, 100, 160).n; out.green180 = colorStat(f180, 100, 160).n;
    out.mag0 = colorStat(f0, 322, 350); out.mag180 = colorStat(f180, 322, 350);
    out.blue0 = colorStat(f0, 195, 225); out.blue180 = colorStat(f180, 195, 225);
    // неправильный профиль («смотрит вправо») должен давать заметно худший силуэт сбоку
    const wrong = await Fig3D.build({ id: 'hull_test2', glow: '#f59e0b' }, 'views', 'full', { views: { ...views, faces: 'right' } }); wrong.U.a.value = 0;
    out.iouWrong90 = +iou(mask(shot(truthLit, Math.PI / 2, true)), mask(shot(wrong.group, Math.PI / 2, true))).toFixed(3);
    wrong.dispose();
    // без картинки сзади: спина достраивается, форма та же
    const nb = await Fig3D.build({ id: 'hull_test3', glow: '#f59e0b' }, 'views', 'lite', { views: { front: views.front, side: views.side, back: null, faces: 'left' } }); nb.U.a.value = 0;
    out.noBack = { tris: nb.tris, iou0: +iou(mask(shot(truthLit, 0, true)), mask(shot(nb.group, 0, true))).toFixed(3) };
    out.noBackImg = shot(nb.group, Math.PI, true).toDataURL('image/png'); nb.dispose();
    // фото на однотонном фоне, без прозрачности: фон вырезается заливкой от краёв
    const bgv = { front: shot(flat, 0, false, 0xe9ecef), side: shot(flat, -Math.PI / 2, false, 0xe9ecef), back: shot(flat, Math.PI, false, 0xe9ecef), faces: 'left' };
    const ob = await Fig3D.build({ id: 'hull_test4', glow: '#f59e0b' }, 'views', 'full', { views: bgv }); ob.U.a.value = 0;
    out.opaque = { tris: ob.tris, iou0: +iou(mask(shot(truthLit, 0, true)), mask(shot(ob.group, 0, true))).toFixed(3), iou90: +iou(mask(shot(truthLit, Math.PI / 2, true)), mask(shot(ob.group, Math.PI / 2, true))).toFixed(3) };
    ob.dispose();
    // пустая картинка не должна ронять приложение
    let emptyErr = null; try { await Fig3D.build({ id: 'x' }, 'views', 'full', { views: { front: cvs(40, 40), side: cvs(40, 40), faces: 'left' } }); } catch (e) { emptyErr = e.message; }
    out.emptyErr = emptyErr;
    mdl.dispose(); r.dispose();
    return out;
  });
  if (res.err) { console.log('FAIL', res.err); process.exit(1); }
  console.log('сетка', JSON.stringify(res.grid), 'вершин', res.verts, 'треугольников', res.tris, 'сборка', res.buildMs, 'мс; IoU', JSON.stringify(res.iou), 'не тот профиль', res.iouWrong90);
  console.log('цвета', JSON.stringify({ red: [res.red0, res.red180], green: [res.green0, res.green180], mag: [res.mag0, res.mag180], blue: [res.blue0, res.blue180] }));
  console.log('без спины', JSON.stringify(res.noBack), 'фон-однотонный', JSON.stringify(res.opaque), 'пустая', res.emptyErr);

  ok('сетка построена (>5000 треугольников, без NaN)', res.tris > 5000 && res.nan === 0, { tris: res.tris, nan: res.nan });
  ok('сетка замкнута и вывернута «наружу»: объём по виткам положителен и правдоподобен', res.volume > .02 && res.volume < .2, res.volume);
  ok('сборка формы быстрее 2,5 с (CPU)', res.buildMs < 2500, res.buildMs);
  ok('силуэт спереди совпадает с оригиналом (IoU ≥ 0,93)', res.iou[0] >= .93, res.iou[0]);
  ok('силуэт сбоку совпадает с оригиналом (IoU ≥ 0,90)', res.iou[90] >= .90 && res.iou[270] >= .88, [res.iou[90], res.iou[270]]);
  ok('силуэт сзади совпадает с оригиналом (IoU ≥ 0,93)', res.iou[180] >= .93, res.iou[180]);
  ok('между видами (45°, 135°, 225°, 315°) форма правдоподобна (IoU ≥ 0,80)', [45, 135, 225, 315].every(a => res.iou[a] >= .8), [45, 135, 225, 315].map(a => res.iou[a]));
  ok('зеркальный профиль («смотрит вправо») заметно хуже правильного', res.iouWrong90 < res.iou[90] - .02, [res.iouWrong90, res.iou[90]]);
  ok('красный нос только спереди', res.red0 > 20 && res.red0 > 3 * Math.max(1, res.red180), [res.red0, res.red180]);
  ok('зелёный рюкзак только сзади', res.green180 > 40 && res.green180 > 3 * Math.max(1, res.green0), [res.green0, res.green180]);
  ok('поднятая рука (−x): спереди слева, сзади справа', res.mag0.cx !== null && res.mag180.cx !== null && res.mag0.cx < .5 && res.mag180.cx > .5, [res.mag0.cx, res.mag180.cx]);
  ok('опущенная рука (+x): спереди справа, сзади слева', res.blue0.cx !== null && res.blue180.cx !== null && res.blue0.cx > .5 && res.blue180.cx < .5, [res.blue0.cx, res.blue180.cx]);
  ok('без картинки сзади форма строится так же', res.noBack.tris > 3000 && res.noBack.iou0 >= .9, res.noBack);
  ok('фото на однотонном фоне: фон вырезается, форма верная', res.opaque.iou0 >= .85 && res.opaque.iou90 >= .75, res.opaque);
  ok('пустые картинки дают понятную ошибку, а не падение', typeof res.emptyErr === 'string' && res.emptyErr.length > 0, res.emptyErr);

  // контактный лист: сверху оригинал, снизу построенная форма
  ['truth', 'hull'].forEach(k => res.imgs[k].forEach((u, i) => fs.writeFileSync(path.join(SHOTS, `hull_${k}_${i}.png`), Buffer.from(u.split(',')[1], 'base64'))));
  fs.writeFileSync(path.join(SHOTS, 'hull_noback.png'), Buffer.from(res.noBackImg.split(',')[1], 'base64'));

  // полный путь через окно просмотра: mount(mode:'views') даёт подпись и управление
  const mnt = await p.evaluate(async () => {
    const m = Fig3D.lib(); const cvs = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
    const mk = (x0, w) => { const c = cvs(120, 240), x = c.getContext('2d'); x.fillStyle = '#d9480f'; x.beginPath(); x.ellipse(60, 120, w, 100, 0, 0, 7); x.fill(); x.fillStyle = '#fff'; x.fillRect(x0, 60, 14, 14); return c; };
    const host = document.createElement('div'); host.className = 'fgv-stage'; host.style.cssText = 'position:fixed;left:0;top:0;width:360px;height:480px;z-index:99999;background:#14110d'; document.body.appendChild(host);
    const ctl = await Fig3D.mount(host, { id: 'mt', name: 'Проверка', glow: '#22d3ee' }, { lvl: 'full', reduce: true, mode: 'views', views: { front: mk(50, 50), side: mk(40, 28), back: mk(50, 50), faces: 'left' } });
    ctl.setRot(30, 5); ctl.frame(.016, 1); const info = ctl.info(), label = ctl.label, note = ctl.note, swing = ctl.swing;
    const nonEmpty = (() => { const c = host.querySelector('canvas'); const t = cvs(c.width, c.height), x = t.getContext('2d'); x.drawImage(c, 0, 0); const d = x.getImageData(0, 0, t.width, t.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++; return n; })();
    ctl.dispose(); host.remove(); return { mode: info.mode, label, note, swing, nonEmpty };
  });
  console.log('окно просмотра', JSON.stringify(mnt));
  ok('mount(views): режим, подпись «Объём по трём видам», полный оборот', mnt.mode === 'views' && mnt.label === 'Объём по трём видам' && mnt.swing === false && /силуэт/.test(mnt.note), mnt);
  ok('mount(views): модель нарисована', mnt.nonEmpty > 2000, mnt.nonEmpty);
  ok('нет ошибок страницы', h.errors.length === 0, h.errors);
  await h.browser.close();

  /* ---------- окно «Виды…» в окне фигурки: три файла с телефона -> модель по трём видам ---------- */
  const d2 = await launch({ dsf: 1, storage: { mandal_art_v14: JSON.stringify({ v: 2, xp: 900, flames: 3 }) } });
  const q = d2.page; await q.goto(APP); await q.waitForTimeout(700);
  const wlc = await q.$('.modal [data-r="1"]'); if (wlc) await wlc.click();
  await q.evaluate(() => { S.unlockedFigs = FIGURES.map(f => f.id); });
  await q.click('#nav [data-tab="relics"]'); await q.waitForTimeout(150);
  await q.click('[data-act="hall"][data-v="figs"]'); await q.waitForTimeout(150);
  await q.click('.fig[data-id="op_captain"]'); await q.waitForSelector('.fgv'); await q.waitForTimeout(1800);
  ok('одна картинка: автодвижение — качание, а не полный оборот (swing)', await q.evaluate(() => !!UI.g3 && UI.g3.swing === true && /Объём из картинки/.test(document.getElementById('fgvMode').textContent)));
  ok('в окне 3D есть кнопка «Виды…»', await q.evaluate(() => !!document.querySelector('.fgv-ctl .vw')));
  const row = await q.evaluate(() => { const r = document.querySelector('.fgv-ctl'), b = r.getBoundingClientRect(); return { l: b.left, r: b.right, vw: innerWidth, h: b.height, kids: [...r.children].every(c => { const x = c.getBoundingClientRect(); return x.left >= 0 && x.right <= innerWidth; }) }; });
  ok('ряд кнопок управления помещается в экран телефона', row.kids && row.r <= row.vw, row);
  await q.click('.fgv-ctl .vw'); await q.waitForSelector('.vw-slots');
  ok('окно выбора: три места под картинки, «Построить» выключена', await q.evaluate(() => document.querySelectorAll('.vw-slot').length === 3 && document.getElementById('vwGo').disabled));
  const png = k => Buffer.from(res.viewPngs[k].split(',')[1], 'base64');
  await q.setInputFiles('input[data-k="front"]', { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('не картинка') }); await q.waitForTimeout(200);
  ok('не картинка отклоняется с понятным сообщением', await q.evaluate(() => /не картинка/i.test(document.getElementById('vwErr').textContent) && document.getElementById('vwGo').disabled));
  await q.setInputFiles('input[data-k="front"]', { name: 'front.png', mimeType: 'image/png', buffer: png('front') }); await q.waitForTimeout(200);
  ok('одной картинки мало: «Построить» всё ещё выключена', await q.evaluate(() => document.getElementById('vwGo').disabled));
  await q.setInputFiles('input[data-k="side"]', { name: 'side.png', mimeType: 'image/png', buffer: png('side') }); await q.waitForTimeout(200);
  ok('после «спереди» и «сбоку» кнопка включена, на местах — миниатюры', await q.evaluate(() => !document.getElementById('vwGo').disabled && document.querySelectorAll('.vw-th.on').length === 2));
  // сначала пустые картинки: честная ошибка и окно остаётся
  await q.setInputFiles('input[data-k="front"]', { name: 'empty.png', mimeType: 'image/png', buffer: Buffer.from(res.viewPngs.empty.split(',')[1], 'base64') }); await q.waitForTimeout(200);
  await q.click('#vwGo'); await q.waitForTimeout(1200);
  ok('пустая картинка: ошибка «не вижу персонажа», окно не закрылось, кнопка снова доступна', await q.evaluate(() => /Не вижу персонажа/.test(document.getElementById('vwErr').textContent) && !!document.querySelector('.vw-slots') && !document.getElementById('vwGo').disabled));
  await q.setInputFiles('input[data-k="front"]', { name: 'front.png', mimeType: 'image/png', buffer: png('front') });
  await q.setInputFiles('input[data-k="back"]', { name: 'back.png', mimeType: 'image/png', buffer: png('back') }); await q.waitForTimeout(200);
  await q.click('[data-f="left"]');
  await q.click('#vwGo'); await q.waitForTimeout(2600);
  const fin = await q.evaluate(() => ({ dlg: !!document.querySelector('.vw-slots'), mode: document.getElementById('fgvMode').textContent, info: UI.g3 && UI.g3.info().mode, swing: UI.g3 && UI.g3.swing, tris: UI.g3 && UI.g3.info().tris }));
  ok('после «Построить» окно закрыто, подпись «Объём по трём видам», полный оборот', !fin.dlg && /Объём по трём видам/.test(fin.mode) && fin.info === 'views' && fin.swing === false && fin.tris > 3000, fin);
  const stage = await q.$('#fgvStage'), bb = await stage.boundingBox();
  await q.screenshot({ path: path.join(SHOTS, 'hull-viewer.png'), clip: bb });
  await q.click('.fgv-ctl [data-v="side"]'); await q.waitForTimeout(900);
  await q.screenshot({ path: path.join(SHOTS, 'hull-viewer-side.png'), clip: bb });
  ok('нет ошибок страницы (окно «Виды…»)', d2.errors.length === 0, d2.errors);
  await d2.browser.close();
  console.log(`\n${pass} прошло, ${fail} упало`); process.exit(fail ? 1 : 0);
})();
