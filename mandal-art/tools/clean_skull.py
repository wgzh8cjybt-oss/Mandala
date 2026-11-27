#!/usr/bin/env python3
"""Убирает с картинки сервочерепа нарисованный дым и искры у сопел — вместо них приложение рисует живые струи.
Исходник: assets/src/wh_skull.orig.webp (файл владельца, не трогаем). Результат: assets/floaters/wh_skull.webp.
Полигоны в координатах спрайта 300x335."""
import sys
from PIL import Image, ImageDraw, ImageFilter
SRC, DST = 'assets/src/wh_skull.orig.webp', 'assets/floaters/wh_skull.webp'
POLYS = [
  # дым из трубы (вверху справа)
  [(226, 0), (300, 0), (300, 70), (262, 70), (252, 58), (246, 50), (241, 44), (236, 38), (231, 32), (228, 26)],
  # дым и искры у правого блока
  [(256, 86), (300, 86), (300, 162), (271, 162), (270.5, 142), (270, 127), (268, 124.5), (258, 124.5)],
  # дым и искры у нижнего сопла
  [(252, 168), (300, 168), (300, 232), (269.5, 232), (271.5, 222), (269.5, 210), (264.5, 200), (258.5, 192), (255.5, 185), (251.5, 175)],
]
def main(preview=None):
    im = Image.open(SRC).convert('RGBA'); W, H = im.size; K = 4
    m = Image.new('L', (W * K, H * K), 255); d = ImageDraw.Draw(m)
    for p in POLYS: d.polygon([(x * K, y * K) for x, y in p], fill=0)
    m = m.filter(ImageFilter.GaussianBlur(K * .45)).resize((W, H), Image.LANCZOS)
    a = im.getchannel('A'); a = Image.composite(a, Image.new('L', (W, H), 0), m) if False else Image.fromarray(__import__('numpy').minimum(__import__('numpy').array(a), __import__('numpy').array(m)))
    im.putalpha(a)
    im.save(DST, 'WEBP', quality=92, method=6, lossless=False, exact=True)
    if preview:
        bg = Image.new('RGBA', im.size, (255, 0, 255, 255)); bg.alpha_composite(im)
        bg = bg.resize((W * 3, H * 3), Image.LANCZOS); bg.save(preview)
if __name__ == '__main__': main(sys.argv[1] if len(sys.argv) > 1 else None)
