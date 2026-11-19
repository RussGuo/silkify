/**
 * dome.js — figure 1: the same outline inflated two ways, compared with a wipe.
 *
 *   right  Poisson: the height silkify actually builds (src/shape.js through shapes.js): ∇²u = −1 inside, u = 0 on
 *          the outline, h = 2√u, solved coarse to fine and smoothed twice.
 *   left   distance to the edge, the usual alternative, given its best chance: the same grid, the same two smoothing
 *          passes, and a round profile h = √(d (2D − d)) (D the largest distance), so a disc becomes the very same
 *          hemisphere as Poisson's. Whatever differs on the other shapes is the distance field itself.
 *
 * Both are shaded the same way, as plain clay under one light with a soft highlight, so the only difference on screen
 * is the surface. Static: it draws once per shape and size, and never animates (nothing to stop for reduced motion).
 */
import { shapeOf, cssVar, fitCanvas } from './shapes.js';

/* ============================================
 * Constants
 * ============================================ */
const LIGHT = norm([-0.5, 0.55, 0.67]);
const HALF = norm([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);   // Blinn half vector, eye on the z axis
const SPEC_POWER = 60;

function norm(v) { const l = Math.hypot(...v); return v.map((x) => x / l); }

/* ============================================
 * The distance field, on the same grid as the Poisson dome
 * ============================================ */
function distanceDome(s) {
  const { M, N, shape } = s, side = shape.side;
  const inside = new Uint8Array(N * N);
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) inside[j * N + i] = s.alphaAt(i / M, j / M) >= 0.5 ? 1 : 0;
  // the outline: outside points that touch an inside one
  const edge = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (inside[k]) continue;
      if ((i > 0 && inside[k - 1]) || (i < N - 1 && inside[k + 1]) || (j > 0 && inside[k - N]) || (j < N - 1 && inside[k + N])) edge.push(i, j);
    }
  }
  let d = new Float32Array(N * N), top = 0;
  const cell = side / M;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (!inside[k]) continue;
      let best = Infinity;
      for (let e = 0; e < edge.length; e += 2) {
        const dx = edge[e] - i, dy = edge[e + 1] - j, q = dx * dx + dy * dy;
        if (q < best) best = q;
      }
      d[k] = (Math.sqrt(best) - 0.5) * cell;   // to the outline, half a cell inside the first outside point
      if (d[k] > top) top = d[k];
    }
  }
  // the same two 3 × 3 box passes shape.js gives u
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(N * N);
    for (let j = 1; j < N - 1; j++) {
      for (let i = 1, k = j * N + 1; i < N - 1; i++, k++) {
        b[k] = (d[k - N - 1] + d[k - N] + d[k - N + 1] + d[k - 1] + d[k] + d[k + 1] + d[k + N - 1] + d[k + N] + d[k + N + 1]) / 9;
      }
    }
    d = b;
  }
  const h = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) { const x = Math.min(Math.max(d[k], 0), top); h[k] = Math.sqrt(x * (2 * top - x)); }
  return normalsOf(h, N, cell);
}

/** Normals by central differences, as shape.js does: three Float32Arrays. */
function normalsOf(h, N, cell) {
  const nx = new Float32Array(N * N), ny = new Float32Array(N * N), nz = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const dx = i > 0 && i < N - 1 ? (h[k + 1] - h[k - 1]) / (2 * cell) : 0;
      const dy = j > 0 && j < N - 1 ? (h[k + N] - h[k - N]) / (2 * cell) : 0;
      const l = Math.hypot(dx, dy, 1);
      nx[k] = -dx / l; ny[k] = -dy / l; nz[k] = 1 / l;
    }
  }
  return { nx, ny, nz };
}

function poissonNormals(s) {
  const { N } = s, p = s.shape.normals;
  const nx = new Float32Array(N * N), ny = new Float32Array(N * N), nz = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) { nx[k] = p[k * 3]; ny[k] = p[k * 3 + 1]; nz[k] = p[k * 3 + 2]; }
  return { nx, ny, nz };
}

/* ============================================
 * Clay shading into a canvas
 * ============================================ */
function shade(canvas, s, n, clay) {
  const [W, H] = fitCanvas(canvas);
  const g = canvas.getContext('2d');
  const img = g.createImageData(W, H), px = img.data, N = s.N;
  const sample = (grid, fx, fy) => {
    const i = Math.min(N - 2, Math.floor(fx)), j = Math.min(N - 2, Math.floor(fy)), tx = fx - i, ty = fy - j, k = j * N + i;
    const a = grid[k] + (grid[k + 1] - grid[k]) * tx, b = grid[k + N] + (grid[k + N + 1] - grid[k + N]) * tx;
    return a + (b - a) * ty;
  };
  for (let y = 0; y < H; y++) {
    const v = 1 - (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W, a = s.alphaAt(u, v), o = (y * W + x) * 4;
      if (a < 0.004) continue;
      const fx = u * (N - 1), fy = v * (N - 1);
      let X = sample(n.nx, fx, fy), Y = sample(n.ny, fx, fy), Z = sample(n.nz, fx, fy);
      const l = Math.hypot(X, Y, Z) || 1; X /= l; Y /= l; Z /= l;
      const diff = Math.max(0, X * LIGHT[0] + Y * LIGHT[1] + Z * LIGHT[2]);
      const spec = Math.max(0, X * HALF[0] + Y * HALF[1] + Z * HALF[2]) ** SPEC_POWER;
      const k = 0.5 + 0.5 * diff;
      px[o] = clay[0] * k + 120 * spec; px[o + 1] = clay[1] * k + 120 * spec; px[o + 2] = clay[2] * k + 120 * spec;
      px[o + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
}

/* ============================================
 * The figure
 * ============================================ */
export function initDome(fig) {
  const df = fig.querySelector('canvas.df'), po = fig.querySelector('canvas.po'), frame = fig.querySelector('.wipe');
  const range = fig.querySelector('input[type=range]');
  const surfaces = new Map();   // shape name → { s, df, po } (normals of both)
  let current = fig.querySelector('input[name="dome-shape"]:checked')?.value || 'portrait', drawn = '';

  const setSplit = (pct) => {
    pct = Math.max(0, Math.min(100, pct));
    frame.style.setProperty('--split', `${pct}%`);
    if (+range.value !== Math.round(pct)) range.value = Math.round(pct);
  };
  range.addEventListener('input', () => setSplit(+range.value));
  let dragging = false;
  const fromPointer = (e) => { const r = frame.getBoundingClientRect(); setSplit(((e.clientX - r.left) / r.width) * 100); };
  frame.addEventListener('pointerdown', (e) => { dragging = true; frame.setPointerCapture(e.pointerId); fromPointer(e); });
  frame.addEventListener('pointermove', (e) => { if (dragging) fromPointer(e); });
  frame.addEventListener('pointerup', () => { dragging = false; });
  frame.addEventListener('pointercancel', () => { dragging = false; });

  async function draw(force = false) {
    const name = current;
    fig.classList.add('busy');
    if (!surfaces.has(name)) {
      const s = await shapeOf(name);
      surfaces.set(name, { s, df: distanceDome(s), po: poissonNormals(s) });
    }
    if (name !== current) return;   // another shape was picked meanwhile
    const key = `${name} ${df.clientWidth} ${matchMedia('(prefers-color-scheme: dark)').matches}`;
    if (key === drawn && !force) { fig.classList.remove('busy'); return; }
    const { s, df: a, po: b } = surfaces.get(name), clay = cssVar('--clay');
    shade(df, s, a, clay);
    shade(po, s, b, clay);
    drawn = key;
    fig.classList.remove('busy');
    fig.dataset.ready = name;   // for the check script
  }
  fig.querySelectorAll('input[name="dome-shape"]').forEach((r) => r.addEventListener('change', () => { current = r.value; draw(); }));
  new ResizeObserver(() => draw()).observe(df);
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => draw(true));
  return draw();
}
