// Снимки оригинальных 3D-моделей (Fig3DProcs) для плиток коллекции: dist/mandal-art.html -> assets/figures/<id>.webp (потом tools/pack_figures.py).
// Запуск: node tools/render_thumbs.cjs   (сначала python3 build.py; нужен Playwright)
const { launch } = require('../tests/lib.cjs');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const KINDS = [['art_coins', 'coins', '#fbbf24', -.5], ['art_helm', 'helm', '#38bdf8', -.45], ['art_crystal', 'crystal', '#a78bfa', -.3]];
(async () => {
  const h = await launch({ dsf: 1 });
  await h.page.goto('http://localhost:8765/mandal-art.html'); await h.page.waitForTimeout(600);
  for (const [id, kind, glow, ang] of KINDS) {
    const url = await h.page.evaluate(([k, g, a]) => Fig3D.snapshot(k, g, 1040, a), [kind, glow, ang]);
    const png = path.join(ROOT, 'assets/src_art', id + '_render.png');
    fs.writeFileSync(png, Buffer.from(url.split(',')[1], 'base64'));
    // обрезка по альфе с небольшим полем -> полная вырезка для pack_figures.py
    execFileSync('python3', ['-I', '-c', `
from PIL import Image
im = Image.open(${JSON.stringify(png)}).convert('RGBA'); b = im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
p = int(im.height * .02); b = (max(0, b[0] - p), max(0, b[1] - p), min(im.width, b[2] + p), min(im.height, b[3] + p))
im.crop(b).save(${JSON.stringify(path.join(ROOT, 'assets/figures', id + '.webp'))}, 'WEBP', lossless=True, method=4)
print(${JSON.stringify(id)}, im.crop(b).size)`], { stdio: 'inherit' });
  }
  console.log(JSON.stringify(h.errors)); await h.browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
