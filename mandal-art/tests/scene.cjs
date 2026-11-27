// Сценка поломки сервочерепа: порядок стадий, чистота DOM после, ограничения (lite/off/движение/семейство/выключатель), прерывание, клики сквозь сценку.
// SHOTS=1 — дополнительно снимает кадры в tests/shots/sc-*.png
const { launch, URL } = require('./lib.cjs');
const OUT = __dirname + '/shots/';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } };
const info = page => page.evaluate(() => Scene.info());
async function fresh(opts) {
  const h = await launch({ dsf: 1, ...(opts || {}) });
  await h.page.goto(URL); await h.page.waitForTimeout(500); await h.page.click('.modal [data-r="1"]');
  await h.page.evaluate(() => { S.settings.fx = 'full'; S.settings.skulls = true; S.settings.scenes = true; S.unlockedThemes = THEMES.map(t => t.id); save(); FX.apply(); });
  await h.page.waitForTimeout(500);
  return h;
}
const waitState = (page, st, ms) => page.waitForFunction(s => Scene.info().scene === s, st, { timeout: ms || 20000 });
(async () => {
  /* ---- 1. ограничения: когда сценки быть не должно ---- */
  {
    const { browser, page, errors } = await fresh();
    ok('full + WH + skulls + scenes: scene is available', (await info(page)).canScene === true, await info(page));
    ok('initial cooldown is about a minute, not instant', (await info(page)).cool > 30, await info(page));
    for (const [name, setup] of [
      ['lite mode', () => { S.settings.fx = 'lite'; FX.apply(); }],
      ['effects off', () => { S.settings.fx = 'off'; FX.apply(); }],
      ['scenes switch off', () => { S.settings.fx = 'full'; S.settings.scenes = false; Scene.setScenes(false); FX.apply(); }],
      ['floaters switch off', () => { S.settings.scenes = true; S.settings.skulls = false; FX.apply(); }],
      ['One Piece family', () => { S.settings.skulls = true; setTheme('onepiece'); FX.apply(); }],
      ['Scrooge family', () => { setTheme('scrooge'); FX.apply(); }]
    ]) {
      await page.evaluate(setup); await page.waitForTimeout(250);
      const i = await info(page), started = await page.evaluate(() => Scene.malfunction());
      ok('no scene in: ' + name, i.canScene === false && started === false, { i, started });
    }
    await page.evaluate(() => { S.settings.fx = 'full'; S.settings.scenes = true; S.settings.skulls = true; setTheme('wh40k'); FX.apply(); }); await page.waitForTimeout(250);
    ok('scene available again after restoring settings', (await info(page)).canScene === true, await info(page));
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.evaluate(() => FX.apply()); await page.waitForTimeout(250);
    ok('no scene with prefers-reduced-motion even if fx=full', (await info(page)).canScene === false && !(await page.evaluate(() => Scene.malfunction())), await info(page));
    ok('no console errors (restrictions)', errors.length === 0, errors);
    await browser.close();
  }
  /* ---- 2. полный прогон ---- */
  {
    const { browser, page, errors } = await fresh();
    const vp = page.viewportSize();
    ok('manual start works', await page.evaluate(() => Scene.malfunction({ x: innerWidth / 2, y: 170 })));
    ok('second start is refused while a scene is running', !(await page.evaluate(() => Scene.malfunction())));
    const order = [], t0 = Date.now(); let prev = '', heroOut = 0, ptr = true, shots = 0, priestSeen = 0, weldSeen = 0, restY = null;
    while (Date.now() - t0 < 30000) {
      const i = await info(page);
      if (i.scene !== prev) { order.push(i.scene || 'end'); prev = i.scene; }
      const probe = await page.evaluate(() => {
        const h = $('#skullsFront .skull'), r = h.getBoundingClientRect();
        const pe = $$('#skullsFront .skull, .priest, .weld, #skullsFront').every(e => getComputedStyle(e).pointerEvents === 'none');
        const pr = $$('.priest').map(e => { const b = e.getBoundingClientRect(); return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)]; });
        const top = pr.length ? document.elementFromPoint(pr[0][0], pr[0][1]) : null;
        return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, pe, priests: pr.length, weld: $$('.weld').length, hit: top ? (top.closest('.priest') ? 'priest' : 'other') : 'none', nav: Math.round($('#nav').getBoundingClientRect().top) };
      });
      if (probe.cx < -80 || probe.cx > vp.width + 80 || probe.cy < -80 || probe.cy > vp.height + 40) heroOut++;
      if (!probe.pe) ptr = false;
      if (probe.priests) priestSeen = Math.max(priestSeen, probe.priests);
      if (probe.weld) weldSeen++;
      if (i.scene === 'lying' && restY === null) restY = { cy: probe.cy, nav: probe.nav };
      if (probe.priests && probe.hit === 'priest') ptr = false;     // элемент под точкой — не жрец => клики проходят насквозь
      if (process.env.SHOTS) { await page.screenshot({ path: OUT + 'sc-' + String(shots++).padStart(2, '0') + '.png', clip: { x: 0, y: 150, width: vp.width, height: vp.height - 150 } }); }
      if (!i.scene && order.length > 2) break;
      await page.waitForTimeout(120);
    }
    console.log('timeline', order.join(' > '), '| total', ((Date.now() - t0) / 1000).toFixed(1) + 's');
    ok('stages run in order', order.join('>') === 'glitch>fall>lying>in>repair>rise>leave>end', order);
    ok('two priests appeared', priestSeen === 2, priestSeen);
    ok('weld light shown during repair', weldSeen > 3, weldSeen);
    ok('everything is pointer-events:none and clicks pass through priests', ptr);
    ok('skull stays on screen during the whole scene', heroOut === 0, heroOut);
    ok('skull lies near the top of the nav (the "ground")', restY && Math.abs(restY.cy - (restY.nav - 22)) < 30, restY);
    const after = await page.evaluate(() => ({ priests: $$('.priest').length, weld: $$('.weld').length, cls: $('#skullsFront .skull').className, op: $('#skullsFront .skull').style.opacity, info: Scene.info() }));
    ok('after the scene: no priests, no weld light, no leftover state classes', after.priests === 0 && after.weld === 0 && !/sk-(glitch|sputter|fault|dmg|dead|boot)/.test(after.cls), after);
    ok('after the scene: opacity restored, cooldown 150..290 s', after.op === '0.7' && after.info.cool >= 148 && after.info.cool <= 291, after);
    ok('no console errors (full run)', errors.length === 0, errors);
    await browser.close();
  }
  /* ---- 3. прерывание ---- */
  for (const [name, stage, act] of [
    ['scenes switched off from settings', 'in', () => { S.settings.scenes = false; Scene.setScenes(false); }],
    ['family switched to One Piece', 'lying', () => { setTheme('onepiece'); }],
    ['effects changed to lite', 'fall', () => { S.settings.fx = 'lite'; FX.apply(); }],
    ['screen resized', 'lying', null]
  ]) {
    const { browser, page, errors } = await fresh();
    await page.evaluate(() => Scene.malfunction({ x: innerWidth / 2, y: 170 }));
    await waitState(page, stage, 15000);
    if (act) await page.evaluate(act); else await page.setViewportSize({ width: 360, height: 640 });
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => ({ priests: $$('.priest').length, weld: $$('.weld').length, info: Scene.info(), cls: ($('#skullsFront .skull') || { className: '' }).className }));
    ok('abort: ' + name + ' -> scene gone, DOM clean', r.info.scene === '' && r.priests === 0 && r.weld === 0 && !/sk-(glitch|sputter|fault|dmg|dead|boot)/.test(r.cls), r);
    ok('abort: ' + name + ' -> no console errors', errors.length === 0, errors);
    await browser.close();
  }
  /* ---- 4. автозапуск по таймеру ---- */
  {
    const { browser, page, errors } = await fresh();
    await page.evaluate(() => Scene.skipCooldown());
    let started = false; const t0 = Date.now();
    while (Date.now() - t0 < 70000) { if ((await info(page)).scene) { started = true; break; } await page.waitForTimeout(500); }
    ok('scene starts by itself once the cooldown is over (hero in the middle of the screen)', started, ((Date.now() - t0) / 1000).toFixed(1) + 's');
    ok('no console errors (auto start)', errors.length === 0, errors);
    await browser.close();
  }
  /* ---- 5. кнопка «Показать сценку сейчас» в Штабе — настоящий запуск ---- */
  {
    const { browser, page, errors } = await fresh();
    await page.evaluate(() => switchTab('hq')); await page.waitForTimeout(400);
    ok('settings has the scenes switch and the demo button (WH)', await page.evaluate(() => !!$('[data-act="tgl"][data-k="scenes"]') && !!$('[data-act="scene-demo"]')));
    if (process.env.SHOTS) { await page.evaluate(() => { const b = $('[data-act="scene-demo"]'); b.scrollIntoView({ block: 'center' }); }); await page.waitForTimeout(200); await page.screenshot({ path: OUT + 'hq-scene-btn.png' }); }
    await page.click('[data-act="scene-demo"]'); await page.waitForTimeout(400);
    ok('demo button really starts the scene', (await info(page)).scene !== '', await info(page));
    await page.click('[data-act="scene-demo"]'); await page.waitForTimeout(200);
    ok('pressing again during a scene does not start a second one', (await info(page)).priests <= 2 && (await info(page)).scene !== '', await info(page));
    await page.evaluate(() => { S.settings.fx = 'lite'; FX.apply(); renderHQ(); }); await page.waitForTimeout(300);
    await page.click('[data-act="scene-demo"]'); await page.waitForTimeout(300);
    ok('in lite mode the button explains why there is no scene (no fake success)', (await info(page)).scene === '' && await page.evaluate(() => /Полные/.test($('#toasts').textContent)), await page.evaluate(() => $('#toasts').textContent));
    await page.evaluate(() => { S.unlockedThemes = THEMES.map(t => t.id); setTheme('onepiece'); S.settings.fx = 'full'; FX.apply(); renderHQ(); }); await page.waitForTimeout(300);
    ok('no scene controls for One Piece theme', await page.evaluate(() => !$('[data-act="scene-demo"]') && !$('[data-k="scenes"]')));
    ok('no console errors (demo button)', errors.length === 0, errors);
    await browser.close();
  }
  console.log(`RESULT pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})();
