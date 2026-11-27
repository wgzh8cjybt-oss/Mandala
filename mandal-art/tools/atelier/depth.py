#!/usr/bin/env python3
"""Объём из картинки (честно: НЕ настоящая 3D-модель). Для каждой фигурки считает карту «высот» лицевой и обратной стороны:
  1) глубина по картинке — Depth Anything V2 Small (ONNX, onnxruntime, CPU; Apache-2.0), вход — вырезка на сером фоне;
  2) «надувание» по силуэту (расстояние до края) даёт округлый объём, глубина — какие части ближе, плюс локальный рельеф.
Результат assets/figures_web/<id>.depth.webp: R — перед, G — зад (0..255 от толщины K*высота), B — глубина как есть (для отладки).
Просмотрщик (06c-3d.js) строит из карты замкнутую сетку и освещает её как настоящий объект.
Запуск: python3 -I tools/atelier/depth.py <model.onnx> [id ...]   (без id — все фигурки из assets/figures_web/meta.json)"""
import sys, os, json
import numpy as np, cv2, onnxruntime as ort
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WEB = os.path.join(ROOT, 'assets/figures_web')
FULL = os.path.join(ROOT, 'assets/figures')
MAP = {  # id -> вырезка высокого разрешения (как в pack_figures.py)
    'wh_skull': 'wh_servoskull', 'wh_adept': 'wh_priest_hood', 'wh_trooper': 'wh_marine', 'wh_walker': 'wh_dreadnought',
    'wh_magos': 'wh_priest_big', 'wh_golden': 'wh_golden',
    'op_captain': 'op_luffy', 'op_swordsman': 'op_zoro', 'op_cook': 'op_sanji', 'op_doctor': 'op_chopper',
    'sc_scrooge': 'sc_scrooge', 'sc_daisy': 'sc_daisy',
}
K = 0.13   # макс. толщина стороны как доля высоты фигурки (читает и просмотрщик)

def da2(sess, rgb, target_h=700):
    h, w = rgb.shape[:2]
    H = max(14, round(target_h / 14) * 14); W = max(14, round(w * H / h / 14) * 14)
    x = cv2.resize(rgb, (W, H), interpolation=cv2.INTER_CUBIC).astype(np.float32) / 255.0
    x = ((x - np.array([0.485, 0.456, 0.406], np.float32)) / np.array([0.229, 0.224, 0.225], np.float32)).transpose(2, 0, 1)[None]
    d = sess.run(None, {'image': x.astype(np.float32)})[0][0]
    return cv2.resize(d, (w, h), interpolation=cv2.INTER_CUBIC)

def volume(alpha, d):
    """alpha: float 0..1 (h,w); d: относительная глубина (больше = ближе). Возвращает (front, back) в долях K*h, 0..1."""
    h, w = alpha.shape
    m = alpha > 0.5
    # глубина внутри силуэта: нормировка по перцентилям, фон не участвует
    lo, hi = np.percentile(d[m], 4), np.percentile(d[m], 90)   # тонкие ближние детали (трость) не должны задавать весь диапазон
    dn = np.clip((d - lo) / (hi - lo + 1e-6), 0, 1)
    # заполняем фон ближайшей глубиной силуэта, чтобы края не «проваливались» при сглаживании
    idx = ndi.distance_transform_edt(~m, return_distances=False, return_indices=True)
    dn = dn[idx[0], idx[1]]
    low = cv2.GaussianBlur(dn, (0, 0), 0.012 * h)
    hp = dn - cv2.GaussianBlur(dn, (0, 0), 0.03 * h)
    # надувание по силуэту: корень из сглаженного расстояния до края даёт округлый «подушечный» профиль
    dt = cv2.GaussianBlur(ndi.distance_transform_edt(m).astype(np.float32), (0, 0), 0.006 * h)
    dmax = ndi.maximum_filter(dt, size=int(0.30 * h)) + 1e-6          # локальный максимум: тонкие части тоньше толстых
    infl = np.sqrt(np.clip(dt / np.maximum(dmax, 0.12 * h), 0, 1))
    front = infl * (0.70 + 0.45 * low) + 0.22 * hp * np.clip(infl * 3, 0, 1)
    back = infl * (0.62 + 0.20 * (1 - low))
    front = np.clip(front, 0, 1.15) / 1.15; back = np.clip(back, 0, 1.15) / 1.15
    return front * m, back * m, dn * m

def shade(front):
    gy, gx = np.gradient(cv2.GaussianBlur(front, (0, 0), 1.5))
    n = np.dstack([-gx * 14, -gy * 14, np.ones_like(gx)]); n /= np.linalg.norm(n, axis=2, keepdims=True)
    L = np.array([-0.45, -0.55, 0.7]); L /= np.linalg.norm(L)
    return np.clip(n @ L, 0, 1)

if __name__ == '__main__':
    model = sys.argv[1]; ids = sys.argv[2:]
    meta = json.load(open(os.path.join(WEB, 'meta.json')))
    ids = ids or list(meta)
    sess = ort.InferenceSession(model, providers=['CPUExecutionProvider'])
    prev = os.environ.get('DEPTH_PREVIEW')
    for fid in ids:
        full = Image.open(os.path.join(FULL, MAP[fid] + '.webp')).convert('RGBA')
        web = Image.open(os.path.join(WEB, fid + '.webp')).convert('RGBA')
        bg = Image.new('RGBA', full.size, (128, 128, 128, 255)); bg.alpha_composite(full)
        d = da2(sess, np.asarray(bg.convert('RGB')))
        d = cv2.resize(d, web.size, interpolation=cv2.INTER_AREA)
        a = np.asarray(web)[..., 3].astype(np.float32) / 255.0
        f, b, dn = volume(a, d)
        out = np.dstack([f * 255, b * 255, dn * 255]).clip(0, 255).astype(np.uint8)
        Image.fromarray(out, 'RGB').save(os.path.join(WEB, fid + '.depth.webp'), 'WEBP', quality=93, method=6)
        print(f'{fid:12s} {web.size}  {os.path.getsize(os.path.join(WEB, fid + ".depth.webp")) // 1024} KB')
        if prev:
            os.makedirs(prev, exist_ok=True)
            Image.fromarray((shade(f) * 255).astype(np.uint8)).save(os.path.join(prev, fid + '_shade.png'))
            Image.fromarray((dn * 255).astype(np.uint8)).save(os.path.join(prev, fid + '_d.png'))
