/**
 * shape.js — turn any picture's silhouette into an inflated dome.
 *
 * Pure arrays and a 2D canvas; no three.js. silk.js is the only caller.
 *
 *   picture ──► matte (its own alpha, or a rounded rectangle for opaque pictures)
 *           ──► square UV "domain" around the silhouette (RGBA, v up, colours bled past the edge)
 *           ──► Poisson inflation: solve ∇²u = −1 inside, u = 0 outside, height h = puff · 2√u
 *           ──► grid mesh (positions, normals, planar UVs) + inside(u, v) hit test
 *
 * Why Poisson and not "distance to the edge": for a disc of radius R, u = (R² − r²) / 4, so h is
 * exactly the hemisphere √(R² − r²). Round things become real domes, thin parts (a tail, a stem,
 * an ear) bulge less, and the surface is smooth everywhere — a distance field folds a crease
 * along the medial axis, which the silk highlight would trace like a seam.
 *
 * World units: the silhouette's bounding box is centred on the origin and is 2 units wide,
 * the same scale as the unit sphere in sphere mode.
 */

/* ============================================
 * Constants
 * ============================================ */
const MESH = 240;      // grid segments → 241 × 241 vertices (< 65 536, so 16-bit indices)
const PAD = 0.03;      // empty border around the silhouette, per side, as a fraction of its long side
const MAX_DOMAIN = 2048;
const BLEED_PASSES = 10;

/** Load anything drawable: a URL, an <img>, an ImageBitmap or a canvas. */
export async function loadPicture(src) {
  if (typeof src !== 'string') {
    if (src instanceof HTMLImageElement && !src.complete) await src.decode();
    return src;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  return img;
}

const sizeOf = (p) => ({ w: p.naturalWidth || p.videoWidth || p.width, h: p.naturalHeight || p.videoHeight || p.height });

function canvas2d(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

/* ---- matte: decide whether the picture carries its own silhouette ---- */
function makeMatte(pic, { matte, corner }) {
  const { w, h } = sizeOf(pic);
  const [c, g] = canvas2d(w, h);
  g.drawImage(pic, 0, 0);
  const im = g.getImageData(0, 0, w, h);
  const a = im.data;
  let clear = 0;
  for (let i = 3; i < a.length; i += 4) if (a[i] < 128) clear++;
  const mode = matte === 'auto' ? (clear > (w * h) / 200 ? 'alpha' : 'rect') : matte;
  if (mode === 'rect') {
    // rounded rectangle with a one-pixel antialiased edge: an opaque picture becomes a cushion
    const r = Math.max(0, corner) * Math.min(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const qx = Math.max(Math.abs(x + 0.5 - w / 2) - (w / 2 - r), 0);
        const qy = Math.max(Math.abs(y + 0.5 - h / 2) - (h / 2 - r), 0);
        const d = Math.hypot(qx, qy) - r;           // signed distance to the rounded edge (px)
        const cover = Math.min(1, Math.max(0, 0.5 - d));
        a[(y * w + x) * 4 + 3] = Math.round(a[(y * w + x) * 4 + 3] * cover);
      }
    }
    g.putImageData(im, 0, 0);
  }
  return { canvas: c, data: a, w, h, mode };
}

/* ---- push edge colours outward so filtering and mipmaps never pull in black from transparent pixels ---- */
function bleed(px, n) {
  let filled = new Uint8Array(n * n);
  let sr = 0, sg = 0, sb = 0, cnt = 0;
  for (let k = 0; k < n * n; k++) {
    if (px[k * 4 + 3] >= 16) {
      filled[k] = 1;
      sr += px[k * 4]; sg += px[k * 4 + 1]; sb += px[k * 4 + 2]; cnt++;
    }
  }
  for (let pass = 0; pass < BLEED_PASSES; pass++) {
    const next = filled.slice();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        if (filled[k]) continue;
        let r = 0, g = 0, b = 0, m = 0;
        if (i > 0 && filled[k - 1]) { r += px[(k - 1) * 4]; g += px[(k - 1) * 4 + 1]; b += px[(k - 1) * 4 + 2]; m++; }
        if (i < n - 1 && filled[k + 1]) { r += px[(k + 1) * 4]; g += px[(k + 1) * 4 + 1]; b += px[(k + 1) * 4 + 2]; m++; }
        if (j > 0 && filled[k - n]) { r += px[(k - n) * 4]; g += px[(k - n) * 4 + 1]; b += px[(k - n) * 4 + 2]; m++; }
        if (j < n - 1 && filled[k + n]) { r += px[(k + n) * 4]; g += px[(k + n) * 4 + 1]; b += px[(k + n) * 4 + 2]; m++; }
        if (!m) continue;
        px[k * 4] = r / m; px[k * 4 + 1] = g / m; px[k * 4 + 2] = b / m;
        next[k] = 1;
      }
    }
    filled = next;
  }
  if (!cnt) return;
  for (let k = 0; k < n * n; k++) {
    if (filled[k]) continue;
    px[k * 4] = sr / cnt; px[k * 4 + 1] = sg / cnt; px[k * 4 + 2] = sb / cnt;
  }
}

/* ---- successive over-relaxation for ∇²u = −1; only interior points move, the outside stays 0 ---- */
function relax(n, inner, h2, iters, x) {
  const w = 2 / (1 + Math.sin(Math.PI / n));   // optimal SOR factor on a square grid
  for (let t = 0; t < iters; t++) {
    for (let j = 1; j < n - 1; j++) {
      for (let i = 1, k = j * n + 1; i < n - 1; i++, k++) {
        if (!inner[k]) continue;
        x[k] += w * ((x[k - 1] + x[k + 1] + x[k - n] + x[k + n] + h2) * 0.25 - x[k]);
      }
    }
  }
}

/**
 * Build the dome for a picture.
 * @returns {null | {positions, normals, uvs, index, domain: Uint8Array, domainSize, side, aspect, mode, inside(u,v)}}
 */
export function buildShape(pic, { matte = 'auto', corner = 0.06, threshold = 0.5, puff = 1 } = {}) {
  const m = makeMatte(pic, { matte, corner });
  const { w: W, h: H, data: a } = m;
  const cut = Math.round(threshold * 255);

  // ---- bounding box of the silhouette ----
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (a[(y * W + x) * 4 + 3] > cut) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const cx = x0 + bw / 2, cy = y0 + bh / 2;
  const sidePx = Math.max(bw, bh) * (1 + 2 * PAD);
  const side = (sidePx * 2) / bw;                       // world units; silhouette width = 2

  // ---- the square domain, v up: albedo in rgb, silhouette in alpha ----
  const D = Math.min(MAX_DOMAIN, Math.max(256, Math.round(sidePx)));
  const [, dg] = canvas2d(D, D);
  const s = D / sidePx;
  dg.drawImage(m.canvas, (sidePx / 2 - cx) * s, (sidePx / 2 - cy) * s, W * s, H * s);
  const top = dg.getImageData(0, 0, D, D).data;
  const domain = new Uint8Array(D * D * 4);
  for (let j = 0; j < D; j++) domain.set(top.subarray((D - 1 - j) * D * 4, (D - j) * D * 4), j * D * 4);
  bleed(domain, D);

  const alphaAt = (u, v) => {
    if (u <= 0 || v <= 0 || u >= 1 || v >= 1) return 0;
    const fx = u * D - 0.5, fy = v * D - 0.5;
    const i = Math.max(0, Math.min(D - 2, Math.floor(fx))), j = Math.max(0, Math.min(D - 2, Math.floor(fy)));
    const tx = Math.min(1, Math.max(0, fx - i)), ty = Math.min(1, Math.max(0, fy - j));
    const k = (j * D + i) * 4 + 3;
    const t = domain[k] + (domain[k + 4] - domain[k]) * tx;
    const b = domain[k + D * 4] + (domain[k + D * 4 + 4] - domain[k + D * 4]) * tx;
    return (t + (b - t) * ty) / 255;
  };

  // ---- Poisson inflation, coarse to fine (61 → 121 → 241) ----
  const N = MESH + 1;
  const alpha = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) alpha[j * N + i] = alphaAt(i / MESH, j / MESH);
  const innerOf = (n) => {
    const step = MESH / (n - 1), inner = new Uint8Array(n * n);
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) inner[j * n + i] = alpha[j * step * N + i * step] >= threshold ? 1 : 0;
    return inner;
  };
  let n = MESH / 4 + 1;
  let inner = innerOf(n);
  let u = new Float32Array(n * n);
  relax(n, inner, (side / (n - 1)) ** 2, 300, u);
  for (const iters of [150, 100]) {
    const mm = (n - 1) * 2 + 1, fine = new Float32Array(mm * mm), fineInner = innerOf(mm);
    for (let j = 0; j < mm; j++) {
      for (let i = 0; i < mm; i++) {
        const k = j * mm + i;
        if (!fineInner[k]) continue;
        const ci = i >> 1, cj = j >> 1, oi = i & 1, oj = j & 1, c = cj * n + ci;
        fine[k] = (u[c] + u[c + oi] + u[c + oj * n] + u[c + oi + oj * n]) * 0.25;
      }
    }
    n = mm;
    inner = fineInner;
    u = fine;
    relax(n, inner, (side / (n - 1)) ** 2, iters, u);
  }

  // ---- soften the staircase: the zero contour sits on grid points, and √ has infinite slope there,
  //      so the one-cell jaggies would become flickering normals (black specks where the terminator
  //      meets the outline). Two 3×3 box passes turn it into a 2–3 cell ramp; the outline itself is
  //      still cut per pixel by the alpha in the fragment shader ----
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(N * N);
    for (let j = 1; j < N - 1; j++) {
      for (let i = 1, k = j * N + 1; i < N - 1; i++, k++) {
        b[k] = (u[k - N - 1] + u[k - N] + u[k - N + 1] + u[k - 1] + u[k] + u[k + 1] + u[k + N - 1] + u[k + N] + u[k + N + 1]) / 9;
      }
    }
    u = b;
  }

  // ---- height, normals (central differences), positions, planar UVs ----
  const hgt = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) hgt[k] = puff * 2 * Math.sqrt(Math.max(u[k], 0));
  const dgrid = side / MESH;
  const positions = new Float32Array(N * N * 3), normals = new Float32Array(N * N * 3), uvs = new Float32Array(N * N * 2);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const dx = i > 0 && i < N - 1 ? (hgt[k + 1] - hgt[k - 1]) / (2 * dgrid) : 0;
      const dy = j > 0 && j < N - 1 ? (hgt[k + N] - hgt[k - N]) / (2 * dgrid) : 0;
      const l = Math.hypot(dx, dy, 1);
      positions.set([(i / MESH - 0.5) * side, (j / MESH - 0.5) * side, hgt[k]], k * 3);
      normals.set([-dx / l, -dy / l, 1 / l], k * 3);
      uvs.set([i / MESH, j / MESH], k * 2);
    }
  }

  // ---- triangles: only cells touching the silhouette (grown by one cell); the fragment shader cuts the rest ----
  const cover = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      let hit = 0;
      for (let b = -1; b <= 1 && !hit; b++) for (let c = -1; c <= 1 && !hit; c++) {
        const jj = j + b, ii = i + c;
        if (jj >= 0 && jj < N && ii >= 0 && ii < N && alpha[jj * N + ii] > 0) hit = 1;
      }
      cover[j * N + i] = hit;
    }
  }
  const tris = [];
  for (let j = 0; j < MESH; j++) {
    for (let i = 0; i < MESH; i++) {
      const k00 = j * N + i, k10 = k00 + 1, k01 = k00 + N, k11 = k01 + 1;
      if (!(cover[k00] || cover[k10] || cover[k01] || cover[k11])) continue;
      tris.push(k00, k10, k11, k00, k11, k01);   // counter-clockwise, facing +z
    }
  }

  return {
    positions, normals, uvs, index: Uint16Array.from(tris),
    domain, domainSize: D, side, aspect: bh / bw, mode: m.mode,
    inside: (uu, vv) => alphaAt(uu, vv) >= threshold,
  };
}

/** No WebGL2: draw the picture once, contain-fitted, on a 2D canvas. Sphere pictures get the front half, clipped to a disc. */
export function paintStill(canvas, pic, { sphere = false, dpr = 2 } = {}) {
  const g = canvas.getContext('2d');
  if (!g) return;
  const k = Math.min(window.devicePixelRatio || 1, dpr);
  const cw = Math.round(canvas.clientWidth * k), ch = Math.round(canvas.clientHeight * k);
  if (!cw || !ch) return;
  canvas.width = cw;
  canvas.height = ch;
  const { w, h } = sizeOf(pic);
  g.clearRect(0, 0, cw, ch);
  if (sphere) {
    const r = Math.min(cw, ch) * 0.455;
    g.save();
    g.beginPath();
    g.arc(cw / 2, ch / 2, r, 0, Math.PI * 2);
    g.clip();
    g.drawImage(pic, w * 0.25, 0, w * 0.5, h, cw / 2 - r, ch / 2 - r, 2 * r, 2 * r);
    g.restore();
    return;
  }
  const s = Math.min(cw / w, ch / h) * 0.8;
  g.drawImage(pic, (cw - w * s) / 2, (ch - h * s) / 2, w * s, h * s);
}
