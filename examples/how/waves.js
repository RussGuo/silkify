/**
 * waves.js — figure 4: the ripple field, seen from above, inside the hare's outline.
 *
 * The update is src/shaders.js SIM_FRAG, run on the CPU on a 128-cell grid instead of on the GPU:
 *   velocity += (average of the four neighbours − height) · waveSpeed;  velocity ·= damping;
 *   height   += velocity;                                                height   ·= damping;
 *   the pointer mixes a dent in (pressDepth 0.3 hovering, 0.6 held);  outside the outline both are set to 0.
 * The constants are the library's (waveSpeed 1.6, damping 0.996, pressRadius 0.075, a press mix of 0.35 per step),
 * rescaled for this grid exactly as src/core.js rescales them for a coarse one (sub-steps, speed × (r / steps)²), and
 * the solver runs at 60 steps a second like core.js. The checkbox turns the "set to 0 outside" line off.
 *
 * It runs only while there is something to show and the figure is on screen, then stops. With reduced motion it never
 * animates: each touch draws one still frame, 45 steps (0.75 s) after the drop.
 */
import { shapeOf, cssVar, fitCanvas } from './shapes.js';

/* ============================================
 * Constants (src/silk.js COMMON, src/core.js)
 * ============================================ */
const S = 128;                       // cells across
const TEXEL = Math.PI / 256;         // core.js: the reference cell, in world units
const WAVE_SPEED = 1.6, DAMPING = 0.996, PRESS_RADIUS = 0.075, PRESS_DEPTH = 0.3, PRESS_HOLD = 0.6, PRESS_MIX = 0.35;
const SIM_HZ = 60, MAX_STEPS = 4, HOLD_STEPS = 7;   // a ripple() press lasts 120 ms = 7 steps
const STILL_STEPS = 45;
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function initWaves(fig, { reduced }) {
  const canvas = fig.querySelector('canvas'), wall = fig.querySelector('input[type=checkbox]');
  let s = null, inside = null, consts = null, body = null, edge = null;
  let r = new Float32Array(S * S), g = new Float32Array(S * S), r2 = new Float32Array(S * S), g2 = new Float32Array(S * S);
  let frame = 0, last = 0, clock = 0, visible = false, energy = 0;
  const press = { on: false, u: 0, v: 0, depth: PRESS_DEPTH, left: 0 };
  const field = document.createElement('canvas');
  field.width = field.height = S;
  const fg = field.getContext('2d'), fimg = fg.createImageData(S, S);
  let colours = null;

  function setup() {
    const simRef = Math.min(512, Math.round(s.shape.side / TEXEL));
    const ratio = simRef / S, steps = ratio <= 1.1 ? 1 : Math.ceil(ratio);
    consts = {
      steps, c: WAVE_SPEED * (ratio / steps) ** 2, damp: DAMPING ** (1 / steps),
      radius: (PRESS_RADIUS * 256) / simRef, mix: 1 - (1 - PRESS_MIX) ** (1 / steps),
    };
    inside = new Uint8Array(S * S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) inside[j * S + i] = s.alphaAt((i + 0.5) / S, (j + 0.5) / S) >= 0.5 ? 1 : 0;
    layers();
  }

  /* ---- the hare's body and its outline, drawn once at 512 px from the picture's own (antialiased) alpha ---- */
  function layers() {
    const B = 512, a = new Float32Array(B * B);
    for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) a[y * B + x] = s.alphaAt((x + 0.5) / B, 1 - (y + 0.5) / B);
    colours ??= { up: cssVar('--accent'), down: cssVar('--cool'), body: cssVar('--field'), line: cssVar('--muted') };
    const mk = () => { const c = document.createElement('canvas'); c.width = c.height = B; return c; };
    body = mk(); edge = mk();
    const bi = body.getContext('2d').createImageData(B, B), ei = edge.getContext('2d').createImageData(B, B);
    for (let y = 1; y < B - 1; y++) {
      for (let x = 1; x < B - 1; x++) {
        const k = y * B + x, o = k * 4;
        let lo = 1, hi = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const v = a[k + dy * B + dx]; if (v < lo) lo = v; if (v > hi) hi = v; }
        bi.data.set([...colours.body, a[k] * 255], o);
        ei.data.set([...colours.line, Math.min(1, (hi - lo) * 1.6) * 255], o);
      }
    }
    body.getContext('2d').putImageData(bi, 0, 0);
    edge.getContext('2d').putImageData(ei, 0, 0);
  }

  /* ---- one sub-step of SIM_FRAG over the whole grid (reads r, g; writes r2, g2; then swaps) ---- */
  function substep() {
    const { c, damp, radius, mix } = consts, walled = wall.checked;
    for (let j = 0; j < S; j++) {
      const jm = j > 0 ? j - 1 : 0, jp = j < S - 1 ? j + 1 : S - 1;
      for (let i = 0; i < S; i++) {
        const k = j * S + i, im = i > 0 ? i - 1 : 0, ip = i < S - 1 ? i + 1 : S - 1;
        const avg = (r[j * S + im] + r[j * S + ip] + r[jm * S + i] + r[jp * S + i]) * 0.25;
        let vel = (g[k] + (avg - r[k]) * c) * damp;
        let h = (r[k] + vel) * damp;
        if (press.on || press.left > 0) {
          const d = Math.hypot((i + 0.5) / S - press.u, (j + 0.5) / S - press.v);
          const inf = smoothstep(radius, 0, d);
          h += (-press.depth - h) * inf * mix;
        }
        if (walled && !inside[k]) { h = 0; vel = 0; }
        r2[k] = h; g2[k] = vel;
      }
    }
    [r, r2] = [r2, r]; [g, g2] = [g2, g];
  }
  function step(n) {
    for (let t = 0; t < n; t++) {
      for (let k = 0; k < consts.steps; k++) substep();
      if (press.left > 0) press.left--;
    }
  }

  /* ---- height → colour over the body: crests warm, dents cool, flat water clear; then the outline on top ---- */
  function paint() {
    const [W, H] = fitCanvas(canvas);
    const { up, down } = colours, px = fimg.data;
    energy = 0;
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const k = j * S + i, o = ((S - 1 - j) * S + i) * 4, h = r[k];   // v up → rows top-down
        energy = Math.max(energy, Math.abs(h));
        const t = Math.max(-1, Math.min(1, h / 0.12)), c = t > 0 ? up : down;
        px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255 * Math.abs(t) ** 0.8;
      }
    }
    fg.putImageData(fimg, 0, 0);
    const c2 = canvas.getContext('2d'), side = Math.min(W, H), x0 = (W - side) / 2, y0 = (H - side) / 2;
    c2.clearRect(0, 0, W, H);
    c2.imageSmoothingEnabled = true;
    c2.imageSmoothingQuality = 'high';
    c2.drawImage(body, x0, y0, side, side);
    c2.drawImage(field, x0, y0, side, side);
    c2.drawImage(edge, x0, y0, side, side);
    fig.dataset.energy = energy.toFixed(4);   // for the check script
  }

  /* ---- the loop: a fixed 60 Hz solver, as core.js; stops once the field is flat and the figure is idle ---- */
  function tick(now) {
    frame = 0;
    const raw = last ? (now - last) / 1000 : 0;
    last = now;
    clock += raw * SIM_HZ;
    const n = Math.min(MAX_STEPS, Math.floor(clock + 0.25));
    clock = Math.min(1, clock - n);
    if (n > 0) step(n);
    paint();
    if (!visible) return;
    if (press.on || press.left > 0 || energy > 0.002) frame = requestAnimationFrame(tick);
    else { r.fill(0); g.fill(0); paint(); last = 0; }
  }
  const wake = () => { if (!frame && visible && !reduced) { last = 0; clock = 0; frame = requestAnimationFrame(tick); } };

  function drop(u, v, { depth = PRESS_DEPTH, hold = HOLD_STEPS } = {}) {
    Object.assign(press, { u, v, depth, left: hold });
    if (reduced) { r.fill(0); g.fill(0); step(STILL_STEPS); paint(); } else wake();
  }

  /* ---- the pointer: hovering presses 0.3 deep, holding 0.6, like the library ---- */
  const uvOf = (e) => {
    const rc = canvas.getBoundingClientRect(), side = Math.min(rc.width, rc.height);
    return [(e.clientX - rc.left - (rc.width - side) / 2) / side, 1 - (e.clientY - rc.top - (rc.height - side) / 2) / side];
  };
  let held = false;
  canvas.addEventListener('pointermove', (e) => {
    if (reduced || !s || (e.pointerType !== 'mouse' && !held)) return;
    const [u, v] = uvOf(e);
    Object.assign(press, { on: true, u, v, depth: held ? PRESS_HOLD : PRESS_DEPTH });
    wake();
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (!s) return;
    const [u, v] = uvOf(e);
    if (reduced) return drop(u, v);
    held = true;
    Object.assign(press, { on: true, u, v, depth: PRESS_HOLD });
    wake();
  });
  const up = () => { held = false; press.depth = PRESS_DEPTH; };
  canvas.addEventListener('pointerup', (e) => { up(); if (e.pointerType !== 'mouse') press.on = false; });
  canvas.addEventListener('pointerleave', () => { up(); press.on = false; });
  canvas.addEventListener('pointercancel', () => { up(); press.on = false; });
  wall.addEventListener('change', () => { r.fill(0); g.fill(0); drop(0.44, 0.42); });
  fig.querySelector('button.drop')?.addEventListener('click', () => drop(0.44, 0.42));

  let started = false;
  return {
    async show(on) {
      visible = on;
      if (!s) { s = await shapeOf('hare'); setup(); }
      if (!on) { if (frame) cancelAnimationFrame(frame); frame = 0; return; }
      if (!started) { started = true; drop(0.44, 0.42); } else wake();   // the first look: one drop in the hare's body
      paint();
    },
    recolour() { colours = null; if (s) { layers(); paint(); } },
  };
}
