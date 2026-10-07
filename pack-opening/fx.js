// Motor de partículas sobre <canvas>: chispas, destellos, confeti y light streaks.
// Un canvas en vez de cientos de nodos del DOM: el reveal legendario mueve
// ~260 partículas sin tocar el layout ni disparar un solo reflow.

import { onFrame, rand, clamp } from './anim.js';

export class FX {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.parts = [];
    this.streaks = [];
    this.w = 0; this.h = 0; this.dpr = 1;
    this.stop = null;
    this._onResize = () => this.resize();
    addEventListener('resize', this._onResize, { passive: true });
    this.resize();
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = r.width; this.h = r.height;
    this.c.width = Math.round(r.width * this.dpr);
    this.c.height = Math.round(r.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  destroy() { removeEventListener('resize', this._onResize); this.clear(); }
  clear() { this.parts.length = 0; this.streaks.length = 0; this._halt(); this.ctx && this.ctx.clearRect(0, 0, this.w, this.h); }

  _run() {
    if (this.stop) return;
    this.stop = onFrame((now, dt) => this._frame(dt));
  }
  _halt() { if (this.stop) { this.stop(); this.stop = null; } }

  /** Explosión de chispas desde un punto (0..1 relativo al canvas). */
  burst(nx, ny, { count = 40, color = '#fff', speed = 260, spread = Math.PI * 2, angle = 0, life = 900, size = 2.6, gravity = 260, glow = true } = {}) {
    const x = nx * this.w, y = ny * this.h;
    for (let i = 0; i < count; i++) {
      const a = angle + rand(-spread / 2, spread / 2);
      const s = speed * rand(0.35, 1);
      this.parts.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        r: rand(size * 0.5, size), life: rand(life * 0.6, life), age: 0,
        color, gravity, glow, shape: 'dot', spin: 0, rot: 0,
      });
    }
    this._run();
  }

  /** Confeti: rectángulos que caen girando desde arriba. */
  confetti(colors, count = 70) {
    for (let i = 0; i < count; i++) {
      this.parts.push({
        x: rand(0, this.w), y: rand(-this.h * 0.4, -10),
        vx: rand(-60, 60), vy: rand(60, 190),
        r: rand(3, 6.5), life: rand(2200, 3600), age: 0,
        color: colors[(Math.random() * colors.length) | 0],
        gravity: 120, glow: false, shape: 'rect',
        rot: rand(0, Math.PI), spin: rand(-6, 6), ar: rand(0.35, 0.8),
      });
    }
    this._run();
  }

  /** Haces de luz que barren desde el centro. */
  lightStreaks(count = 14, color = 'rgba(255,255,255,.85)') {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand(-0.12, 0.12);
      this.streaks.push({ a, len: 0, max: rand(0.45, 1.05), life: rand(650, 1100), age: 0, color, wid: rand(1.5, 4.5) });
    }
    this._run();
  }

  _frame(dt) {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = dt / 1000;
    ctx.clearRect(0, 0, this.w, this.h);

    // Haces
    if (this.streaks.length) {
      const cx = this.w / 2, cy = this.h / 2;
      const R = Math.hypot(this.w, this.h) / 2;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = this.streaks.length - 1; i >= 0; i--) {
        const k = this.streaks[i];
        k.age += dt;
        const p = k.age / k.life;
        if (p >= 1) { this.streaks.splice(i, 1); continue; }
        const grow = Math.min(1, p * 2.2);
        const fade = 1 - Math.max(0, (p - 0.45) / 0.55);
        const inner = R * 0.12 * grow, outer = R * k.max * grow;
        const g = ctx.createLinearGradient(cx + Math.cos(k.a) * inner, cy + Math.sin(k.a) * inner, cx + Math.cos(k.a) * outer, cy + Math.sin(k.a) * outer);
        g.addColorStop(0, k.color); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = g; ctx.lineWidth = k.wid * fade; ctx.globalAlpha = fade;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(k.a) * inner, cy + Math.sin(k.a) * inner);
        ctx.lineTo(cx + Math.cos(k.a) * outer, cy + Math.sin(k.a) * outer);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Partículas
    ctx.save();
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.age += dt;
      if (p.age >= p.life) { this.parts.splice(i, 1); continue; }
      p.vy += p.gravity * s;
      p.vx *= 1 - 1.1 * s;
      p.vy *= 1 - 0.5 * s;
      p.x += p.vx * s; p.y += p.vy * s; p.rot += p.spin * s;
      const a = clamp(1 - p.age / p.life, 0, 1);
      ctx.globalAlpha = p.shape === 'rect' ? a : a * a;
      ctx.globalCompositeOperation = p.glow ? 'lighter' : 'source-over';
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') {
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillRect(-p.r, -p.r * p.ar, p.r * 2, p.r * 2 * p.ar);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (0.4 + a * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    if (!this.parts.length && !this.streaks.length) { this._halt(); ctx.clearRect(0, 0, this.w, this.h); }
  }
}
