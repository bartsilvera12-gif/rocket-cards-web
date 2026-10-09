// Diagnóstico de la conexión a la base.
//
//   npm run db:probar
//
// Lee DATABASE_URL del .env y revisa, en orden, todo lo que puede estar mal.
// Está pensado para que no haga falta mandarle la contraseña a nadie: corrés
// esto y te dice qué falta, con el paso siguiente.
//
// Lo importante es la prueba de LISTEN/NOTIFY del final. Es la que detecta el
// error que no se ve: con el pooler en modo transacción todo lo demás pasa, y
// la tienda igual se queda congelada mostrando el catálogo del arranque.

import pg from 'pg';
import { readFileSync } from 'node:fs';

const { Client } = pg;

const bien = (m) => console.log('  ok    ' + m);
const mal = (m) => console.log('  FALLA ' + m);
const nota = (m) => console.log('        ' + m);

const url = process.env.DATABASE_URL;
if (!url) {
  mal('Falta DATABASE_URL.');
  nota('cp .env.ejemplo .env   y completá la cadena de conexión.');
  process.exit(1);
}

/** La cadena sin la contraseña, para poder mostrarla sin filtrarla. */
function sinClave(u) {
  try {
    const x = new URL(u);
    if (x.password) x.password = '***';
    return x.toString();
  } catch (_) {
    return '(cadena ilegible)';
  }
}

function tls() {
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
  if (process.env.DB_SSL === '0') return false;
  if (local && process.env.DB_SSL !== '1') return false;
  const ca = process.env.DB_SSL_CA;
  return ca ? { ca: readFileSync(ca, 'utf8'), rejectUnauthorized: true } : { rejectUnauthorized: true };
}

console.log('\nProbando ' + sinClave(url) + '\n');

const cliente = new Client({ connectionString: url, ssl: tls(), application_name: 'rocketcards-probar' });
let salida = 0;

try {
  await cliente.connect();
  bien('conecta');
} catch (err) {
  mal('no conecta: ' + err.message);
  const pistas = {
    ETIMEDOUT: 'El puerto no responde. Si el host está detrás de Cloudflare, Postgres no pasa por ahí: Cloudflare sólo proxea HTTP/HTTPS. Necesitás un host que llegue directo a la base, o correr el servidor en la misma máquina que Supabase.',
    ECONNREFUSED: 'Hay red pero nadie escucha en ese puerto. ¿Es el puerto correcto?',
    ENOTFOUND: 'El nombre del host no resuelve. Revisá que esté bien escrito.',
    SELF_SIGNED_CERT_IN_CHAIN: 'El certificado no lo firma una CA pública. Bajá el certificado del servidor y apuntá DB_SSL_CA a ese archivo.',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'Certificado autofirmado. Igual que arriba: DB_SSL_CA.',
  };
  if (pistas[err.code]) nota(pistas[err.code]);
  if (/password authentication failed/i.test(err.message)) {
    nota("La contraseña no coincide. En la base: ALTER ROLE rocketcards_app PASSWORD '...';");
  }
  if (/no pg_hba.conf entry/i.test(err.message) && /SSL off/i.test(err.message)) {
    nota('El servidor exige TLS y la conexión salió sin cifrar. Sacá DB_SSL=0 del .env.');
  }
  process.exit(1);
}

try {
  const { rows } = await cliente.query(
    "select current_user as quien, current_database() as base, version() as v, " +
    "(select setting from pg_settings where name='ssl') as ssl_del_servidor"
  );
  const r = rows[0];
  bien('entra como "' + r.quien + '" a la base "' + r.base + '"');
  nota(r.v.split(' ').slice(0, 2).join(' '));

  const cifrado = await cliente.query('select ssl from pg_stat_ssl where pid = pg_backend_pid()');
  if (cifrado.rows[0] && cifrado.rows[0].ssl) bien('la conexión va cifrada');
  else { mal('la conexión NO va cifrada'); salida = 1; }

  // ── El esquema ──
  const esq = await cliente.query(
    "select count(*)::int as n from information_schema.tables where table_schema = 'rocketcards'"
  );
  if (esq.rows[0].n === 0) {
    mal('el esquema rocketcards no existe o no lo ves');
    nota('Corré db/rocketcards.sql con un usuario que pueda crear esquemas.');
    salida = 1;
  } else {
    bien('el esquema rocketcards tiene ' + esq.rows[0].n + ' tablas');
  }

  // ── El catálogo ──
  try {
    const cat = await cliente.query('select rocketcards.catalogo() as c');
    const c = cat.rows[0].c;
    bien('catalogo() responde: v' + c.version + ', ' + c.productos.length +
         ' productos, ' + c.categorias.length + ' categorías');
    if (!c.productos.length) nota('Está vacío: te falta correr db/semilla.sql.');
  } catch (err) {
    mal('catalogo() no anda: ' + err.message);
    salida = 1;
  }

  // ── Usuarios del panel ──
  try {
    const u = await cliente.query('select count(*)::int as n from rocketcards.admin where activo');
    if (u.rows[0].n) bien(u.rows[0].n + ' usuario(s) activo(s) en el panel');
    else {
      mal('no hay ningún usuario del panel');
      nota('npm run admin:crear -- admin@rocketcards.com --dueno');
      salida = 1;
    }
  } catch (err) {
    mal('no puedo leer la tabla admin: ' + err.message);
    salida = 1;
  }

  // ── LISTEN/NOTIFY: la prueba que importa ──
  // Con el pooler en modo transacción todo lo de arriba pasa igual y esto no.
  const oyente = new Client({ connectionString: url, ssl: tls(), application_name: 'rocketcards-probar-listen' });
  await oyente.connect();
  const llego = new Promise((listo) => {
    oyente.on('notification', (m) => { if (m.channel === 'rocketcards') listo(true); });
    setTimeout(() => listo(false), 4000);
  });
  await oyente.query('LISTEN rocketcards');
  await cliente.query("select pg_notify('rocketcards', '{\"tipo\":\"prueba\"}')");

  if (await llego) {
    bien('LISTEN/NOTIFY funciona');
  } else {
    mal('LISTEN/NOTIFY no funciona con esta cadena de conexión');
    nota('Es el pooler en modo TRANSACCIÓN (suele ser el puerto 6543).');
    nota('Cambiala por la conexión directa o el pooler en modo SESIÓN (5432).');
    nota('Sin esto el servidor arranca igual, pero la tienda se queda');
    nota('congelada mostrando el catálogo del momento del arranque.');
    salida = 1;
  }
  await oyente.end();
} catch (err) {
  mal(err.message);
  salida = 1;
} finally {
  await cliente.end().catch(() => {});
}

console.log(salida === 0
  ? '\nTodo en orden. Ya podés correr npm start.\n'
  : '\nHay cosas para arreglar, arriba.\n');
process.exit(salida);
