// BoosterPack — el sobre en 3D.
// Se dibuja como dos capas idénticas superpuestas con distinto clip-path:
// la línea de corte dentada queda perfectamente alineada entre tapa y cuerpo,
// y cada mitad puede transformarse por separado sin recortar nada en runtime.

import { h, useRef, useEffect, useLayoutEffect, useMemo } from './react.js';
import { onFrame, reducedMotion } from './anim.js';

const CUT_Y = 21; // % de la altura donde se abre el sobre

/** Genera la silueta dentada del desgarro, una vez por sobre. */
function tearClips(seed) {
  const n = 30, pts = [];
  for (let i = 0; i <= n; i++) {
    const x = (i / n) * 100;
    const edge = i === 0 || i === n;
    const j = edge ? 0 : Math.sin(i * 2.7 + seed) * 0.85 + Math.sin(i * 7.1 + seed * 2) * 0.5;
    pts.push(x.toFixed(2) + '% ' + (CUT_Y + j).toFixed(2) + '%');
  }
  return {
    top: 'polygon(0% 0%, 100% 0%, ' + pts.slice().reverse().join(', ') + ')',
    body: 'polygon(' + pts.join(', ') + ', 100% 100%, 0% 100%)',
  };
}

function PackArt() {
  return h('div', { className: 'rcpo-art' },
    h('div', { className: 'rcpo-foil' }),
    h('div', { className: 'rcpo-slash' }),
    h('div', { className: 'rcpo-seal' }, h('span', null, 'ABRIR AQUÍ')),
    h('div', { className: 'rcpo-packlogo' },
      h('img', { src: '/assets/rocket-logo.png', alt: '', draggable: false }),
      h('div', { className: 'rcpo-packname' }, 'ROCKET'),
      h('div', { className: 'rcpo-packsub' }, 'CARDS')
    ),
    h('div', { className: 'rcpo-packfoot' },
      h('div', { className: 'rcpo-barcode' }),
      h('span', null, '5 PRODUCTOS · AL AZAR')
    )
  );
}

export function BoosterPack({ packRef, topRef, bodyRef, innerRef, cutLineRef, cutHeadRef, sheenRef, tiltRef, frozenRef, children }) {
  const seed = useMemo(() => Math.random() * 10, []);
  const clips = useMemo(() => tearClips(seed), [seed]);
  const localPack = useRef(null);
  const ref = packRef || localPack;

  // Al abrir otro sobre este componente se re-monta con una key nueva, pero los
  // refs los vive PackOpening: un tween en vuelo del sobre anterior puede llegar
  // a escribir sobre los nodos recién creados. Partimos siempre de cero acá,
  // que es donde esos nodos nacen.
  useLayoutEffect(() => {
    // Sólo las propiedades animadas: el clip-path de cada mitad lo pone React
    // por `style` y borrarlo entero dejaría el desgarro sin recortar.
    const clear = (r) => {
      const el = r && r.current;
      if (!el) return;
      el.style.transform = '';
      el.style.opacity = '';
      el.style.transformOrigin = '';
    };
    [ref, topRef, bodyRef, innerRef, cutLineRef, cutHeadRef].forEach(clear);
  }, []);

  // Flotación y destello: un único rAF que escribe transform sobre dos nodos.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion()) return;
    const t0 = performance.now();
    let seen = true, checked = 0;
    return onFrame((now) => {
      if (frozenRef && frozenRef.current) return;
      // Fuera de pantalla no tiene sentido gastar frames; se revisa 4 veces por segundo.
      if (now - checked > 250) {
        checked = now;
        const r = el.getBoundingClientRect();
        seen = r.bottom > -200 && r.top < innerHeight + 200 && document.visibilityState === 'visible';
      }
      if (!seen) return;
      const t = (now - t0) / 1000;
      const tilt = (tiltRef && tiltRef.current) || { x: 0, y: 0 };
      const ry = Math.sin(t * 0.72) * 6.5 + tilt.x * 13;
      const rx = Math.cos(t * 0.58) * 4.2 - tilt.y * 10;
      const ty = Math.sin(t * 0.95) * 6;
      el.style.transform =
        'translate3d(0,' + ty.toFixed(2) + 'px,0) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg)';
      const s = sheenRef && sheenRef.current;
      if (s) {
        const p = ((t * 0.22) % 1);
        const eased = p < 0.42 ? p / 0.42 : 1.0001;
        s.style.transform = 'rotate(14deg) translateX(' + (eased * 320).toFixed(1) + '%)';
        s.style.opacity = p < 0.42 ? '1' : '0';
      }
    });
  }, [ref, tiltRef, sheenRef, frozenRef]);

  return h('div', { className: 'rcpo-packwrap' },
    h('div', { className: 'rcpo-pack', ref },
      // Cuerpo (parte de abajo) + el hueco oscuro que se ve al abrirse
      h('div', { className: 'rcpo-half', ref: bodyRef, style: { clipPath: clips.body, WebkitClipPath: clips.body } },
        PackArt()
      ),
      h('div', { className: 'rcpo-innerdark', ref: innerRef }),
      // Tapa (parte de arriba), la que se desprende
      h('div', { className: 'rcpo-half', ref: topRef, style: { clipPath: clips.top, WebkitClipPath: clips.top } },
        PackArt()
      ),
      h('div', { className: 'rcpo-sheenwrap' }, h('div', { className: 'rcpo-sheen', ref: sheenRef })),
      h('div', { className: 'rcpo-cutline', ref: cutLineRef }, h('i')),
      h('div', { className: 'rcpo-cuthead', ref: cutHeadRef })
    ),
    children
  );
}

export default BoosterPack;
