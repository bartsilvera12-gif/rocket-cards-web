// Autenticación del panel.
//
// Contraseñas con scrypt, que viene en Node: no hace falta bcrypt ni argon2.
// Las sesiones viven en la base, no en memoria, así reiniciar el servidor no
// echa a nadie y dos procesos comparten la misma verdad.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { consultar } from './db.mjs';

const scryptAsync = promisify(scrypt);

const N = 16384, R = 8, P = 1, LARGO = 64;
const COOKIE = 'rc_admin';
const DURACION_H = 12;
const RENOVAR_SI_QUEDA_MENOS_DE_H = 6;

// ── Contraseñas ──────────────────────────────────────────────────────────

export async function hashear(clave) {
  if (typeof clave !== 'string' || clave.length < 10) {
    throw new Error('La contraseña necesita al menos 10 caracteres');
  }
  const sal = randomBytes(16);
  const h = await scryptAsync(clave.normalize('NFKC'), sal, LARGO, { N, r: R, p: P });
  return ['scrypt', N, R, P, sal.toString('hex'), h.toString('hex')].join('$');
}

export async function verificar(clave, guardado) {
  if (typeof clave !== 'string' || typeof guardado !== 'string') return false;
  const p = guardado.split('$');
  if (p.length !== 6 || p[0] !== 'scrypt') return false;
  const [, n, r, pp, salHex, hashHex] = p;
  let esperado;
  try {
    esperado = Buffer.from(hashHex, 'hex');
    const calculado = await scryptAsync(
      clave.normalize('NFKC'), Buffer.from(salHex, 'hex'), esperado.length,
      { N: Number(n), r: Number(r), p: Number(pp) }
    );
    return timingSafeEqual(calculado, esperado);
  } catch (_) {
    return false;
  }
}

// ── Intentos fallidos ────────────────────────────────────────────────────
// En memoria a propósito: escribir en la base en cada intento fallido es
// justo lo que busca quien prueba contraseñas en masa.

const intentos = new Map();
const TOPE = 10, VENTANA = 15 * 60_000;

export function demasiadosIntentos(llave) {
  const e = intentos.get(llave);
  if (!e) return false;
  if (Date.now() - e.desde > VENTANA) { intentos.delete(llave); return false; }
  return e.n >= TOPE;
}

export function anotarFallo(llave) {
  const e = intentos.get(llave);
  if (!e || Date.now() - e.desde > VENTANA) intentos.set(llave, { n: 1, desde: Date.now() });
  else e.n++;
}

export const limpiarFallos = (llave) => intentos.delete(llave);

setInterval(() => {
  const corte = Date.now() - VENTANA;
  for (const [k, v] of intentos) if (v.desde < corte) intentos.delete(k);
}, VENTANA).unref();

// ── Sesiones ─────────────────────────────────────────────────────────────

export async function abrirSesion(adminId, ip, agente) {
  const id = randomBytes(32).toString('hex');
  await consultar(
    `INSERT INTO sesion (id, admin_id, expira_en, ip, agente)
     VALUES ($1, $2, now() + ($3 || ' hours')::interval, $4, $5)`,
    [id, adminId, String(DURACION_H), ip || null, (agente || '').slice(0, 300)]
  );
  await consultar('UPDATE admin SET ultimo_acceso = now() WHERE id = $1', [adminId]);
  return id;
}

export async function cerrarSesion(id) {
  if (id) await consultar('DELETE FROM sesion WHERE id = $1', [id]);
}

/** Devuelve el admin de la sesión, o null. Renueva si está por vencer. */
export async function adminDe(id) {
  if (!id || !/^[a-f0-9]{64}$/.test(id)) return null;
  const { rows } = await consultar(
    `SELECT a.id, a.usuario, a.nombre, a.rol, s.expira_en
       FROM sesion s JOIN admin a ON a.id = s.admin_id
      WHERE s.id = $1 AND s.expira_en > now() AND a.activo`,
    [id]
  );
  if (!rows.length) return null;
  const a = rows[0];
  const quedan = (new Date(a.expira_en) - Date.now()) / 3600_000;
  if (quedan < RENOVAR_SI_QUEDA_MENOS_DE_H) {
    await consultar(
      `UPDATE sesion SET expira_en = now() + ($2 || ' hours')::interval WHERE id = $1`,
      [id, String(DURACION_H)]
    );
  }
  return { id: a.id, usuario: a.usuario, nombre: a.nombre, rol: a.rol };
}

// ── Cookie ───────────────────────────────────────────────────────────────

export function leerCookie(req) {
  const crudo = req.headers.cookie;
  if (!crudo) return null;
  for (const parte of crudo.split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === COOKIE) return parte.slice(i + 1).trim();
  }
  return null;
}

export function ponerCookie(res, valor, seguro) {
  const partes = [
    COOKIE + '=' + valor,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + (valor ? DURACION_H * 3600 : 0),
  ];
  if (seguro) partes.push('Secure');
  res.setHeader('Set-Cookie', partes.join('; '));
}

export const borrarCookie = (res, seguro) => ponerCookie(res, '', seguro);
