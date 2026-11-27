#!/usr/bin/env python3
"""Вырезка фигуры со СВЕТЛЫМ градиентным фоном (рендеры Скруджа и Дейзи): assets/src_art/<id>.png -> assets/figures/<id>.webp (RGBA).
Фон гладкий: приближаем его полиномом по рамке изображения, берём пиксели, заметно отличающиеся от модели,
уточняем GrabCut'ом, чистим дырки и мелкие островки, гасим отражение в полу снизу. Исходники не меняются.
Запуск: python3 tools/cutout_grad.py [id ...]"""
import os, sys
import numpy as np, cv2
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets/src_art')
OUT = os.path.join(ROOT, 'assets/figures')

# thr — порог отличия от фона; floor — доля высоты, ниже которой маска режется (отражение в полу); fade — высота плавного затухания, px
PARAMS = {
    'sc_scrooge': dict(thr=17, floor=0.948, fade=10, close=7, erode=1, height=1500, blur=1.2, top_close=13, zone=.80, sat=52),
    'sc_daisy':   dict(thr=15, floor=0.972, fade=12, close=7, erode=1, height=1500, blur=1.2, top_close=0, zone=.80, sat=46),
}

def disk(r):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))

def fit_bg(img, border_mask, deg=3):
    """Полином степени deg по пикселям рамки -> модель фона по всему кадру."""
    h, w = border_mask.shape
    ys, xs = np.nonzero(border_mask)
    sel = np.random.default_rng(1).choice(len(ys), min(60000, len(ys)), replace=False)
    ys, xs = ys[sel], xs[sel]
    def basis(x, y):
        x = x / w * 2 - 1; y = y / h * 2 - 1
        return np.stack([x ** i * y ** j for i in range(deg + 1) for j in range(deg + 1 - i)], axis=-1)
    A = basis(xs.astype(np.float32), ys.astype(np.float32))
    gy, gx = np.mgrid[0:h, 0:w]
    B = basis(gx.reshape(-1).astype(np.float32), gy.reshape(-1).astype(np.float32))
    out = np.zeros(img.shape, np.float32)
    for c in range(3):
        coef, *_ = np.linalg.lstsq(A, img[ys, xs, c].astype(np.float32), rcond=None)
        out[..., c] = (B @ coef).reshape(h, w)
    return out

def local_bg(img, fg, sigma=55, grow=34):
    """Фон как гауссово среднее по пикселям, которые точно не фигура (нормированная свёртка): держит виньетку и градиент."""
    keep = (~cv2.dilate(fg.astype(np.uint8), disk(grow)).astype(bool)).astype(np.float32)
    w = cv2.GaussianBlur(keep, (0, 0), sigma) + 1e-6
    out = np.zeros(img.shape, np.float32)
    for c in range(3):
        out[..., c] = cv2.GaussianBlur(img[..., c].astype(np.float32) * keep, (0, 0), sigma) / w
    return out

def fill_small(mask, max_area):
    """Заливает только мелкие дырки (блики, щели); большие просветы между рукой и телом остаются прозрачными."""
    holes = ndi.binary_fill_holes(mask) & ~mask
    lab, n = ndi.label(holes)
    if n == 0:
        return mask
    sizes = ndi.sum(holes, lab, range(1, n + 1))
    return mask | np.isin(lab, np.where(sizes <= max_area)[0] + 1)

def largest(mask, keep=1):
    lab, n = ndi.label(mask)
    if n <= keep:
        return mask
    sizes = ndi.sum(mask, lab, range(1, n + 1))
    return np.isin(lab, np.argsort(sizes)[::-1][:keep] + 1)

def cut(name, p):
    im = Image.open(os.path.join(SRC, name + '.png')).convert('RGB')
    img = np.asarray(im)
    h, w = img.shape[:2]
    band = np.zeros((h, w), bool)
    bw, bt = int(w * .05), int(h * .03)
    band[:, :bw] = True; band[:, -bw:] = True; band[:bt, :] = True
    bg = fit_bg(img, band)
    diff = np.abs(img.astype(np.float32) - bg).max(axis=2)
    crude = cv2.GaussianBlur(diff, (0, 0), 1.5) > 38          # проход 1: «точно фигура»
    crude = largest(cv2.morphologyEx(crude.astype(np.uint8), cv2.MORPH_OPEN, disk(3)).astype(bool))
    for _ in range(2):                                         # проход 2-3: локальная модель фона без фигуры
        bg = local_bg(img, crude)
        diff = np.abs(img.astype(np.float32) - bg).max(axis=2)
        crude = largest(cv2.GaussianBlur(diff, (0, 0), p['blur']) > p['thr'])
    fg = cv2.GaussianBlur(diff, (0, 0), p['blur']) > p['thr']
    fg[int(h * p['floor']):, :] = False
    # у ног фон — пол и тень (серо-коричневые, малонасыщенные), а обувь и ноги яркие: внизу оставляем только насыщенные пиксели
    sat = cv2.GaussianBlur((img.max(axis=2).astype(np.float32) - img.min(axis=2).astype(np.float32)), (0, 0), 1.2)
    z = int(h * p['zone']); fg[z:, :] &= sat[z:, :] > p['sat']
    fg = cv2.morphologyEx(fg.astype(np.uint8), cv2.MORPH_OPEN, disk(3)).astype(bool)
    fg = cv2.morphologyEx(fg.astype(np.uint8), cv2.MORPH_CLOSE, disk(p['close'])).astype(bool)
    if p.get('top_close'):                                     # тёмный цилиндр на тёмном фоне: затягиваем щербины крупнее
        top = fg.copy(); top[int(h * .30):, :] = False
        top = cv2.morphologyEx(top.astype(np.uint8), cv2.MORPH_CLOSE, disk(p['top_close'])).astype(bool)
        fg |= top
    fg = fill_small(largest(fg), 2500)
    gc = np.full(fg.shape, cv2.GC_BGD, np.uint8)
    gc[cv2.dilate(fg.astype(np.uint8), disk(16)).astype(bool)] = cv2.GC_PR_BGD
    gc[fg] = cv2.GC_PR_FGD
    gc[cv2.erode(fg.astype(np.uint8), disk(12)).astype(bool)] = cv2.GC_FGD
    b, f = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(cv2.cvtColor(img, cv2.COLOR_RGB2BGR), gc, None, b, f, 5, cv2.GC_INIT_WITH_MASK)
    m = (gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD)
    m[int(h * p['floor']):, :] = False
    m[z:, :] &= sat[z:, :] > p['sat'] * 0.75                   # GrabCut мог вернуть кусочки пола
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, disk(2)).astype(bool)
    m = fill_small(largest(m), 2500)
    if p['erode']:
        m = cv2.erode(m.astype(np.uint8), disk(p['erode'])).astype(bool)
    alpha = cv2.GaussianBlur(m.astype(np.float32), (0, 0), 1.1)
    alpha = np.clip((alpha - 0.08) / 0.84, 0, 1)
    # мягкое затухание у линии пола
    y_cut = int(h * p['floor']); fd = p['fade']
    ramp = np.ones(h, np.float32); ramp[max(0, y_cut - fd):y_cut] = np.linspace(1, 0, min(fd, y_cut))
    ramp[y_cut:] = 0
    alpha = alpha * ramp[:, None]
    ys, xs = np.where(alpha > 0.02)
    pad = 8
    y0, y1 = max(0, ys.min() - pad), min(h, ys.max() + pad + 1)
    x0, x1 = max(0, xs.min() - pad), min(w, xs.max() + pad + 1)
    rgba = np.dstack([img, (alpha * 255).astype(np.uint8)])[y0:y1, x0:x1]
    out = Image.fromarray(rgba, 'RGBA')
    if out.height > p['height']:
        out = out.resize((round(out.width * p['height'] / out.height), p['height']), Image.LANCZOS)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name + '.webp')
    out.save(path, 'WEBP', quality=88, alpha_quality=100, method=6)
    print(f'{name}: {out.size[0]}x{out.size[1]} {os.path.getsize(path) // 1024} KB, fg={m.mean() * 100:.1f}%')
    return path

if __name__ == '__main__':
    for n in (sys.argv[1:] or list(PARAMS)):
        cut(n, PARAMS[n])
