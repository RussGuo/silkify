/**
 * light.js — figure 2: Lambert next to Lommel–Seeliger, on the Moon and on a picture's dome.
 *
 * Each pane redoes, in JavaScript, the matte part of src/shaders.js OBJ_FRAG at rest (no ripples, so no silk):
 *   shadow = smoothstep(−0.09, 0.03, μgeo)      μ0 = max(N · sun, 0) · shadow      μ = max(N · view, 0)
 *   Lommel–Seeliger  lunar = clamp(2 μ0 / max(μ0 + μ, DEN), 0, 1)        Lambert  lunar = μ0
 *   lum = lunar + floor · (1 − lunar);   colour = albedo · lum · (1 − volume … 1 by the fill-light gradient)
 * with the library's defaults: floor 0.05 and DEN 0.02 on the sphere, floor 0.55 and DEN 0.15 on a picture, volume 0.28
 * towards the fill light's home direction. The camera is the library's too: the sphere seen from z = 4.25, the picture
 * orthographic from z = 5 with fit 1.3. Left out: the moon's elevation relief and its perspective (drawn orthographic).
 * Only the formula differs between the two panes. Redrawn on input; nothing animates.
 */
import { shapeOf, loadPixels, fitCanvas } from './shapes.js';

/* ============================================
 * Constants (src/silk.js COMMON / DEFAULTS, src/core.js)
 * ============================================ */
const VOLUME = 0.28;
const FILL_HOME = norm([-0.55, 0.6, 0.58]);
const SUBJECTS = {
  moon: { floor: 0.05, den: 0.02, azimuth: 0, angle: 0 },                    // full moon: the sun behind you
  pomegranate: { floor: 0.55, den: 0.15, azimuth: Math.atan2(0.45, -0.35), angle: Math.acos(0.82 / Math.hypot(-0.35, 0.45, 0.82)) },
};
const FIT = 1.3, CAM_Z = 5, SPHERE_Z = 4.25;

function norm(v) { const l = Math.hypot(...v); return v.map((x) => x / l); }
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** One pixel of the rest frame. n = geometric normal, view = towards the eye, sun = towards the sun. */
function lit(n, view, sun, sub, lambert) {
  const muGeo = n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2];
  const mu0 = Math.max(muGeo, 0) * smoothstep(-0.09, 0.03, muGeo);
  const mu = Math.max(n[0] * view[0] + n[1] * view[1] + n[2] * view[2], 0);
  const lunar = lambert ? Math.min(1, mu0) : Math.min(1, Math.max(0, (2 * mu0) / Math.max(mu0 + mu, sub.den)));
  const lum = lunar + sub.floor * (1 - lunar);
  const fill = smoothstep(-1, 1, n[0] * FILL_HOME[0] + n[1] * FILL_HOME[1] + n[2] * FILL_HOME[2]);
  return lum * (1 - VOLUME + VOLUME * fill);
}

/* ============================================
 * Drawing
 * ============================================ */
function drawMoon(canvas, map, sun, lambert) {
  const [W, H] = fitCanvas(canvas);
  const g = canvas.getContext('2d'), img = g.createImageData(W, H), px = img.data;
  const R = Math.min(W, H) * 0.42, cx = W / 2, cy = H / 2, n = [0, 0, 0], view = [0, 0, 0], sub = SUBJECTS.moon;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const X = (x + 0.5 - cx) / R, Y = (cy - y - 0.5) / R, q = X * X + Y * Y;
      if (q > 1.0) continue;
      const Z = Math.sqrt(Math.max(0, 1 - q));
      n[0] = X; n[1] = Y; n[2] = Z;
      const vx = -X, vy = -Y, vz = SPHERE_Z - Z, vl = Math.hypot(vx, vy, vz);
      view[0] = vx / vl; view[1] = vy / vl; view[2] = vz / vl;
      const k = lit(n, view, sun, sub, lambert);
      // equirectangular map, the near side (longitude 0) facing you
      const u = 0.5 + Math.atan2(X, Z) / (2 * Math.PI), v = 0.5 - Math.asin(Math.max(-1, Math.min(1, Y))) / Math.PI;
      const mi = (Math.min(map.h - 1, Math.floor(v * map.h)) * map.w + Math.min(map.w - 1, Math.floor(u * map.w))) * 4;
      const edge = Math.min(1, (1 - Math.sqrt(q)) * R);   // one pixel of antialiasing at the limb
      const o = (y * W + x) * 4;
      px[o] = map.data[mi] * k; px[o + 1] = map.data[mi + 1] * k; px[o + 2] = map.data[mi + 2] * k; px[o + 3] = 255 * edge;
    }
  }
  g.putImageData(img, 0, 0);
}

function drawPicture(canvas, s, sun, lambert) {
  const [W, H] = fitCanvas(canvas);
  const g = canvas.getContext('2d'), img = g.createImageData(W, H), px = img.data;
  const side = s.shape.side, aspect = s.shape.aspect, A = W / H;
  const halfH = Math.max(FIT * aspect, FIT / A), halfW = halfH * A;
  const n = [0, 0, 0], view = [0, 0, 0], c = [0, 0, 0], sub = SUBJECTS.pomegranate;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const wx = ((x + 0.5) / W * 2 - 1) * halfW, wy = (1 - (y + 0.5) / H * 2) * halfH;
      const u = wx / side + 0.5, v = wy / side + 0.5, a = s.alphaAt(u, v);
      if (a < 0.004) continue;
      s.normalAt(u, v, n);
      const h = s.heightAt(u, v), vz = CAM_Z - h, vl = Math.hypot(wx, wy, vz);   // view = normalize(−viewPos), as the shader
      view[0] = -wx / vl; view[1] = -wy / vl; view[2] = vz / vl;
      const k = lit(n, view, sun, sub, lambert) * 255;
      s.colorAt(u, v, c);
      const o = (y * W + x) * 4;
      px[o] = c[0] * k; px[o + 1] = c[1] * k; px[o + 2] = c[2] * k; px[o + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
}

/* ============================================
 * The figure
 * ============================================ */
export function initLight(fig) {
  const lam = fig.querySelector('canvas.lambert'), ls = fig.querySelector('canvas.ls');
  const range = fig.querySelector('input[type=range]'), out = fig.querySelector('output');
  let subject = fig.querySelector('input[name="light-subject"]:checked')?.value || 'moon', moon = null, pome = null, queued = 0;

  const sunDir = () => {
    const sub = SUBJECTS[subject], t = (+range.value * Math.PI) / 180;
    return [Math.sin(t) * Math.cos(sub.azimuth || 0), Math.sin(t) * Math.sin(sub.azimuth || 0), Math.cos(t)].map((x, i, a) => x / Math.hypot(...a));
  };
  async function draw() {
    queued = 0;
    fig.classList.add('busy');
    if (subject === 'moon') moon ??= await loadPixels('../images/moon.webp');
    else pome ??= await shapeOf('pomegranate');
    const sun = sunDir();
    out.value = `${Math.round(+range.value)}°`;
    if (subject === 'moon') { drawMoon(lam, moon, sun, true); drawMoon(ls, moon, sun, false); }
    else { drawPicture(lam, pome, sun, true); drawPicture(ls, pome, sun, false); }
    fig.classList.remove('busy');
    fig.dataset.ready = subject;
  }
  const later = () => { if (!queued) queued = requestAnimationFrame(draw); };
  const reset = () => { range.value = Math.round((SUBJECTS[subject].angle * 180) / Math.PI); };
  fig.querySelectorAll('input[name="light-subject"]').forEach((r) => r.addEventListener('change', () => { subject = r.value; reset(); later(); }));
  range.addEventListener('input', later);
  new ResizeObserver(later).observe(ls);
  reset();
  return draw();
}
