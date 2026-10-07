// Contenido del sobre: productos reales de la tienda.
//
// El catálogo y las acciones de carrito llegan por `window.ROCKET_SHOP`, que
// publica la página (ver el puente en el script de Rocket Cards - Home.dc.html).
// Si ese puente no estuviera, el módulo sigue funcionando con un catálogo
// mínimo de respaldo en vez de romperse.

import { rand } from './anim.js';

export const RARITY = {
  common: {
    key: 'common', label: 'Común', rank: 0,
    ink: '#9AA3AD', ink2: '#464E57', foil: 'rgba(154,163,173,.30)',
    glow: 'rgba(154,163,173,.45)', suspense: 0, slow: 1,
  },
  uncommon: {
    key: 'uncommon', label: 'Poco común', rank: 1,
    ink: '#44C98D', ink2: '#156B45', foil: 'rgba(68,201,141,.34)',
    glow: 'rgba(68,201,141,.55)', suspense: 0, slow: 1,
  },
  rare: {
    key: 'rare', label: 'Rara', rank: 2,
    ink: '#3FA9F5', ink2: '#12527F', foil: 'rgba(63,169,245,.40)',
    glow: 'rgba(63,169,245,.75)', suspense: 0, slow: 1.08,
  },
  epic: {
    key: 'epic', label: 'Épica', rank: 3,
    ink: '#B06BFF', ink2: '#4B1C87', foil: 'rgba(176,107,255,.46)',
    glow: 'rgba(176,107,255,.85)', suspense: 480, slow: 1.22,
  },
  legendary: {
    key: 'legendary', label: 'Legendaria', rank: 4,
    ink: '#F0B429', ink2: '#8A4B06', foil: 'rgba(240,180,41,.52)',
    glow: 'rgba(240,180,41,.95)', suspense: 980, slow: 1.55,
  },
};

export const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

const FALLBACK = [
  { id: 'X1', name: 'Booster Pack', set: 'Rocket Cards', img: '/assets/rocket-logo.png', price: 60000, stock: 10 },
];

const shop = () => (typeof window !== 'undefined' && window.ROCKET_SHOP) || {};

export function catalog() {
  const c = shop().catalog;
  return Array.isArray(c) && c.length ? c : FALLBACK;
}

/** Formato de precio: usa el de la página para no divergir. */
export function fmt(n) {
  const f = shop().fmt;
  if (typeof f === 'function') return f(n);
  return 'Gs. ' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export const isOffer = (p) => !!p.old && p.old > p.price;
export const discount = (p) => (isOffer(p) ? Math.round((1 - p.price / p.old) * 100) : 0);

/**
 * Rareza de un producto.
 * Si está en oferta manda el descuento — es lo que hace valioso el hallazgo.
 * Si no, manda el precio, que en esta tienda ordena bastante bien de sobre
 * suelto a Elite Trainer Box.
 */
export function rarityOf(p) {
  if (isOffer(p)) {
    const d = discount(p);
    if (d >= 40) return 'legendary';
    if (d >= 25) return 'epic';
    if (d >= 15) return 'rare';
    return 'uncommon';
  }
  if (p.price >= 1200000 || p.stock === 1) return 'legendary';
  if (p.price >= 600000) return 'epic';
  if (p.price >= 300000) return 'rare';
  if (p.price >= 100000) return 'uncommon';
  return 'common';
}

function toCard(p, i) {
  const r = rarityOf(p);
  return {
    id: p.id + '-' + i + '-' + ((Math.random() * 1e6) | 0),
    productId: p.id,
    name: p.name,
    set: p.set,
    img: p.img,
    price: p.price,
    priceLabel: fmt(p.price),
    oldLabel: isOffer(p) ? fmt(p.old) : '',
    discount: discount(p),
    offer: isOffer(p),
    soldOut: p.stock === 0,
    stock: p.stock,
    rarity: r,
    holo: RARITY[r].rank >= 2,
    tilt: rand(-2.4, 2.4),
  };
}

const byRank = (a, b) => RARITY[rarityOf(b)].rank - RARITY[rarityOf(a)].rank;
const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);

/**
 * Un sobre de 5 productos.
 * Primero las ofertas (si la tienda tiene alguna), después el resto del
 * catálogo. La última ranura siempre trae lo mejor del sobre: es la que
 * sostiene la tensión del reveal.
 */
export function openPack(size = 5) {
  const all = catalog().filter((p) => p.stock !== 0);
  const pool = all.length ? all : catalog();

  const offers = shuffle(pool.filter(isOffer));
  const rest = shuffle(pool.filter((p) => !isOffer(p)));
  const picked = offers.concat(rest).slice(0, Math.min(size, pool.length));

  // Si el catálogo es más chico que el sobre, se repite sin quedar corto.
  while (picked.length < size) picked.push(pool[picked.length % pool.length]);

  // El mejor va último.
  const best = picked.slice().sort(byRank)[0];
  const i = picked.indexOf(best);
  if (i >= 0 && i !== picked.length - 1) {
    picked.splice(i, 1);
    picked.push(best);
  }
  return picked.map(toCard);
}

export const bestOf = (cards) =>
  cards.reduce((b, c) => (RARITY[c.rarity].rank > RARITY[b.rarity].rank ? c : b), cards[0]);

export function addToCart(productId) {
  const f = shop().addToCart;
  if (typeof f === 'function') { f(productId); return true; }
  return false;
}
export function openProduct(productId) {
  const f = shop().openProduct;
  if (typeof f === 'function') { f(productId); return true; }
  return false;
}
/** Hay ofertas cargadas en la tienda. */
export const hasOffers = () => catalog().some(isOffer);
