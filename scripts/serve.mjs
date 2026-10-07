// Servidor estático de desarrollo, sin dependencias.
//
// Sirve dist/ igual que Vercel: si la ruta no corresponde a un archivo real
// (/catalogo, /producto/algo), devuelve index.html para que el ruteo del
// cliente la resuelva. Sin este fallback, entrar directo a /catalogo da 404.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const PORT = Number(process.argv[2]) || 4321;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.pdf': 'application/pdf',
};

const isFile = (p) => stat(p).then((s) => s.isFile(), () => false);

createServer(async (req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (_) { rel = '/'; }

  // normalize + el prefijo obligatorio cortan cualquier ../ que quiera salir de dist/
  let file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

  if (!(await isFile(file))) {
    const index = join(ROOT, 'index.html');
    if (extname(rel)) { res.writeHead(404).end('No encontrado: ' + rel); return; }
    file = index;   // fallback de SPA
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500).end('Error: ' + err.message);
  }
}).listen(PORT, () => {
  console.log(`Sirviendo dist/ en http://localhost:${PORT}  (con fallback de rutas)`);
});
