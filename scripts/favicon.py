# -*- coding: utf-8 -*-
"""Rasteriza el favicon a PNG y .ico.

Dibuja la misma geometria que favicon.svg con primitivas de Pillow en vez de
rasterizar el SVG: asi no hace falta cairo/resvg, y vector y mapa de bits no
se pueden desincronizar por un detalle de renderizado.

Se dibuja 8x mas grande y se reduce con LANCZOS; a 16px esa supermuestra es la
diferencia entre una R legible y una mancha.

    python scripts/favicon.py
"""

from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
RED = (227, 6, 19, 255)
BLACK = (10, 10, 10, 255)
SS = 8  # supermuestreo


def dibujar(lado_px, redondeado=True):
    """Devuelve el icono de `lado_px`, dibujado en la grilla de 64 del SVG."""
    S = lado_px * SS / 64.0
    u = lambda v: v * S  # de unidades del SVG a pixeles del lienzo

    im = Image.new('RGBA', (lado_px * SS, lado_px * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)

    # Fondo. Cuadrado para el icono de iOS, que aplica su propia mascara.
    if redondeado:
        d.rounded_rectangle([0, 0, u(64) - 1, u(64) - 1], radius=u(12), fill=BLACK)
    else:
        d.rectangle([0, 0, u(64) - 1, u(64) - 1], fill=BLACK)

    d.rectangle([u(12), u(10), u(34), u(36)], fill=RED)               # panza (recto)
    d.ellipse([u(21), u(10), u(47), u(36)], fill=RED)                 # panza (curva)
    d.rounded_rectangle([u(12), u(10), u(22), u(54)], radius=u(1.5), fill=RED)  # asta
    d.polygon([(u(28), u(33)), (u(40), u(33)), (u(52), u(54)), (u(40), u(54))], fill=RED)  # pata
    d.rounded_rectangle([u(22), u(18), u(36), u(28)], radius=u(5), fill=BLACK)  # ojo de la R

    return im.resize((lado_px, lado_px), Image.LANCZOS)


def main():
    # .ico con tres tamanos: Windows y pestanas viejas eligen el que necesitan.
    iconos = [dibujar(n) for n in (16, 32, 48)]
    iconos[0].save(ROOT / 'favicon.ico', format='ICO',
                   sizes=[(16, 16), (32, 32), (48, 48)], append_images=iconos[1:])
    print('  favicon.ico      16 + 32 + 48')

    # iOS: sin esquinas redondeadas ni transparencia.
    apple = dibujar(180, redondeado=False).convert('RGB')
    apple.save(ROOT / 'apple-touch-icon.png', optimize=True)
    print('  apple-touch-icon.png  180x180')

    for n in (192, 512):
        dibujar(n).save(ROOT / f'icon-{n}.png', optimize=True)
        print(f'  icon-{n}.png')


if __name__ == '__main__':
    main()
