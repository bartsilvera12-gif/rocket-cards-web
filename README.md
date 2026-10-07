# Rocket Cards

Tienda de Pokémon TCG en Paraguay: sellados, sobres y Elite Trainer Box.
Sitio estático, sin framework ni dependencias de runtime.

## Cómo está armado

La página se arma con una plantilla declarativa propia (`<x-dc>` + `support.js`,
que monta React 18 desde CDN). Encima hay tres módulos ES escritos a mano:

| Módulo | Qué hace |
|---|---|
| [`pack-opening/`](pack-opening) | Apertura de sobres en 3D: gesto de corte, cartas con rareza y efectos |
| [`reveal.js`](reveal.js) | Animación de entrada por scroll de cada sección |
| [`scripts/`](scripts) | Build de producción y servidor de desarrollo |

Nada de esto necesita `npm install`: las únicas dependencias son React y ReactDOM,
que llegan por `<script>` desde unpkg.

### Apertura de sobres

Una máquina de estados —`idle → cutting → cut → opening → cardsEmerging →
revealing → completed`— con Pointer Events, así el gesto es el mismo en mouse,
touch y lápiz. Las cartas que salen son productos reales del catálogo y su
rareza sale del descuento, o del precio si no está en oferta.

El arrastre y el corte escriben `transform` directo sobre el DOM: un gesto
completo no dispara ni un render de React. Sólo se animan `transform`, `opacity`
y `filter`; las partículas van en un `<canvas>`, no en nodos.

### Rutas

Una sola página, pero cada vista tiene su URL real: `/`, `/catalogo`,
`/catalogo/sobres`, `/producto/<slug>`, `/privacidad`, `/terminos`.
El botón atrás funciona entre vistas.

## Desarrollo

```bash
npm run preview     # build + servidor como en producción, en :4322
npm run build       # genera dist/
```

Para editar sin build alcanza con servir la carpeta raíz, pero ahí las rutas
profundas dan 404 porque no hay fallback.

## Deploy

Va a Vercel; los detalles están en [DEPLOY.md](DEPLOY.md).

## Pendientes

Los textos legales tienen marcadores `[PENDIENTE — …]` para completar con los
datos reales del comercio (razón social, RUC, domicilio, medios de pago).

---

Pokémon y las marcas asociadas pertenecen a sus respectivos titulares.
Rocket Cards es un comercio independiente, no afiliado ni patrocinado por
The Pokémon Company.
