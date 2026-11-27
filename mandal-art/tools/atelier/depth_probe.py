#!/usr/bin/env python3
"""Проба глубины: MiDaS-small (ONNX, onnxruntime, CPU) по вырезкам фигурок -> карты глубины для проверки глазами.
Запуск: python3 -I tools/atelier/depth_probe.py <model.onnx> <out_dir> <id> [id ...]"""
import sys, os
import numpy as np, onnxruntime as ort
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
model, out, ids = sys.argv[1], sys.argv[2], sys.argv[3:]
os.makedirs(out, exist_ok=True)
sess = ort.InferenceSession(model, providers=['CPUExecutionProvider'])
inp = sess.get_inputs()[0]
print('input', inp.name, inp.shape, 'output', sess.get_outputs()[0].shape)
S = inp.shape[-1] if isinstance(inp.shape[-1], int) else 256
mean = np.array([0.485, 0.456, 0.406], np.float32); std = np.array([0.229, 0.224, 0.225], np.float32)
for fid in ids:
    im = Image.open(os.path.join(ROOT, 'assets/figures_web', fid + '.webp')).convert('RGBA')
    bg = Image.new('RGBA', im.size, (128, 128, 128, 255)); bg.alpha_composite(im)
    rgb = bg.convert('RGB'); w, h = rgb.size
    side = max(w, h); sq = Image.new('RGB', (side, side), (128, 128, 128)); sq.paste(rgb, ((side - w) // 2, (side - h) // 2))
    x = np.asarray(sq.resize((S, S), Image.BICUBIC), np.float32) / 255.0
    x = ((x - mean) / std).transpose(2, 0, 1)[None].astype(np.float32)
    d = sess.run(None, {inp.name: x})[0][0]
    d = np.asarray(Image.fromarray(d.astype(np.float32)).resize((side, side), Image.BICUBIC))
    d = d[(side - h) // 2:(side - h) // 2 + h, (side - w) // 2:(side - w) // 2 + w]
    a = np.asarray(im)[..., 3] > 128
    lo, hi = np.percentile(d[a], 3), np.percentile(d[a], 97)
    dn = np.clip((d - lo) / (hi - lo + 1e-6), 0, 1) * a
    Image.fromarray((dn * 255).astype(np.uint8)).save(os.path.join(out, fid + '_depth.png'))
    print(fid, (w, h), 'depth range', float(d.min()), float(d.max()))
