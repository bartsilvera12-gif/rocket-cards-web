// Arranque del módulo de apertura de sobres.
//
// La página monta su app en #dc-root y renderiza un hueco vacío,
// `#rc-pack-slot`, dentro de la vista de inicio. Colgamos ahí nuestra propia
// raíz de React 18: como la plantilla nunca le pone hijos a ese hueco, React
// no toca lo que haya adentro.
//
// Los imports son dinámicos a propósito: React llega por <script> UMD y puede
// no estar listo cuando este módulo se evalúa.

const MOUNT_ID = 'rc-pack-opening';
const SLOT_ID = 'rc-pack-slot';

function whenReactReady(timeout = 15000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function check() {
      if (window.React && window.ReactDOM && window.ReactDOM.createRoot) return resolve();
      if (Date.now() - t0 > timeout) return reject(new Error('React no cargó a tiempo'));
      setTimeout(check, 40);
    })();
  });
}

/** Espera a que la página renderice el hueco donde va la sección. */
function waitForSlot(timeout = 10000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    (function look() {
      const slot = document.getElementById(SLOT_ID);
      if (slot || Date.now() - t0 > timeout) return resolve(slot || null);
      setTimeout(look, 40);
    })();
  });
}

/**
 * El hueco vive dentro de la vista de inicio, así que al abrir un producto o
 * el catálogo React lo desmonta y al volver crea uno nuevo. En vez de perder
 * la sección (y su estado), movemos el mismo nodo al hueco que esté vivo:
 * la raíz de React sigue intacta, sólo cambia de padre.
 */
function keepAttached(host) {
  let queued = false;
  const place = () => {
    queued = false;
    const slot = document.getElementById(SLOT_ID);
    if (slot && host.parentElement !== slot) slot.appendChild(host);
  };
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(place); } };
  if ('MutationObserver' in window) {
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  }
  place();
}

function mountNode() {
  let el = document.getElementById(MOUNT_ID);
  if (el) return el;
  el = document.createElement('div');
  el.id = MOUNT_ID;
  return el;
}

async function boot() {
  try {
    await whenReactReady();
    await waitForSlot();

    const { injectStyles } = await import('./styles.js');
    injectStyles();

    const host = mountNode();
    keepAttached(host);
    if (!host.isConnected) {
      // Sin hueco (plantilla vieja o vista distinta): al final de la página.
      const root = document.querySelector('#dc-root .sc-host > div') || document.body;
      root.appendChild(host);
    }

    const [{ default: React }, { PackOpening }] = await Promise.all([
      import('./react.js'),
      import('./PackOpening.js'),
    ]);
    window.ReactDOM.createRoot(host).render(React.createElement(PackOpening));
  } catch (err) {
    console.error('[rocket-cards] no se pudo montar la apertura de sobres:', err);
  }
}

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
