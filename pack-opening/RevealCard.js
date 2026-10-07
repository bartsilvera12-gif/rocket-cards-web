// RevealCard — una ranura del mazo: la cara de la carta más la silueta
// que la tapa mientras dura el suspenso de las rarezas altas.
// No tiene estado propio; su transform lo escribe CardStack en el rAF.

import { h, memo } from './react.js';
import CardFace from './CardFace.js';

function RevealCardBase({ card, slotRef, silhouetteRef, isTop, handlers }) {
  return h('div', {
    className: 'rcpo-slot' + (isTop ? ' is-top' : ''),
    ref: slotRef,
    ...(isTop && handlers ? handlers : null),
    'aria-hidden': isTop ? undefined : 'true',
  },
    h(CardFace, { card }),
    isTop ? h('div', { className: 'rcpo-silhouette', ref: silhouetteRef, style: { opacity: 0 } }) : null
  );
}

export const RevealCard = memo(RevealCardBase);
export default RevealCard;
