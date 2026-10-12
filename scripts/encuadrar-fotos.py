"""Encuadra las fotos del catálogo para que todos los productos se vean del mismo tamaño.

    python scripts/encuadrar-fotos.py

Cada foto del proveedor trae un margen blanco distinto, y varias ni siquiera
son cuadradas (1000x500, 1000x525). La tienda las muestra dentro de un
cuadro blanco con "contain", así que una caja con mucho margen, o una foto
apaisada, se ve bastante más chica que la de al lado.

Este script parte de los originales (assets-originales/catalogo), recorta
el margen blanco hasta el borde real del producto, y lo vuelve a poner en un
lienzo cuadrado blanco donde el lado mayor del producto ocupa siempre el
mismo porcentaje (OCUPA). Resultado en assets/catalogo, en WebP.

El panel hace lo mismo con las fotos que se suben desde ahí (encuadrar() en
admin.html), con el mismo OCUPA, para que una foto nueva quede igual que
estas.
"""
from pathlib import Path
from PIL import Image, ImageChops

RAIZ = Path(__file__).resolve().parent.parent
ORIGEN = RAIZ / 'assets-originales' / 'catalogo'
DESTINO = RAIZ / 'assets' / 'catalogo'

OCUPA = 0.86      # el producto ocupa el 86% del lado: queda 7% de aire a cada lado
LADO_MAX = 1000   # el uso más grande en la página es el carrusel (~576px a 2x)
CALIDAD = 82
TOLERANCIA = 14   # cuánto puede apartarse un pixel del blanco y seguir siendo fondo


def borde_del_producto(im):
    """La caja donde termina el blanco. None si la foto es toda blanca."""
    rgb = im.convert('RGB')
    blanco = Image.new('RGB', rgb.size, (255, 255, 255))
    dif = ImageChops.difference(rgb, blanco).convert('L')
    return dif.point(lambda v: 255 if v > TOLERANCIA else 0).getbbox()


def encuadrar(im):
    if im.mode in ('RGBA', 'LA', 'P'):
        fondo = Image.new('RGB', im.size, (255, 255, 255))
        fondo.paste(im.convert('RGBA'), mask=im.convert('RGBA').split()[-1])
        im = fondo
    im = im.convert('RGB')
    caja = borde_del_producto(im)
    if caja:
        im = im.crop(caja)
    w, h = im.size
    lado = round(max(w, h) / OCUPA)
    escala = min(1.0, LADO_MAX / lado)       # nunca agrandar: no suma detalle
    if escala < 1:
        im = im.resize((max(1, round(w * escala)), max(1, round(h * escala))), Image.LANCZOS)
        lado = round(lado * escala)
    lienzo = Image.new('RGB', (lado, lado), (255, 255, 255))
    lienzo.paste(im, ((lado - im.width) // 2, (lado - im.height) // 2))
    return lienzo


def main():
    hechos = 0
    for origen in sorted(ORIGEN.iterdir()):
        if origen.suffix.lower() not in ('.jpg', '.jpeg', '.png', '.webp'):
            continue
        destino = DESTINO / (origen.stem + '.webp')
        resultado = encuadrar(Image.open(origen))
        resultado.save(destino, 'WEBP', quality=CALIDAD, method=6)
        print(f'{origen.name:38} -> {destino.name:38} {resultado.width}x{resultado.height}  {destino.stat().st_size // 1024} KB')
        hechos += 1
    print(f'\n{hechos} fotos encuadradas.')


if __name__ == '__main__':
    main()
