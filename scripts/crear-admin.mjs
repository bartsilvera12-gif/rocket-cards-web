// Crea o actualiza un usuario del panel.
//
//   node scripts/crear-admin.mjs <usuario> [--dueno] [--nombre "Karen"]
//
// La contraseña se pide por teclado y no se ve mientras se escribe. No se pasa
// por argumento a propósito: los argumentos quedan en el historial del shell y
// en la lista de procesos de la máquina.
//
// Si el usuario ya existe, le cambia la contraseña.

import { createInterface } from 'node:readline';
import { hashear, permitido, PERMITIDOS } from '../server/auth.mjs';
import { consultar, cerrar } from '../server/db.mjs';

const args = process.argv.slice(2);
const usuario = (args.find((a) => !a.startsWith('--')) || '').trim().toLowerCase();
const esDueno = args.includes('--dueno');
const iNombre = args.indexOf('--nombre');
const nombre = iNombre >= 0 ? (args[iNombre + 1] || '') : '';

if (!usuario || !/^[a-z0-9._+@-]{3,120}$/.test(usuario)) {
  console.error('Uso: node scripts/crear-admin.mjs <usuario> [--dueno] [--nombre "Karen"]');
  console.error('El usuario va en minúsculas. Puede ser un email.');
  process.exit(1);
}

// Crear a alguien que después no va a poder entrar es sólo confusión.
if (!permitido(usuario)) {
  console.error('"' + usuario + '" no está en ADMIN_PERMITIDOS, así que no podría entrar al panel.');
  console.error('Hoy la lista es: ' + [...PERMITIDOS].join(', '));
  console.error('Agregalo en el .env y volvé a intentar.');
  process.exit(1);
}

/** Lee una línea sin mostrar lo que se escribe. */
function preguntarOculto(texto) {
  return new Promise((listo) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const salida = process.stdout;
    let silencio = true;
    const escribir = salida.write.bind(salida);
    salida.write = (trozo, ...resto) => (silencio ? true : escribir(trozo, ...resto));
    escribir(texto);
    rl.question('', (valor) => {
      silencio = false;
      salida.write = escribir;
      escribir('\n');
      rl.close();
      listo(valor);
    });
  });
}

try {
  const clave = await preguntarOculto('Contraseña para "' + usuario + '" (mínimo 10 caracteres): ');
  const otra = await preguntarOculto('Repetila: ');
  if (clave !== otra) {
    console.error('No coinciden.');
    process.exit(1);
  }

  const hash = await hashear(clave);
  const { rows } = await consultar(
    `INSERT INTO admin (usuario, hash, nombre, rol)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (usuario) DO UPDATE
       SET hash = EXCLUDED.hash,
           nombre = CASE WHEN EXCLUDED.nombre <> '' THEN EXCLUDED.nombre ELSE admin.nombre END,
           rol = CASE WHEN $5 THEN 'dueno' ELSE admin.rol END,
           activo = true
     RETURNING id, usuario, rol, (creado_en = now()) AS recien`,
    [usuario, hash, nombre, esDueno ? 'dueno' : 'editor', esDueno]
  );
  const a = rows[0];
  console.log((a.recien ? 'Creado' : 'Actualizado') + ': ' + a.usuario + ' (' + a.rol + ')');
} catch (err) {
  console.error('Falló:', err.message);
  process.exitCode = 1;
} finally {
  await cerrar();
}
