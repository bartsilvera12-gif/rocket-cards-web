# -*- coding: utf-8 -*-
"""Reduce y recomprime las imagenes de assets/.

Las originales venian del proveedor a tamanio completo: el logo tenia 760px
y 274 KB para dibujarse a 44px, y varias fotos de catalogo rondaban los
1500px para mostrarse a 500. Eso es lo que hacia que las imagenes tardaran
en aparecer.

Guarda las originales en assets-originales/ (fuera de git y del deploy) y
escribe WebP al tamanio que la pagina realmente usa.

    python scripts/optimize-images.py            # aplica
    python scripts/optimize-images.py --dry-run  # solo informa
"""

import shutil
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'assets'
BACKUP = ROOT / 'assets-originales'

# Ancho maximo por carpeta, con margen para pantallas 2x.
# El carrusel muestra 576px como maximo; el resto, bastante menos.
REGLAS = {
    'catalogo': (1000, 80),   # (lado mayor, calidad)
    'cards': (600, 82),       # abanico del hero, se ve a ~200px
    '': (192, 90),            # el logo, que se usa a 44 y a 92px
}

DRY = '--dry-run' in sys.argv


def regla(p: Path):
    carpeta = p.parent.name if p.parent != ASSETS else ''
    return REGLAS.get(carpeta, (1000, 80))


def main():
    originales = sorted(
        p for p in ASSETS.rglob('*')
        if p.is_file() and p.suffix.lower() in ('.jpg', '.jpeg', '.png', '.webp')
    )
    if not originales:
        print('No hay imagenes en assets/')
        return

    if not DRY and not BACKUP.exists():
        shutil.copytree(ASSETS, BACKUP)
        print('Originales copiadas a %s/\n' % BACKUP.name)

    antes = despues = 0
    renombrados = []

    print('%-44s %10s %10s  %s' % ('archivo', 'antes', 'despues', 'tamanio'))
    for src in originales:
        kb0 = src.stat().st_size / 1024
        antes += kb0
        lado, q = regla(src)

        with Image.open(src) as im:
            im = im.convert('RGBA' if im.mode in ('RGBA', 'LA', 'P') else 'RGB')
            if max(im.size) > lado:
                k = lado / max(im.size)
                im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
            dim = '%dx%d' % im.size
            dst = src.with_suffix('.webp')
            if not DRY:
                im.save(dst, 'WEBP', quality=q, method=6)
                if dst != src:
                    src.unlink()
                    renombrados.append((src.relative_to(ROOT).as_posix(), dst.relative_to(ROOT).as_posix()))

        kb1 = dst.stat().st_size / 1024 if not DRY else kb0
        despues += kb1
        print('%-44s %9.0fK %9.0fK  %s' % (src.relative_to(ASSETS).as_posix(), kb0, kb1, dim))

    print('\nTotal: %.1f MB  ->  %.1f MB  (%.0f%% menos)'
          % (antes / 1024, despues / 1024, 100 * (1 - despues / antes)))

    if renombrados:
        print('\nCambiaron de extension %d archivos; hay que actualizar las referencias:' % len(renombrados))
        for a, b in renombrados[:5]:
            print('  %s -> %s' % (a, b))


if __name__ == '__main__':
    main()
