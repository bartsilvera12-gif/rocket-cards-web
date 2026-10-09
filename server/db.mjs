// Conexión a Postgres y caché del catálogo.
//
// La tienda no consulta la base. El catálogo entero se lee una vez, se guarda
// en memoria ya serializado, y se vuelve a leer únicamente cuando Postgres
// avisa por el canal 'rocketcards'. Una visita normal no genera ni una
// consulta; si el navegador ya tiene la versión actual, tampoco genera
// tráfico, porque el ETag le devuelve 304.
//
// Para escuchar hace falta una conexión propia y permanente: LISTEN vive en la
// sesión, y las del pool se reciclan entre consultas. Si esa conexión se cae,
// se reconecta y recarga, porque mientras estuvo caída pudo perderse un aviso.

import pg from 'pg';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';

const { Pool, Client } = pg;

const CANAL = 'rocketcards';
const ESPERA_AVISO = 120;     // ms que agrupa avisos seguidos en una sola recarga
const REINTENTO_MIN = 500;
const REINTENTO_MAX = 15000;

if (!process.env.DATABASE_URL) {
  throw new Error('Falta DATABASE_URL (ver .env.ejemplo)');
}

/**
 * TLS.
 *
 * node-postgres NO cifra por omisión, aunque la cadena diga "postgresql://".
 * Contra Supabase eso es la contraseña del rol y el catálogo entero viajando
 * en claro por internet —si la conexión llega a establecerse: Supabase
 * normalmente la rechaza, y el error no menciona TLS por ningún lado—.
 *
 * Por eso: cifrado y con verificación de certificado siempre, salvo contra
 * una base local, donde no hay red de por medio y casi nunca hay certificado.
 *
 *   DB_SSL=0            apagarlo a mano (sólo para una base local rara)
 *   DB_SSL=1            encenderlo contra localhost
 *   DB_SSL_CA=ruta.crt  CA propia, si el certificado no lo firma una pública
 */
function tls() {
  const url = process.env.DATABASE_URL;
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);

  if (process.env.DB_SSL === '0') return false;
  if (local && process.env.DB_SSL !== '1') return false;

  const ca = process.env.DB_SSL_CA;
  // rejectUnauthorized en true es lo que hace que el cifrado sirva de algo:
  // sin eso, cualquiera que se meta en el medio presenta su propio
  // certificado y la conexión lo acepta sin chistar.
  return ca
    ? { ca: readFileSync(ca, 'utf8'), rejectUnauthorized: true }
    : { rejectUnauthorized: true };
}

const conexion = {
  connectionString: process.env.DATABASE_URL,
  application_name: 'rocketcards',
  ssl: tls(),
};

export const pool = new Pool(Object.assign({
  max: Number(process.env.DB_POOL || 8),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 8000,
}, conexion));

// Nuestras tablas viven en el esquema "rocketcards", no en "public": así
// PostgREST no las publica. Lo ponemos acá y no en la cadena de conexión
// porque el pooler de Supabase puede no pasar las opciones de arranque.
const RUTA = 'SET search_path TO rocketcards, public';
pool.on('connect', (cliente) => {
  cliente.query(RUTA).catch((err) => console.error('[db] search_path:', err.message));
});

// Un error en una conexión ociosa del pool no debe tumbar el proceso.
pool.on('error', (err) => console.error('[db] conexión ociosa:', err.message));

/** Avisa 'catalogo' cada vez que la caché se renueva. Lo usa el stream SSE. */
export const bus = new EventEmitter();
bus.setMaxListeners(0);

// ── Caché ────────────────────────────────────────────────────────────────

let cache = null;             // { version, cuerpo, etag, en }
let cargando = null;          // promesa en curso, para no pedir lo mismo dos veces

async function leerDeLaBase() {
  const { rows } = await pool.query('SELECT rocketcards.catalogo() AS c');
  const dato = rows[0].c;
  const cuerpo = JSON.stringify(dato);
  return {
    version: Number(dato.version),
    cuerpo,
    etag: '"v' + dato.version + '"',
    en: Date.now(),
  };
}

/** Relee el catálogo. Las llamadas simultáneas comparten una sola consulta. */
export function recargar() {
  if (cargando) return cargando;
  cargando = leerDeLaBase()
    .then((nuevo) => {
      const antes = cache && cache.version;
      cache = nuevo;
      if (antes !== nuevo.version) {
        console.log('[db] catálogo v' + nuevo.version + (antes ? ' (antes v' + antes + ')' : ''));
        bus.emit('catalogo', nuevo);
      }
      return nuevo;
    })
    .finally(() => { cargando = null; });
  return cargando;
}

/** El catálogo listo para servir. Sólo toca la base la primera vez. */
export function catalogo() {
  return cache || recargar();
}

/** La versión actual sin esperar nada; null si todavía no se cargó. */
export const versionActual = () => (cache ? cache.version : null);

// ── El que escucha ───────────────────────────────────────────────────────

let oyente = null;
let reintento = REINTENTO_MIN;
let temporizador = null;
let cerrado = false;

function programarRecarga() {
  if (temporizador) return;           // ya hay una en camino
  temporizador = setTimeout(() => {
    temporizador = null;
    recargar().catch((err) => console.error('[db] no pude recargar:', err.message));
  }, ESPERA_AVISO);
}

async function escuchar() {
  if (cerrado) return;
  const cliente = new Client(conexion);
  oyente = cliente;

  cliente.on('notification', (msg) => {
    if (msg.channel !== CANAL) return;
    // El payload trae la versión, pero igual releemos: es una consulta cada
    // vez que alguien edita, no cada vez que alguien entra a la tienda.
    programarRecarga();
  });

  cliente.on('error', (err) => {
    console.error('[db] el oyente se cayó:', err.message);
    cliente.end().catch(() => {});
    if (oyente === cliente) { oyente = null; reconectar(); }
  });

  cliente.on('end', () => {
    if (oyente === cliente) { oyente = null; reconectar(); }
  });

  await cliente.connect();
  await cliente.query(RUTA);
  await cliente.query('LISTEN ' + CANAL);
  reintento = REINTENTO_MIN;
  console.log('[db] escuchando ' + CANAL);

  // Mientras no estábamos pudo cambiar algo: arrancamos releyendo.
  await recargar();
}

function reconectar() {
  if (cerrado) return;
  const espera = reintento;
  reintento = Math.min(reintento * 2, REINTENTO_MAX);
  console.log('[db] reintento en ' + espera + 'ms');
  setTimeout(() => {
    escuchar().catch((err) => {
      console.error('[db] reconexión falló:', err.message);
      reconectar();
    });
  }, espera).unref();
}

/** Arranca la caché y el oyente. Si la base no está, el proceso no arranca. */
export async function iniciar() {
  await escuchar();
  // Sesiones vencidas, una vez por hora. No hace falta pg_cron.
  setInterval(() => {
    pool.query('SELECT rocketcards.limpiar_sesiones()')
      .catch((err) => console.error('[db] limpieza:', err.message));
  }, 3600_000).unref();
}

export async function cerrar() {
  cerrado = true;
  clearTimeout(temporizador);
  if (oyente) await oyente.end().catch(() => {});
  await pool.end().catch(() => {});
}

// ── Escrituras ───────────────────────────────────────────────────────────

/**
 * Corre `fn` en una transacción declarando quién la hace, para que los
 * triggers de auditoría registren el autor. El SET es LOCAL: vale sólo
 * dentro de esta transacción, así que una conexión reciclada del pool no se
 * lleva puesta la identidad del admin anterior.
 */
export async function comoAdmin(adminId, fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query('SELECT set_config($1, $2, true)', ['rocketcards.admin', String(adminId)]);
    const r = await fn(cliente);
    await cliente.query('COMMIT');
    return r;
  } catch (err) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    cliente.release();
  }
}

export const consultar = (texto, valores) => pool.query(texto, valores);
