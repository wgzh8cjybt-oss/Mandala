// 3D-просмотр фигурок (Three.js): объём из картинки, оригинальные модели, GLB, запасной режим, потеря контекста.
// Скорость на настоящем телефоне здесь не проверить: Chromium в песочнице рисует программно (SwiftShader), без видеокарты.
const { launch, URL: APP } = require('./lib.cjs');
const { execFileSync, execSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };

/** доля «не фоновых» пикселей и среднее различие двух снимков — считаем в Python (Pillow) */
const PY = `
import sys, io, json
from PIL import Image
a = Image.open(io.BytesIO(open(sys.argv[1], 'rb').read())).convert('RGB')
def frac(im):
    w, h = im.size; px = im.load(); bg = px[2, 2]; n = t = 0
    for y in range(0, h, 3):
        for x in range(0, w, 3):
            r, g, b = px[x, y]; t += 1
            if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > 60: n += 1
    return n / t
out = {'frac': frac(a)}
if len(sys.argv) > 2:
    b = Image.open(io.BytesIO(open(sys.argv[2], 'rb').read())).convert('RGB').resize(a.size)
    sa = a.resize((64, 64)); sb = b.resize((64, 64)); pa = list(sa.getdata()); pb = list(sb.getdata())
    out['diff'] = sum(abs(x[0] - y[0]) + abs(x[1] - y[1]) + abs(x[2] - y[2]) for x, y in zip(pa, pb)) / len(pa) / 3
print(json.dumps(out))`;
const fs = require('fs'), os = require('os'), path = require('path');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'three-'));
const stats = (a, b) => { const fa = path.join(TMP, 'a.png'); fs.writeFileSync(fa, a); const args = ['-I', '-c', PY, fa]; if (b) { const fb = path.join(TMP, 'b.png'); fs.writeFileSync(fb, b); args.push(fb); } return JSON.parse(execFileSync('python3', args).toString()); };

/** минимальный GLB: куб из 12 треугольников, зелёный материал, без нормалей (загрузчик сделает плоское затенение) */
function makeGLB() {
  const pos = new Float32Array([-.5, -.5, -.5, .5, -.5, -.5, .5, .5, -.5, -.5, .5, -.5, -.5, -.5, .5, .5, -.5, .5, .5, .5, .5, -.5, .5, .5]);
  const idx = new Uint16Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 3, 0, 4, 3, 4, 7]);
  const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)]);
  const j = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [.2, .8, .4, 1], metallicFactor: 0, roughnessFactor: .6 } }], buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: pos.byteLength, target: 34962 }, { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength, target: 34963 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-.5, -.5, -.5], max: [.5, .5, .5] }, { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' }] };
  let js = Buffer.from(JSON.stringify(j)); while (js.length % 4) js = Buffer.concat([js, Buffer.from(' ')]);
  let bn = bin; while (bn.length % 4) bn = Buffer.concat([bn, Buffer.from([0])]);
  const total = 12 + 8 + js.length + 8 + bn.length, h = Buffer.alloc(12); h.write('glTF', 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(total, 8);
  const c1 = Buffer.alloc(8); c1.writeUInt32LE(js.length, 0); c1.writeUInt32LE(0x4E4F534A, 4);
  const c2 = Buffer.alloc(8); c2.writeUInt32LE(bn.length, 0); c2.writeUInt32LE(0x004E4942, 4);
  return Buffer.concat([h, c1, js, c2, bn]);
}

const START = { v: 2, xp: 900, flames: 3 };
const dev = async (extra) => {
  const h = await launch(Object.assign({ dsf: 1, storage: { mandal_art_v14: JSON.stringify(START) } }, extra || {}));
  await h.page.goto(APP); await h.page.waitForTimeout(700);
  const w = await h.page.$('.modal [data-r="1"]'); if (w) await w.click();
  await h.page.evaluate(() => { S.unlockedFigs = FIGURES.map(f => f.id); });
  return h;
};
const openFig = async (p, id, wait) => {
  await p.click('#nav [data-tab="relics"]'); await p.waitForTimeout(150);
  await p.click('[data-act="hall"][data-v="figs"]'); await p.waitForTimeout(150);
  await p.click('.fig[data-id="' + id + '"]'); await p.waitForSelector('.fgv'); await p.waitForTimeout(wait || 2200);
};
const closeFig = async p => { await p.click('.fgv-x'); await p.waitForTimeout(250); };
const shot = async p => { const b = await (await p.$('#fgvStage')).boundingBox(); return p.screenshot({ clip: b }); };

(async () => {
  /* ---------- 1. объём из картинки ---------- */
  let d = await dev(); let p = d.page;
  ok('WebGL is available in the test browser and the Three.js bundle is embedded', await p.evaluate(() => Fig3D.supported() && !!document.getElementById('m3d-src')));
  ok('before the first viewer the library is not executed (lazy): window.M3D is undefined', await p.evaluate(() => typeof window.M3D === 'undefined'));
  const t0 = Date.now();
  await openFig(p, 'wh_trooper', 1800);
  const v = await p.evaluate(() => { const g = document.querySelector('.fgv-gl'); return { cls: document.querySelector('.fgv').className, gl: !!g, w: g && g.clientWidth, h: g && g.clientHeight, mode: document.querySelector('#fgvMode').textContent, cam: getComputedStyle(document.querySelector('.fgv-cam')).display, info: UI.g3 && UI.g3.info(), lib: typeof window.M3D }; });
  console.log('   открытие целиком (программный рендер, не телефон): ~' + (Date.now() - t0) + ' мс; построение модели в JS: ' + await p.evaluate(() => UI.g3 && UI.g3.info().buildMs) + ' мс');
  ok('volume: viewer switches to 3D (class g3, canvas, CSS stand hidden)', /\bg3\b/.test(v.cls) && v.gl && v.w > 150 && v.h > 200 && v.cam === 'none' && v.lib === 'object', v);
  ok('volume: honest label says "Объём из картинки" and that it is not a scan', /Объём из картинки/.test(v.mode) && /Не скан/.test(v.mode), v.mode);
  ok('volume: a real mesh is drawn (thousands of triangles, 1+ textures)', v.info && v.info.mode === 'volume' && v.info.tris > 3000 && v.info.tex >= 2, v.info);
  const a1 = await shot(p), s1 = stats(a1);
  ok('volume: the canvas is not blank (figure covers a visible part of the stage)', s1.frac > .06, s1);
  await p.click('[data-v="auto"]'); await p.waitForTimeout(100);
  await p.click('[data-v="side"]'); await p.waitForTimeout(1100);
  const a2 = await shot(p), s2 = stats(a2, a1);
  ok('"Сбоку" really turns the 3D model (the picture changes)', s2.diff > 2.5, s2);
  await p.click('[data-v="back"]'); await p.waitForTimeout(1100);
  const a3 = await shot(p), s3 = stats(a3, a1);
  ok('"Сзади" shows the invented back side (a different picture, still not blank)', s3.diff > 2.5 && s3.frac > .05, s3);
  await p.click('[data-v="front"]'); await p.waitForTimeout(1100);
  const z0 = await p.evaluate(() => UI.g3.info().zoom);
  const box = await (await p.$('#fgvStage')).boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await p.mouse.wheel(0, -500); await p.waitForTimeout(250);
  const z1 = await p.evaluate(() => UI.g3.info().zoom);
  ok('mouse wheel zooms in', z1 > z0 * 1.3, { z0, z1 });
  await p.evaluate(() => { const st = document.querySelector('#fgvStage'), ev = (t, id, x, y) => st.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch', isPrimary: id === 1 })); window.__pv = ev; ev('pointerdown', 1, 150, 300); ev('pointerdown', 2, 230, 300); ev('pointermove', 2, 330, 300); });
  const z2 = await p.evaluate(() => UI.g3.info().zoom);
  ok('two-finger pinch changes the zoom and the drag-rotation is suspended', await p.evaluate(() => UI.g3.pinching === true) && z2 > z1 * 1.1, { z1, z2 });
  await p.evaluate(() => { __pv('pointerup', 2, 330, 300); __pv('pointerup', 1, 150, 300); });
  ok('after the fingers lift the pinch state is cleared', await p.evaluate(() => UI.g3.pinching === false));
  ok('3D hint tells about rotate and zoom', await p.evaluate(() => /приблизить/.test(document.querySelector('.fgv-hint').textContent)));
  await closeFig(p);
  ok('close disposes the 3D scene (UI.g3 is empty, viewer flag freed, canvas removed)', await p.evaluate(() => UI.g3 === null && UI.fgv === false && !document.querySelector('.fgv-gl')));

  /* ---------- 2. заблокированная фигурка и все вселенные ---------- */
  await p.evaluate(() => { S.unlockedFigs = []; });
  await openFig(p, 'wh_golden', 1800);
  const lk = await p.evaluate(() => ({ locked: document.querySelector('.fgv').classList.contains('locked'), g3: document.querySelector('.fgv').classList.contains('g3'), mode: document.querySelector('#fgvMode').textContent }));
  ok('locked figure: preview stays 3D but is dimmed and marked as a preview', lk.locked && lk.g3 && /Объём из картинки/.test(lk.mode), lk);
  await closeFig(p);
  await p.evaluate(() => { S.unlockedFigs = FIGURES.map(f => f.id); });
  const ids = ['wh_skull', 'op_captain', 'sc_scrooge', 'sc_daisy'];
  for (const id of ids) {
    await openFig(p, id, 1500);
    const r = await p.evaluate(() => ({ g3: document.querySelector('.fgv').classList.contains('g3'), tris: UI.g3 && UI.g3.info().tris }));
    const st = stats(await shot(p));
    ok('figure ' + id + ' builds a 3D volume and draws it', r.g3 && r.tris > 3000 && st.frac > .05, { r, st });
    await closeFig(p);
  }

  /* ---------- 3. оригинальные модели ---------- */
  for (const [id, re] of [['art_coins', /Оригинальная 3D-модель/], ['art_helm', /Оригинальная 3D-модель/], ['art_crystal', /Оригинальная 3D-модель/]]) {
    await openFig(p, id, 1500);
    const r = await p.evaluate(() => ({ mode: document.querySelector('#fgvMode').textContent, info: UI.g3 && UI.g3.info() }));
    const st = stats(await shot(p));
    ok('original model ' + id + ': labelled "Оригинальная 3D-модель", many triangles, visible', re.test(r.mode) && r.info && r.info.mode === 'proc' && r.info.tris > (id === 'art_crystal' ? 300 : 1500) && st.frac > .05, { r, st });
    await closeFig(p);
  }
  await openFig(p, 'art_helm', 1200);
  const h1 = await shot(p); await p.waitForTimeout(900); const h2 = await shot(p);
  ok('original model moves by itself (the wheel turns / floating parts animate)', stats(h2, h1).diff > .15, stats(h2, h1));

  /* ---------- 4. свой GLB ---------- */
  ok('GLB button is shown in the 3D viewer', await p.evaluate(() => !!document.querySelector('.fgv-ctl .glb') && !!document.querySelector('#fgvGlb')));
  const before = await shot(p);
  await p.setInputFiles('#fgvGlb', { name: 'cube.glb', mimeType: 'model/gltf-binary', buffer: makeGLB() }); await p.waitForTimeout(900);
  const g = await p.evaluate(() => ({ mode: document.querySelector('#fgvMode').textContent, info: UI.g3.info() }));
  const after = await shot(p);
  ok('opening a .glb file replaces the model and labels it "3D-модель GLB"', g.info.mode === 'glb' && /GLB/.test(g.mode) && /cube\.glb/.test(g.mode) && stats(after, before).diff > 3, { g, d: stats(after, before) });
  ok('GLB view is not blank', stats(after).frac > .03);
  await p.setInputFiles('#fgvGlb', { name: 'broken.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from('это не модель') }); await p.waitForTimeout(700);
  ok('a broken .glb is refused with a message, the viewer keeps working', await p.evaluate(() => UI.g3 && UI.g3.info().mode === 'glb' && /Не удалось открыть GLB/.test(document.body.textContent)));
  await closeFig(p);

  /* ---------- 5. потеря контекста WebGL и выключенные эффекты ---------- */
  await openFig(p, 'wh_trooper', 1500);
  await p.evaluate(() => { const c = document.querySelector('.fgv-gl'); const gl = c.getContext('webgl2') || c.getContext('webgl'); gl.getExtension('WEBGL_lose_context').loseContext(); });
  await p.waitForTimeout(700);
  const lost = await p.evaluate(() => ({ cls: document.querySelector('.fgv').className, mode: document.querySelector('#fgvMode').textContent, faces: document.querySelectorAll('.fgv-face').length, gl: !!document.querySelector('.fgv-gl'), g3: UI.g3 }));
  ok('lost WebGL context: viewer falls back to the CSS stand with an honest label', /g3f/.test(lost.cls) && /Акриловый стенд/.test(lost.mode) && lost.faces === 2 && !lost.gl && lost.g3 === null, lost);
  await closeFig(p);
  const errs = d.errors.filter(e => !/404|Failed to load resource|WebGL|GPU stall|context/i.test(e));
  ok('no page errors in the 3D flows', errs.length === 0, errs);
  await p.close(); await d.browser.close();

  d = await dev({ storage: { mandal_art_v14: JSON.stringify(Object.assign({}, START, { settings: { fx: 'off' } })) } }); p = d.page;
  await openFig(p, 'wh_trooper', 700);
  ok('effects "off": 3D is not started, the light CSS stand is used (no canvas, no Three.js executed)', await p.evaluate(() => !document.querySelector('.fgv-gl') && typeof window.M3D === 'undefined' && /Акриловый стенд/.test(document.querySelector('#fgvMode').textContent)));
  await p.close(); await d.browser.close();

  /* ---------- 6. устройство без WebGL ---------- */
  d = await dev({ init: () => { const o = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (t, ...r) { return /webgl/i.test(t) ? null : o.call(this, t, ...r); }; } }); p = d.page;
  await openFig(p, 'wh_trooper', 800);
  const nw = await p.evaluate(() => ({ sup: Fig3D.supported(), gl: !!document.querySelector('.fgv-gl'), faces: document.querySelectorAll('.fgv-face').length, mode: document.querySelector('#fgvMode').textContent }));
  ok('no WebGL on the device: CSS stand with an honest label, no errors', !nw.sup && !nw.gl && nw.faces === 2 && /Акриловый стенд/.test(nw.mode) && d.errors.length === 0, { nw, e: d.errors });
  await closeFig(p);
  await openFig(p, 'art_helm', 800);
  ok('no WebGL: an original model still opens (as its thumbnail on the CSS stand)', await p.evaluate(() => !!document.querySelector('.fgv') && !document.querySelector('.fgv-gl')));
  await p.close(); await d.browser.close();

  /* ---------- 7. публичная сборка: оригинальные модели работают, чужих картинок и карт глубины нет ---------- */
  execSync('python3 build.py --public', { cwd: __dirname + '/..' });
  const hh = await launch({ dsf: 1 }); await hh.page.goto(APP.replace('mandal-art.html', 'mandal-art-public.html')); await hh.page.waitForTimeout(700);
  const w2 = await hh.page.$('.modal [data-r="1"]'); if (w2) await w2.click();
  await hh.page.evaluate(() => { S.unlockedFigs = FIGURES.map(f => f.id); });
  await openFig(hh.page, 'art_coins', 1600);
  const pub = await hh.page.evaluate(() => ({ g3: document.querySelector('.fgv').classList.contains('g3'), n: FIGURES.length, depth: Object.keys(FIGURE_DEPTH).length, glb: Object.keys(FIGURE_GLB).length }));
  ok('public build: the original 3D artifact opens in 3D; no depth maps of franchise figures', pub.g3 && pub.n === 3 && pub.depth === 0, pub);
  ok('public build has no page errors', hh.errors.filter(e => !/404|Failed to load resource/.test(e)).length === 0, hh.errors);
  await hh.browser.close();
  execSync('rm -f dist/mandal-art-public.html', { cwd: __dirname + '/..' });

  console.log('\nthree: ' + pass + ' pass, ' + fail + ' fail');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
