// Genera el favicon.
//
// El logo completo (aro + "ROCKET" + "CARDS" + adornos) es ilegible a 16px y
// pesa 274 KB, así que el icono es una marca propia: la R de Rocket sobre el
// negro de la marca. Se dibuja como SVG —vectorial, nítido en cualquier
// tamaño— y de ahí salen los PNG y el .ico con `scripts/favicon.py`.
//
// Este archivo sólo escribe el SVG; la rasterización necesita Pillow.

import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const RED = '#E30613';
const BLACK = '#0A0A0A';

/**
 * La R: asta, panza y pata. Dibujada con formas y no con tipografía para no
 * depender de que una fuente esté instalada en el equipo que haga el build.
 * Lienzo de 64x64.
 */
const MARK = `
  <rect x="12" y="10" width="10" height="44" rx="1.5" fill="${RED}"/>
  <path d="M12 10h22a13 13 0 0 1 0 26H12z" fill="${RED}"/>
  <rect x="22" y="18" width="14" height="10" rx="5" fill="${BLACK}"/>
  <path d="M28 33h12l12 21H40z" fill="${RED}"/>
`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Rocket Cards">
  <rect width="64" height="64" rx="12" fill="${BLACK}"/>
  ${MARK.trim()}
</svg>
`;

await writeFile(join(ROOT, 'favicon.svg'), svg);
console.log('favicon.svg escrito');
