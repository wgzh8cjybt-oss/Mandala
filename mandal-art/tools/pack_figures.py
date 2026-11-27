#!/usr/bin/env python3
"""Фигурки для витрины: assets/figures/*.webp (полные вырезки) -> assets/figures_web/<id>.webp (облегчённые, для встраивания) + meta.json.
Идентификаторы совпадают с grant.figure.id товаров на сервере (mandala-shop/src/catalog.js).
Запуск: python3 tools/pack_figures.py"""
import os, json
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets/figures')
OUT = os.path.join(ROOT, 'assets/figures_web')
H = 520   # высота в px: достаточно для просмотра ~300 css-px (DPR 2 — слегка мягко, зато файл лёгкий)

MAP = {   # id фигурки -> файл-вырезка
    'wh_skull': 'wh_servoskull', 'wh_adept': 'wh_priest_hood', 'wh_trooper': 'wh_marine', 'wh_walker': 'wh_dreadnought',
    'wh_magos': 'wh_priest_big', 'wh_golden': 'wh_golden',
    'op_captain': 'op_luffy', 'op_swordsman': 'op_zoro', 'op_cook': 'op_sanji', 'op_doctor': 'op_chopper',
    'sc_scrooge': 'sc_scrooge', 'sc_daisy': 'sc_daisy',
    'art_coins': 'art_coins', 'art_helm': 'art_helm', 'art_crystal': 'art_crystal',   # оригинальные 3D-модели: снимки tools/render_thumbs.cjs
}

def resize_premul(im, size):
    return im.convert('RGBa').resize(size, Image.LANCZOS).convert('RGBA')

os.makedirs(OUT, exist_ok=True)
meta, total = {}, 0
for fid, name in MAP.items():
    im = Image.open(os.path.join(SRC, name + '.webp')).convert('RGBA')
    k = min(1.0, H / im.height)
    out = resize_premul(im, (max(1, round(im.width * k)), max(1, round(im.height * k)))) if k < 1 else im
    path = os.path.join(OUT, fid + '.webp')
    out.save(path, 'WEBP', quality=76, alpha_quality=94, method=6)
    sz = os.path.getsize(path); total += sz
    meta[fid] = dict(w=out.width, h=out.height)
    print(f'{fid:12s} {out.width}x{out.height}  {sz // 1024} KB')
with open(os.path.join(OUT, 'meta.json'), 'w') as f:
    json.dump(meta, f, separators=(',', ':'))
print('итого', total // 1024, 'KB')
