# Publicar

El sitio es estático: HTML, módulos ES e imágenes. No hay backend que
desplegar — el catálogo sale de Supabase desde el navegador.

El hosting de verdad es **Hostinger**, en `rocketcards.com.py`. Vercel queda
como vista previa (`rocket-cards-web.vercel.app`), útil para mirar un cambio
antes de publicarlo.

## Qué se publica

El build (`scripts/build.mjs`) copia a `dist/` **sólo** esto:

| En `dist/` | Viene de |
|---|---|
| `index.html` | `Rocket Cards - Home.dc.html` |
| `admin.html` | el panel |
| `rocketcards-config.js` | url y anon key de Supabase (la anon key es pública) |
| `.htaccess` | reescritura de URLs y cabeceras |
| `support.js` | runtime de la plantilla |
| `reveal.js` | animación de entrada por scroll |
| `assets/` | logo, fotos de catálogo y de cartas |
| iconos | favicon, apple-touch-icon, manifest |

**No se publica** `uploads/` (el PDF del proyecto y fotos de WhatsApp),
`screenshots/`, `.thumbnail`, `.claude/`, `.env` ni `db/`, que son los
scripts de la base.

La lista es blanca a propósito: con una lista negra, cualquier archivo nuevo
que caiga en la carpeta se publicaría sin que nadie lo note. Si agregás un
archivo que la página necesita, sumalo a `INCLUDE` en `scripts/build.mjs` o
no va a subir.

## Hostinger

### Automático, con cada push

Hay un workflow en [`.github/workflows/publicar.yml`](.github/workflows/publicar.yml)
que construye y sube por FTPS a `public_html/` cada vez que se empuja a
`main`. Sube sólo lo que cambió, no los 1,5 MB de fotos de nuevo.

Para que funcione hay que cargar tres secretos en GitHub
(Settings → Secrets and variables → Actions). Los datos salen de
hPanel → Archivos → Cuentas FTP:

| Secreto | Qué es |
|---|---|
| `FTP_SERVER` | el host, sin `ftp://` adelante |
| `FTP_USERNAME` | usuario de la cuenta FTP |
| `FTP_PASSWORD` | su contraseña |

Conviene crear una cuenta FTP aparte para esto, con acceso sólo a
`public_html/`, en vez de usar la principal.

### A mano

```bash
npm run build
```

y subís el **contenido** de `dist/` a `public_html/` por el Administrador de
archivos de hPanel o por FTP. Ojo: el contenido, no la carpeta — en
`public_html/` tiene que quedar `index.html`, no `dist/index.html`.

Que no se te escape el `.htaccess`: empieza con punto y los clientes de FTP
lo esconden salvo que les pidas mostrar archivos ocultos.

### Lo que hace el `.htaccess`

Es lo único que no es obvio de este despliegue.

El sitio tiene URLs reales —`/catalogo`, `/producto/pitch-black-etb`— que no
corresponden a ningún archivo. Sin reescritura, entrar directo a `/catalogo`
da 404, y entrar directo es justo lo que pasa cuando alguien comparte un link
o lo abre desde Google. La regla sirve el archivo si existe y, si no,
devuelve `index.html` para que el router del cliente resuelva.

También fuerza HTTPS. **Si todavía no emitiste el certificado** en
hPanel → Sitios web → SSL, comentá esas tres líneas primero: redirigir a
https sin certificado deja el sitio inaccesible.

## Vercel (vista previa)

`vercel.json` ya define el build y la carpeta de salida; cada push a `main`
redeploya solo. El rewrite de ahí hace lo mismo que el `.htaccess`.

Dos cosas de esa configuración que conviene no tocar sin saber:

- **No hay `cleanUrls`.** Con `cleanUrls: true`, Vercel responde un 308 de
  `/index.html` hacia `/`, así que el destino del rewrite dejaba de resolver
  y `/catalogo` y `/producto/*` devolvían 404.
- **`vercel.json` no admite comentarios.** Su esquema declara
  `additionalProperties: false`: cualquier clave inventada —aunque empiece
  con guion bajo— invalida el archivo y Vercel falla el deploy antes de
  compilar, con todos los commits siguientes en error. Las explicaciones van
  acá.

## URLs

| URL | Vista |
|---|---|
| `/` | inicio |
| `/catalogo` | catálogo completo |
| `/catalogo/sellados` · `/catalogo/sobres` · `/catalogo/etb` | catálogo filtrado |
| `/producto/<nombre-del-producto>` | ficha de producto |
| `/privacidad` · `/terminos` | legales |
| `/admin.html` | panel de administración |

El slug del producto sale de su nombre. Un enlace viejo con el id
(`/producto/ME-PB-ETB`) sigue funcionando: la app lo resuelve y corrige la
URL al slug. Un producto inexistente lleva al catálogo, no a una ficha rota.

El botón atrás del navegador funciona entre vistas. Filtrar dentro del
catálogo cambia la URL pero no apila historial, así "atrás" no te hace
recorrer filtro por filtro.

## Probarlo local

```bash
npm run preview
```

Construye `dist/` y lo sirve en http://localhost:4322 con el mismo fallback
de rutas que Hostinger y Vercel, así podés entrar directo a
`/catalogo/sobres` o a `/admin.html` y funciona.

Ese servidor de desarrollo **no lee el `.htaccess`**: el fallback lo hace por
su cuenta. Si tocás las reglas de reescritura, la prueba de verdad es en
Hostinger.

## DNS

El dominio `rocketcards.com.py` está delegado a Cloudflare y apunta a la
tienda vieja de Shopify. Hay un pedido pendiente en NIC Paraguay para mover
los nameservers a Hostinger (`solar.dns-parking.com`, `lunar.dns-parking.com`),
donde la zona ya existe.

Para comprobar si NIC ya lo aplicó:

```bash
nslookup -type=NS rocketcards.com.py b.dns.py
```

Mientras devuelva los de Cloudflare, el cambio no entró y el dominio sigue
mostrando lo viejo. Cuando devuelva los de Hostinger, manda la zona de
Hostinger y aparece este sitio.

## Antes de publicar

Hay textos pendientes de completar, marcados como `[PENDIENTE — …]` en la
política de privacidad y en los términos: razón social, RUC, domicilio, email
y teléfono de contacto, medios de pago y plazo de cambios.

```bash
grep -o "\[PENDIENTE[^]]*\]" "Rocket Cards - Home.dc.html" | sort -u
```

El WhatsApp ya quedó configurado en `595981377541`.
