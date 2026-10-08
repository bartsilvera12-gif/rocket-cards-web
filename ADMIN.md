# Panel de administración

Hasta ahora el catálogo estaba escrito a mano dentro de la página. Con esto
pasa a vivir en Postgres y se edita desde `/admin`, sin tocar código ni volver
a publicar el sitio.

## Por qué no se sobrecarga la base

La tienda **no consulta la base**. Ni una vez por visita.

```
  panel  ──escribe──►  Postgres  ──NOTIFY──►  servidor  ──SSE──►  navegadores
                                              (caché en
                                               memoria)
```

1. El servidor lee el catálogo entero **una sola vez** con `rc_catalogo()` y lo
   guarda en memoria, ya serializado.
2. Queda escuchando el canal `rocketcards` con `LISTEN`. Mientras nadie edite
   nada, esa conexión está quieta y no genera carga.
3. Cuando el panel cambia algo, un trigger sube `rc_version`, manda un
   `pg_notify`, y recién ahí el servidor vuelve a leer. **Una consulta por
   edición, no una por visita.**
4. Los navegadores abiertos reciben el aviso por `/api/eventos` (SSE) y
   refrescan solos. Tampoco preguntan cada tantos segundos: esperan.
5. Para el que recarga la página, `/api/catalogo` responde con `ETag`. Si ya
   tiene la versión actual, recibe un `304` sin cuerpo.

Mil personas mirando la tienda durante una hora, con el catálogo quieto, son
**cero consultas**.

Tres detalles que hacen que eso funcione de verdad:

- **Un aviso por transacción, no por fila.** Si corregís el stock de cuarenta
  productos de una, `rc_avisar_cambio()` manda un solo `NOTIFY`: la primera vez
  deja una marca local a la transacción y las siguientes salen sin hacer nada.
- **El `NOTIFY` viaja en el `COMMIT`.** Nadie se entera de un cambio que
  después se revirtió.
- **El que escucha tiene conexión propia.** `LISTEN` vive en la sesión, y las
  del pool se reciclan entre consultas. Si esa conexión se cae, se reconecta
  con espera creciente y **relee** apenas vuelve, porque mientras estuvo caída
  pudo perderse un aviso.

## Instalación

Hace falta Postgres 12 o más nuevo y Node 20.12 o más nuevo.

```bash
npm install
```

### 1. Crear la base

```bash
psql -U postgres -f db/rocketcards.sql
```

Crea la base `rocketcards`, las tablas, los triggers y el rol
`rocketcards_app`. El rol **nace sin contraseña** a propósito: un rol con la
contraseña escrita en un archivo del repo es un rol público. Poné la tuya:

```bash
psql -U postgres -d rocketcards -c "ALTER ROLE rocketcards_app PASSWORD 'la-que-elijas'"
```

El script se puede volver a correr cuantas veces quieras: no borra datos.

### 2. Cargar el catálogo actual

```bash
npm run db:semilla                                    # regenera db/semilla.sql
psql -U postgres -d rocketcards -f db/semilla.sql
```

`db/semilla.sql` sale de los arreglos `CATALOG`, `CATEGORIAS` y `NEW_IDS` que
todavía están en la página. Es el puente de una sola vez. De ahí en adelante la
fuente de verdad es la base.

### 3. Configurar el servidor

```bash
cp .env.ejemplo .env
```

y completá `DATABASE_URL` con la contraseña del paso 1. `.env` está en
`.gitignore`.

### 4. Crear el primer usuario

```bash
npm run admin:crear -- karen --dueno --nombre "Karen"
```

Pide la contraseña por teclado y no la muestra mientras la escribís. No se pasa
por argumento a propósito: los argumentos quedan en el historial del shell y en
la lista de procesos de la máquina.

El rol `dueno` puede todo, incluso ver y crear usuarios. `editor` sólo toca el
catálogo.

### 5. Levantar

```bash
npm run build
npm start
```

- Tienda: http://localhost:4000
- Panel: http://localhost:4000/admin

## El panel

| Pestaña | Qué hace |
|---|---|
| **Productos** | Alta, baja y edición. El precio, el stock y el interruptor de visible se guardan al salir del campo, sin abrir nada. |
| **Nuevos ingresos** | El orden del carrusel de la portada, hasta 12 productos. |
| **Categorías** | Nombre, bajada y orden. La clave sale en la URL y no se cambia desde acá. |
| **Historial** | Quién cambió qué y cuándo, con el antes y el después de cada campo. |
| **Usuarios** | Sólo para el dueño. Las contraseñas se ponen desde la terminal. |

Arriba a la derecha hay un indicador:

- **EN VIVO · v12** — conectado, mostrando la versión 12 del catálogo.
- **NOVEDAD · v13** — alguien más cambió algo mientras estabas escribiendo. La
  pantalla no se repinta hasta que soltás el campo, para no sacarte el cursor
  de las manos.
- **SIN CONEXIÓN** — se cortó el stream. Reconecta solo.

Si dos personas tienen el panel abierto, los cambios de una aparecen en la
pantalla de la otra sin recargar.

## La página sigue andando sin servidor

El catálogo escrito dentro de `Rocket Cards - Home.dc.html` **no se borró**.
Al cargar, la página pide `/api/catalogo`:

- Si hay servidor, lo reemplaza por el de la base y se queda escuchando.
- Si no (el sitio estático de Vercel, donde esa ruta devuelve el propio
  `index.html` por el fallback de rutas), se queda con el que ya tenía y ni
  abre el stream. No hay errores en la consola ni nada roto.

Así que hoy conviven dos despliegues:

| | Vercel (hoy) | Servidor con base |
|---|---|---|
| Catálogo | el del HTML | Postgres |
| Para cambiar un precio | editar y publicar | el panel |
| Panel | no hay | `/admin` |

Vercel corre funciones que arrancan y mueren con cada pedido, así que no puede
sostener un `LISTEN` ni un stream SSE abierto. Para tener el panel hace falta
un host donde el proceso quede corriendo: un VPS, Railway, Render, Fly. La
tienda puede seguir en Vercel apuntando a esa API, o servirse del mismo
proceso, que es lo que hace `npm start`.

## Seguridad

- Contraseñas con **scrypt** (nativo de Node), nunca en claro ni en la base ni
  en los logs.
- Sesiones en la base, cookie `HttpOnly` + `SameSite=Lax`, 12 horas con
  renovación. Con `DETRAS_DE_TLS=1` la cookie va además como `Secure`.
- Todo lo que escribe exige la cabecera `X-Rocket-Admin: 1`, que un formulario
  de otro sitio no puede poner sin preflight. Eso más `SameSite=Lax` cierra el
  CSRF.
- Diez intentos fallidos por IP y usuario cada 15 minutos. El contador vive en
  memoria: escribir en la base en cada intento fallido es justo lo que busca
  quien prueba contraseñas en masa.
- El login tarda lo mismo con un usuario que no existe que con una contraseña
  incorrecta, así nadie puede averiguar qué usuarios hay.
- Las rutas de imagen tienen que ser del propio sitio. Si no, el panel sería
  una forma de incrustar contenido de terceros en la tienda.
- El rol `rocketcards_app` no es dueño de nada: no puede borrar tablas ni
  cambiar el esquema, y sobre `auditoria` sólo puede insertar y leer, no
  reescribir el historial.
- `/admin` responde con `X-Robots-Tag: noindex, nofollow`.

## Qué queda afuera

Lo probé con un servidor de prueba que habla el mismo contrato, pero **no pude
correrlo contra un Postgres real**: en esta máquina no hay. Antes de ponerlo en
producción conviene hacer el recorrido completo una vez —crear la base, la
semilla, el usuario, y editar un producto con la tienda abierta en otra
pestaña— que es justo donde saldría cualquier error de tipeo del SQL.

Tampoco hay todavía:

- Subida de imágenes desde el panel: las fotos se siguen subiendo a `assets/`
  con el repo, y en el panel se escribe la ruta.
- Pedidos ni carrito del lado del servidor: el carrito sigue siendo del
  navegador y el cierre es por WhatsApp.
- Backups. Un `pg_dump` diario a otro disco es lo mínimo.
