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
 * Presets name a whole look: `material` (silk, satin, velvet, wet, foil, paper, ink) and `feel` (silk, water,
 * gel, jelly), from presets.js, merged under the explicit options (see resolveOptions).
 *
 * This file is the page side. It picks a tier (tier.js), then renders in a Web Worker on an OffscreenCanvas,
 * or on the main thread where workers cannot render, or, in the static tier, draws `poster` (or the picture)
 * once without loading three.js. The renderer itself is core.js; the dome is built by shape.js.
 *
 * Failing loudly: a picture that cannot be loaded or decoded, or one with nothing opaque in it, ends in
 * mode 'failed' with `handle.reason` and one console.warn — the only console output of the library. SVG pictures
 * are rasterised here, on the page (workers cannot decode SVG), and handed to the renderer as a bitmap.
 *
 * Peer dependency: three (tested with 0.152.2), resolved through the page's import map or bundler.
 */
import { pickTier, TIERS } from './tier.js';
import { PUFF } from './shape.js';
import { MATERIALS, FEELS, keysOf } from './presets.js';

export { PUFF, MATERIALS, FEELS };

/* ============================================
 * Defaults
 * ============================================ */
const COMMON = {
  shape: 'image',
  interactive: true,
  pressDepth: 0.3, pressDepthHold: 0.6, pressRadius: 0.075,
  waveSpeed: 1.6, damping: 0.996, displace: 0.32, ripple: 62,
  satin: 0.9, exposure: 1, gamma: 1, volume: 0.28,
  // material dimensions: every default leaves the classic look untouched
  lightColor: [1, 1, 1], sheenColor: [0.9, 0.95, 1], satinLight: [0.5, 0.6, 0.45],
  anisotropy: 0, anisotropyAngle: 0, rim: 0, rimPower: 3, rimColor: [1, 1, 1], iridescence: 0, silkRest: 0, silkSpread: 1,
  threads: 0, metallic: 0, grainScale: 1,
  // motion that does not wait for a pointer: off by default, because both keep the loop awake
  autoplay: false,         // true | { interval: 2500, depth: 0.3, radius } — a drop at a random point every interval ms
  breeze: 0,               // 0–1: a slow noise field keeps the surface faintly alive (30 fps while visible)
  fillLight: true, idleSweep: true,
  dpr: undefined,          // device-pixel-ratio cap; undefined → the tier's (2 high, 1 low)
  reducedMotion: 'auto',
  tier: 'auto',            // 'auto' | 'high' | 'low' | 'static'
  worker: 'auto',          // 'auto' renders in a Web Worker when the browser can; false keeps it on the main thread
  threeUrl: undefined,     // absolute URL of three.module.js for the worker (default: import.meta.resolve('three'))
  poster: undefined,       // a still frame shown in the static tier (default: the picture itself)
  stepPerFrame: false,     // one solver step per drawn frame instead of 60 per second: frame-exact recordings only
  onHover: null,
};

const DEFAULTS = {
  sphere: { light: [0, 0, 1], floor: 0.05, sheen: 0.18, sheenPower: 22, phase: null, bump: null, bumpStrength: 7, spin: true, spinSpeed: 0.006, angle: 0 },
  image: { light: [-0.35, 0.45, 0.82], floor: 0.55, sheen: 0.3, sheenPower: 16, puff: 'dome', matte: 'auto', corner: 0.06, threshold: 0.5, albedo: null, grain: 0, fit: 1.3 },
};

const SVG_PX = 1024;   // an SVG picture is rasterised to this long side

/* ============================================
 * Helpers
 * ============================================ */
const claimed = new WeakSet();   // canvases a renderer owns (transferred to a worker, or holding a WebGL context)
const owner = new WeakMap();     // canvas → the handle that renders it (a second silkify() on it replaces the first)

const absolute = (src) => (typeof src === 'string' ? new URL(src, document.baseURI).href : src);

/** Plain data the worker can receive: no functions, no DOM objects (object literals such as `autoplay` pass). */
function plain(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'function' || (v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype)) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? plain(v) : v;
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

/**
 * The worker. Same origin: the literal `new Worker(new URL('./worker.js', import.meta.url), { type: 'module' })`,
 * the form Vite, webpack and Turbopack recognise, so a bundler builds worker.js with its imports (three included).
 * Another origin (silk.js from a CDN): a page cannot start a worker from there, and Firefox and Safari only say so
 * asynchronously, so it is decided up front: a same-origin blob: trampoline imports the CDN worker. The worker's
 * URL is built with string operations here, so bundlers do not mistake it for an asset.
 */
function spawnWorker() {
  const here = new URL(import.meta.url);   // a bundler may make it a file: URL (Turbopack): that is not another origin
  if (/^https?:$/.test(here.protocol) && here.origin !== location.origin) {
    const src = import.meta.url.replace(/[^/]*$/, 'worker.js');
    const url = URL.createObjectURL(new Blob([`import ${JSON.stringify(src)};`], { type: 'text/javascript' }));
    const worker = new Worker(url, { type: 'module' });
    worker.addEventListener('message', () => URL.revokeObjectURL(url), { once: true });
    return worker;
  }
  return new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
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

/* ---- SVG: workers cannot decode it (createImageBitmap rejects SVG), so it becomes a bitmap here ---- */
const SVG_URL = /^data:image\/svg\+xml|\.svg(?:[?#]|$)/i;
const isSvg = (src) => (typeof src === 'string' ? SVG_URL.test(src)
  : typeof Blob !== 'undefined' && src instanceof Blob ? /svg/i.test(src.type)
  : typeof HTMLImageElement !== 'undefined' && src instanceof HTMLImageElement && SVG_URL.test(src.currentSrc || src.src));

/** Draw an SVG (URL, Blob or <img>) into a canvas, SVG_PX on its long side. */
async function rasterize(src) {
  const url = typeof src === 'string' ? src : src instanceof Blob ? URL.createObjectURL(src) : null;
  try {
    const img = url ? await loadImage(url) : (src.complete || (await src.decode()), src);
    const w = img.naturalWidth || SVG_PX, h = img.naturalHeight || SVG_PX, k = SVG_PX / Math.max(w, h);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    if (url && url !== src) URL.revokeObjectURL(url);
  }
}

/** Does a picture have anything opaque in it? (Sampled small: only an empty picture answers no.) */
function opaque(pic) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(pic, 0, 0, 64, 64);
  try {
    const a = g.getImageData(0, 0, 64, 64).data;
    for (let i = 3; i < a.length; i += 4) if (a[i] > 8) return true;
    return false;
  } catch {
    return true;   // a tainted canvas cannot be read: assume the picture is fine
  }
}

/** Wait until the canvas has a layout size (the scene is sized to it once); a canvas in display: none waits. */
function sized(canvas, signal) {
  if (canvas.clientWidth && canvas.clientHeight) return Promise.resolve();
  return new Promise((resolve) => {
    const ro = new ResizeObserver(() => {
      if (canvas.clientWidth && canvas.clientHeight) { ro.disconnect(); resolve(); }
    });
    ro.observe(canvas);
    signal.addEventListener('abort', () => { ro.disconnect(); resolve(); }, { once: true });
  });
}

const describe = (x) => (x === null ? 'null' : x === undefined ? 'undefined' : x?.constructor?.name || typeof x);

/**
 * The options silkify will actually use: COMMON < DEFAULTS[shape] < material < feel < explicit options.
 * Exported for tools (examples/lab.html prints only what differs from it).
 */
export function resolveOptions(options = {}) {
  const kind = options.shape === 'sphere' ? 'sphere' : 'image';
  return { ...COMMON, ...DEFAULTS[kind], ...preset(MATERIALS, options.material), ...preset(FEELS, options.feel), ...options, shape: kind };
}
function preset(group, name) {
  if (name === undefined || name === null) return {};
  if (!group[name]) throw new Error(`silkify: unknown preset '${name}' (${Object.keys(group).join(', ')})`);
  return group[name];
}

/* ============================================
 * silkify(canvas, options) → handle
 * ============================================ */
export function silkify(canvasIn, options = {}) {
  if (typeof HTMLCanvasElement === 'undefined' || !(canvasIn instanceof HTMLCanvasElement)) {
    throw new TypeError(`silkify: the first argument must be a <canvas> element, not ${describe(canvasIn)}`);
  }
  const o = resolveOptions(options);
  const kind = o.shape;
  if (!o.image) throw new Error('silkify: options.image is required');
  owner.get(canvasIn)?.dispose();   // one renderer per canvas: the newer call wins, the older one is disposed

  const reduceMq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduced = () => (o.reducedMotion === 'auto' ? !!reduceMq?.matches : !!o.reducedMotion);
  const tier = pickTier(o.tier, o.reducedMotion);

  let canvas = canvasIn;
  let send = () => {};
  let worker = null, disposed = false, inView = true, staticPic = null, raster = null;
  const early = [];          // ripple() calls made before the renderer was ready: replayed by the renderer
  const asked = new Map();   // stats requests in flight: id → resolve
  let askId = 0;
  const ctl = new AbortController();
  const on = { signal: ctl.signal, passive: true };

  const handle = {
    get canvas() { return canvas; },
    mode: 'loading',          // → 'webgl' | 'static' | 'failed' | 'disposed'
    tier: tier.tier,          // may become 'low' once the renderer finds a software rasteriser, 'static' on a fallback
    thread: null,             // 'worker' | 'main' when live
    info: null,               // { sim, steps, mesh, texture, software } when live
    reason: tier.why || null, // why it is static or failed, in words
    ready: null,
    setTheme(patch) {
      // a preset name resets every key its group can set (to the new preset's value or the default), then the rest applies
      const base = { ...COMMON, ...DEFAULTS[kind] };
      const swap = (group, name, p = preset(group, name)) => Object.fromEntries(keysOf(group).map((k) => [k, k in p ? p[k] : base[k]]));
      if (patch.material !== undefined) patch = { ...swap(MATERIALS, patch.material), ...patch };
      if (patch.feel !== undefined) patch = { ...swap(FEELS, patch.feel), ...patch };
      Object.assign(o, patch);   // a renderer that starts later reads it from here; one that is starting queues it
      send({ t: 'options', patch: plain(patch) });
    },
    setPhase(f) { handle.setTheme({ phase: f }); },
    /** A programmatic touch at canvas coordinates (0–1, top-left origin): a short press, then the ripples run. */
    ripple(x, y, { depth, radius, hold } = {}) {
      const m = { t: 'touch', x, y, depth, radius, hold };
      if (handle.mode === 'loading') early.push(m);
      send(m);
    },
    /** For measuring: frames drawn since mount and the loop's current mode ('active', 'breeze', 'tail', 'sweep', 'rest'). */
    stats() {
      if (handle.mode !== 'webgl') return Promise.resolve({ frames: 0, mode: handle.mode });
      return new Promise((resolve) => { asked.set(++askId, resolve); send({ t: 'stats', id: askId }); });
    },
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
      send = () => {};
      handle.mode = 'disposed';
      for (const resolve of asked.values()) resolve({ frames: 0, mode: 'disposed' });
      asked.clear();
      if (owner.get(canvas) === handle) owner.delete(canvas);
    },
  };
  owner.set(canvas, handle);

  /* ---- a fresh element in place of a canvas that already belongs to a renderer ---- */
  function freshCanvas() {
    const c = canvas.cloneNode(false);
    canvas.replaceWith(c);
    io.unobserve(canvas); ro.unobserve(canvas);
    if (owner.get(canvas) === handle) owner.delete(canvas);
    canvas = c;
    owner.set(canvas, handle);
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

  /* ---- failing: one sentence that says what went wrong and what to do ---- */
  function fail(reason) {
    Object.assign(handle, { mode: 'failed', reason, thread: null, info: null });
    console.warn(`silkify: ${reason}`);
  }

  /* ---- static: no three.js; the poster (a rendered frame of this canvas) or the picture, drawn once.
   *      False when there is nothing to draw (the picture did not load, or it is empty). ---- */
  async function paintStatic() {
    if (disposed) return true;
    if (!staticPic) {
      const src = o.poster || o.image;
      staticPic = await (raster || (isSvg(src) && !o.poster ? rasterize(src) : loadImage(src))).catch(() => null);
      if (staticPic && !o.poster && !opaque(staticPic)) staticPic = null;
    }
    if (disposed) return true;
    if (!staticPic) return false;
    // a canvas that a renderer has claimed (a worker owns it, or it holds a WebGL context) cannot give a 2D context
    if (claimed.has(canvas)) freshCanvas();
    let g = canvas.getContext('2d');
    if (!g) { freshCanvas(); g = canvas.getContext('2d'); }
    if (!g) return false;
    const k = Math.min(window.devicePixelRatio || 1, o.dpr ?? 2);
    const cw = Math.round(canvas.clientWidth * k), ch = Math.round(canvas.clientHeight * k);
    if (!cw || !ch) return true;   // drawn when it gets a size (the ResizeObserver calls again)
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
    return true;
  }

  /** The picture as the renderer receives it: an absolute URL, or a transferable ImageBitmap (SVG, <img>, canvas…). */
  async function pictureFor() {
    if (raster) return createImageBitmap(raster);
    if (typeof o.image === 'string') return absolute(o.image);
    return createImageBitmap(o.image);
  }

  /* ---- live: one attempt on a given thread; resolves with the ready info or rejects ---- */
  async function attempt(onWorker, threeUrl) {
    let picture;
    try {
      if (!raster && isSvg(o.image)) raster = await rasterize(o.image);
      picture = await pictureFor();
    } catch (e) {
      throw Object.assign(new Error(`could not decode the picture (${e?.message || e})`), { fatal: true });
    }
    const bump = typeof o.bump === 'string' ? absolute(o.bump) : null;
    const msg = {
      t: 'init', threeUrl, picture, bump, options: plain(o), tier, lowTier: TIERS.low, forced: o.tier !== 'auto',
      view: view(), visible: visible(), still: reduced(), touches: early.slice(),
    };
    return new Promise((resolve, reject) => {
      const receive = (m) => {
        if (m.t === 'ready') resolve(m);
        else if (m.t === 'hover') o.onHover?.(m.on);
        else if (m.t === 'stats') { asked.get(m.id)?.({ frames: m.frames, mode: m.mode, steps: m.steps }); asked.delete(m.id); }
        else if (m.t === 'fail') reject(Object.assign(new Error(m.reason), { fatal: !!m.fatal, picture: !!m.picture, svg: !!m.svg }));
      };
      if (onWorker) {
        const offscreen = canvas.transferControlToOffscreen();
        claimed.add(canvas);
        worker = spawnWorker();
        worker.onmessage = (e) => receive(e.data);
        worker.onerror = (e) => { e.preventDefault?.(); reject(new Error(e.message || 'the worker did not start')); };
        send = (m, transfer) => worker?.postMessage(m, transfer || []);
        msg.canvas = offscreen;
        send(msg, [offscreen, ...(picture instanceof ImageBitmap ? [picture] : [])]);
      } else {
        import('./core.js').then((core) => {
          // three is imported only after the renderer has found WebGL2 on this canvas
          const endpoint = core.serve((m) => queueMicrotask(() => receive(m)), () => import('three'));
          send = endpoint;
          msg.canvas = canvas;
          claimed.add(canvas);
          endpoint(msg);
        }, reject);
      }
    });
  }

  /* ---- the pointer: only what happens over this canvas reaches the renderer, so a pointer moving or held anywhere
   *      else on the page never wakes a sleeping object (a long page with a hero would otherwise draw 60 fps) ---- */
  function listen() {
    let over = false, pressed = false;
    const at = (e) => {
      const r = canvas.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      return r.width && r.height && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x: x * 2 - 1, y: 1 - y * 2 } : null;
    };
    const leave = () => { if (over || pressed) send({ t: 'lift' }); over = pressed = false; };
    window.addEventListener('pointermove', (e) => {
      const p = at(e);
      if (p) { over = true; send({ t: 'pointer', ...p }); }
      else if (over) leave();
    }, on);
    window.addEventListener('pointerdown', (e) => {
      const p = at(e);
      if (!p) return;
      over = pressed = true;
      send({ t: 'pointer', ...p });
      send({ t: 'press', down: true });
    }, on);
    // a mouse that lets go is still there; a lifted finger or pen is not (else its last point "hovers" forever)
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'mouse') return leave();
      if (pressed) { pressed = false; send({ t: 'press', down: false }); }
    }, on);
    window.addEventListener('pointercancel', leave, on);   // a touch that turns into a scroll
    document.documentElement.addEventListener('pointerleave', leave, on);
    window.addEventListener('blur', leave, on);
    document.addEventListener('visibilitychange', () => send({ t: 'visible', visible: visible() }), on);
    reduceMq?.addEventListener?.('change', () => send({ t: 'still', still: reduced() }), on);
  }

  handle.ready = (async () => {
    await sized(canvas, ctl.signal);
    if (disposed) return handle;
    let why = handle.reason, pictureError = null;
    if (tier.tier !== 'static') {
      // without an import map or threeUrl, the worker imports 'three' itself, which works where a bundler built it
      const threeUrl = resolveThree(o.threeUrl);
      // a page opened from file:// has an opaque origin: Chrome refuses its blob: worker and WebKit's cannot read
      // blobs, so it renders on the main thread (the Lab's downloaded pages open this way)
      const tries = o.worker !== false && canWorker() && location.protocol !== 'file:' ? [true, false] : [false];
      for (let i = 0; i < tries.length; i++) {
        const onWorker = tries[i];
        try {
          if (claimed.has(canvas)) freshCanvas();
          const info = await attempt(onWorker, threeUrl);
          if (disposed) { send({ t: 'dispose' }); worker?.terminate(); return handle; }
          early.length = 0;
          Object.assign(handle, { mode: 'webgl', thread: onWorker ? 'worker' : 'main', tier: info.tier, info, reason: null });
          listen();
          return handle;
        } catch (e) {
          worker?.terminate();
          worker = null;
          send = () => {};
          if (disposed) return handle;
          if (e.svg && !raster) {                 // an SVG served without a .svg name: rasterise it, then retry
            raster = await rasterize(o.image).catch(() => null);
            if (raster) { i--; continue; }
          }
          if (e.fatal) { fail(e.message); return handle; }
          if (e.picture) pictureError = e.message;
          why = e.message;
        }
      }
    }
    Object.assign(handle, { mode: 'static', tier: 'static', thread: null, info: null, reason: why || 'no live renderer' });
    if (!(await paintStatic()) && !disposed) {
      fail(pictureError || (o.poster ? `the poster ${o.poster} could not be drawn`
        : `the picture ${typeof o.image === 'string' ? o.image : describe(o.image)} could not be loaded, or it has nothing opaque in it`));
    }
    return handle;
  })();
  return handle;
}

export default silkify;
