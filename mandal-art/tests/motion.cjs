// Плавность полёта: останавливается ли череп, насколько резко меняется скорость. Сравнение со старой сборкой: node tests/motion.cjs [имя-файла-в-dist]
const { launch } = require('./lib.cjs');
const FILE = process.argv[2] || 'mandal-art.html';
const URLX = 'http://localhost:8765/' + FILE;
(async () => {
  const { browser, page, errors } = await launch({ dsf: 1 });
  await page.goto(URLX); await page.waitForTimeout(700);
  await page.click('.modal [data-r="1"]');
  await page.evaluate(th => { S.unlockedThemes = THEMES.map(t => t.id); if (th) setTheme(th); S.settings.fx = 'full'; S.settings.skulls = true; if ('scenes' in S.settings) S.settings.scenes = false; save(); FX.apply(); }, process.env.THEME || '');
  await page.waitForTimeout(400);
  const data = await page.evaluate(() => new Promise(res => {
    const els = $$('.skull'), rows = els.map(() => []), t0 = performance.now(); const N = 16000;
    const parse = el => { const m = /translate3d\(([-\d.]+)px,\s*([-\d.]+)px/.exec(el.style.transform); return m ? [+m[1] + el.offsetWidth / 2, +m[2] + el.offsetHeight / 2] : null; };
    (function f(now) { els.forEach((el, i) => { const p = parse(el); if (p) rows[i].push([now, p[0], p[1]]); }); if (now - t0 < N) requestAnimationFrame(f); else res(rows); })(t0);
  }));
  const pct = (a, q) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))]; };
  const out = data.map((r, i) => {
    // скорость по окнам ~0.2 с, чтобы не мерить шум от дробления кадров
    const w = [], dtw = .2; let j0 = 0;
    for (let j = 1; j < r.length; j++) { while (r[j][0] - r[j0][0] > dtw * 1000 && j0 < j - 1) j0++; const dt = (r[j][0] - r[j0][0]) / 1000; if (dt >= dtw * .7 && dt < .6) w.push({ t: r[j][0], v: Math.hypot(r[j][1] - r[j0][1], r[j][2] - r[j0][2]) / dt, a: Math.atan2(r[j][2] - r[j0][2], r[j][1] - r[j0][1]) }); }
    const v = w.map(x => x.v), med = pct(v, .5);
    const acc = [], turn = [];
    for (let j = 1; j < w.length; j++) { const dt = (w[j].t - w[j - 1].t) / 1000; if (dt <= 0 || dt > .1) continue; acc.push(Math.abs(w[j].v - w[j - 1].v) / dt); let da = w[j].a - w[j - 1].a; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI; turn.push(Math.abs(da) / dt); }
    return { skull: i, frames: r.length, fps: +(r.length / 16).toFixed(1), medSpeed: +med.toFixed(1), minSpeed: +pct(v, .02).toFixed(1), slowFrac: +(v.filter(x => x < med * .35).length / v.length).toFixed(3), acc95: +pct(acc, .95).toFixed(1), accMax: +pct(acc, .999).toFixed(1), turn95: +pct(turn, .95).toFixed(2) };
  });
  console.log(FILE, process.env.THEME || 'wh40k'); out.forEach(o => console.log(JSON.stringify(o)));
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})();
