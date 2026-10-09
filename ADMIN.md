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
| **Productos** | Alta, baja y edición. El precio, el stock y el interruptor de visible se guardan al salir del campo. Las fotos se suben desde el mismo formulario. |
| **Nuevos ingresos** | El orden del carrusel de la portada, hasta 12 productos. |
| **Categorías** | Nombre, bajada y orden. La clave sale en la URL y no se cambia desde acá. |
| **Configuración** | Las cinco cartas de la portada y los datos de la tienda: WhatsApp, Instagram, la descripción del pie. |

Arriba a la derecha:

- **EN VIVO · v12** — suscrito, mostrando la versión 12 del catálogo.
- **NOVEDAD** — alguien más cambió algo mientras estabas escribiendo. La
  pantalla no se repinta hasta que soltás el campo, para no sacarte el cursor
  de las manos.
- **SIN CONEXIÓN** — se cortó el websocket. Reconecta solo.

Si dos personas tienen el panel abierto, los cambios de una aparecen en la
pantalla de la otra sin recargar. Y en la tienda también.

### Fotos

Cada producto tiene una **galería de hasta 10 fotos**. Se cargan desde el
formulario del producto arrastrándolas desde la carpeta de la compu al
recuadro, o tocándolo para elegir varias a la vez. Van a un bucket de
Supabase Storage (`rocketcards`): no hace falta meterlas al repo ni volver a
publicar el sitio.

La primera foto es la **portada**: es la que se ve en tarjetas, carruseles y
carrito (se copia al campo `img`). En la ficha del producto aparecen todas,
con miniaturas para cambiar de foto. Se reordenan con ← →, la ★ pasa una a
portada y la ✕ la quita de la galería.

Antes de subir, el navegador **la achica a 1000px de lado y la pasa a WebP**.
Las fotos salen del teléfono con 4000px y 4 MB; subirlas tal cual es
exactamente el problema que ya arreglamos una vez a mano con
`scripts/optimize-images.py`, y no conviene que vuelva a entrar por la puerta
del panel. Si el navegador no sabe escribir WebP, sube el original.

El nombre lleva un timestamp, así reemplazar una foto no pisa la anterior:
quien tenga la página abierta sigue viendo su copia en caché hasta que
recargue.

Las rutas viejas de `assets/` siguen funcionando — el campo acepta las dos
cosas. Lo que **no** acepta es una URL de otro sitio: si no, el panel sería
una forma de incrustar contenido de terceros en la tienda. Leer el bucket
puede cualquiera (son fotos de productos); subir, reemplazar y borrar, sólo
el admin.

### La portada y los datos de la tienda

En **Configuración** hay dos cosas.

**Las cinco cartas del abanico**, numeradas de izquierda a derecha —la 3 es la
del centro—. De cada una se cambia la foto y la descripción. Lo que **no** se
edita es la inclinación, el tamaño ni la profundidad: el abanico está
calibrado para que las cinco se superpongan bien en cualquier pantalla, y un
número mal puesto lo rompe sin forma obvia de volver atrás.

La página sólo acepta la portada de la base si vienen **las cinco**. Con menos
se queda con las fotos que ya tenía, porque un abanico incompleto se ve peor
que uno viejo.

**Los datos de la tienda** salen de la tabla `config`, que guarda la etiqueta
y la ayuda al lado de cada valor. El panel dibuja el formulario leyendo esa
tabla, así que **agregar un ajuste nuevo es un INSERT, sin tocar el panel**:

```sql
insert into rocketcards.config (clave, valor, etiqueta, ayuda, orden)
values ('email', 'hola@rocketcards.com.py', 'Email de contacto', 'Para los textos legales', 4);
```

Dos campos se limpian solos al guardar, porque son los errores que todo el
mundo comete y dejan los enlaces rotos sin que nada avise:

- **WhatsApp** se queda sólo con los números. Si pegás `0981 377-541` lo
  guarda igual, pero avisa si no parece un número con código de país.
- **Instagram** se come la arroba y la URL entera: podés pegar
  `https://instagram.com/rocketcardspy/` y guarda `rocketcardspy`.

Debajo de cada uno se muestra cómo queda el enlace final, que es lo que no se
ve escribiendo el dato crudo.

### Destacado

El interruptor **Destacado** pone una etiqueta dorada en la tarjeta y manda
el producto al principio del catálogo.

Si el producto está sin stock gana **AGOTADO**: es lo único que le cambia la
decisión a quien está mirando.

(Esto reemplaza al campo `premium`, que estaba en los datos y no se mostraba
en ningún lado. El script lo renombra solo.)

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

- Borrar del bucket la foto vieja cuando se reemplaza: por ahora queda
  ocupando lugar. No molesta a nadie, pero con el tiempo se acumula.
- Pedidos del lado del servidor: el carrito sigue siendo del navegador y el
  cierre es por WhatsApp.
