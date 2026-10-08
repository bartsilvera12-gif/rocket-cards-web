// Endpoints: los públicos que consume la tienda y los del panel.
//
// Públicos
//   GET  /api/catalogo   catálogo completo, desde la caché, con ETag
//   GET  /api/eventos    SSE: avisa "recargar" cuando el catálogo cambió
//   GET  /api/salud
//
// Panel (requieren sesión)
//   POST   /api/admin/login            POST /api/admin/logout
//   GET    /api/admin/yo
//   GET    /api/admin/productos        POST   /api/admin/productos
//   PATCH  /api/admin/productos/:id    DELETE /api/admin/productos/:id
//   PUT    /api/admin/nuevos           orden del carrusel, en un solo paso
//   GET    /api/admin/categorias       POST   /api/admin/categorias
//   PATCH  /api/admin/categorias/:key  DELETE /api/admin/categorias/:key
//   GET    /api/admin/auditoria
//   GET    /api/admin/usuarios         POST   /api/admin/usuarios   (sólo dueño)

import { catalogo, bus, consultar, comoAdmin, versionActual } from './db.mjs';
import * as auth from './auth.mjs';

const LIMITE_CUERPO = 64 * 1024;

// ── Utilidades ───────────────────────────────────────────────────────────

class ErrorHttp extends Error {
  constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; }
}
const malPedido = (m) => new ErrorHttp(400, m);

export function responder(res, codigo, dato, cabeceras) {
  const cuerpo = typeof dato === 'string' ? dato : JSON.stringify(dato);
  res.writeHead(codigo, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(cuerpo),
    'Cache-Control': 'no-store',
  }, cabeceras));
  res.end(cuerpo);
}

function leerCuerpo(req) {
  return new Promise((listo, falla) => {
    let total = 0;
    const trozos = [];
    req.on('data', (t) => {
      total += t.length;
      if (total > LIMITE_CUERPO) { falla(malPedido('Cuerpo demasiado grande')); req.destroy(); return; }
      trozos.push(t);
    });
    req.on('end', () => {
      if (!total) return listo({});
      try { listo(JSON.parse(Buffer.concat(trozos).toString('utf8'))); }
      catch (_) { falla(malPedido('JSON inválido')); }
    });
    req.on('error', falla);
  });
}

const ipDe = (req) => (req.socket.remoteAddress || '').replace(/^::ffff:/, '');

// ── Validación ───────────────────────────────────────────────────────────

const CAMPOS_PRODUCTO = {
  nombre:          (v) => texto(v, 'nombre', 1, 200),
  coleccion:       (v) => texto(v, 'coleccion', 0, 200),
  categoria:       (v) => texto(v, 'categoria', 1, 60),
  img:             (v) => ruta(v, 'img'),
  precio:          (v) => entero(v, 'precio', 0, 1e12),
  precio_anterior: (v) => (v === null || v === '' ? null : entero(v, 'precio_anterior', 1, 1e12)),
  stock:           (v) => entero(v, 'stock', 0, 1e6),
  etiqueta:        (v) => (v === null || v === '' ? null : texto(v, 'etiqueta', 1, 40)),
  premium:         (v) => booleano(v, 'premium'),
  publicado:       (v) => booleano(v, 'publicado'),
  nuevo_orden:     (v) => (v === null || v === '' ? null : entero(v, 'nuevo_orden', 1, 999)),
};

const CAMPOS_CATEGORIA = {
  nombre:    (v) => texto(v, 'nombre', 1, 120),
  kicker:    (v) => texto(v, 'kicker', 0, 120),
  nota:      (v) => texto(v, 'nota', 0, 200),
  nota_menu: (v) => texto(v, 'nota_menu', 0, 200),
  accent:    (v) => color(v, 'accent'),
  img:       (v) => ruta(v, 'img'),
  orden:     (v) => entero(v, 'orden', 0, 999),
};

function texto(v, campo, min, max) {
  if (typeof v !== 'string') throw malPedido(campo + ' tiene que ser texto');
  const t = v.trim();
  if (t.length < min) throw malPedido(campo + ' no puede estar vacío');
  if (t.length > max) throw malPedido(campo + ' no puede pasar de ' + max + ' caracteres');
  return t;
}
function entero(v, campo, min, max) {
  const n = typeof v === 'string' ? Number(v.replace(/[^\d-]/g, '')) : Number(v);
  if (!Number.isInteger(n)) throw malPedido(campo + ' tiene que ser un número entero');
  if (n < min || n > max) throw malPedido(campo + ' queda fuera de rango');
  return n;
}
function booleano(v, campo) {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === 'false') return v === 'true';
  throw malPedido(campo + ' tiene que ser sí o no');
}
function color(v, campo) {
  const t = texto(v, campo, 4, 7);
  if (!/^#[0-9A-Fa-f]{6}$/.test(t)) throw malPedido(campo + ' tiene que ser un color #RRGGBB');
  return t;
}
/**
 * Las imágenes son rutas de assets/ del propio sitio. Rechazamos URLs
 * absolutas: una ruta que apunte afuera convierte el panel en una forma de
 * incrustar contenido de terceros en la tienda.
 */
function ruta(v, campo) {
  const t = texto(v, campo, 0, 300);
  if (!t) return '';
  if (!t.startsWith('/') || t.startsWith('//') || t.includes('..')) {
    throw malPedido(campo + ' tiene que ser una ruta del sitio, como /assets/catalogo/foto.webp');
  }
  return t;
}

/** Toma de `cuerpo` sólo los campos conocidos, ya validados. */
function recortar(cuerpo, esquema, obligatorios) {
  const salida = {};
  for (const [campo, valida] of Object.entries(esquema)) {
    if (Object.prototype.hasOwnProperty.call(cuerpo, campo)) salida[campo] = valida(cuerpo[campo]);
  }
  for (const campo of obligatorios || []) {
    if (!Object.prototype.hasOwnProperty.call(salida, campo)) throw malPedido('Falta ' + campo);
  }
  if (!Object.keys(salida).length) throw malPedido('No mandaste ningún campo para cambiar');
  return salida;
}

/** Convierte un error de Postgres en algo que el panel pueda mostrar. */
function traducir(err) {
  if (err instanceof ErrorHttp) return err;
  switch (err.code) {
    case '23505': return new ErrorHttp(409,
      err.constraint === 'producto_nuevo_orden_idx'
        ? 'Ya hay otro producto en esa posición de Nuevos ingresos'
        : 'Ya existe un registro con esa clave');
    case '23503': return new ErrorHttp(409, 'Esa categoría no existe, o todavía tiene productos');
    case '23514': return new ErrorHttp(400, 'Algún valor no cumple las reglas de la base');
    default: return null;
  }
}

// ── Catálogo público ─────────────────────────────────────────────────────

async function servirCatalogo(req, res) {
  const c = await catalogo();
  if (req.headers['if-none-match'] === c.etag) {
    res.writeHead(304, { ETag: c.etag, 'Cache-Control': 'no-cache' });
    return res.end();
  }
  responder(res, 200, c.cuerpo, {
    ETag: c.etag,
    // no-cache, no no-store: el navegador guarda la copia y pregunta con el
    // ETag. Si no cambió nada, la respuesta es un 304 sin cuerpo.
    'Cache-Control': 'no-cache',
  });
}

/**
 * Stream de eventos. Mientras está abierto, el navegador no consulta nada:
 * se entera del cambio en el momento en que ocurre. El comentario cada 25s
 * es para que los proxies no corten la conexión por inactividad.
 */
function servirEventos(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 5000\n\n');
  const v = versionActual();
  if (v !== null) res.write('event: version\ndata: {"version":' + v + '}\n\n');

  const alCambiar = (c) => res.write('event: recargar\ndata: {"version":' + c.version + '}\n\n');
  bus.on('catalogo', alCambiar);

  const latido = setInterval(() => res.write(': ping\n\n'), 25000);
  const cerrar = () => { clearInterval(latido); bus.off('catalogo', alCambiar); };
  req.on('close', cerrar);
  res.on('error', cerrar);
}

// ── Panel ────────────────────────────────────────────────────────────────

async function login(req, res, cuerpo, seguro) {
  const usuario = String(cuerpo.usuario || '').trim().toLowerCase();
  const clave = String(cuerpo.clave || '');
  const llave = ipDe(req) + '|' + usuario;

  if (auth.demasiadosIntentos(llave)) {
    throw new ErrorHttp(429, 'Demasiados intentos. Probá de nuevo en un rato.');
  }

  const { rows } = await consultar(
    'SELECT id, usuario, nombre, rol, hash FROM admin WHERE usuario = $1 AND activo',
    [usuario]
  );
  const a = rows[0];
  // Verificamos igual con un hash de descarte cuando el usuario no existe,
  // para que "usuario inexistente" y "contraseña incorrecta" tarden lo mismo.
  const ok = await auth.verificar(clave, a ? a.hash : 'scrypt$16384$8$1$00$00');

  if (!a || !ok) {
    auth.anotarFallo(llave);
    throw new ErrorHttp(401, 'Usuario o contraseña incorrectos');
  }

  auth.limpiarFallos(llave);
  const sid = await auth.abrirSesion(a.id, ipDe(req), req.headers['user-agent']);
  auth.ponerCookie(res, sid, seguro);
  responder(res, 200, { usuario: a.usuario, nombre: a.nombre, rol: a.rol });
}

async function listarProductos(res) {
  const { rows } = await consultar(
    `SELECT p.*, c.nombre AS categoria_nombre
       FROM producto p LEFT JOIN categoria c ON c.key = p.categoria
      ORDER BY p.nombre`
  );
  responder(res, 200, { productos: rows, version: versionActual() });
}

async function crearProducto(admin, cuerpo, res) {
  const id = texto(cuerpo.id || '', 'id', 1, 60);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw malPedido('El SKU sólo admite letras, números, punto, guion y guion bajo');
  }
  const datos = recortar(cuerpo, CAMPOS_PRODUCTO, ['nombre', 'categoria', 'precio']);
  const campos = ['id', ...Object.keys(datos)];
  const valores = [id, ...Object.values(datos)];
  const huecos = campos.map((_, i) => '$' + (i + 1));

  const fila = await comoAdmin(admin.id, async (cli) => {
    const r = await cli.query(
      'INSERT INTO producto (' + campos.join(', ') + ') VALUES (' + huecos.join(', ') + ') RETURNING *',
      valores
    );
    return r.rows[0];
  });
  responder(res, 201, { producto: fila });
}

async function editarProducto(admin, id, cuerpo, res) {
  const datos = recortar(cuerpo, CAMPOS_PRODUCTO);
  const campos = Object.keys(datos);
  const asignaciones = campos.map((c, i) => c + ' = $' + (i + 2));

  const fila = await comoAdmin(admin.id, async (cli) => {
    const r = await cli.query(
      'UPDATE producto SET ' + asignaciones.join(', ') + ' WHERE id = $1 RETURNING *',
      [id, ...Object.values(datos)]
    );
    return r.rows[0];
  });
  if (!fila) throw new ErrorHttp(404, 'No existe el producto ' + id);
  responder(res, 200, { producto: fila });
}

async function borrarProducto(admin, id, res) {
  const fila = await comoAdmin(admin.id, async (cli) => {
    const r = await cli.query('DELETE FROM producto WHERE id = $1 RETURNING id', [id]);
    return r.rows[0];
  });
  if (!fila) throw new ErrorHttp(404, 'No existe el producto ' + id);
  responder(res, 200, { ok: true });
}

/**
 * Reordena "Nuevos ingresos" de una sola vez. Primero deja todo en NULL y
 * después numera, porque el índice único no deja que dos productos compartan
 * posición ni un instante. Al ir todo en una transacción, la tienda recibe un
 * único aviso y no ve el carrusel vacío en el medio.
 */
async function guardarNuevos(admin, cuerpo, res) {
  const ids = Array.isArray(cuerpo.ids) ? cuerpo.ids : null;
  if (!ids) throw malPedido('Mandá "ids" con la lista ordenada');
  if (ids.length > 12) throw malPedido('El carrusel no lleva más de 12 productos');
  if (new Set(ids).size !== ids.length) throw malPedido('Hay productos repetidos en la lista');

  await comoAdmin(admin.id, async (cli) => {
    await cli.query('UPDATE producto SET nuevo_orden = NULL WHERE nuevo_orden IS NOT NULL');
    if (ids.length) {
      const r = await cli.query(
        `UPDATE producto p SET nuevo_orden = n.orden
           FROM unnest($1::text[]) WITH ORDINALITY AS n(id, orden)
          WHERE p.id = n.id RETURNING p.id`,
        [ids]
      );
      if (r.rowCount !== ids.length) throw malPedido('Alguno de esos productos no existe');
    }
  });
  responder(res, 200, { ok: true, ids });
}

async function listarCategorias(res) {
  const { rows } = await consultar(
    `SELECT c.*, (SELECT count(*) FROM producto p WHERE p.categoria = c.key) AS productos
       FROM categoria c ORDER BY c.orden, c.key`
  );
  responder(res, 200, { categorias: rows });
}

async function crearCategoria(admin, cuerpo, res) {
  const key = texto(cuerpo.key || '', 'key', 1, 40).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) {
    throw malPedido('La clave va en minúsculas, sin espacios ni acentos (es la que sale en la URL)');
  }
  const datos = recortar(cuerpo, CAMPOS_CATEGORIA, ['nombre']);
  const campos = ['key', ...Object.keys(datos)];
  const valores = [key, ...Object.values(datos)];

  const fila = await comoAdmin(admin.id, async (cli) => {
    const r = await cli.query(
      'INSERT INTO categoria (' + campos.join(', ') + ') VALUES (' +
      campos.map((_, i) => '$' + (i + 1)).join(', ') + ') RETURNING *',
      valores
    );
    return r.rows[0];
  });
  responder(res, 201, { categoria: fila });
}

async function editarCategoria(admin, key, cuerpo, res) {
  const datos = recortar(cuerpo, CAMPOS_CATEGORIA);
  const campos = Object.keys(datos).map((c, i) => c + ' = $' + (i + 2));
  const fila = await comoAdmin(admin.id, async (cli) => {
    const r = await cli.query(
      'UPDATE categoria SET ' + campos.join(', ') + ' WHERE key = $1 RETURNING *',
      [key, ...Object.values(datos)]
    );
    return r.rows[0];
  });
  if (!fila) throw new ErrorHttp(404, 'No existe la categoría ' + key);
  responder(res, 200, { categoria: fila });
}

async function borrarCategoria(admin, key, res) {
  const fila = await comoAdmin(admin.id, async (cli) => {
    const r = await cli.query('DELETE FROM categoria WHERE key = $1 RETURNING key', [key]);
    return r.rows[0];
  });
  if (!fila) throw new ErrorHttp(404, 'No existe la categoría ' + key);
  responder(res, 200, { ok: true });
}

async function listarAuditoria(url, res) {
  const limite = Math.min(Number(url.searchParams.get('limite')) || 50, 200);
  const { rows } = await consultar(
    `SELECT au.id, au.tabla, au.registro_id, au.accion, au.creado_en,
            au.antes, au.despues, a.usuario
       FROM auditoria au LEFT JOIN admin a ON a.id = au.admin_id
      ORDER BY au.id DESC LIMIT $1`,
    [limite]
  );
  responder(res, 200, { movimientos: rows });
}

async function listarUsuarios(res) {
  const { rows } = await consultar(
    'SELECT id, usuario, nombre, rol, activo, creado_en, ultimo_acceso FROM admin ORDER BY usuario'
  );
  responder(res, 200, { usuarios: rows });
}

async function crearUsuario(cuerpo, res) {
  const usuario = texto(cuerpo.usuario || '', 'usuario', 3, 40).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(usuario)) throw malPedido('El usuario admite letras, números, punto, guion y guion bajo');
  const rol = cuerpo.rol === 'dueno' ? 'dueno' : 'editor';
  const nombre = cuerpo.nombre ? texto(cuerpo.nombre, 'nombre', 1, 120) : '';
  let hash;
  try { hash = await auth.hashear(String(cuerpo.clave || '')); }
  catch (err) { throw malPedido(err.message); }

  const { rows } = await consultar(
    'INSERT INTO admin (usuario, hash, nombre, rol) VALUES ($1,$2,$3,$4) RETURNING id, usuario, nombre, rol, activo',
    [usuario, hash, nombre, rol]
  );
  responder(res, 201, { usuario: rows[0] });
}

// ── Ruteo ────────────────────────────────────────────────────────────────

/** Devuelve true si atendió el pedido. */
export async function api(req, res, url, seguro) {
  const ruta = url.pathname;
  if (!ruta.startsWith('/api/')) return false;

  try {
    if (ruta === '/api/salud') {
      responder(res, 200, { ok: true, version: versionActual() });
      return true;
    }
    if (ruta === '/api/catalogo' && req.method === 'GET') { await servirCatalogo(req, res); return true; }
    if (ruta === '/api/eventos' && req.method === 'GET') { servirEventos(req, res); return true; }

    if (!ruta.startsWith('/api/admin/')) throw new ErrorHttp(404, 'No existe ese endpoint');

    // Todo lo que escribe exige esta cabecera. Un formulario de otro sitio no
    // puede ponerla sin que el navegador pida permiso antes (preflight CORS),
    // así que alcanza para cerrar el CSRF junto con SameSite=Lax.
    if (req.method !== 'GET' && req.headers['x-rocket-admin'] !== '1') {
      throw new ErrorHttp(403, 'Pedido sin la cabecera X-Rocket-Admin');
    }

    const cuerpo = req.method === 'GET' ? {} : await leerCuerpo(req);
    const sid = auth.leerCookie(req);

    if (ruta === '/api/admin/login' && req.method === 'POST') {
      await login(req, res, cuerpo, seguro);
      return true;
    }
    if (ruta === '/api/admin/logout' && req.method === 'POST') {
      await auth.cerrarSesion(sid);
      auth.borrarCookie(res, seguro);
      responder(res, 200, { ok: true });
      return true;
    }

    const admin = await auth.adminDe(sid);
    if (!admin) throw new ErrorHttp(401, 'Entrá de nuevo');

    if (ruta === '/api/admin/yo') { responder(res, 200, { admin }); return true; }

    if (ruta === '/api/admin/productos') {
      if (req.method === 'GET') { await listarProductos(res); return true; }
      if (req.method === 'POST') { await crearProducto(admin, cuerpo, res); return true; }
    }
    const prod = ruta.match(/^\/api\/admin\/productos\/(.+)$/);
    if (prod) {
      const id = decodeURIComponent(prod[1]);
      if (req.method === 'PATCH') { await editarProducto(admin, id, cuerpo, res); return true; }
      if (req.method === 'DELETE') { await borrarProducto(admin, id, res); return true; }
    }

    if (ruta === '/api/admin/nuevos' && req.method === 'PUT') {
      await guardarNuevos(admin, cuerpo, res);
      return true;
    }

    if (ruta === '/api/admin/categorias') {
      if (req.method === 'GET') { await listarCategorias(res); return true; }
      if (req.method === 'POST') { await crearCategoria(admin, cuerpo, res); return true; }
    }
    const cat = ruta.match(/^\/api\/admin\/categorias\/([a-z0-9-]+)$/);
    if (cat) {
      if (req.method === 'PATCH') { await editarCategoria(admin, cat[1], cuerpo, res); return true; }
      if (req.method === 'DELETE') { await borrarCategoria(admin, cat[1], res); return true; }
    }

    if (ruta === '/api/admin/auditoria' && req.method === 'GET') { await listarAuditoria(url, res); return true; }

    if (ruta === '/api/admin/usuarios') {
      if (admin.rol !== 'dueno') throw new ErrorHttp(403, 'Sólo el dueño administra usuarios');
      if (req.method === 'GET') { await listarUsuarios(res); return true; }
      if (req.method === 'POST') { await crearUsuario(cuerpo, res); return true; }
    }

    throw new ErrorHttp(405, 'Ese endpoint no acepta ' + req.method);
  } catch (err) {
    const e = traducir(err) || err;
    if (e instanceof ErrorHttp) {
      responder(res, e.codigo, { error: e.message });
    } else {
      console.error('[api] ' + req.method + ' ' + ruta + ':', err);
      responder(res, 500, { error: 'Error del servidor' });
    }
    return true;
  }
}
