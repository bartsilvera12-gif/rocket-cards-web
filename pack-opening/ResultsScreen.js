// ResultsScreen — el resumen del sobre: los cinco productos que salieron.
// Cada uno es clickeable y abre su ficha en la tienda.

import { h, useEffect, useRef } from './react.js';
import CardFace from './CardFace.js';
import { RARITY, bestOf, openProduct, hasOffers } from './data.js';
import { tween, easeOutCubic, easeOutBack, reducedMotion } from './anim.js';

export function ResultsScreen({ cards, onAgain }) {
  const root = useRef(null);
  const items = useRef([]);

  useEffect(() => {
    const reduce = reducedMotion();
    const stops = [];
    if (root.current) {
      stops.push(tween({
        from: 0, to: 1, duration: reduce ? 160 : 380, ease: easeOutCubic,
        onUpdate: (v) => { if (root.current) root.current.style.opacity = v; },
      }));
    }
    items.current.forEach((el, i) => {
      if (!el) return;
      el.style.opacity = '0';
      stops.push(tween({
        from: 0, to: 1, duration: reduce ? 180 : 520, delay: reduce ? 0 : 120 + i * 65,
        ease: easeOutBack,
        onUpdate: (v) => {
          el.style.opacity = String(Math.min(1, v * 1.6));
          el.style.transform = 'translate3d(0,' + ((1 - v) * 26).toFixed(1) + 'px,0) scale(' + (0.86 + v * 0.14).toFixed(3) + ') rotate(' + ((1 - v) * (i % 2 ? 5 : -5)).toFixed(2) + 'deg)';
        },
      }));
    });
    return () => stops.forEach((s) => s && s());
  }, [cards]);

  const best = bestOf(cards);
  const br = RARITY[best.rarity];
  const offers = hasOffers();

  return h('div', { className: 'rcpo-results', ref: root, style: { opacity: 0 } },
    h('h3', { className: 'rcpo-rtitle' }, 'Tu sobre'),
    h('div', { className: 'rcpo-rgrid' },
      cards.map((c, i) => h('button', {
        key: c.id, className: 'rcpo-rcard', type: 'button',
        title: c.name + ' · ' + c.priceLabel,
        'aria-label': 'Ver ' + c.name,
        onClick: () => openProduct(c.productId),
        ref: (el) => { items.current[i] = el; },
      }, h(CardFace, { card: c })))
    ),
    h('p', { className: 'rcpo-best' },
      'Lo mejor: ', h('b', { style: { color: br.ink } }, best.name)
    ),
    h('p', { className: 'rcpo-hintline' }, 'Tocá una carta para ver el producto'),
    h('div', { className: 'rcpo-actions' },
      h('button', { className: 'rcpo-btn', onClick: onAgain }, 'Abrir otro'),
      h('a', { className: 'rcpo-btn ghost', href: offers ? '#ofertas' : '#sellados' },
        offers ? 'Ver ofertas' : 'Ver catálogo')
    )
  );
}

export default ResultsScreen;
