// CutGesture — el gesto de cortar el sobre.
// Un solo camino de código para mouse, touch y lápiz: Pointer Events con
// setPointerCapture, así el dedo puede salirse del sobre sin perder el gesto.
// El progreso se escribe directo sobre el DOM (transform), nunca por setState:
// durante el arrastre React no se re-renderiza ni una sola vez, y las medidas
// se cachean en el pointerdown para no leer layout en cada frame.

import { h, useRef, useCallback, useEffect } from './react.js';
import { clamp, tween, easeOutCubic, vibrate } from './anim.js';
import * as sfx from './audio.js';

export const CUT_THRESHOLD = 0.76; // 76% del recorrido disponible

export function CutGesture({ cutLineRef, cutHeadRef, onCut, onPointerStart, fx, active }) {
  const grip = useRef(null);
  const st = useRef({ on: false, startPct: 0, dir: 1, p: 0, len: 0, lastSpark: 0, id: null, rect: null, stage: null });
  const finishRef = useRef(null);
  const anim = useRef(null); // tween en vuelo del corte, para poder cortarlo

  // len = fracción del ancho del sobre ya cortada; dir = sentido del gesto.
  const paint = useCallback((len, dir, startPct) => {
    const line = cutLineRef.current, head = cutHeadRef.current;
    const w = st.current.rect ? st.current.rect.width : 0;
    if (line) {
      const off = dir > 0 ? startPct : startPct - len * 100;
      line.style.transform = 'translateX(' + off.toFixed(2) + '%) scaleX(' + len.toFixed(4) + ')';
    }
    if (head) {
      head.style.transform = 'translate3d(' + (((startPct / 100) + dir * len) * w).toFixed(1) + 'px,0,0)';
      head.style.opacity = len > 0.01 ? '1' : '0';
    }
  }, [cutLineRef, cutHeadRef]);

  useEffect(() => {
    if (!active) return;
    st.current.p = 0; st.current.len = 0;
    if (grip.current) st.current.rect = grip.current.getBoundingClientRect();
    paint(0, 1, 0);
  }, [active, paint]);

  // Un tween del corte que siga vivo después de desmontar seguiría escribiendo
  // sobre los refs, que para entonces ya apuntan al sobre siguiente.
  useEffect(() => () => { if (anim.current) anim.current(); }, []);

  const down = useCallback((e) => {
    if (!active) return;
    const el = grip.current;
    const r = el.getBoundingClientRect();
    st.current = {
      on: true,
      startPct: clamp(((e.clientX - r.left) / r.width) * 100, 0, 100),
      dir: 1, p: 0, len: 0, lastSpark: 0, id: e.pointerId,
      rect: r,
      stage: fx ? fx.c.getBoundingClientRect() : null,
    };
    try { el.setPointerCapture(e.pointerId); } catch (_) {}
    el.dataset.active = '1';
    sfx.unlock();
    vibrate(8);
    onPointerStart && onPointerStart();
    e.preventDefault();
  }, [active, fx, onPointerStart]);

  const move = useCallback((e) => {
    const s = st.current;
    if (!s.on) return;
    const r = s.rect;
    const dx = e.clientX - (r.left + (s.startPct / 100) * r.width);
    if (Math.abs(dx) > 6 && s.p < 0.04) s.dir = dx < 0 ? -1 : 1;

    // El recorrido disponible es lo que queda de sobre hacia ese lado.
    const spanPx = Math.max(r.width * (s.dir > 0 ? 1 - s.startPct / 100 : s.startPct / 100), 1);
    const p = clamp((dx * s.dir) / spanPx, 0, 1);
    const len = p * (spanPx / r.width);
    s.p = p; s.len = len;
    paint(len, s.dir, s.startPct);

    const now = performance.now();
    if (fx && s.stage && p > 0.02 && now - s.lastSpark > 38) {
      s.lastSpark = now;
      const hx = r.left + ((s.startPct / 100) + s.dir * len) * r.width;
      const hy = r.top + r.height * 0.656; // el corte va al 21% de la altura del sobre
      fx.burst((hx - s.stage.left) / s.stage.width, (hy - s.stage.top) / s.stage.height,
        { count: 3, color: '#FF7A3D', speed: 110, life: 420, size: 1.8, gravity: 320 });
      sfx.tick(p);
    }

    if (p >= CUT_THRESHOLD) { finishRef.current(true); return; }
    e.preventDefault();
  }, [fx, paint]);

  const finish = useCallback((cut) => {
    const s = st.current;
    if (!s.on) return;
    s.on = false;
    const el = grip.current;
    if (el) {
      el.dataset.active = '0';
      try { el.releasePointerCapture(s.id); } catch (_) {}
    }
    if (cut) {
      // Lo que falta del corte se completa solo: el desgarro "se escapa".
      const dir = s.dir, from = s.len, anchor = dir > 0 ? 0 : 100;
      anim.current = tween({ from, to: 1, duration: 150, ease: easeOutCubic, onUpdate: (v) => paint(v, dir, anchor) });
      onCut();
    } else {
      const dir = s.dir, start = s.startPct;
      anim.current = tween({ from: s.len, to: 0, duration: 260, ease: easeOutCubic, onUpdate: (v) => paint(v, dir, start) });
      s.p = 0; s.len = 0;
    }
  }, [onCut, paint]);
  finishRef.current = finish;

  const up = useCallback(() => finishRef.current(st.current.p >= CUT_THRESHOLD), []);
  const cancel = useCallback(() => finishRef.current(false), []);
  const byKey = useCallback((e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sfx.unlock(); onCut(); }
  }, [onCut]);

  if (!active) return null;

  return h('div', null,
    h('div', {
      className: 'rcpo-grip', ref: grip, tabIndex: 0, role: 'button',
      'aria-label': 'Deslizá horizontalmente para cortar el sobre, o presioná Enter para abrirlo',
      onPointerDown: down, onPointerMove: move, onPointerUp: up,
      onPointerCancel: cancel, onLostPointerCapture: cancel, onKeyDown: byKey,
    }),
    h('div', { className: 'rcpo-hint' },
      h('svg', { width: '15', height: '10', viewBox: '0 0 15 10', fill: 'none' },
        h('path', {
          d: 'M1 5h11M8.4 1.4 12.6 5l-4.2 3.6', stroke: 'currentColor',
          strokeWidth: '1.7', strokeLinecap: 'round', strokeLinejoin: 'round',
        })
      ),
      'Deslizá para abrir'
    ),
    h('div', { className: 'rcpo-fallback' },
      h('button', { className: 'rcpo-btn ghost', onClick: () => { sfx.unlock(); onCut(); } }, 'Abrir sobre')
    )
  );
}

export default CutGesture;
