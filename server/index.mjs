// Servidor de Rocket Cards: la tienda, la API y el panel en un solo proceso.
//
//   node server/index.mjs            (o npm start)
//
//   /            la tienda, desde dist/
//   /admin       el panel
//   /api/...     ver server/api.mjs
//
// Variables de entorno (ver .env.ejemplo):
//   DATABASE_URL   obligatoria
//   PORT           4000 por defecto
//   DETRAS_DE_TLS  1 si hay un proxy HTTPS adelante (marca la cookie Secure)

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { api, responder } from './api.mjs';
import { iniciar, cerrar } from './db.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(AQUI, '..');
const SITIO = join(RAIZ, 'dist');
const PANEL = join(RAIZ, 'admin');

const PORT = Number(process.env.PORT) || 4000;
const SEGURO = process.env.DETRAS_DE_TLS === '1';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

const esArchivo = (p) => stat(p).then((s) => s.isFile(), () => false);

/** Resuelve `rel` dentro de `base` sin dejar que se escape con ../ */
function dentro(base, rel) {
  const destino = normalize(join(base, rel));
  return destino === base || destino.startsWith(base + sep) ? destino : null;
}

async function enviarArchivo(res, archivo, cacheable) {
  try {
    const cuerpo = await readFile(archivo);
    res.writeHead(200, {
      'Content-Type': TIPOS[extname(archivo).toLowerCase()] || 'application/octet-stream',
      'Content-Length': cuerpo.length,
      'Cache-Control': cacheable
        ? 'public, max-age=3600, stale-while-revalidate=604800'
        : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(cuerpo);
  } catch (err) {
    res.writeHead(500).end('Error: ' + err.message);
  }
}

const servidor = createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (_) { res.writeHead(400).end(); return; }

  // Cabeceras de seguridad, las mismas que pone Vercel en el sitio estático.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  if (await api(req, res, url, SEGURO)) return;

  let ruta;
  try { ruta = decodeURIComponent(url.pathname); } catch (_) { ruta = '/'; }

  // ── El panel ──
  if (ruta === '/admin' || ruta === '/admin/') {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    return enviarArchivo(res, join(PANEL, 'index.html'), false);
  }
  if (ruta.startsWith('/admin/')) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    const archivo = dentro(PANEL, ruta.slice('/admin'.length));
    if (archivo && (await esArchivo(archivo))) return enviarArchivo(res, archivo, false);
    res.writeHead(404).end('No encontrado');
    return;
  }

  // ── La tienda ──
  const archivo = dentro(SITIO, ruta);
  if (!archivo) { res.writeHead(403).end('Prohibido'); return; }

  if (await esArchivo(archivo)) {
    return enviarArchivo(res, archivo, ruta.startsWith('/assets/'));
  }
  // Fallback de SPA: /catalogo, /producto/algo y demás los resuelve el cliente.
  if (extname(ruta)) { res.writeHead(404).end('No encontrado: ' + ruta); return; }
  return enviarArchivo(res, join(SITIO, 'index.html'), false);
});

// Un stream SSE abierto no tiene por qué morir a los dos minutos.
servidor.keepAliveTimeout = 65000;
servidor.headersTimeout = 70000;
servidor.requestTimeout = 0;

try {
  if (!(await esArchivo(join(SITIO, 'index.html')))) {
    console.error('Falta dist/index.html. Corré:  npm run build');
    process.exit(1);
  }
  await iniciar();
} catch (err) {
  console.error('No pude arrancar:', err.message);
  console.error('¿Está DATABASE_URL bien puesta y la base corriendo?');
  process.exit(1);
}

servidor.listen(PORT, () => {
  console.log('Rocket Cards en http://localhost:' + PORT);
  console.log('Panel          http://localhost:' + PORT + '/admin');
});

for (const senal of ['SIGINT', 'SIGTERM']) {
  process.on(senal, () => {
    console.log('\nCerrando…');
    servidor.close(() => cerrar().then(() => process.exit(0)));
    setTimeout(() => process.exit(0), 4000).unref();
  });
}
