#!/usr/bin/env python3
"""Пакует техножрецов из присланных пользователем рендеров в слои для анимации.
Вход: assets/src_art/wh_priest_hood.jpg, wh_priest_big.jpg (вырезка делает tools/cutout.py).
Выход: assets/priests/<жрец>_<слой>.webp + assets/priests/layout.json (положение и точки вращения слоёв в пикселях спрайта).
Слои: из «тела» вырезаются подвижные части (механодендрит, верхние манипуляторы), каждая — отдельная картинка с запасом 2 px на шов;
оверлей «голограмма» — осветлённая копия панели, её мерцание делает CSS.
Запуск: python3 tools/pack_priests.py [--debug каталог]
"""
import os, sys, json
import numpy as np, cv2
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cutout as C

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets/priests')
SCALE = .5

# Координаты — в системе вырезанной фигуры (см. tools/cutout.py: wh_priest_hood 376x734, wh_priest_big 782x766).
SPEC = {
    'hood': dict(src='wh_priest_hood', hem=.585, parts=[
        # механодендрит за правым плечом: режем над опорным цилиндром, вращаем вокруг его верха
        dict(id='arm', poly=[(222, 0), (376, 0), (376, 130), (222, 130)], pivot=(264, 138), tip=(316, 112)),
    ]),
    'big': dict(src='wh_priest_big', hem=None, parts=[
        dict(id='al', poly=[(242, 6), (386, 6), (386, 134), (298, 134), (298, 198), (228, 198), (228, 140), (242, 140)], pivot=(262, 200), tip=(334, 112)),
        dict(id='ar', poly=[(452, 16), (672, 16), (672, 158), (466, 158), (466, 150), (452, 150)], pivot=(479, 152), tip=(624, 140)),
        dict(id='holo', kind='overlay', poly=[(536, 172), (772, 172), (772, 350), (536, 350)], boost=1.0),
    ]),
}

def rgba_resize(im, k):
    """Масштаб с предумножением альфы (иначе тёмный фон под прозрачностью даёт тёмную кайму)."""
    w, h = max(1, round(im.width * k)), max(1, round(im.height * k))
    return im.convert('RGBa').resize((w, h), Image.LANCZOS).convert('RGBA')

def save(im, name):
    path = os.path.join(OUT, name + '.webp')
    im.save(path, 'WEBP', quality=84, alpha_quality=100, method=6)
    return os.path.getsize(path)

def build(key, spec, debug=None):
    C.cutout(spec['src'], C.PARAMS[spec['src']])
    rgba = np.asarray(C.cutout.last['rgba']).copy()
    H, W = rgba.shape[:2]
    alpha = rgba[..., 3].astype(np.float32) / 255
    body_a = alpha.copy()
    layout = dict(w=round(W * SCALE), h=round(H * SCALE), body=key + '_body', parts=[], hem=spec['hem'])
    masks = []
    for part in spec['parts']:
        m = np.zeros((H, W), np.uint8)
        cv2.fillPoly(m, [np.array(part['poly'], np.int32)], 1)
        masks.append(m)
        if part.get('kind') != 'overlay':
            body_a *= (1 - m)
    body = rgba.copy(); body[..., 3] = (body_a * 255).astype(np.uint8)
    total = save(rgba_resize(Image.fromarray(body, 'RGBA'), SCALE), key + '_body')
    for part, m in zip(spec['parts'], masks):
        md = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))) if part.get('kind') != 'overlay' else m
        a = alpha * md
        ys, xs = np.where(a > .01)
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        lay = rgba.copy()
        if part.get('kind') == 'overlay':
            # осветлённая копия: экран-смешение с собой, цвет остаётся тёплым красно-оранжевым
            c = lay[..., :3].astype(np.float32) / 255
            c = 1 - (1 - c) * (1 - np.clip(c * 1.25 + .06, 0, 1))
            lay[..., :3] = (np.clip(c, 0, 1) * 255).astype(np.uint8)
        lay[..., 3] = (a * 255).astype(np.uint8)
        crop = Image.fromarray(lay[y0:y1, x0:x1], 'RGBA')
        total += save(rgba_resize(crop, SCALE), key + '_' + part['id'])
        px, py = part.get('pivot', ((x0 + x1) / 2, (y0 + y1) / 2))
        tx, ty = part.get('tip', (px, py))
        layout['parts'].append(dict(id=part['id'], kind=part.get('kind', 'part'), img=key + '_' + part['id'],
            x=round(x0 * SCALE, 1), y=round(y0 * SCALE, 1), w=round((x1 - x0) * SCALE, 1), h=round((y1 - y0) * SCALE, 1),
            px=round((px - x0) * SCALE, 1), py=round((py - y0) * SCALE, 1), tx=round((tx - x0) * SCALE, 1), ty=round((ty - y0) * SCALE, 1)))
    print(f'{key}: sprite {layout["w"]}x{layout["h"]}, {len(layout["parts"])} слоёв, {total // 1024} KB')
    if debug:
        os.makedirs(debug, exist_ok=True)
        bg = np.full((H, W, 3), (70, 90, 120), np.uint8)
        vis = rgba[..., :3].astype(np.float32) * alpha[..., None] + bg * (1 - alpha[..., None])
        vis = np.clip(vis, 0, 255).astype(np.uint8)
        for part in spec['parts']:
            cv2.polylines(vis, [np.array(part['poly'], np.int32)], True, (0, 255, 255), 1)
            if 'pivot' in part:
                cv2.circle(vis, tuple(int(v) for v in part['pivot']), 4, (255, 255, 0), -1)
        Image.fromarray(vis).save(os.path.join(debug, key + '_polys.png'))
        # тело без подвижных частей
        b = body_a[..., None]
        v2 = rgba[..., :3].astype(np.float32) * b + bg * (1 - b)
        Image.fromarray(np.clip(v2, 0, 255).astype(np.uint8)).save(os.path.join(debug, key + '_bodyonly.png'))
    return layout

if __name__ == '__main__':
    dbg = sys.argv[sys.argv.index('--debug') + 1] if '--debug' in sys.argv else None
    os.makedirs(OUT, exist_ok=True)
    lay = {k: build(k, v, dbg) for k, v in SPEC.items()}
    with open(os.path.join(OUT, 'layout.json'), 'w') as f:
        json.dump(lay, f, ensure_ascii=False, separators=(',', ':'))
    print('layout.json записан')
