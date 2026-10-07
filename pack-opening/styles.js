// Hoja de estilos del módulo, inyectada una sola vez.
// Regla general: sólo se animan transform, opacity y filter.

const CSS = `
.rcpo{--red:#E30613;--red2:#FF1A27;--gold:#C9A227;--ink:#F5F5F5;--dim:#A7A7A7;
  --cw:clamp(176px,22vw,252px);--ch:calc(var(--cw)*1.396);
  --pw:clamp(190px,24vw,272px);--ph:calc(var(--pw)*1.54);
  --rw:clamp(78px,9.5vw,118px);--rgap:clamp(7px,1.1vw,13px);
  background:#0D0D0D;border-top:1px solid #141414;border-bottom:1px solid #141414;color:var(--ink);
  font-family:'Poppins',system-ui,sans-serif;position:relative;overflow:hidden}
.rcpo *,.rcpo *::before,.rcpo *::after{box-sizing:border-box}
/* Texto a la izquierda, escenario a la derecha. La columna del sobre se
   dimensiona por contenido para que el escenario no se estire de más. */
.rcpo-wrap{max-width:1400px;margin:0 auto;padding:clamp(36px,4.6vw,64px) clamp(16px,3vw,32px);
  display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:clamp(20px,4vw,56px)}
.rcpo-bg{position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(70% 90% at 82% 50%,rgba(227,6,19,.15),transparent 64%),
             radial-gradient(60% 80% at 10% 60%,rgba(201,162,39,.05),transparent 70%)}
.rcpo-copy{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:11px;max-width:40ch}
.rcpo-kicker{font-family:'IBM Plex Mono',monospace;font-size:10.5px;letter-spacing:.3em;color:var(--gold);text-transform:uppercase}
.rcpo-title{font-family:'Saira Condensed',sans-serif;font-weight:900;font-style:italic;
  font-size:clamp(28px,4.4vw,52px);line-height:.94;margin:0;text-transform:uppercase}
.rcpo-title em{color:var(--red);font-style:italic}
.rcpo-sub{font-size:clamp(13px,1.4vw,14.5px);color:var(--dim);line-height:1.6;margin:0;text-wrap:pretty}
.rcpo-note{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.14em;
  text-transform:uppercase;color:#5f5f5f;margin:0}
.rcpo-tools{display:flex;align-items:center;gap:10px;margin-top:3px}

.rcpo-stage{position:relative;width:clamp(300px,44vw,560px);height:clamp(480px,66vh,680px);
  display:grid;place-items:center;perspective:1300px;perspective-origin:50% 42%;
  touch-action:pan-y;isolation:isolate}
@media (max-width:860px){
  .rcpo-wrap{grid-template-columns:minmax(0,1fr);justify-items:center;gap:clamp(18px,4vw,30px)}
  .rcpo-copy{align-items:center;text-align:center;max-width:44ch}
  .rcpo-stage{width:min(100%,480px);height:clamp(500px,66vh,660px)}
  /* En el teléfono la carta ocupa buena parte del ancho: es lo que hace
     que el swipe se sienta natural con el pulgar. */
  .rcpo{--cw:clamp(210px,66vw,272px);--pw:clamp(226px,71vw,294px);
    --rw:clamp(84px,26vw,118px);--rgap:clamp(7px,2vw,13px)}
}
.rcpo-fx{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:40}
.rcpo-dim{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none;z-index:5;
  transition:opacity .5s ease;will-change:opacity}
.rcpo-flash{position:absolute;inset:0;pointer-events:none;z-index:45;opacity:0;mix-blend-mode:screen;
  background:radial-gradient(60% 50% at 50% 48%,#fff,rgba(255,255,255,0) 72%);will-change:opacity}

/* ---- Sobre ---- */
.rcpo-packwrap{position:relative;width:var(--pw);height:var(--ph);z-index:10;
  /* perspectiva propia y contexto plano: con preserve-3d acá, la ayuda y la
     línea de corte entraban al mismo contexto 3D del sobre y el z-index dejaba
     de ordenarlas, quedando dibujadas por detrás. */
  perspective:1400px;transform-style:flat}
.rcpo-pack{position:absolute;inset:0;transform-style:preserve-3d;will-change:transform}
.rcpo-half{position:absolute;inset:0;backface-visibility:hidden;transform-origin:50% 21%;
  will-change:transform,opacity}
.rcpo-art{position:absolute;inset:0;border-radius:7px;overflow:hidden;
  background:linear-gradient(152deg,#1a0205 0%,#2b0308 22%,#120103 48%,#2e0409 74%,#130104 100%);
  box-shadow:0 30px 70px rgba(0,0,0,.72),0 0 0 1px rgba(255,255,255,.07) inset,0 2px 0 rgba(255,255,255,.12) inset}
.rcpo-art::before{content:'';position:absolute;inset:0;
  background:repeating-linear-gradient(115deg,rgba(255,255,255,.035) 0 1px,transparent 1px 9px)}
/* banda diagonal de marca */
.rcpo-slash{position:absolute;left:-26%;right:-26%;height:19%;top:53%;transform:skewY(-12deg);
  background:linear-gradient(94deg,rgba(227,6,19,0) 0 6%,#B00410 14%,var(--red) 38%,#7d0309 62%,rgba(125,3,9,0) 86%)}
.rcpo-slash::after{content:'';position:absolute;left:0;right:0;bottom:-3px;height:2px;
  background:linear-gradient(90deg,transparent,rgba(201,162,39,.85) 30% 70%,transparent)}
/* zona del precinto, arriba de la línea de corte */
.rcpo-seal{position:absolute;left:0;right:0;top:0;height:21%;
  background:linear-gradient(180deg,rgba(255,255,255,.09),rgba(255,255,255,.015));
  border-bottom:1px dashed rgba(255,255,255,.22)}
.rcpo-seal span{position:absolute;left:0;right:0;bottom:36%;text-align:center;
  font-family:'IBM Plex Mono',monospace;font-size:7.5px;letter-spacing:.3em;color:rgba(255,255,255,.4)}
.rcpo-foil{position:absolute;inset:0;mix-blend-mode:color-dodge;opacity:.2;
  background:conic-gradient(from 210deg at 42% 28%,#ff2d3a22,#ffd36622,#38d0ff22,#b06bff22,#ff2d3a22)}
.rcpo-sheenwrap{position:absolute;inset:0;overflow:hidden;border-radius:7px;pointer-events:none;z-index:3}
.rcpo-sheen{position:absolute;top:-55%;bottom:-55%;width:28%;left:-45%;pointer-events:none;
  background:linear-gradient(100deg,transparent,rgba(255,255,255,.19),transparent);
  transform:rotate(14deg);will-change:transform}
.rcpo-packlogo{position:absolute;left:0;right:0;top:27%;display:flex;flex-direction:column;align-items:center;gap:4px}
.rcpo-packlogo img{width:32%;max-width:68px;display:block;filter:drop-shadow(0 3px 10px rgba(0,0,0,.8))}
.rcpo-packname{font-family:'Saira Condensed',sans-serif;font-weight:900;font-style:italic;
  font-size:clamp(16px,3.6vw,21px);text-shadow:0 2px 6px rgba(0,0,0,.85)}
.rcpo-packsub{font-family:'Saira Condensed',sans-serif;font-weight:700;font-size:9px;
  letter-spacing:.44em;color:rgba(255,255,255,.78);text-indent:.44em}
.rcpo-packfoot{position:absolute;left:0;right:0;bottom:6%;display:flex;flex-direction:column;align-items:center;gap:5px}
.rcpo-packfoot span{font-family:'IBM Plex Mono',monospace;font-size:8.5px;letter-spacing:.2em;color:#d9c9a0}
.rcpo-barcode{height:16px;width:46%;opacity:.75;
  background:repeating-linear-gradient(90deg,#e8e2d4 0 1.5px,transparent 1.5px 3px,#e8e2d4 3px 4px,transparent 4px 6.5px)}
.rcpo-innerdark{position:absolute;left:4%;right:4%;top:20.6%;height:14%;border-radius:2px;opacity:0;
  background:linear-gradient(#000,#180205);box-shadow:0 10px 26px rgba(0,0,0,.9) inset;
  transform-origin:50% 0;will-change:transform,opacity}

/* corte */
.rcpo-grip{position:absolute;left:0;right:0;top:0;height:32%;z-index:20;cursor:grab;
  touch-action:pan-y;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.rcpo-grip[data-active="1"]{cursor:grabbing}
.rcpo-cutline{position:absolute;left:0;top:21%;height:2px;width:100%;z-index:22;pointer-events:none;
  transform-origin:0 50%;transform:scaleX(0);will-change:transform}
.rcpo-cutline i{position:absolute;inset:0;display:block;
  background:linear-gradient(90deg,rgba(255,255,255,.12),var(--red2) 55%,#fff);
  box-shadow:0 0 10px rgba(255,26,39,.9),0 0 26px rgba(255,26,39,.5)}
.rcpo-cuthead{position:absolute;top:21%;left:0;width:16px;height:16px;margin:-8px 0 0 -8px;z-index:23;
  border-radius:50%;opacity:0;pointer-events:none;will-change:transform,opacity;
  background:radial-gradient(circle,#fff 0 26%,var(--red2) 38%,rgba(255,26,39,0) 72%)}
.rcpo-hint{position:absolute;left:50%;top:21%;z-index:21;transform:translate(-50%,-50%);
  display:flex;align-items:center;gap:8px;padding:7px 13px;border-radius:999px;pointer-events:none;
  background:rgba(8,8,8,.9);border:1px solid #333;box-shadow:0 6px 18px rgba(0,0,0,.6);
  white-space:nowrap;font-family:'Saira Condensed',sans-serif;font-weight:800;font-size:11px;
  letter-spacing:.14em;text-transform:uppercase;will-change:transform,opacity;
  animation:rcpo-nudge 2.1s ease-in-out infinite}
.rcpo-hint svg{display:block;color:var(--red2)}
@keyframes rcpo-nudge{0%,100%{transform:translate(-50%,-50%)}50%{transform:translate(calc(-50% + 7px),-50%)}}
.rcpo-fallback{position:absolute;left:50%;bottom:-46px;transform:translateX(-50%);z-index:24;white-space:nowrap}

/* ---- Cartas ---- */
/* Anclado explícito: como hermano absoluto dentro del grid, sin left/top
   caería en su posición estática en vez del centro del escenario. */
.rcpo-stack{position:absolute;left:50%;top:50%;width:var(--cw);height:var(--ch);
  margin-left:calc(var(--cw) / -2);margin-top:calc(var(--ch) / -2 - 34px);
  transform-style:preserve-3d;z-index:12;will-change:transform;pointer-events:none}
.rcpo-stack.is-live{pointer-events:auto}
.rcpo-slot{position:absolute;inset:0;will-change:transform,opacity;backface-visibility:hidden}
.rcpo-slot.is-top{touch-action:pan-y;cursor:grab;-webkit-tap-highlight-color:transparent}
.rcpo-slot.is-top[data-drag="1"]{cursor:grabbing}
.rcpo-halo{position:absolute;inset:-16%;border-radius:28px;opacity:0;pointer-events:none;
  filter:blur(18px);will-change:transform,opacity}
.rcpo-silhouette{position:absolute;inset:0;border-radius:11px;background:#040404;z-index:6;
  will-change:opacity;box-shadow:0 0 0 1px rgba(255,255,255,.14) inset}
.rcpo-silhouette::after{content:'';position:absolute;inset:0;border-radius:11px;
  background:radial-gradient(70% 55% at 50% 45%,rgba(255,255,255,.1),transparent 70%)}

.rcpo-counter{position:absolute;left:50%;bottom:clamp(14px,3.4vh,26px);transform:translateX(-50%);z-index:30;
  display:flex;align-items:center;gap:7px;pointer-events:none}
.rcpo-dot{width:7px;height:7px;border-radius:50%;background:#2a2a2a;transition:background .25s ease,transform .25s ease}
.rcpo-dot.on{background:var(--red);transform:scale(1.34)}
.rcpo-dot.done{background:#565656}
.rcpo-swipehint{position:absolute;left:50%;bottom:clamp(40px,8vh,62px);transform:translateX(-50%);z-index:30;
  font-family:'Saira Condensed',sans-serif;font-weight:700;font-size:11px;letter-spacing:.2em;
  text-transform:uppercase;color:#7a7a7a;pointer-events:none;white-space:nowrap;
  animation:rcpo-nudge 2.4s ease-in-out infinite}

/* ---- Resumen ---- */
.rcpo-results{position:absolute;inset:0;z-index:35;overflow:hidden;display:flex;flex-direction:column;align-items:center;
  justify-content:center;gap:clamp(10px,1.4vw,15px);padding:10px;will-change:transform,opacity;
  background:radial-gradient(70% 60% at 50% 45%,rgba(5,5,5,.86),rgba(5,5,5,.97))}
.rcpo-rtitle{font-family:'Saira Condensed',sans-serif;font-weight:900;font-style:italic;text-transform:uppercase;
  font-size:clamp(22px,3vw,34px);line-height:.95;margin:0;text-align:center}
/* Tope de 3 por fila: el resumen lee mejor en 3+2 que en 4+1. */
.rcpo-rgrid{display:flex;flex-wrap:wrap;justify-content:center;gap:var(--rgap);
  max-width:min(100%,calc(var(--rw) * 3 + var(--rgap) * 2 + 2px))}
.rcpo-rcard{width:var(--rw);will-change:transform,opacity;transform-origin:50% 100%;
  appearance:none;background:transparent;border:0;padding:0;cursor:pointer;display:block;
  transition:filter .18s ease}
.rcpo-rcard:hover{filter:brightness(1.12)}
.rcpo-rcard .rcpo-cf{font-size:calc(var(--rw)/16.4)}
.rcpo-slot .rcpo-cf{font-size:calc(var(--cw)/16.4)}
.rcpo-hintline{font-family:'IBM Plex Mono',monospace;font-size:10px;letter-spacing:.14em;
  text-transform:uppercase;color:#5a5a5a;margin:-4px 0 0;text-align:center;max-width:100%;padding:0 10px}
.rcpo-best{font-family:'IBM Plex Mono',monospace;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;
  color:var(--dim);text-align:center;margin:0;padding:0 10px;max-width:100%;line-height:1.55;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.rcpo-best b{color:var(--ink);font-weight:600}
.rcpo-actions{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}
.rcpo-btn{appearance:none;border:0;cursor:pointer;font-family:'Saira Condensed',sans-serif;font-weight:800;
  letter-spacing:.14em;text-transform:uppercase;font-size:13.5px;padding:13px 24px;border-radius:2px;
  background:var(--red);color:#fff;transition:background .18s ease,transform .18s ease}
.rcpo-btn:hover{background:var(--red2)}
.rcpo-btn:active{transform:translateY(1px)}
.rcpo-btn.ghost{background:transparent;color:var(--ink);box-shadow:0 0 0 1px #2a2a2a inset}
.rcpo-btn.ghost:hover{box-shadow:0 0 0 1px var(--red) inset;color:var(--red2)}
.rcpo-sound{background:transparent;border:1px solid #242424;border-radius:2px;color:var(--dim);
  cursor:pointer;width:34px;height:34px;display:grid;place-items:center;flex:0 0 auto;
  transition:color .18s ease,border-color .18s ease}
.rcpo-sound:hover{color:var(--ink);border-color:var(--red)}

@media (prefers-reduced-motion:reduce){
  .rcpo-hint,.rcpo-swipehint{animation:none}
}
`;

// Cara de carta: diseño propio Rocket Cards.
// Todas las medidas internas van en `em`, así una sola font-size escala la carta entera.
const CARD_CSS = `
.rcpo-cf{position:relative;width:100%;aspect-ratio:63/88;border-radius:.62em;overflow:hidden;
  font-size:16px;display:flex;flex-direction:column;-webkit-user-select:none;user-select:none;
  background:linear-gradient(160deg,var(--k2),#070707 55%,var(--k2));
  box-shadow:0 .5em 1.6em rgba(0,0,0,.6),0 0 0 .055em rgba(255,255,255,.1) inset}
.rcpo-cf::before{content:'';position:absolute;inset:.17em;border-radius:.44em;pointer-events:none;z-index:4;
  box-shadow:0 0 0 .07em var(--k) inset}
.rcpo-cf-inner{position:absolute;inset:.34em;border-radius:.34em;overflow:hidden;display:flex;
  flex-direction:column;background:linear-gradient(175deg,#0d0d0f,#040405)}
.rcpo-cf-top{display:flex;align-items:center;justify-content:space-between;gap:.3em;padding:.4em .45em .3em}
.rcpo-cf-chip{font-family:'Saira Condensed',sans-serif;font-weight:800;font-size:.44em;letter-spacing:.18em;
  text-transform:uppercase;padding:.3em .6em;border-radius:999px;color:#050505;background:var(--k);white-space:nowrap}
.rcpo-cf-off{font-family:'Saira Condensed',sans-serif;font-weight:900;font-size:.5em;letter-spacing:.06em;
  padding:.26em .5em;border-radius:.14em;background:#E30613;color:#fff;white-space:nowrap}
.rcpo-cf-art{position:relative;flex:1;min-height:0;margin:0 .4em;border-radius:.2em;overflow:hidden;
  display:grid;place-items:center;
  background:linear-gradient(176deg,#ffffff 0%,#f2f2f4 52%,#dcdce2 100%);
  box-shadow:0 0 0 .055em rgba(0,0,0,.35) inset}
.rcpo-cf-art::after{content:'';position:absolute;inset:0;pointer-events:none;
  background:repeating-linear-gradient(58deg,rgba(0,0,0,.05) 0 .09em,transparent .09em .34em)}
.rcpo-cf-rays{position:absolute;inset:-30%;opacity:.16;
  background:conic-gradient(from 0deg,transparent 0 6deg,var(--k2) 6deg 7.4deg,transparent 7.4deg 24deg)}
.rcpo-cf-img{position:relative;width:94%;height:94%;object-fit:contain;display:block;
  filter:drop-shadow(0 .12em .28em rgba(0,0,0,.3));-webkit-user-drag:none}
.rcpo-cf-holo{position:absolute;inset:0;mix-blend-mode:overlay;opacity:0;will-change:transform,opacity;
  background:conic-gradient(from 180deg at 35% 30%,#ff2d3a,#ffd366,#38d0ff,#b06bff,#ff2d3a)}
.rcpo-cf.is-holo .rcpo-cf-holo{opacity:.3}
.rcpo-cf-set{margin:.42em .5em 0;font-family:'IBM Plex Mono',monospace;font-size:.4em;line-height:1.3;
  letter-spacing:.1em;text-transform:uppercase;color:var(--k);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rcpo-cf-name{margin:.24em .5em 0;font-family:'Saira Condensed',sans-serif;font-weight:800;
  font-size:.62em;line-height:1.12;text-transform:uppercase;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.rcpo-cf-foot{display:flex;align-items:baseline;gap:.4em;padding:.3em .5em .45em;margin-top:auto}
.rcpo-cf-price{font-family:'Saira Condensed',sans-serif;font-weight:900;font-size:.72em;line-height:1;white-space:nowrap}
.rcpo-cf-old{font-family:'IBM Plex Mono',monospace;font-size:.38em;color:#6f6f6f;white-space:nowrap}
.rcpo-cf-shine{position:absolute;top:-60%;bottom:-60%;width:34%;left:-50%;z-index:5;pointer-events:none;
  background:linear-gradient(100deg,transparent,rgba(255,255,255,.3),transparent);
  transform:rotate(14deg);will-change:transform}
.rcpo-cf-mark{position:absolute;right:.5em;top:.5em;z-index:4;font-family:'Saira Condensed',sans-serif;
  font-weight:900;font-style:italic;font-size:.4em;letter-spacing:.26em;color:rgba(255,255,255,.18)}
`;

let injected = false;
export function injectStyles() {
  if (injected) return;
  injected = true;
  const tag = document.createElement('style');
  tag.id = 'rcpo-styles';
  tag.textContent = CSS + CARD_CSS;
  document.head.appendChild(tag);
}
