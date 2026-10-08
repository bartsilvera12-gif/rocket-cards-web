// Genera db/semilla.sql con el catálogo que hoy está escrito a mano dentro de
// la página. Es el puente de una sola vez entre el CATALOG del HTML y la base.
//
//   node scripts/exportar-semilla.mjs
//
// Lee los tres arreglos (CATEGORIAS, CATALOG, NEW_IDS) evaluándolos en un
// contexto vacío. Son literales: no hay nada que ejecutar más que la sintaxis
// de objeto, y el archivo es nuestro.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = join(ROOT, 'Rocket Cards - Home.dc.html');
const SALIDA = join(ROOT, 'db', 'semilla.sql');

/** Saca `const <nombre> = [ ... ];` del fuente y lo convierte en valor. */
function arreglo(src, nombre) {
  const i = src.indexOf('const ' + nombre + ' = [');
  if (i < 0) throw new Error('No encuentro ' + nombre + ' en la página');
  const abre = src.indexOf('[', i);
  let prof = 0, fin = -1;
  for (let k = abre; k < src.length; k++) {
    if (src[k] === '[') prof++;
    else if (src[k] === ']' && --prof === 0) { fin = k + 1; break; }
  }
  if (fin < 0) throw new Error(nombre + ' no cierra');
  return new Function('return ' + src.slice(abre, fin))();
}

const txt = (v) => (v === null || v === undefined ? 'NULL' : "'" + String(v).replace(/'/g, "''") + "'");
const num = (v) => (v === null || v === undefined ? 'NULL' : String(v));

const src = await readFile(PAGE, 'utf8');
const categorias = arreglo(src, 'CATEGORIAS');
const catalog = arreglo(src, 'CATALOG');
const nuevos = arreglo(src, 'NEW_IDS');

const orden = new Map(nuevos.map((id, i) => [id, i + 1]));
const faltan = nuevos.filter((id) => !catalog.some((p) => p.id === id));
if (faltan.length) throw new Error('NEW_IDS apunta a productos que no existen: ' + faltan.join(', '));

const lineas = [];
const L = (s = '') => lineas.push(s);

L('-- Rocket Cards — catálogo inicial');
L('--');
L('--   psql -U postgres -d rocketcards -f db/semilla.sql');
L('--');
L('-- Generado por scripts/exportar-semilla.mjs a partir de los arreglos');
L('-- CATEGORIAS, CATALOG y NEW_IDS de la página. No editar a mano: una vez que');
L('-- la base es la fuente de verdad, los cambios van por el panel de admin.');
L('--');
L('-- Todo en una transacción, así los triggers mandan UN solo NOTIFY para la');
L('-- carga entera en vez de uno por producto.');
L('');
L('BEGIN;');
L('');
L('INSERT INTO categoria (key, nombre, kicker, nota, nota_menu, accent, img, orden) VALUES');
L(categorias.map((c, i) => '  (' + [
  txt(c.key), txt(c.name), txt(c.kicker || ''), txt(c.note || ''),
  txt(c.notaMenu || ''), txt(c.accent || '#E30613'), txt(c.img || ''), num(i + 1),
].join(', ') + ')').join(',\n'));
L('ON CONFLICT (key) DO UPDATE SET');
L('  nombre = EXCLUDED.nombre, kicker = EXCLUDED.kicker, nota = EXCLUDED.nota,');
L('  nota_menu = EXCLUDED.nota_menu, accent = EXCLUDED.accent, img = EXCLUDED.img,');
L('  orden = EXCLUDED.orden;');
L('');
L('INSERT INTO producto (id, nombre, coleccion, categoria, img, precio, precio_anterior, stock, etiqueta, premium, nuevo_orden) VALUES');
L(catalog.map((p) => '  (' + [
  txt(p.id), txt(p.name), txt(p.set || ''), txt(p.cat), txt(p.img || ''),
  num(p.price), num(p.old), num(p.stock || 0), txt(p.tag),
  p.premium ? 'true' : 'false', num(orden.get(p.id)),
].join(', ') + ')').join(',\n'));
L('ON CONFLICT (id) DO UPDATE SET');
L('  nombre = EXCLUDED.nombre, coleccion = EXCLUDED.coleccion, categoria = EXCLUDED.categoria,');
L('  img = EXCLUDED.img, precio = EXCLUDED.precio, precio_anterior = EXCLUDED.precio_anterior,');
L('  stock = EXCLUDED.stock, etiqueta = EXCLUDED.etiqueta, premium = EXCLUDED.premium,');
L('  nuevo_orden = EXCLUDED.nuevo_orden;');
L('');
L('COMMIT;');
L('');
L('\\echo ' + "'" + categorias.length + ' categorías y ' + catalog.length + ' productos cargados.' + "'");
L('');

await mkdir(dirname(SALIDA), { recursive: true });
await writeFile(SALIDA, lineas.join('\n'), 'utf8');
console.log('db/semilla.sql  ←  ' + categorias.length + ' categorías, ' + catalog.length + ' productos, ' + nuevos.length + ' en nuevos ingresos');
