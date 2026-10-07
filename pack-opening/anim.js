// Utilidades de animación: easings, tween sobre rAF y un ticker compartido.
// Todo lo que se anima acá escribe sólo transform / opacity / filter.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
export const easeInCubic = (t) => t * t * t;
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeOutElastic = (t) => {
  if (t === 0 || t === 1) return t;
  const c4 = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};
// Caída con rebote apagado, para la tapa del sobre.
export const easeGravity = (t) => t * t * (1.08 - 0.08 * t);

export const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Ticker único compartido: un solo rAF para todos los suscriptores. */
const subs = new Set();
let rafId = 0, last = 0;
function loop(now) {
  const dt = last ? Math.min(now - last, 50) : 16.7;
  last = now;
  for (const fn of subs) fn(now, dt);
  rafId = subs.size ? requestAnimationFrame(loop) : (last = 0);
}
export function onFrame(fn) {
  subs.add(fn);
  if (!rafId) rafId = requestAnimationFrame(loop);
  return () => {
    subs.delete(fn);
    if (!subs.size && rafId) { cancelAnimationFrame(rafId); rafId = 0; last = 0; }
  };
}

/** Tween simple sobre el ticker compartido. Devuelve una función para cancelar. */
export function tween({ from = 0, to = 1, duration = 400, delay = 0, ease = easeOutCubic, onUpdate, onComplete }) {
  let t0 = 0, done = false;
  const stop = onFrame((now) => {
    if (!t0) t0 = now;
    const e = now - t0 - delay;
    if (e < 0) return;
    const p = duration <= 0 ? 1 : clamp(e / duration, 0, 1);
    onUpdate && onUpdate(lerp(from, to, ease(p)), p);
    if (p >= 1 && !done) { done = true; stop(); onComplete && onComplete(); }
  });
  return stop;
}

/**
 * Spring crítico-amortiguado para el arrastre de cartas.
 * Integra a paso fijo para que el resultado no dependa del framerate.
 */
export function makeSpring(value = 0, { stiffness = 170, damping = 26, mass = 1 } = {}) {
  let v = value, vel = 0, target = value;
  return {
    get value() { return v; },
    get velocity() { return vel; },
    set(x) { v = x; },
    setVelocity(x) { vel = x; },
    to(x) { target = x; },
    settled() { return Math.abs(v - target) < 0.05 && Math.abs(vel) < 0.05; },
    step(dt) {
      const steps = Math.max(1, Math.ceil(dt / 8));
      const h = dt / steps / 1000;
      for (let i = 0; i < steps; i++) {
        const f = -stiffness * (v - target) - damping * vel;
        vel += (f / mass) * h;
        v += vel * h;
      }
      return v;
    },
  };
}

export function vibrate(pattern) {
  try { navigator.vibrate && navigator.vibrate(pattern); } catch (_) {}
}
