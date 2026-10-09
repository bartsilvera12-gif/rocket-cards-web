# Panel de administración

El catálogo vive en Supabase y se edita desde `/admin.html`, sin tocar código
ni volver a publicar el sitio.

No hay servidor propio: la tienda y el panel hablan directo con Supabase por
`supabase-js`, igual que
[tienda-aguara-vulka](https://github.com/bartsilvera12-gif/tienda-aguara-vulka).
Por eso todo esto funciona en Vercel.

## Por qué no se sobrecarga la base

Nadie pregunta cada tantos segundos.

```
  panel ──escribe──► Supabase ──Realtime (websocket)──► navegadores abiertos
```

La página lee el catálogo **una vez** al cargar, con `rocketcards.catalogo()`
—un viaje, no tres—, y después se queda suscrita. Supabase le avisa por
websocket cuando una fila cambia, y recién ahí vuelve a leer. Mil personas
mirando la tienda con el catálogo quieto son **cero consultas**.

Para que eso ande, las tablas tienen que estar en la publicación
`supabase_realtime`; el script las agrega solo.

## Lo que de verdad protege los datos

**La anon key es pública.** Va escrita dentro de la página, cualquiera que
abra el sitio la puede leer y usar contra la API. No es un secreto y no hay
forma de que lo sea.

Lo que separa el catálogo de internet es **RLS**:

| | anon (cualquiera) | admin@rocketcards.com |
|---|---|---|
| Productos publicados | lee | lee |
| Productos ocultos | no los ve | lee |
| Escribir cualquier cosa | **no** | sí |
| Historial de cambios | **no** | lee |

Escribir exige `rocketcards.es_admin()`, que compara el email del JWT —lo
firma el servidor de auth, el navegador no lo puede falsificar— contra
`admin@rocketcards.com`.

> **Esto es distinto de lo que hace aguara-vulka**, y a propósito. Allá las
> políticas dicen `for all to authenticated using (true)`: alcanza con *estar
> autenticado*. Como el registro está abierto en esa instancia de Supabase,
> cualquiera se crea una cuenta en diez segundos y ya puede escribir por la
> API. El chequeo del email que hay en su `admin.html` corre en el navegador:
> sólo esconde la pantalla, no frena nada. Conviene arreglarlo allá también.

El chequeo de email que hay en nuestro `admin.html` tiene el mismo alcance
—esconder la pantalla—, pero acá no es lo único: abajo está RLS.

## Instalación

### 1. Crear el esquema

Supabase → **SQL Editor** → pegar `db/rocketcards.sql` entero → Run.

Crea el esquema `rocketcards`, las tablas, los triggers, las políticas, y
agrega las tablas a Realtime. Es idempotente: se puede volver a correr.

Todo el DDL va en una transacción y termina con
`NOTIFY pgrst, 'reload schema';`, una vez al final.

> Si ya habías corrido la versión anterior, el script **borra las tablas
> `admin` y `sesion`**, que eran del login propio. Ahora de eso se encarga
> Supabase Auth, y una tabla con hashes de contraseña en un esquema publicado
> por PostgREST es justo lo que no conviene tener de más.

### 2. Exponer el esquema

Settings → API → **Exposed schemas** → agregar `rocketcards`.

Sin esto PostgREST no lo ve y el panel avisa *"PostgREST no ve el esquema"*.

### 3. Cargar el catálogo actual

```bash
npm run db:semilla
```

y pegar `db/semilla.sql` en el SQL Editor. Es el puente de una sola vez: de
ahí en adelante la fuente de verdad es la base.

### 4. Crear el usuario

Supabase → Authentication → Users → **Add user**, con email
`admin@rocketcards.com` y la contraseña que elijas. Marcá *auto confirm*.

Ese email está en dos lados y tienen que coincidir:

- `rocketcards-config.js` → `adminEmail` (para la pantalla)
- `db/rocketcards.sql` → `es_admin()` (el que manda de verdad)

Si querés cambiarlo, cambialo en los dos y volvé a correr el SQL.

### 5. Listo

El panel sale del mismo deploy que la tienda:

- Local: `npm run preview` → http://localhost:4322/admin.html
- Vercel: `https://tu-sitio.vercel.app/admin.html`

## El panel

| Pestaña | Qué hace |
|---|---|
| **Productos** | Alta, baja y edición. El precio, el stock y el interruptor de visible se guardan al salir del campo. |
| **Nuevos ingresos** | El orden del carrusel de la portada, hasta 12 productos. |
| **Categorías** | Nombre, bajada y orden. La clave sale en la URL y no se cambia desde acá. |
| **Historial** | Quién cambió qué y cuándo, con el antes y el después de cada campo. |

Arriba a la derecha:

- **EN VIVO · v12** — suscrito, mostrando la versión 12 del catálogo.
- **NOVEDAD** — alguien más cambió algo mientras estabas escribiendo. La
  pantalla no se repinta hasta que soltás el campo, para no sacarte el cursor
  de las manos.
- **SIN CONEXIÓN** — se cortó el websocket. Reconecta solo.

Si dos personas tienen el panel abierto, los cambios de una aparecen en la
pantalla de la otra sin recargar. Y en la tienda también.

### Reordenar el carrusel

Va por una función (`rocketcards.guardar_nuevos`) y no con dos `UPDATE`
sueltos. Por PostgREST cada llamada es su propia transacción, así que "borro
el orden y después lo escribo" dejaría el carrusel vacío un instante para
quien esté mirando la tienda. Dentro de la función es una sola transacción, y
Realtime manda un aviso en vez de dos.

## La página sigue andando sin Supabase

El catálogo escrito dentro de `Rocket Cards - Home.dc.html` **no se borró**.
Es lo que se ve mientras llega el de la base, y lo que queda si Supabase no
contesta. Nadie ve una tienda vacía por un problema de red.

También es la red para un error de configuración: si falta exponer el
esquema, o la anon key está mal, la tienda se ve igual. El que avisa es el
panel.

## Qué queda afuera

Probé contra tu Supabase real que el panel carga, que `supabase-js` y la
config se enganchan, que el login llega al servidor de auth y traduce bien el
error, y que la tienda cae a su catálogo propio cuando la API responde
`permission denied`.

Lo que **no** pude probar, porque hace falta correr el SQL nuevo y crear el
usuario —y no voy a crear cuentas en tu Supabase—:

- entrar al panel y editar de verdad;
- que las políticas dejen pasar al admin y frenen a los demás;
- que Realtime empuje los cambios a la tienda.

Después del paso 4: entrá al panel, cambiá un precio con la tienda abierta en
otra pestaña, y fijate si cambia sola. Si algo falla, el panel dice el motivo
en vez de quedarse mudo.

Tampoco hay todavía:

- Subida de imágenes desde el panel: las fotos se siguen subiendo a `assets/`
  con el repo, y en el panel se escribe la ruta. (Supabase Storage sería el
  paso siguiente.)
- Pedidos del lado del servidor: el carrito sigue siendo del navegador y el
  cierre es por WhatsApp.
