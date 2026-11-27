// Снимки и проверки трёх семейств тем: Warhammer (wh40k), One Piece (onepiece), Scrooge (scrooge)
const { launch, URL } = require('./lib.cjs');
const fs = require('fs');
const OUT = __dirname + '/shots/';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra !== undefined ? JSON.stringify(extra) : ''); } };
(async () => {
  const { browser, page, errors } = await launch({ dsf: 1 });
  await page.goto(URL); await page.waitForTimeout(700);
  await page.click('.modal [data-r="1"]');
  // наполняем данные для наглядных снимков
  await page.evaluate(() => {
    const m = activeMandala();
    applyCell(m, 40, 'Стать сильнее', true);
    [30, 31, 32, 39, 41, 48, 49, 50].forEach((i, n) => applyCell(m, i, ['Здоровье', 'Деньги', 'Семья', 'Знания', 'Карьера', 'Отдых', 'Друзья', 'Дух'][n], n < 5));
    [0, 1, 2, 3, 4, 9, 10, 11, 12, 13, 14, 18, 19, 20].forEach((i, n) => applyCell(m, i, 'Задача ' + i, n % 3 !== 0));
    addDiary('Первая запись для проверки оформления темы.'); addDiary('Вторая запись.');
    S.unlockedThemes = THEMES.map(t => t.id);
    S.unlockedRelics = ['wh_1', 'wh_2', 'op_1', 'sc_1'];
    S.xp = Math.max(S.xp, 1200); S.flames = 42; S.settings.fx = 'full'; S.settings.skulls = true;
    checkAchievements(true); save(); FX.apply(); scheduleRender();
  });
  await page.waitForTimeout(500);
  // дожидаемся, пока отыграют очереди повышений ранга (иначе оверлей закрывает экран на снимках)
  for (let i = 0; i < 14; i++) {
    const busy = await page.evaluate(() => lvQueue.length > 0 || !!document.querySelector('.levelup'));
    if (!busy) break;
    await page.evaluate(() => { const e = document.querySelector('.levelup'); if (e) e.click(); });
    await page.waitForTimeout(750);
  }
  await page.evaluate(() => { $('#toasts').innerHTML = ''; });
  const FAMS_T = [['wh40k', 'wh'], ['onepiece', 'op'], ['scrooge', 'sc']];
  for (const [id, fam] of FAMS_T) {
    await page.evaluate(id => { switchTab('mandala'); setTheme(id); }, id);
    await page.waitForTimeout(600);
    const shot = async (name, keepToasts) => { await page.waitForTimeout(250); if (!keepToasts) await page.evaluate(() => { $('#toasts').innerHTML = ''; }); await page.screenshot({ path: OUT + `th-${id}-${name}.png` }); };
    const info = await page.evaluate(() => ({
      cls: document.body.className, nav: $$('#nav .lb').map(e => e.textContent),
      floaters: $$('.skull').map(e => e.className), diaryTitle: $('#diaryTitle').textContent, rank: $('#rankLine').textContent
    }));
    ok(`${id}: body has fam-${fam}`, info.cls.includes('fam-' + fam), info.cls);
    ok(`${id}: floaters are ${fam}`, info.floaters.length > 0 && info.floaters.every(c => c.includes(' ' + fam)), info.floaters);
    await shot('1-mandala');
    await page.evaluate(() => switchTab('diary')); await shot('2-diary');
    await page.evaluate(() => switchTab('relics')); await shot('3-relics-top');
    await page.evaluate(() => { $('#relicsScroll').scrollTop = 99999; }); await shot('4-relics-bottom');
    await page.evaluate(() => switchTab('hq')); await shot('5-hq-top');
    await page.evaluate(() => { $('#hqScroll').scrollTop = 99999; }); await shot('6-hq-bottom');
    await page.evaluate(() => { switchTab('mandala'); openStore(); }); await shot('7-store');
    await page.evaluate(() => { Modal.closeTop(); const r = RELICS.find(x => x.id === ({ wh40k: 'wh_2', onepiece: 'op_1', scrooge: 'sc_1' })[S.activeTheme]); openReveal(r, true); }); await page.waitForTimeout(900); await shot('8-reveal');
    await page.evaluate(() => { Modal.closeTop(); showLevelUp(4, rankName(3), 3); }); await page.waitForTimeout(1300); await shot('9-levelup');
    await page.waitForTimeout(3600);
    await page.evaluate(() => { toast('{ic:gear} ' + T('blockDone') + ' +30 XP, +2 {ic:flame}'); setMode('block', 4); }); await shot('10-block-toast', true);
    await page.evaluate(() => setMode('all'));
    // все иконки должны получить рисунок маски (иначе ключ неизвестен и иконка невидима)
    const ic = await page.evaluate(() => { const all = $$('.ic'); const bad = all.filter(e => { const m = getComputedStyle(e).webkitMaskImage || getComputedStyle(e).maskImage; return !m || m.indexOf('data:image/svg+xml') < 0; }).map(e => e.dataset.i); return { n: all.length, bad }; });
    ok(`${id}: all ${ic.n} .ic elements have a mask image`, ic.n > 10 && ic.bad.length === 0, ic.bad);
    const noEmoji = await page.evaluate(() => { const re = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u; return document.body.innerText.split('\n').filter(l => re.test(l)).slice(0, 5); });
    ok(`${id}: no emoji in visible text`, noEmoji.length === 0, noEmoji);
    console.log(id, JSON.stringify({ nav: info.nav, diary: info.diaryTitle, rank: info.rank }));
  }
  // «лёгкий» режим не должен ломать смену семейства
  await page.evaluate(() => { S.settings.fx = 'lite'; FX.apply(); setTheme('wh40k'); });
  await page.waitForTimeout(300);
  ok('lite mode keeps floaters of current family', await page.evaluate(() => Scene.info().skulls > 0 && $$('.skull').every(e => e.className.includes(' wh'))));
  ok('no console errors', errors.length === 0, errors);
  console.log(`RESULT pass=${pass} fail=${fail}`); console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
  // склейки
  const { execSync } = require('child_process');
  execSync(`python3 - <<'PY'
from PIL import Image
import os
d='${OUT}'
for tid in ['wh40k','onepiece','scrooge']:
    for tag, names in (('A',['1-mandala','2-diary','3-relics-top','4-relics-bottom']),('B',['5-hq-top','6-hq-bottom','7-store','8-reveal']),('C',['9-levelup','10-block-toast'])):
        ims=[Image.open(f'{d}th-{tid}-{n}.png') for n in names]
        w=sum(i.width for i in ims); h=max(i.height for i in ims)
        s=Image.new('RGB',(w,h),'#000'); x=0
        for i in ims: s.paste(i,(x,0)); x+=i.width
        s.save(f'{d}strip-{tid}-{tag}.png')
print('strips ok')
PY`, { stdio: 'inherit' });
})();
