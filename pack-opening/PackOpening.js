// PackOpening — la máquina de estados y el director de la secuencia.
//
//   idle ──(gesto)──► cutting ──(76%)──► cut ──► opening
//        ◄──(otro sobre)── completed ◄── revealing ◄── cardsEmerging
//
// Cada fase programa la siguiente con timers; todo lo que se mueve lo hace
// por transform/opacity escritos desde tweens sobre rAF, nunca por layout.

import { h, useState, useRef, useEffect, useCallback, useMemo } from './react.js';
import BoosterPack from './BoosterPack.js';
import CutGesture from './CutGesture.js';
import CardStack from './CardStack.js';
import ResultsScreen from './ResultsScreen.js';
import { openPack } from './data.js';
import { FX } from './fx.js';
import { tween, easeGravity, easeOutCubic, easeOutQuint, vibrate, reducedMotion } from './anim.js';
import * as sfx from './audio.js';

const PHASES = ['idle', 'cutting', 'cut', 'opening', 'cardsEmerging', 'revealing', 'completed'];

export function PackOpening() {
  const [run, setRun] = useState(() => ({ id: 1, cards: openPack(5) }));
  const [phase, setPhase] = useState('idle');
  const [muted, setMuted] = useState(sfx.isMuted());

  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const dimRef = useRef(null);
  const flashRef = useRef(null);
  const packRef = useRef(null);
  const topRef = useRef(null);
  const bodyRef = useRef(null);
  const innerRef = useRef(null);
  const sheenRef = useRef(null);
  const cutLineRef = useRef(null);
  const cutHeadRef = useRef(null);
  const tiltRef = useRef({ x: 0, y: 0 });
  const frozenRef = useRef(false);
  const timers = useRef([]);
  const stops = useRef([]);
  const [fx, setFx] = useState(null);

  const after = (ms, fn) => { timers.current.push(setTimeout(fn, ms)); };
  const clearAll = () => {
    timers.current.forEach(clearTimeout); timers.current = [];
    stops.current.forEach((s) => s && s()); stops.current = [];
  };

  // Canvas de partículas, uno por sección.
  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new FX(canvasRef.current);
    setFx(engine);
    return () => engine.destroy();
  }, []);

  useEffect(() => () => clearAll(), []);

  // Paralaje del sobre con el mouse (en touch no aplica: ya hay flotación).
  const onStagePointerMove = useCallback((e) => {
    if (e.pointerType !== 'mouse') return;
    const r = stageRef.current.getBoundingClientRect();
    tiltRef.current = {
      x: ((e.clientX - r.left) / r.width - 0.5) * 2,
      y: ((e.clientY - r.top) / r.height - 0.5) * 2,
    };
  }, []);
  const onStageLeave = useCallback(() => { tiltRef.current = { x: 0, y: 0 }; }, []);

  const fxCtx = useMemo(() => ({ fx, dimRef, flashRef, stageRef }), [fx]);

  // ── La secuencia de apertura ──
  const startCut = useCallback(() => setPhase((p) => (p === 'idle' ? 'cutting' : p)), []);

  const onCut = useCallback(() => {
    if (phase === 'cut' || phase === 'opening' || phase === 'cardsEmerging') return;
    const reduce = reducedMotion();
    const k = reduce ? 0.35 : 1;
    setPhase('cut');
    frozenRef.current = true;
    sfx.rip();
    vibrate([0, 18, 30, 45]);

    // Chispazo a lo largo del corte.
    if (fx && !reduce) {
      for (let i = 0; i < 9; i++) {
        fx.burst(0.5 + (i / 8 - 0.5) * 0.26, 0.335, { count: 7, color: '#FFB07A', speed: 230, life: 700, size: 2.2, gravity: 420 });
      }
    }
    const fl = flashRef.current;
    if (fl) stops.current.push(tween({ from: 0.3, to: 0, duration: 420, ease: easeOutQuint, onUpdate: (v) => { fl.style.opacity = v; } }));

    after(170 * k, () => {
      setPhase('opening');
      const stageH = stageRef.current ? stageRef.current.getBoundingClientRect().height : 600;

      // 1. La tapa se desprende: sube apenas, rota y cae.
      const top = topRef.current;
      if (top) {
        stops.current.push(tween({
          from: 0, to: 1, duration: 1000 * (reduce ? 0.4 : 1), ease: easeGravity,
          onUpdate: (v) => {
            const y = -26 * Math.sin(Math.min(v, 0.5) * Math.PI) + v * v * stageH * 1.05;
            top.style.transform =
              'translate3d(' + (v * 54).toFixed(1) + 'px,' + y.toFixed(1) + 'px,' + (v * 90).toFixed(1) + 'px)' +
              ' rotateZ(' + (v * 34).toFixed(1) + 'deg) rotateX(' + (v * 26).toFixed(1) + 'deg)';
            top.style.opacity = String(v > 0.62 ? Math.max(0, 1 - (v - 0.62) / 0.38) : 1);
          },
          onComplete: () => sfx.thud(),
        }));
      }

      // 2. El cuerpo se inclina y aparece la boca oscura del sobre.
      const body = bodyRef.current, inner = innerRef.current;
      if (body) {
        body.style.transformOrigin = '50% 100%';
        stops.current.push(tween({
          from: 0, to: 1, duration: 620 * (reduce ? 0.4 : 1), delay: 150 * k, ease: easeOutCubic,
          onUpdate: (v) => { body.style.transform = 'rotateX(' + (v * 21).toFixed(2) + 'deg) translate3d(0,' + (v * 8).toFixed(1) + 'px,0)'; },
        }));
      }
      if (inner) {
        stops.current.push(tween({
          from: 0, to: 1, duration: 520 * (reduce ? 0.4 : 1), delay: 180 * k, ease: easeOutCubic,
          onUpdate: (v) => { inner.style.opacity = String(v); inner.style.transform = 'scaleY(' + v.toFixed(3) + ')'; },
        }));
      }

      // 3. Las cartas salen; el sobre se va hacia abajo y se apaga.
      after(520 * k, () => {
        setPhase('cardsEmerging');
        const pack = packRef.current;
        if (pack) {
          stops.current.push(tween({
            from: 0, to: 1, duration: 900 * (reduce ? 0.4 : 1), delay: 260 * k, ease: easeOutCubic,
            onUpdate: (v) => {
              pack.style.transform = 'translate3d(0,' + (v * 120).toFixed(1) + 'px,' + (-v * 160).toFixed(1) + 'px) scale(' + (1 - v * 0.18).toFixed(3) + ')';
              pack.style.opacity = String(1 - v);
            },
          }));
        }
        after(reduce ? 340 : 1050, () => setPhase('revealing'));
      });
    });
  }, [phase, fx]);

  const onCompleteCards = useCallback(() => setPhase('completed'), []);

  const again = useCallback(() => {
    clearAll();
    if (fx) fx.clear();
    frozenRef.current = false;
    tiltRef.current = { x: 0, y: 0 };
    [dimRef, flashRef].forEach((r) => { if (r.current) r.current.style.opacity = '0'; });
    setPhase('idle');
    setRun((r) => ({ id: r.id + 1, cards: openPack(5) }));
  }, [fx]);

  const toggleSound = useCallback(() => { sfx.unlock(); setMuted(sfx.setMuted(!sfx.isMuted())); }, []);

  const packVisible = phase !== 'completed';
  const stackMounted = phase === 'cardsEmerging' || phase === 'revealing';
  const emergeFrom = useMemo(() => {
    const el = packRef.current;
    return el ? el.getBoundingClientRect().height * 0.34 : 180;
  }, [stackMounted]);

  return h('section', { className: 'rcpo', id: 'abrir-sobre' },
    h('div', { className: 'rcpo-bg' }),
    h('div', { className: 'rcpo-wrap' },
      h('div', { className: 'rcpo-copy' },
        h('span', { className: 'rcpo-kicker' }, 'Ofertas sorpresa'),
        h('h2', { className: 'rcpo-title' }, 'Abrí un ', h('em', null, 'sobre')),
        h('p', { className: 'rcpo-sub' },
          'Cortá el sobre y salen cinco productos de la tienda, con su rareza según el descuento. Tocá cualquiera para ver la ficha.'),
        h('p', { className: 'rcpo-note' },
          'Vitrina al azar · no es una compra ni reserva stock'),
        h('div', { className: 'rcpo-tools' },
          h('button', {
            className: 'rcpo-sound', onClick: toggleSound,
            'aria-label': muted ? 'Activar sonido' : 'Silenciar',
            title: muted ? 'Activar sonido' : 'Silenciar',
          }, muted ? h(IconMute) : h(IconSound))
        )
      ),
      h('div', {
        className: 'rcpo-stage', ref: stageRef,
        onPointerMove: onStagePointerMove, onPointerLeave: onStageLeave,
      },
        h('div', { className: 'rcpo-dim', ref: dimRef }),
        packVisible ? h(BoosterPack, {
          key: 'pack-' + run.id,
          packRef, topRef, bodyRef, innerRef, sheenRef, cutLineRef, cutHeadRef, tiltRef, frozenRef,
        },
          h(CutGesture, {
            cutLineRef, cutHeadRef, fx,
            active: phase === 'idle' || phase === 'cutting',
            onPointerStart: startCut,
            onCut,
          })
        ) : null,
        stackMounted ? h(CardStack, {
          key: 'stack-' + run.id,
          cards: run.cards,
          emerging: true,
          live: phase === 'revealing',
          emergeFrom,
          fxCtx,
          onComplete: onCompleteCards,
        }) : null,
        phase === 'completed' ? h(ResultsScreen, { key: 'res-' + run.id, cards: run.cards, onAgain: again }) : null,
        h('div', { className: 'rcpo-flash', ref: flashRef }),
        h('canvas', { className: 'rcpo-fx', ref: canvasRef })
      )
    )
  );
}

const IconSound = () => h('svg', { width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none' },
  h('path', { d: 'M3 6h2.5L9 3v10L5.5 10H3z', fill: 'currentColor' }),
  h('path', { d: 'M11.2 5.6a3.4 3.4 0 0 1 0 4.8M13.2 3.6a6.2 6.2 0 0 1 0 8.8', stroke: 'currentColor', strokeWidth: '1.4', strokeLinecap: 'round' })
);
const IconMute = () => h('svg', { width: '16', height: '16', viewBox: '0 0 16 16', fill: 'none' },
  h('path', { d: 'M3 6h2.5L9 3v10L5.5 10H3z', fill: 'currentColor' }),
  h('path', { d: 'm11 6 4 4m0-4-4 4', stroke: 'currentColor', strokeWidth: '1.5', strokeLinecap: 'round' })
);

export { PHASES };
export default PackOpening;
