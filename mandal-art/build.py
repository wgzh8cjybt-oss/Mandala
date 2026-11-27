#!/usr/bin/env python3
"""Собирает src/* в один самодостаточный HTML: dist/mandal-art.html"""
import glob, os, re, sys

root = os.path.dirname(os.path.abspath(__file__))
def rd(p):
    with open(os.path.join(root, p), encoding='utf-8') as f:
        return f.read()

PUBLIC = '--public' in sys.argv   # публичная сборка: без картинок, у которых права не подтверждены (rights != own/licensed)
sys.path.insert(0, os.path.join(root, 'src'))
import importlib
from urllib.parse import quote
icons = importlib.import_module('icons')

def uri(svg):
    return 'url("data:image/svg+xml,' + quote(svg, safe=" /:;=,.'()-_") + '")'

def icon_css():
    # рисунок иконки лежит в переменной --m (data-URI SVG); неизвестный ключ -> прозрачная маска (ничего не рисуется)
    out = ['.ic{display:inline-block;width:1.18em;height:1.18em;background-color:currentColor;-webkit-mask-image:var(--m,linear-gradient(#0000,#0000));mask-image:var(--m,linear-gradient(#0000,#0000));-webkit-mask-repeat:no-repeat;mask-repeat:no-repeat;-webkit-mask-position:center;mask-position:center;-webkit-mask-size:contain;mask-size:contain;vertical-align:-.24em;flex:0 0 auto}']
    for fam in ('wh', 'op', 'sc'):
        for key in icons.ALL_KEYS:
            out.append(f'body.fam-{fam} .ic[data-i="{key}"]{{--m:{uri(icons.icon_svg(fam, key))}}}')
        out.append(f'body.fam-{fam} .cell.done::before{{--m:{uri(icons.icon_svg(fam, "star"))}}}')
    return '\n'.join(out)

css = rd('src/styles1.css') + '\n' + rd('src/styles2.css')
def _style_no(path):
    m = re.search(r'styles(\d+)\.css$', path)
    return int(m.group(1)) if m else 0
for extra in sorted((os.path.relpath(x, root) for x in glob.glob(os.path.join(root, 'src/styles*.css'))), key=_style_no):
    if _style_no(extra) < 3:
        continue
    if os.path.exists(os.path.join(root, extra)):
        css += '\n' + rd(extra)
css += '\n' + icon_css()

# Спрайты летающих декораций: assets/floaters/<ключ>.webp -> CSS-класс .sk-img.<ключ> (один раз в таблице стилей)
import base64, json
floaters = {}
for fp in sorted(glob.glob(os.path.join(root, 'assets/floaters/*.webp'))):
    key = os.path.splitext(os.path.basename(fp))[0]
    with open(fp, 'rb') as fh:
        css += f'\n.skull .sk-img.{key}{{background-image:url("data:image/webp;base64,' + base64.b64encode(fh.read()).decode() + '")}'
    floaters[key] = True
# Слои техножрецов: assets/priests/<жрец>_<слой>.webp -> .pr-img.<ключ>; раскладка слоёв — assets/priests/layout.json (tools/pack_priests.py)
priest_layout = {}
for fp in sorted(glob.glob(os.path.join(root, 'assets/priests/*.webp'))):
    key = os.path.splitext(os.path.basename(fp))[0]
    with open(fp, 'rb') as fh:
        css += f'\n.pr-img.{key}{{background-image:url("data:image/webp;base64,' + base64.b64encode(fh.read()).decode() + '")}'
lp = os.path.join(root, 'assets/priests/layout.json')
if os.path.exists(lp):
    with open(lp, encoding='utf-8') as fh:
        priest_layout = json.load(fh)
# Фигурки-стенды: описания assets/figures.json + спрайты assets/figures_web/<id>.webp (tools/pack_figures.py).
# Каждый спрайт кладётся в стили ОДИН раз как .fgd.<id>{--fg:url(...)}; плитка, стенд и срезы толщины берут его через var(--fg).
figure_defs = []
figure_depth = {}   # id -> карта глубины (data-URI) для «объёма из картинки» (tools/atelier/depth.py)
figure_glb = {}     # id -> готовая 3D-модель GLB (assets/models/<id>.glb), если лежит файл
figure_views = {}   # id -> три картинки для «объёма по трём видам»: assets/views/<id>/{front,side,back}.webp|png (+ views.json: {"faces":"left"|"right"})
fp_json = os.path.join(root, 'assets/figures.json')
fp_meta = os.path.join(root, 'assets/figures_web/meta.json')
if os.path.exists(fp_json) and os.path.exists(fp_meta):
    with open(fp_meta, encoding='utf-8') as fh:
        fmeta = json.load(fh)
    with open(fp_json, encoding='utf-8') as fh:
        for d in json.load(fh):
            fid = d['id']
            if PUBLIC and d.get('rights') not in ('own', 'licensed'):
                continue
            sp = os.path.join(root, 'assets/figures_web', fid + '.webp')
            if not os.path.exists(sp) or fid not in fmeta:
                print('ПРЕДУПРЕЖДЕНИЕ: нет спрайта для фигурки', fid); continue
            with open(sp, 'rb') as fh2:
                css += f'\n.fgd.{fid}{{--fg:url("data:image/webp;base64,' + base64.b64encode(fh2.read()).decode() + '")}'
            d['w'] = fmeta[fid]['w']; d['h'] = fmeta[fid]['h']
            dp = os.path.join(root, 'assets/figures_web', fid + '.depth.webp')
            if os.path.exists(dp):
                with open(dp, 'rb') as fh3:
                    figure_depth[fid] = 'data:image/webp;base64,' + base64.b64encode(fh3.read()).decode()
            gp = os.path.join(root, 'assets/models', fid + '.glb')
            if os.path.exists(gp):
                with open(gp, 'rb') as fh4:
                    figure_glb[fid] = 'data:model/gltf-binary;base64,' + base64.b64encode(fh4.read()).decode()
            vd = os.path.join(root, 'assets/views', fid)
            if os.path.isdir(vd):
                vv = {}
                for nm in ('front', 'side', 'back'):
                    for ext, mime in (('webp', 'image/webp'), ('png', 'image/png')):
                        vp = os.path.join(vd, nm + '.' + ext)
                        if os.path.exists(vp):
                            with open(vp, 'rb') as fh5:
                                vv[nm] = f'data:{mime};base64,' + base64.b64encode(fh5.read()).decode()
                            break
                if 'front' in vv and 'side' in vv:      # спереди и сбоку обязательны; спина без картинки достраивается
                    vj = os.path.join(vd, 'views.json')
                    vv['faces'] = json.load(open(vj, encoding='utf-8')).get('faces', 'left') if os.path.exists(vj) else 'left'
                    figure_views[fid] = vv
                else:
                    print('ПРЕДУПРЕЖДЕНИЕ: для', fid, 'в assets/views нужны минимум front и side')
            figure_defs.append(d)
js_files = sorted(glob.glob(os.path.join(root, 'src/js/*.js')))
js = '\n'.join(open(p, encoding='utf-8').read() for p in js_files)

# Свои картинки реликвий: assets/relics/<id>.webp|png|jpg -> data-URI (один самодостаточный файл).
# Нет файла -> реликвия рисуется встроенной SVG-эмблемой. Заменить картинку = положить файл и пересобрать.
relic_imgs = {}
for fp in sorted(glob.glob(os.path.join(root, 'assets/relics/*'))):
    ext = os.path.splitext(fp)[1].lower().lstrip('.')
    mime = {'webp': 'image/webp', 'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg'}.get(ext)
    if mime:
        with open(fp, 'rb') as fh:
            relic_imgs[os.path.splitext(os.path.basename(fp))[0]] = f'data:{mime};base64,' + base64.b64encode(fh.read()).decode()
js = 'const FIGURE_DEFS = ' + json.dumps(figure_defs, ensure_ascii=False, separators=(',', ':')) + ';\nconst FIGURE_DEPTH = ' + json.dumps(figure_depth) + ';\nconst FIGURE_GLB = ' + json.dumps(figure_glb) + ';\nconst FIGURE_VIEWS = ' + json.dumps(figure_views) + ';\nconst BUILTIN_RELIC_IMAGES = ' + json.dumps(relic_imgs) + ';\nconst BUILTIN_FLOATERS = ' + json.dumps(floaters) + ';\nconst PRIEST_LAYOUT = ' + json.dumps(priest_layout, separators=(',', ':')) + ';\n' + js
body = rd('src/body.html')

# Бандл Three.js (tools/build_three.sh): кладём как текст, а не как скрипт — он исполняется лениво, при первом открытии 3D-фигурки.
m3d = ''
bp = os.path.join(root, 'build/three.bundle.js')
if os.path.exists(bp):
    m3d = open(bp, encoding='utf-8').read().replace('</script', '<\\/script')
else:
    print('ПРЕДУПРЕЖДЕНИЕ: нет build/three.bundle.js — 3D-просмотр будет выключен (останется CSS-стенд). Соберите: bash tools/build_three.sh')

if '</script' in js.lower():
    sys.exit('ОШИБКА: в JS встречается "</script" — сломает встраивание')

html = f"""<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#05070a">
<meta name="format-detection" content="telephone=no">
<meta name="color-scheme" content="dark">
<title>Mandal-Art · WH40K Grimdark</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
{css}
</style>
</head>
<body class="theme-wh40k fam-wh">
{body}
<script>
{js}
</script>
{('<script type="text/plain" id="m3d-src">' + m3d + '</script>') if m3d else ''}
</body>
</html>
"""
os.makedirs(os.path.join(root, 'dist'), exist_ok=True)
out = os.path.join(root, 'dist/mandal-art-public.html' if PUBLIC else 'dist/mandal-art.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print('OK', out, len(html.encode('utf-8')), 'bytes;', len(js_files), 'js files;', len(relic_imgs), 'relic images;', len(floaters), 'floater sprites;', len(figure_defs), 'figures;', len(figure_depth), 'depth maps;', len(figure_glb), 'glb;', 'three', len(m3d) // 1024, 'KB', '(public)' if PUBLIC else '')
