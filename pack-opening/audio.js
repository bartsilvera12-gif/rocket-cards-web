// Sonido sintetizado con WebAudio: nada de archivos externos.
// El contexto se crea recién en el primer gesto del usuario (política de autoplay).

let ctx = null, master = null, muted = true;

try { muted = localStorage.getItem('rc-pack-muted') !== '0'; } catch (_) {}

function ensure() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(ctx.destination);
  return ctx;
}

export function isMuted() { return muted; }
export function setMuted(v) {
  muted = !!v;
  try { localStorage.setItem('rc-pack-muted', muted ? '1' : '0'); } catch (_) {}
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.02);
  return muted;
}
export function unlock() { ensure(); }

function noiseBuffer(seconds) {
  const n = (ctx.sampleRate * seconds) | 0;
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  return buf;
}

function noise(dur, { type = 'bandpass', freq = 1800, q = 1.2, gain = 0.3, sweep = 0 } = {}) {
  if (!ensure() || muted) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(dur);
  const f = ctx.createBiquadFilter();
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(80, freq + sweep), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur);
}

function tone(freq, dur, { type = 'sine', gain = 0.18, delay = 0, detune = 0 } = {}) {
  if (!ensure() || muted) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type; o.frequency.value = freq; o.detune.value = detune;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

/** Rasguido continuo mientras se corta: se llama por tramos del gesto. */
export function tick(progress) {
  noise(0.045, { freq: 900 + progress * 2600, q: 2.4, gain: 0.07 + progress * 0.07 });
}
export function rip() {
  noise(0.42, { freq: 2600, q: 0.8, gain: 0.34, sweep: -2100 });
  tone(120, 0.26, { type: 'triangle', gain: 0.1 });
}
export function thud() {
  noise(0.22, { type: 'lowpass', freq: 260, gain: 0.26 });
  tone(70, 0.3, { type: 'sine', gain: 0.14 });
}
export function whoosh() {
  noise(0.3, { freq: 420, q: 0.7, gain: 0.2, sweep: 2600 });
}
export function slide() {
  noise(0.12, { freq: 1500, q: 1.1, gain: 0.08 });
}
/** Acorde de reveal; se abre y se alarga según la rareza. */
export function chime(rank) {
  if (rank <= 0) { tone(520, 0.14, { gain: 0.07, type: 'triangle' }); return; }
  const roots = [0, 392, 440, 523.25, 587.33];
  const base = roots[rank] || 440;
  const steps = [1, 1.25, 1.5, 2];
  steps.slice(0, 2 + rank).forEach((m, i) =>
    tone(base * m, 0.5 + rank * 0.25, { gain: 0.1, delay: i * 0.055, type: 'sine' })
  );
  if (rank >= 3) tone(base / 4, 0.9 + rank * 0.2, { type: 'sine', gain: 0.16 });
  if (rank >= 4) {
    tone(base * 3, 1.5, { type: 'sine', gain: 0.05, delay: 0.3, detune: 6 });
    noise(1.1, { freq: 5200, q: 0.5, gain: 0.07 });
  }
}
export function boom() {
  if (!ensure() || muted) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(34, t + 0.7);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.4, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + 0.85);
}
