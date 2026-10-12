// Animación de entrada por scroll para toda la página.
//
// Va por fuera de la plantilla a propósito: marca los bloques con un atributo
// `data-rcrv` y deja que el CSS haga la transición. Usa data-* y no `class`
// porque la plantilla no declara className en estos nodos; si tocáramos class,
// un re-render de React podría pisarlo. Un data-* que React no conoce lo deja
// intacto.
//
// Sólo se animan opacity y transform. Al terminar, el atributo se borra y el
// nodo vuelve a quedar limpio.

const ATTR = 'data-rcrv';
const DONE = 'data-rcrv-done';
const DUR = 720;          // ms de la transición
const STEP = 70;          // ms entre bloques de una misma sección
const MAX_DELAY = 350;    // techo del escalonado

const CSS = `
[${ATTR}="0"]{opacity:0;transform:translate3d(0,24px,0);will-change:opacity,transform}
[${ATTR}="0"][data-rcrv-flat]{transform:none}
[${ATTR}="1"]{opacity:1;transform:none;
  transition:opacity ${DUR}ms cubic-bezier(.22,.61,.36,1) var(--rcrv-d,0ms),
             transform ${DUR}ms cubic-bezier(.22,.61,.36,1) var(--rcrv-d,0ms)}
@media (prefers-reduced-motion:reduce){
  [${ATTR}]{opacity:1 !important;transform:none !important;transition:none !important}
}
`;

const reduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function injectStyles() {
  if (document.getElementById('rcrv-styles')) return;
  const tag = document.createElement('style');
  tag.id = 'rcrv-styles';
  tag.textContent = CSS;
  document.head.appendChild(tag);
}

/** La sección de apertura de sobres se anima sola; el resto del módulo la ignora. */
const isOurs = (el) => !!el.closest('#abrir-sobre, #rc-pack-opening, #rc-pack-slot');

/**
 * Baja por los envoltorios de una sola rama hasta encontrar el nivel que
 * realmente tiene varios bloques: es el que conviene escalonar.
 */
function blocksOf(section) {
  let kids = [...section.children];
  let guard = 0;
  while (kids.length === 1 && kids[0].children.length > 1 && guard++ < 3) {
    kids = [...kids[0].children];
  }
  return kids;
}

/** Una grilla o fila de tarjetas se abre en sus hijos para que entren de a uno. */
function expand(blocks) {
  const out = [];
  for (const b of blocks) {
    const cs = getComputedStyle(b);
    const kids = [...b.children];
    const track = (cs.display === 'grid' || cs.display === 'flex') && kids.length >= 2 && kids.length <= 12;
    if (track && kids.every((k) => k.getBoundingClientRect().height >= 48)) out.push(...kids);
    else out.push(b);
  }
  return out;
}

function animatable(el) {
  if (el.hasAttribute(ATTR) || el.hasAttribute(DONE)) return false;
  if (isOurs(el)) return false;
  const cs = getComputedStyle(el);
  if (cs.position === 'fixed' || cs.position === 'sticky') return false;
  if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  const r = el.getBoundingClientRect();
  if (r.height < 24 || r.width < 24) return false;
  return true;
}

/**
 * Un contenedor 3D (el carrusel) pierde la profundidad de sus hijos si le
 * aplicamos transform encima: a esos se les anima sólo la opacidad.
 */
function isThreeD(el) {
  const cs = getComputedStyle(el);
  return cs.perspective !== 'none' || cs.transformStyle === 'preserve-3d';
}

let io = null;   // null = sin crear, false = no disponible
const pending = new Set();

function reveal(el) {
  pending.delete(el);
  if (io) try { io.unobserve(el); } catch (_) {}
  el.setAttribute(ATTR, '1');
  const delay = parseInt(el.style.getPropertyValue('--rcrv-d'), 10) || 0;
  setTimeout(() => {
    el.removeAttribute(ATTR);
    el.removeAttribute('data-rcrv-flat');
    el.style.removeProperty('--rcrv-d');
    el.setAttribute(DONE, '');
  }, DUR + delay + 60);
}

function ensureObserver() {
  if (io !== null) return io;
  if (!('IntersectionObserver' in window)) { io = false; return io; }
  io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) reveal(e.target);
    }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
  return io;
}

function scan() {
  if (reduced()) return;
  const obs = ensureObserver();
  document.querySelectorAll('#dc-root section, #dc-root footer').forEach((section) => {
    if (isOurs(section)) return;
    const blocks = expand(blocksOf(section)).filter(animatable);
    if (blocks.length) startSweep();
    blocks.forEach((el, i) => {
      el.setAttribute(ATTR, '0');
      if (isThreeD(el)) el.setAttribute('data-rcrv-flat', '');
      el.style.setProperty('--rcrv-d', Math.min(i * STEP, MAX_DELAY) + 'ms');
      pending.add(el);
      if (obs) obs.observe(el);
    });
  });
}

/**
 * Barrido por sondeo. Es el mecanismo PRINCIPAL, no un extra: hay entornos
 * (emulación mobile del navegador, entre otros) donde el IntersectionObserver
 * no llama nunca y los eventos de scroll tampoco llegan. Si dependiéramos de
 * ellos, la página se quedaría en blanco, que es mucho peor que no animar.
 *
 * Mide sólo lo que falta, y el intervalo se apaga solo cuando no queda nada.
 */
function sweep() {
  if (!pending.size) { stopSweep(); return; }
  const doc = document.documentElement;
  const atEnd = innerHeight + Math.ceil(scrollY) >= doc.scrollHeight - 2;
  for (const el of [...pending]) {
    if (!el.isConnected) { pending.delete(el); continue; }
    if (atEnd || el.getBoundingClientRect().top < innerHeight * 0.92) reveal(el);
  }
  if (!pending.size) stopSweep();
}

let timer = 0;
function startSweep() { if (!timer) timer = setInterval(sweep, 150); }
function stopSweep() { if (timer) { clearInterval(timer); timer = 0; } }

function boot() {
  if (reduced()) return;
  injectStyles();

  let sweeping = false;
  const onScroll = () => {
    if (sweeping) return;
    sweeping = true;
    requestAnimationFrame(() => { sweeping = false; sweep(); });
  };
  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll, { passive: true });

  let queued = false;
  const rescan = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; scan(); });
  };

  // La app renderiza async y cambia de vista (inicio / producto / catálogo),
  // así que hay que volver a mirar cuando el DOM cambia.
  // Se espera con rAF, no con setTimeout: el callback corre justo antes del
  // repintado, así los bloques se ocultan en el mismo frame en que la app los
  // monta y no llegan a verse un instante antes de la animación.
  const start = Date.now();
  (function wait() {
    if (document.querySelector('#dc-root section')) {
      scan();
      if ('MutationObserver' in window) {
        new MutationObserver(rescan).observe(document.body, { childList: true, subtree: true });
      }
      return;
    }
    if (Date.now() - start < 15000) requestAnimationFrame(wait);
  })();
}

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
