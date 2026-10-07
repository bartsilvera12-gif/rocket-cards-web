// Build para Vercel.
//
// Copia a dist/ SÓLO lo que la página usa. Es una lista blanca a propósito:
// la carpeta uploads/ tiene el PDF del proyecto y fotos de WhatsApp, y
// screenshots/ son capturas internas. Con una lista negra, cualquier archivo
// nuevo que caiga en la carpeta se publicaría sin que nadie lo note.
//
// La página fuente se llama "Rocket Cards - Home.dc.html" (así la exporta la
// herramienta de diseño). En dist/ se copia como index.html para que Vercel la
// sirva en la raíz, sin redirecciones.

import { cp, mkdir, rm, stat, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

const PAGE = 'Rocket Cards - Home.dc.html';

/** Todo lo que se publica. Si agregás un archivo nuevo, va acá. */
const INCLUDE = [
  'support.js',           // runtime de la plantilla
  'reveal.js',            // animación de entrada por scroll
  'pack-opening',         // módulo de apertura de sobres
  'assets',               // logo, fotos de catálogo y cartas
  'favicon.ico',          // iconos (los genera scripts/favicon.py)
  'favicon.svg',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'site.webmanifest',
];

const exists = (p) => stat(p).then(() => true, () => false);

async function main() {
  if (!(await exists(join(ROOT, PAGE)))) {
    throw new Error(`No encuentro la página fuente: ${PAGE}`);
  }

  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  await cp(join(ROOT, PAGE), join(DIST, 'index.html'));
  console.log(`  index.html  ←  ${PAGE}`);

  for (const entry of INCLUDE) {
    const from = join(ROOT, entry);
    if (!(await exists(from))) {
      throw new Error(`Falta "${entry}", que la página necesita`);
    }
    await cp(from, join(DIST, entry), { recursive: true });
    console.log(`  ${entry}`);
  }

  // Red de seguridad: que nunca se cuele lo que no debe publicarse.
  const PROHIBIDO = ['uploads', 'screenshots', '.thumbnail', '.claude'];
  const salida = await readdir(DIST);
  const colados = salida.filter((f) => PROHIBIDO.includes(f));
  if (colados.length) {
    throw new Error(`Se colaron archivos privados en dist/: ${colados.join(', ')}`);
  }

  console.log(`\nListo. dist/ tiene ${salida.length} entradas.`);
}

main().catch((err) => {
  console.error('\nBuild falló:', err.message);
  process.exit(1);
});
