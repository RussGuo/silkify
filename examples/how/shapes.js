/**
 * shapes.js — the pictures the "How silkify works" figures are made from, and the dome silkify builds for each.
 *
 * The domes come from the library itself (src/shape.js buildShape, the same call core.js makes), so the figures
 * show the real Poisson solve, not a re-creation of it. Only the grid is fixed here (160 segments, a 512-texel
 * domain) instead of sized to the screen, and each shape is built once per page, lazily, then cached.
 *
 *   shapeOf(name)   → Promise<{ shape, N, M, alphaAt(u, v), heightAt(u, v), normalAt(u, v, out), colorAt(u, v, out) }>
 *   loadPixels(url) → Promise<{ w, h, data }>   (the moon's colour map, read once)
 *   cssVar(name)    → the page's colour token as [r, g, b] (0–255), so the 2D figures follow light and dark mode
 *
 * Consumed by dome.js (figure 1), light.js (figure 2) and waves.js (figure 4).
 */
import { buildShape } from '../../src/shape.js';

/* ============================================
 * Constants
 * ============================================ */
const MESH = 160;          // grid segments (a multiple of 4: the solve runs 41 → 81 → 161)
const DOMAIN = 512;        // texels across the square domain
const SOURCES = {
  portrait: { url: '../images/mona-lisa.webp', puff: 1 },   // opaque: silkify gives it a rounded rectangle
  hare: { url: '../images/hare.webp', puff: 1 },
  pomegranate: { url: '../images/pomegranate.webp', puff: 1 },
  disc: { disc: true, puff: 1 },
};

/* ============================================
 * Helpers
 * ============================================ */
const cache = new Map();

async function picture(src) {
  if (src.disc) {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#c9bca6';
    g.beginPath();
    g.arc(256, 256, 236, 0, Math.PI * 2);
    g.fill();
    return c;
  }
  const img = new Image();
  img.src = new URL(src.url, import.meta.url).href;
  await img.decode();
  return img;
}

/** Bilinear sample of a scalar grid of n × n values over [0, 1]². */
function bilinear(grid, n, u, v) {
  const fx = Math.min(n - 1.0001, Math.max(0, u * (n - 1))), fy = Math.min(n - 1.0001, Math.max(0, v * (n - 1)));
  const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j, k = j * n + i;
  const a = grid[k] + (grid[k + 1] - grid[k]) * tx;
  const b = grid[k + n] + (grid[k + n + 1] - grid[k + n]) * tx;
  return a + (b - a) * ty;
}

/** Wrap a buildShape() result with the samplers the figures need (u, v in [0, 1], v up, like the library). */
function wrap(shape) {
  const M = shape.mesh, N = M + 1, D = shape.domainSize, dom = shape.domain;
  const height = new Float32Array(N * N), nx = new Float32Array(N * N), ny = new Float32Array(N * N), nz = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) {
    height[k] = shape.positions[k * 3 + 2];
    nx[k] = shape.normals[k * 3]; ny[k] = shape.normals[k * 3 + 1]; nz[k] = shape.normals[k * 3 + 2];
  }
  // the same bilinear alpha lookup as shape.js alphaAt
  const texel = (u, v, c) => {
    if (u <= 0 || v <= 0 || u >= 1 || v >= 1) return 0;
    const fx = u * D - 0.5, fy = v * D - 0.5;
    const i = Math.max(0, Math.min(D - 2, Math.floor(fx))), j = Math.max(0, Math.min(D - 2, Math.floor(fy)));
    const tx = Math.min(1, Math.max(0, fx - i)), ty = Math.min(1, Math.max(0, fy - j));
    const k = (j * D + i) * 4 + c;
    const t = dom[k] + (dom[k + 4] - dom[k]) * tx;
    const b = dom[k + D * 4] + (dom[k + D * 4 + 4] - dom[k + D * 4]) * tx;
    return (t + (b - t) * ty) / 255;
  };
  return {
    shape, M, N,
    alphaAt: (u, v) => texel(u, v, 3),
    heightAt: (u, v) => bilinear(height, N, u, v),
    normalAt(u, v, out) {
      const x = bilinear(nx, N, u, v), y = bilinear(ny, N, u, v), z = bilinear(nz, N, u, v), l = Math.hypot(x, y, z) || 1;
      out[0] = x / l; out[1] = y / l; out[2] = z / l;
      return out;
    },
    colorAt(u, v, out) {
      out[0] = texel(u, v, 0); out[1] = texel(u, v, 1); out[2] = texel(u, v, 2);
      return out;
    },
  };
}

/* ============================================
 * Exports
 * ============================================ */
export function shapeOf(name) {
  if (!cache.has(name)) {
    const src = SOURCES[name];
    cache.set(name, picture(src).then((pic) => wrap(buildShape(pic, {
      matte: 'auto', corner: 0.06, threshold: 0.5, puff: src.puff, meshFor: () => MESH, domainFor: () => DOMAIN,
    }))));
  }
  return cache.get(name);
}

export async function loadPixels(url) {
  const img = new Image();
  img.src = new URL(url, import.meta.url).href;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  return { w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
}

export function cssVar(name) {
  const probe = document.createElement('span');
  probe.style.color = `var(${name})`;
  document.body.append(probe);
  const m = getComputedStyle(probe).color.match(/[\d.]+/g) || [0, 0, 0];
  probe.remove();
  return m.slice(0, 3).map(Number);
}

/** Run `fn` when the browser is idle (or soon, where it has no idle callback). */
export const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 600 }) : setTimeout(fn, 60));

/** A canvas's backing store sized to its CSS box at the device-pixel ratio (capped at 2). Returns [w, h, ratio]. */
export function fitCanvas(canvas) {
  const k = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(canvas.clientWidth * k)), h = Math.max(1, Math.round(canvas.clientHeight * k));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return [w, h, k];
}
