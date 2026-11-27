#!/usr/bin/env python3
"""Вырезает фигуру из тёмного фона: assets/src_art/<id>.jpg -> assets/figures/<id>.webp (RGBA).
Фон на присланных картинках почти чёрный с мягкой виньеткой: оцениваем его модель, берём отличающиеся пиксели,
уточняем GrabCut'ом, оставляем крупнейшие компоненты, сглаживаем край. Дым, искры и ореол отбрасываются:
свечение при показе дорисовывается стилями. Исходные файлы не меняются.
Запуск: python3 tools/cutout.py [id ...]
"""
import os, sys
import numpy as np, cv2
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets/src_art')
OUT = os.path.join(ROOT, 'assets/figures')

# thr — порог отличия от фона; close — радиус «замыкания» тёмных щелей; keep — сколько крупнейших компонент оставить;
# erode — срез кромки в пикселях; height — итоговая высота
PARAMS = {
    'wh_servoskull': dict(thr=16, close=5, keep=1, erode=1, height=760, blur=1.4, open=3, texture=True, tex_thr=14),
    'wh_dreadnought': dict(thr=24, close=7, keep=1, erode=1, height=820),
    'wh_marine': dict(thr=24, close=7, keep=1, erode=1, height=860),
    'wh_golden': dict(thr=40, close=10, keep=1, erode=2, height=860, texture=True, tex_thr=26, soft=True),
    'op_luffy': dict(thr=26, close=4, keep=1, erode=1, height=860),
    'op_zoro': dict(thr=7, close=5, keep=1, erode=1, height=860, blur=1.8),
    'op_sanji': dict(thr=7, close=5, keep=1, erode=1, height=860, blur=1.8),
    'op_chopper': dict(thr=26, close=4, keep=1, erode=1, height=820),
    # техножрецы (присланные пользователем рендеры): полное разрешение, дальше упаковывает tools/pack_priests.py
    'wh_priest_hood': dict(thr=14, close=5, keep=1, erode=1, height=2000, blur=1.2, holes=300),
    'wh_priest_big': dict(thr=20, close=5, keep=1, erode=1, height=2000, blur=1.2, holes=300, fade_bottom=26),
}

def disk(r):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))

def bg_model(img, fg):
    """Модель фона: гауссово сглаживание по пикселям, которые точно не фигура (нормированная свёртка)."""
    keep = (~cv2.dilate(fg.astype(np.uint8), disk(28)).astype(bool)).astype(np.float32)
    out = np.zeros_like(img, dtype=np.float32)
    w = cv2.GaussianBlur(keep, (0, 0), 70) + 1e-6
    for c in range(3):
        ch = img[..., c].astype(np.float32) * keep
        out[..., c] = cv2.GaussianBlur(ch, (0, 0), 70) / w
    return out

def fill_small(mask, max_area):
    """Заливает только маленькие дырки (просветы между деталями), а большие тёмные «окна» между рукой и телом оставляет прозрачными."""
    holes = ndi.binary_fill_holes(mask) & ~mask
    lab, n = ndi.label(holes)
    if n == 0:
        return mask
    sizes = ndi.sum(holes, lab, range(1, n + 1))
    small = np.isin(lab, np.where(sizes <= max_area)[0] + 1)
    return mask | small

def largest(mask, keep):
    lab, n = ndi.label(mask)
    if n <= keep:
        return mask
    sizes = ndi.sum(mask, lab, range(1, n + 1))
    idx = np.argsort(sizes)[::-1][:keep] + 1
    return np.isin(lab, idx)

def cutout(name, p):
    im = Image.open(os.path.join(SRC, name + '.jpg')).convert('RGB')
    img = np.asarray(im)
    v = img.max(axis=2)
    fg0 = v > 48
    bg = bg_model(img, fg0)
    diff = np.abs(img.astype(np.float32) - bg).max(axis=2)
    fg = cv2.GaussianBlur(diff, (0, 0), p.get('blur', 1.0)) > p['thr']
    if p.get('texture'):
        # свечение гладкое, а у фигуры много деталей: оставляем только «шершавые» яркие области
        gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY).astype(np.float32)
        gx, gy = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3), cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
        tex = cv2.GaussianBlur(np.hypot(gx, gy), (0, 0), 5)
        fg = fg & (tex > p.get('tex_thr', 22))
    if p.get('open'):
        fg = cv2.morphologyEx(fg.astype(np.uint8), cv2.MORPH_OPEN, disk(p['open'])).astype(bool)
    fg = largest(fg, p['keep'] + 2) if p['keep'] > 1 else fg
    fg = cv2.morphologyEx(fg.astype(np.uint8), cv2.MORPH_CLOSE, disk(p['close'])).astype(bool)
    fg = fill_small(fg, p['holes']) if p.get('holes') else ndi.binary_fill_holes(fg)
    fg = largest(fg, p['keep'])
    # GrabCut на уточнение границы
    gc = np.full(fg.shape, cv2.GC_BGD, np.uint8)
    far = cv2.dilate(fg.astype(np.uint8), disk(14)).astype(bool)
    gc[far] = cv2.GC_PR_BGD
    gc[fg] = cv2.GC_PR_FGD
    gc[cv2.erode(fg.astype(np.uint8), disk(8)).astype(bool)] = cv2.GC_FGD
    b, f = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    try:
        cv2.grabCut(cv2.cvtColor(img, cv2.COLOR_RGB2BGR), gc, None, b, f, 4, cv2.GC_INIT_WITH_MASK)
        m = (gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD)
    except Exception as e:
        print('  grabcut failed, using threshold mask:', e)
        m = fg
    m = largest(m, p['keep'])
    m = fill_small(m, p['holes']) if p.get('holes') else ndi.binary_fill_holes(m)
    if p['erode']:
        m = cv2.erode(m.astype(np.uint8), disk(p['erode'])).astype(bool)
    alpha = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 1.1)
    alpha = np.clip((alpha - 0.08) / 0.84, 0, 1)
    if p.get('soft'):
        # фигура со свечением: ядро непрозрачное, внешний край — мягкое затухание по яркости (без резкого контура ореола)
        core = cv2.GaussianBlur(cv2.erode(m.astype(np.uint8), disk(22)).astype(np.float32), (0, 0), 3)
        edge = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 10)
        lum = np.clip((cv2.GaussianBlur(v.astype(np.float32), (0, 0), 3) - 15) / 60, 0, 1)
        alpha = np.maximum(core, edge * lum)
    if p.get('fade_bottom'):
        # картинка обрезана по нижнему краю: плавно гасим последние строки, чтобы не было жёсткого среза
        fb = p['fade_bottom']
        ramp = np.ones(alpha.shape[0], np.float32)
        ramp[-fb:] = np.linspace(1, 0, fb)
        alpha = alpha * ramp[:, None]
    ys, xs = np.where(alpha > 0.02)
    pad = 8
    y0, y1 = max(0, ys.min() - pad), min(img.shape[0], ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(img.shape[1], xs.max() + pad + 1)
    rgba = np.dstack([img, (alpha * 255).astype(np.uint8)])[y0:y1, x0:x1]
    out = Image.fromarray(rgba, 'RGBA')
    cutout.last = dict(x0=int(x0), y0=int(y0), w=int(x1 - x0), h=int(y1 - y0), src=(img.shape[1], img.shape[0]), rgba=out.copy())
    h = p['height']
    if out.height > h:
        out = out.resize((round(out.width * h / out.height), h), Image.LANCZOS)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name + '.webp')
    out.save(path, 'WEBP', quality=86, alpha_quality=100, method=6)
    print(f'{name}: {out.size[0]}x{out.size[1]} {os.path.getsize(path) // 1024} KB, fg={m.mean() * 100:.1f}%')
    return path

if __name__ == '__main__':
    names = sys.argv[1:] or list(PARAMS)
    for n in names:
        cutout(n, PARAMS[n])
