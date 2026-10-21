/**
 * silk.js — silkify anything.
 *
 *   import { silkify } from './silk.js';
 *   const silk = silkify(canvas, { image: 'pear.png' });                         // shape: 'image' (default)
 *   const moon = silkify(canvas2, { image: 'moon.png', shape: 'sphere' });
 *
 * At rest the object is matte and photographic. Where the pointer touches it, the surface is pressed in,
 * ripples spread, and only there does it turn to silk: a satin overlay and a soft highlight scale with local
 * ripple energy, so the two materials blend continuously instead of being switched.
 *
 * This file is the page side. It picks a tier (tier.js), then renders in a Web Worker on an OffscreenCanvas,
 * or on the main thread where workers cannot render, or, in the static tier, draws `poster` (or the picture)
 * once without loading three.js. The renderer itself is core.js; the dome is built by shape.js.
 *
 * Peer dependency: three (tested with 0.152.2), resolved through the page's import map or bundler.
 */
import { pickTier, TIERS } from './tier.js';
import { PUFF } from './shape.js';

export { PUFF };

/* ============================================
 * Defaults
 * ============================================ */
const COMMON = {
  shape: 'image',
  interactive: true,
  pressDepth: 0.3, pressDepthHold: 0.6, pressRadius: 0.075,
  waveSpeed: 1.6, damping: 0.996, displace: 0.32, ripple: 62,
  satin: 0.9, exposure: 1, gamma: 1, volume: 0.28,
  fillLight: true, idleSweep: true,
  dpr: undefined,          // device-pixel-ratio cap; undefined → the tier's (2 high, 1 low)
  reducedMotion: 'auto',
  tier: 'auto',            // 'auto' | 'high' | 'low' | 'static'
  worker: 'auto',          // 'auto' renders in a Web Worker when the browser can; false keeps it on the main thread
  threeUrl: undefined,     // absolute URL of three.module.js for the worker (default: import.meta.resolve('three'))
  poster: undefined,       // a still frame shown in the static tier (default: the picture itself)
  onHover: null,
};

const DEFAULTS = {
  sphere: { light: [0, 0, 1], floor: 0.05, sheen: 0.18, sheenPower: 22, phase: null, bump: null, bumpStrength: 7, spin: true, spinSpeed: 0.006, angle: 0 },
  image: { light: [-0.35, 0.45, 0.82], floor: 0.55, sheen: 0.3, sheenPower: 16, puff: 'dome', matte: 'auto', corner: 0.06, threshold: 0.5, albedo: null, grain: 0, fit: 1.3 },
};

/* ============================================
 * Helpers
 * ============================================ */
const transferred = new WeakSet();   // a canvas can be handed to a worker only once

const absolute = (src) => (typeof src === 'string' ? new URL(src, document.baseURI).href : src);

/** Plain data the worker can receive: no functions, no DOM objects. */
function plain(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'function' || (v && typeof v === 'object' && !Array.isArray(v))) continue;
    out[k] = v;
  }
  return out;
}

function resolveThree(explicit) {
  if (explicit) return absolute(explicit);
  try {
    const url = import.meta.resolve?.('three');
    return url && /^(https?|blob):/.test(url) ? url : null;
  } catch {
    return null;
  }
}

function spawnWorker() {
  const url = new URL('./worker.js', import.meta.url);
  try {
    return new Worker(url, { type: 'module' });
  } catch {
    // a cross-origin script (silk.js from a CDN) cannot start a worker directly: start a same-origin trampoline
    const blob = new Blob([`import ${JSON.stringify(url.href)};`], { type: 'text/javascript' });
    return new Worker(URL.createObjectURL(blob), { type: 'module' });
  }
}

const canWorker = () => typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
  && 'transferControlToOffscreen' in HTMLCanvasElement.prototype;

function loadImage(src) {
  if (typeof src !== 'string') return Promise.resolve(src);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  return img.decode().then(() => img);
}

/** Wait until the canvas has a layout size (the scene is sized to it once). */
function sized(canvas) {
  if (canvas.clientWidth && canvas.clientHeight) return Promise.resolve();
  return new Promise((resolve) => {
    const ro = new ResizeObserver(() => {
      if (canvas.clientWidth && canvas.clientHeight) { ro.disconnect(); resolve(); }
    });
    ro.observe(canvas);
  });
}

/* ============================================
 * silkify(canvas, options) → handle
 * ============================================ */
export function silkify(canvasIn, options = {}) {
  const kind = options.shape === 'sphere' ? 'sphere' : 'image';
  const o = { ...COMMON, ...DEFAULTS[kind], ...options, shape: kind };
  if (!o.image) throw new Error('silkify: options.image is required');

  const reduceMq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduced = () => (o.reducedMotion === 'auto' ? !!reduceMq?.matches : !!o.reducedMotion);
  const tier = pickTier(o.tier, o.reducedMotion);

  let canvas = canvasIn;
  let send = () => {};
  let worker = null, disposed = false, inView = true, staticPic = null;
  const ctl = new AbortController();
  const on = { signal: ctl.signal, passive: true };

  const handle = {
    get canvas() { return canvas; },
    mode: 'loading',          // → 'webgl' | 'static' | 'failed'
    tier: tier.tier,          // may become 'low' once the renderer finds a software rasteriser
    thread: null,             // 'worker' | 'main' when live
    info: null,               // { sim, steps, mesh, software } when live
    ready: null,
    setTheme(patch) { Object.assign(o, patch); send({ t: 'options', patch: plain(patch) }); },
    setPhase(f) { handle.setTheme({ phase: f }); },
    wake() { send({ t: 'wake' }); },
    dispose() {
      if (disposed) return;
      disposed = true;
      ctl.abort();
      io.disconnect();
      ro.disconnect();
      send({ t: 'dispose' });
      worker?.terminate();
      worker = null;
    },
  };

  /* ---- a fresh element in place of a canvas that already belongs to a worker ---- */
  function freshCanvas() {
    const c = canvas.cloneNode(false);
    canvas.replaceWith(c);
    io.unobserve(canvas); ro.unobserve(canvas);
    canvas = c;
    io.observe(canvas); ro.observe(canvas);
  }

  const view = () => ({ w: canvas.clientWidth, h: canvas.clientHeight, dpr: window.devicePixelRatio || 1 });
  const visible = () => inView && !document.hidden;

  const io = new IntersectionObserver((es) => {
    inView = es[es.length - 1].isIntersecting;
    send({ t: 'visible', visible: visible() });
  }, { rootMargin: '100px' });
  const ro = new ResizeObserver(() => {
    if (handle.mode === 'static') paintStatic();
    else send({ t: 'view', view: view() });
  });
  io.observe(canvas);
  ro.observe(canvas);

  /* ---- static: no three.js; the poster (a rendered frame of this canvas) or the picture, drawn once ---- */
  async function paintStatic() {
    if (disposed) return;
    if (transferred.has(canvas)) freshCanvas();
    staticPic ??= await loadImage(o.poster || o.image).catch(() => null);
    const g = canvas.getContext('2d');
    if (!g || !staticPic) return;
    const k = Math.min(window.devicePixelRatio || 1, o.dpr ?? 2);
    const cw = Math.round(canvas.clientWidth * k), ch = Math.round(canvas.clientHeight * k);
    if (!cw || !ch) return;
    canvas.width = cw;
    canvas.height = ch;
    const w = staticPic.naturalWidth || staticPic.width, h = staticPic.naturalHeight || staticPic.height;
    g.clearRect(0, 0, cw, ch);
    if (o.poster) {
      const s = Math.max(cw / w, ch / h);             // a poster is this canvas's own frame: cover
      g.drawImage(staticPic, (cw - w * s) / 2, (ch - h * s) / 2, w * s, h * s);
    } else if (kind === 'sphere') {
      const r = (Math.min(cw, ch) / 2) / (4.25 * Math.tan(Math.PI / 12));
      g.save();
      g.beginPath();
      g.arc(cw / 2, ch / 2, r, 0, Math.PI * 2);
      g.clip();
      g.drawImage(staticPic, w * 0.25, 0, w * 0.5, h, cw / 2 - r, ch / 2 - r, 2 * r, 2 * r);
      g.restore();
    } else {
      const s = Math.min(cw / w, ch / h) / o.fit;
      g.drawImage(staticPic, (cw - w * s) / 2, (ch - h * s) / 2, w * s, h * s);
    }
  }

  /* ---- live: one attempt on a given thread; resolves with the ready info or rejects ---- */
  async function attempt(onWorker, threeUrl) {
    const picture = typeof o.image === 'string' ? absolute(o.image) : await createImageBitmap(o.image);
    const bump = typeof o.bump === 'string' ? absolute(o.bump) : null;
    const msg = {
      t: 'init', threeUrl, picture, bump, options: plain(o), tier, lowTier: TIERS.low, forced: o.tier !== 'auto',
      view: view(), visible: visible(), still: reduced(),
    };
    return new Promise((resolve, reject) => {
      const receive = (m) => {
        if (m.t === 'ready') resolve(m);
        else if (m.t === 'hover') o.onHover?.(m.on);
        else if (m.t === 'fail') reject(new Error(m.reason));
      };
      if (onWorker) {
        const offscreen = canvas.transferControlToOffscreen();
        transferred.add(canvas);
        worker = spawnWorker();
        worker.onmessage = (e) => receive(e.data);
        worker.onerror = (e) => { e.preventDefault?.(); reject(new Error(e.message || 'worker error')); };
        send = (m, transfer) => worker?.postMessage(m, transfer || []);
        msg.canvas = offscreen;
        send(msg, [offscreen, ...(picture instanceof ImageBitmap ? [picture] : [])]);
      } else {
        Promise.all([import('./core.js'), import('three')]).then(([core, THREE]) => {
          const endpoint = core.serve((m) => queueMicrotask(() => receive(m)), async () => THREE);
          send = endpoint;
          msg.canvas = canvas;
          endpoint(msg);
        }, reject);
      }
    });
  }

  function listen() {
    const ndc = (e) => {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      send({ t: 'pointer', x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 });
    };
    window.addEventListener('pointermove', ndc, on);
    window.addEventListener('pointerdown', (e) => { ndc(e); send({ t: 'press', down: true }); }, on);
    // a mouse that lets go is still there; a lifted finger or pen is not (else its last point "hovers" forever)
    window.addEventListener('pointerup', (e) => send(e.pointerType === 'mouse' ? { t: 'press', down: false } : { t: 'lift' }), on);
    window.addEventListener('pointercancel', () => send({ t: 'lift' }), on);   // a touch that turns into a scroll
    document.documentElement.addEventListener('pointerleave', () => send({ t: 'lift' }), on);
    window.addEventListener('blur', () => send({ t: 'lift' }), on);
    document.addEventListener('visibilitychange', () => send({ t: 'visible', visible: visible() }), on);
    reduceMq?.addEventListener?.('change', () => send({ t: 'still', still: reduced() }), on);
  }

  handle.ready = (async () => {
    await sized(canvas);
    if (disposed) return handle;
    if (tier.tier !== 'static') {
      const threeUrl = resolveThree(o.threeUrl);
      const tries = o.worker !== false && canWorker() && threeUrl ? [true, false] : [false];
      for (const onWorker of tries) {
        try {
          if (transferred.has(canvas)) freshCanvas();
          const info = await attempt(onWorker, threeUrl);
          if (disposed) { send({ t: 'dispose' }); worker?.terminate(); return handle; }
          Object.assign(handle, { mode: 'webgl', thread: onWorker ? 'worker' : 'main', tier: info.tier, info });
          listen();
          return handle;
        } catch {
          worker?.terminate();
          worker = null;
          send = () => {};
        }
      }
    }
    handle.mode = 'static';
    await paintStatic();
    if (!staticPic) handle.mode = 'failed';
    return handle;
  })();
  return handle;
}

export default silkify;
