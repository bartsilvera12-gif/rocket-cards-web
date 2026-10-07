// Puente al React 18 que la página ya carga (window.React), sin bundler ni JSX.
const React = window.React;
if (!React) throw new Error('rcpo: window.React no está disponible');

export const h = React.createElement;
export const Fragment = React.Fragment;
export const memo = React.memo;
export const useState = React.useState;
export const useEffect = React.useEffect;
export const useLayoutEffect = React.useLayoutEffect;
export const useRef = React.useRef;
export const useMemo = React.useMemo;
export const useCallback = React.useCallback;
export default React;

/** Convierte #RRGGBB a rgba() con el alfa pedido. */
export function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Une clases ignorando falsy. */
export const cx = (...xs) => xs.filter(Boolean).join(' ');
