// RareEffects — todo lo que distingue una común de una legendaria.
// Dos momentos por carta: `intro` (suspenso, antes de ver la carta) y
// `reveal` (el golpe). Las comunes atraviesan ambos sin coste visible.

import { h } from './react.js';
import { RARITY } from './data.js';
import { tween, easeOutCubic, easeOutQuint, vibrate, reducedMotion } from './anim.js';
import * as sfx from './audio.js';

/** Halo detrás de la carta; su opacidad la maneja el stack por ref. */
export function Halo({ haloRef }) {
  return h('div', { className: 'rcpo-halo', ref: haloRef });
}

function setHalo(ref, color, to, duration) {
  const el = ref && ref.current;
  if (!el) return;
  el.style.background = 'radial-gradient(50% 50% at 50% 50%, ' + color + ', rgba(0,0,0,0) 72%)';
  tween({ from: parseFloat(el.style.opacity || 0), to, duration, ease: easeOutCubic, onUpdate: (v) => { el.style.opacity = v; } });
}

function setDim(ref, to, duration) {
  const el = ref && ref.current;
  if (!el) return;
  el.style.transitionDuration = duration + 'ms';
  el.style.opacity = String(to);
}

function flash(ref, peak) {
  const el = ref && ref.current;
  if (!el) return;
  tween({ from: 0, to: peak, duration: 70, ease: easeOutCubic, onUpdate: (v) => { el.style.opacity = v; },
    onComplete: () => tween({ from: peak, to: 0, duration: 520, ease: easeOutQuint, onUpdate: (v) => { el.style.opacity = v; } }) });
}

/**
 * Suspenso previo. Devuelve cuántos ms hay que mantener la silueta
 * antes de descubrir la carta (0 = reveal inmediato).
 */
export function rarityIntro(card, ctx) {
  const r = RARITY[card.rarity];
  const reduce = reducedMotion();
  const hold = reduce ? Math.min(r.suspense, 200) : r.suspense;

  switch (card.rarity) {
    case 'rare':
      setHalo(ctx.haloRef, r.glow, 0.55, 420);
      break;
    case 'epic':
      setHalo(ctx.haloRef, r.glow, 0.8, 380);
      setDim(ctx.dimRef, 0.42, 320);
      if (ctx.fx && !reduce) ctx.fx.lightStreaks(9, 'rgba(176,107,255,.9)');
      sfx.slide();
      vibrate(18);
      break;
    case 'legendary':
      setHalo(ctx.haloRef, r.glow, 1, 560);
      setDim(ctx.dimRef, 0.82, 460);
      if (ctx.fx && !reduce) {
        ctx.fx.lightStreaks(18, 'rgba(255,226,150,.95)');
        ctx.fx.burst(0.5, 0.46, { count: 34, color: '#FFD98A', speed: 150, life: 1300, size: 2.2, gravity: -40 });
      }
      sfx.boom();
      vibrate([0, 30, 60, 30]);
      break;
    default:
      setHalo(ctx.haloRef, r.glow, 0, 180);
      setDim(ctx.dimRef, 0, 220);
  }
  return hold;
}

/** El golpe de reveal, una vez que la carta ya es visible. */
export function rarityReveal(card, ctx) {
  const r = RARITY[card.rarity];
  const reduce = reducedMotion();
  const fx = reduce ? null : ctx.fx;
  sfx.chime(r.rank);

  switch (card.rarity) {
    case 'uncommon':
      fx && fx.burst(0.5, 0.46, { count: 16, color: r.ink, speed: 190, life: 650, size: 2 });
      break;
    case 'rare':
      fx && fx.burst(0.5, 0.46, { count: 34, color: r.ink, speed: 260, life: 850, size: 2.4 });
      setHalo(ctx.haloRef, r.glow, 0.42, 700);
      vibrate(14);
      break;
    case 'epic':
      flash(ctx.flashRef, 0.45);
      if (fx) {
        fx.burst(0.5, 0.46, { count: 76, color: r.ink, speed: 360, life: 1100, size: 2.8 });
        fx.burst(0.5, 0.46, { count: 26, color: '#ffffff', speed: 420, life: 800, size: 1.8 });
        fx.confetti([r.ink, '#ffffff', '#E30613'], 34);
      }
      setHalo(ctx.haloRef, r.glow, 0.5, 900);
      setDim(ctx.dimRef, 0.22, 700);
      vibrate([0, 22, 40, 22]);
      break;
    case 'legendary':
      flash(ctx.flashRef, 1);
      if (fx) {
        fx.lightStreaks(22, 'rgba(255,240,205,.95)');
        fx.burst(0.5, 0.46, { count: 150, color: '#FFD24A', speed: 520, life: 1500, size: 3.2 });
        fx.burst(0.5, 0.46, { count: 60, color: '#ffffff', speed: 640, life: 1000, size: 2.2 });
        fx.confetti(['#F0B429', '#FFE9A8', '#E30613', '#ffffff'], 96);
      }
      setHalo(ctx.haloRef, r.glow, 0.72, 1100);
      setDim(ctx.dimRef, 0.5, 900);
      sfx.boom();
      vibrate([0, 40, 50, 40, 50, 90]);
      break;
    default:
      fx && fx.burst(0.5, 0.46, { count: 8, color: '#8d8d8d', speed: 140, life: 460, size: 1.6, glow: false });
  }
}

/** Se llama al descartar una carta: apaga lo que haya quedado encendido. */
export function rarityClear(ctx) {
  setHalo(ctx.haloRef, 'rgba(0,0,0,0)', 0, 260);
  setDim(ctx.dimRef, 0, 320);
}

export default { Halo, rarityIntro, rarityReveal, rarityClear };
