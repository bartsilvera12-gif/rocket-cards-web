// CardFace — la cara de una carta: un producto real de la tienda.
// El marco, el foil y la cinta de rareza son propios; la foto y los datos
// salen del catálogo de Rocket Cards.

import { h, memo, alpha } from './react.js';
import { RARITY } from './data.js';

function CardFaceBase({ card, style, className }) {
  const r = RARITY[card.rarity];
  const vars = {
    '--k': r.ink,
    '--k2': r.ink2,
    '--kSoft': alpha(r.ink, 0.22),
    '--hueSoft': alpha(r.ink, 0.16),
    ...style,
  };
  return h('div', {
    className: 'rcpo-cf' + (card.holo ? ' is-holo' : '') + (className ? ' ' + className : ''),
    style: vars,
  },
    h('div', { className: 'rcpo-cf-inner' },
      h('div', { className: 'rcpo-cf-top' },
        h('span', { className: 'rcpo-cf-chip' }, r.label),
        card.offer
          ? h('span', { className: 'rcpo-cf-off' }, '-' + card.discount + '%')
          : null
      ),
      h('div', { className: 'rcpo-cf-art' },
        h('div', { className: 'rcpo-cf-rays' }),
        h('img', { className: 'rcpo-cf-img', src: card.img, alt: '', loading: 'lazy', draggable: false }),
        h('div', { className: 'rcpo-cf-holo' })
      ),
      h('div', { className: 'rcpo-cf-set' }, card.set),
      h('div', { className: 'rcpo-cf-name' }, card.name),
      h('div', { className: 'rcpo-cf-foot' },
        h('span', { className: 'rcpo-cf-price' }, card.priceLabel),
        card.oldLabel ? h('s', { className: 'rcpo-cf-old' }, card.oldLabel) : null
      )
    ),
    h('div', { className: 'rcpo-cf-mark' }, 'RC'),
    h('div', { className: 'rcpo-cf-shine' })
  );
}

export const CardFace = memo(CardFaceBase);
export default CardFace;
