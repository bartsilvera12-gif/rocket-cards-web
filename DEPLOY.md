# Subir a Vercel

El sitio es estático: HTML + módulos ES + imágenes. No hay dependencias que instalar.

## Qué se publica

El build (`scripts/build.mjs`) copia a `dist/` **sólo** esto:

| En `dist/` | Viene de |
|---|---|
| `index.html` | `Rocket Cards - Home.dc.html` |
| `support.js` | runtime de la plantilla |
| `reveal.js` | animación de entrada por scroll |
| `assets/` | logo, fotos de catálogo y de cartas |

**No se publica** `uploads/` (11 MB: el PDF del proyecto y fotos de WhatsApp),
`screenshots/`, `.thumbnail`, `.claude/`, `.env`, ni `server/`, `db/` y
`admin/`, que son del panel y no tienen nada que hacer en el sitio estático.

La lista es blanca a propósito: con una lista negra, cualquier archivo nuevo que
caiga en la carpeta se publicaría sin que nadie lo note. Si agregás un archivo que
la página necesita, sumalo a `INCLUDE` en `scripts/build.mjs` o no va a subir.

## Deploy

### Opción A — desde Git (recomendado)

1. Subí el repo a GitHub/GitLab.
2. En Vercel: **Add New → Project** e importá el repo.
3. No toques la configuración: `vercel.json` ya define el build y la carpeta de salida.
4. **Deploy**.

Cada push a la rama principal redeploya solo.

### Opción B — desde tu máquina

```bash
npx vercel --prod
```

La primera vez pregunta a qué cuenta y proyecto asociarlo.

## URLs

Cada vista tiene su dirección real. No aparece `dc.html` en ningún lado.

| URL | Vista |
|---|---|
| `/` | inicio |
| `/catalogo` | catálogo completo |
| `/catalogo/sellados` · `/catalogo/sobres` · `/catalogo/etb` | catálogo filtrado |
| `/producto/<nombre-del-producto>` | ficha de producto |
| `/privacidad` · `/terminos` | legales |

El slug del producto sale de su nombre. Un enlace viejo con el id
(`/producto/ME-PB-ETB`) sigue funcionando: la app lo resuelve y corrige la URL
al slug. Un producto inexistente lleva al catálogo, no a una ficha rota.

El botón atrás del navegador funciona entre vistas. Filtrar dentro del catálogo
cambia la URL pero no apila historial, así "atrás" no te hace recorrer filtro
por filtro.

Para que esto ande, el servidor tiene que devolver `index.html` en cualquier ruta
que no sea un archivo real; `vercel.json` ya lo hace con un rewrite.

Dos cosas de esa configuración que conviene no tocar sin saber:

- **No hay `cleanUrls`.** Con `cleanUrls: true`, Vercel responde un 308 de
  `/index.html` hacia `/`, así que el destino del rewrite dejaba de resolver y
  `/catalogo` y `/producto/*` devolvían 404.
- **`vercel.json` no admite comentarios.** Su esquema declara
  `additionalProperties: false`: cualquier clave inventada —aunque empiece con
  guion bajo— invalida el archivo y Vercel falla el deploy antes de compilar,
  con todos los commits siguientes en error. Las explicaciones van acá.

Para comprobar el archivo antes de subir:

```bash
curl -sL https://openapi.vercel.sh/vercel.json -o /tmp/s.json
python -c "import json,jsonschema;jsonschema.Draft7Validator(json.load(open('/tmp/s.json'))).validate({k:v for k,v in json.load(open('vercel.json')).items() if k!='\$schema'})"
```

## Probarlo local, igual que en producción

```bash
npm run preview
```

Construye `dist/` y lo sirve en http://localhost:4322 con el mismo fallback de
rutas que Vercel, así podés entrar directo a `/catalogo/sobres` y funciona.

Para editar sin build, el servidor sobre la carpeta raíz sigue sirviendo
(http://localhost:4321), pero ahí las rutas profundas dan 404 porque
`python -m http.server` no tiene fallback.

## Detalles de la configuración

- **La página se sirve en `/`.** El archivo fuente se llama
  `Rocket Cards - Home.dc.html` porque así lo exporta la herramienta de diseño;
  el build lo copia como `index.html`, así la URL queda limpia y sin redirecciones.
  El runtime no depende del nombre del archivo.
- **Caché.** Las imágenes se cachean 1 hora con `stale-while-revalidate` de 7 días.
  El HTML y los scripts se revalidan siempre, así un deploy se ve al instante.
  Si las fotos de productos casi no cambian, podés subir `max-age` en `vercel.json`;
  como los nombres de archivo no llevan hash, un valor muy alto haría que reemplazar
  una foto con el mismo nombre tarde en verse.
- **Cabeceras de seguridad:** `nosniff`, `Referrer-Policy` y `X-Frame-Options`.

## Antes de publicar

Hay textos pendientes de completar en el sitio, marcados como `[PENDIENTE — …]`
en la política de privacidad y en los términos: razón social, RUC, domicilio,
email y teléfono de contacto, medios de pago y plazo de cambios.

```bash
grep -o "\[PENDIENTE[^]]*\]" "Rocket Cards - Home.dc.html" | sort -u
```

El WhatsApp ya quedó configurado en `595981377541`.

## El panel no va en Vercel

Vercel corre funciones que arrancan y mueren con cada pedido, así que no puede
sostener la conexión `LISTEN` contra Postgres ni el stream SSE que mantienen el
catálogo al día. El panel necesita un host donde el proceso quede corriendo
(un VPS, Railway, Render, Fly). Ver [ADMIN.md](ADMIN.md).

Mientras tanto el sitio de Vercel sigue andando igual que siempre: usa el
catálogo escrito dentro de la página y ni intenta hablar con la API.
