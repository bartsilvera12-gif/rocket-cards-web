// CardStack — el mazo que sale del sobre y se descarta carta por carta.
//
// Toda la animación vive en un único rAF que escribe `transform` sobre los
// nodos de las cartas. React sólo se entera cuando cambia el índice, así que
// un arrastre completo no dispara un solo render.
//
// Posición de cada ranura: d = (k - vIndex) - progreso_de_arrastre.
// d = 0 es la carta de adelante; d = 1, 2, 3 son las que asoman por detrás.
// Avanzar de carta es simplemente tween-ear vIndex en 1.

import { h, useRef, useState, useEffect, useCallback, useMemo } from './react.js';
import RevealCard from './RevealCard.js';
import { Halo, rarityIntro, rarityReveal, rarityClear } from './RareEffects.js';
import { RARITY, openProduct } from './data.js';
import { clamp, onFrame, tween, makeSpring, easeOutQuint, easeOutCubic, vibrate, reducedMotion } from './anim.js';
import * as sfx from './audio.js';

const VISIBLE = 4;      // cuántas ranuras se dibujan a la vez
const SWIPE_RATIO = 0.3; // fracción del ancho de carta para considerar descarte
const FLICK = 0.65;      // px/ms: un golpe rápido descarta aunque no llegue al umbral

export function CardStack({ cards, emerging, live, emergeFrom, fxCtx, onComplete }) {
  const [index, setIndex] = useState(0);
  const stackRef = useRef(null);
  const haloRef = useRef(null);
  const silRef = useRef(null);
  const slots = useRef([]);
  if (slots.current.length !== cards.length) slots.current = cards.map(() => ({ current: null }));

  const S = useRef({
    x: makeSpring(0, { stiffness: 210, damping: 28 }),
    vIndex: 0,
    emerge: 0,
    zoom: 1,
    drag: { on: false, id: null, x0: 0, last: 0, lastT: 0, vx: 0, w: 1 },
    exit: null,     // { k, x, rot, op }
    busy: true,     // mientras dura el suspenso no se puede arrastrar
    geom: { emergeY: 180 },
  }).current;

  const ctx = useMemo(() => ({ ...fxCtx, haloRef }), [fxCtx]);

  // ── Presentación de la carta de adelante: suspenso → reveal ──
  const present = useCallback((i) => {
    const card = cards[i];
    if (!card) return;
    S.busy = true;
    const sil = silRef.current;
    const hold = rarityIntro(card, ctx);
    const rank = RARITY[card.rarity].rank;

    if (sil) sil.style.opacity = hold > 0 ? '1' : '0';
    if (hold > 0 && rank >= 4) {
      // Zoom de cámara: el mazo entero se acerca mientras dura la silueta.
      tween({ from: S.zoom, to: 1.13, duration: hold * 0.8, ease: easeOutCubic, onUpdate: (v) => { S.zoom = v; } });
    }

    const t = setTimeout(() => {
      if (sil) tween({ from: 1, to: 0, duration: rank >= 4 ? 420 : 240, ease: easeOutCubic, onUpdate: (v) => { sil.style.opacity = v; } });
      if (S.zoom !== 1) tween({ from: S.zoom, to: 1, duration: 620, ease: easeOutCubic, onUpdate: (v) => { S.zoom = v; } });
      rarityReveal(card, ctx);
      S.busy = false;
    }, hold);
    return () => clearTimeout(t);
  }, [cards, ctx, S]);

  // Cada vez que cambia la carta de adelante (y una vez terminado el emerge).
  useEffect(() => {
    if (!live || index >= cards.length) return;
    return present(index);
  }, [index, live, present, cards.length]);

  // ── Emerge: el mazo sale del sobre ──
  useEffect(() => {
    if (!emerging) return;
    S.geom.emergeY = emergeFrom || 180;
    const reduce = reducedMotion();
    return tween({
      from: 0, to: 1, duration: reduce ? 320 : 1050, ease: easeOutQuint,
      onUpdate: (v) => { S.emerge = v; },
    });
  }, [emerging, emergeFrom, S]);

  // ── El rAF: una sola pasada de escritura por frame ──
  useEffect(() => {
    return onFrame((now, dt) => {
      const stack = stackRef.current;
      if (!stack) return;

      // Si nada se mueve, no se escribe nada: el ticker sigue vivo pero el
      // mazo quieto no cuesta ni un write al DOM.
      if (!S.drag.on && S.x.settled()) { S.x.set(0); S.x.setVelocity(0); }
      const quiet = S.emerge === 1 && !S.drag.on && !S.exit && S.x.value === 0 &&
        Math.abs(S.vIndex - index) < 0.0005 && Math.abs(S.zoom - 1) < 0.0005;
      if (quiet && S.quiet) return;
      S.quiet = quiet;

      // Entrada del mazo desde dentro del sobre.
      const e = S.emerge;
      const ey = (1 - e) * S.geom.emergeY;
      const es = 0.46 + e * 0.54;
      const erx = (1 - e) * 64;
      stack.style.opacity = String(clamp(e * 2.4, 0, 1));
      stack.style.transform =
        'translate3d(0,' + ey.toFixed(2) + 'px,0) rotateX(' + erx.toFixed(2) + 'deg) scale(' + (es * S.zoom).toFixed(4) + ')';

      // Arrastre de la carta de adelante.
      if (!S.drag.on) S.x.step(dt);
      const x = S.x.value;
      const prog = clamp(Math.abs(x) / (S.drag.w * SWIPE_RATIO || 1), 0, 1);

      for (let k = index - 1; k <= index + VISIBLE; k++) {
        const ref = slots.current[k];
        const el = ref && ref.current;
        if (!el) continue;

        if (S.exit && S.exit.k === k) {
          el.style.opacity = String(S.exit.op);
          el.style.transform =
            'translate3d(' + S.exit.x.toFixed(1) + 'px,' + (Math.abs(S.exit.x) * 0.06).toFixed(1) + 'px,0) rotate(' + S.exit.rot.toFixed(2) + 'deg)';
          continue;
        }
        if (k < index) { el.style.opacity = '0'; continue; }

        const isTop = k === index;
        const d = Math.max(0, (k - S.vIndex) - (isTop ? 0 : prog));
        const tx = isTop ? x : 0;
        const rot = isTop ? x / 16 : d * 2.6 * (k % 2 ? 1 : -1);
        const scale = Math.max(0.5, 1 - d * 0.062);
        const ty = d * 26 + (isTop ? Math.abs(x) * 0.05 : 0);
        el.style.opacity = d > 2.7 ? '0' : '1';
        el.style.zIndex = String(40 - k);
        el.style.transform =
          'translate3d(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px,' + (-d * 36).toFixed(1) + 'px)' +
          ' rotate(' + rot.toFixed(2) + 'deg) scale(' + scale.toFixed(4) + ')';
      }

      // El halo acompaña a la carta de adelante.
      const halo = haloRef.current;
      if (halo) halo.style.transform = 'translate3d(' + (x * 0.9).toFixed(1) + 'px,0,0)';
    });
  }, [index, S]);

  // ── Gestos de swipe ──
  const advance = useCallback((dir) => {
    const k = index;
    const w = S.drag.w || 300;
    const from = S.x.value;
    const to = dir * (w * 3.2 + 260);
    S.exit = { k, x: from, rot: from / 16, op: 1 };
    S.x.set(0); S.x.to(0); S.x.setVelocity(0);
    sfx.whoosh();
    vibrate(12);
    rarityClear(ctx);

    tween({
      from, to, duration: 420, ease: easeOutCubic,
      onUpdate: (v, p) => { if (S.exit) { S.exit.x = v; S.exit.rot = v / 16 + dir * 14 * p; S.exit.op = 1 - p * 0.9; } },
      onComplete: () => { S.exit = null; },
    });

    const next = k + 1;
    const slow = next < cards.length ? RARITY[cards[next].rarity].slow : 1;
    tween({
      from: S.vIndex, to: next, duration: 480 * slow, ease: easeOutQuint,
      onUpdate: (v) => { S.vIndex = v; },
    });

    if (next >= cards.length) {
      S.busy = true;
      setTimeout(() => onComplete && onComplete(), 420);
    }
    setIndex(next);
  }, [index, cards, ctx, S, onComplete]);

  const down = useCallback((e) => {
    if (!live || S.busy || index >= cards.length) return;
    const el = e.currentTarget;
    const now = performance.now();
    S.drag = { on: true, id: e.pointerId, x0: e.clientX - S.x.value, last: e.clientX, lastT: now,
      vx: 0, w: el.getBoundingClientRect().width, startX: e.clientX, t0: now };
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    el.dataset.drag = '1';
    sfx.unlock();
  }, [live, index, cards.length, S]);

  const move = useCallback((e) => {
    const d = S.drag;
    if (!d.on) return;
    const now = performance.now();
    const dt = Math.max(now - d.lastT, 1);
    d.vx = (e.clientX - d.last) / dt;
    d.last = e.clientX; d.lastT = now;
    const nx = e.clientX - d.x0;
    S.x.set(nx); S.x.to(nx);
    e.preventDefault();
  }, [S]);

  const up = useCallback((e) => {
    const d = S.drag;
    if (!d.on) return;
    d.on = false;
    const el = e.currentTarget;
    el.dataset.drag = '0';
    try { el.releasePointerCapture(d.id); } catch (_) {}
    const x = S.x.value;
    const past = Math.abs(x) > d.w * SWIPE_RATIO || Math.abs(d.vx) > FLICK;
    if (past) {
      S.x.setVelocity(d.vx * 1000);
      advance(x === 0 ? (d.vx < 0 ? -1 : 1) : (x < 0 ? -1 : 1));
    } else {
      S.x.setVelocity(d.vx * 1000);
      S.x.to(0);           // el spring la devuelve sola a su lugar
      // Un toque corto y sin desplazamiento no es un swipe fallido: es un
      // click, y abre la ficha del producto en la tienda.
      const tap = Math.abs(e.clientX - d.startX) < 7 && performance.now() - d.t0 < 500;
      if (tap) { const c = cards[index]; if (c) openProduct(c.productId); }
      else sfx.slide();
    }
  }, [advance, S, cards, index]);

  const handlers = useMemo(() => ({
    onPointerDown: down, onPointerMove: move, onPointerUp: up,
    onPointerCancel: up, onLostPointerCapture: up,
    tabIndex: 0,
    role: 'button',
    'aria-label': 'Deslizá la carta para ver la siguiente, o tocala para abrir el producto',
    onKeyDown: (e) => {
      if (S.busy) return;
      if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); S.drag.w = S.drag.w || 300; advance(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); S.drag.w = S.drag.w || 300; advance(-1); }
    },
  }), [down, move, up, advance, S]);

  const visible = [];
  for (let k = Math.max(0, index - 1); k < Math.min(cards.length, index + VISIBLE + 1); k++) visible.push(k);

  return h('div', null,
    h('div', { className: 'rcpo-stack' + (live ? ' is-live' : ''), ref: stackRef, style: { opacity: 0 } },
      h(Halo, { haloRef }),
      visible.map((k) => h(RevealCard, {
        key: cards[k].id,
        card: cards[k],
        slotRef: slots.current[k],
        silhouetteRef: k === index ? silRef : null,
        isTop: k === index,
        handlers,
      }))
    ),
    live && index < cards.length ? h('div', { className: 'rcpo-swipehint' }, 'Deslizá la carta') : null,
    h('div', { className: 'rcpo-counter' },
      cards.map((c, i) => h('span', {
        key: c.id,
        className: 'rcpo-dot' + (i === index ? ' on' : i < index ? ' done' : ''),
      }))
    )
  );
}

export default CardStack;
