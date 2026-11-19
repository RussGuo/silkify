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
 * once without loading three.js. The renderer itself is core.js, behind its message endpoint serve.js; the dome is
 * built by shape.js.
 *
 * Failing loudly: a picture that cannot be loaded or decoded, or one with nothing opaque in it, ends in
 * mode 'failed' with `handle.reason` and one console.warn — the only console output of the library. So does code that
 * cannot be loaded (no import map for three, a worker.js, serve.js or core.js that is not served), whatever it ends in: a worker
 * that did not start but a main thread that did, or a still frame. A missing feature (no WebGL2, the static tier, no
 * HTML-in-Canvas) is not a mistake and stays quiet. SVG pictures
 * are rasterised here, on the page (workers cannot decode SVG), and handed to the renderer as a bitmap.
 *
 * Words: `silkify(canvas, { text, font, color, lineHeight })` sets the text in a 2D canvas once its font has loaded
 * (text.js) and from then on treats it as any picture; mistakes in the call throw at once, a font that does not render
 * warns once and draws the fallback.
 *
 * Live HTML: `silkify(canvas, { element })` prints a real element on the silk with HTML-in-Canvas (Chrome 157+);
 * the element stays selectable, clickable and editable. Without the feature, in the static tier, or when no picture
 * of it comes, the element stays where it is as plain HTML (mode 'static'). The page side is live.js.
 *
 * The first touch: the pointer is listened to from the call on, not from `ready`. What it does while the renderer
 * loads (hovering, a stroke across, a tap, a held button) is kept and handed to the renderer, which answers it the
 * moment it is up. `prewarm()` does the slow, shared part of a mount ahead of time (a worker with three.js imported),
 * so a page of many objects can mount each one on its first touch and still answer that touch quickly (pool.js does
 * that for a page; coolDown() lets the prewarmed worker go). The window's
 * pointer listeners are shared by every object on the page (pointer.js), so twenty objects cost what one does.
 *
 * A lost WebGL context (a background tab, a GPU reset, too many contexts): the object shows its still frame at once,
 * mode 'static', and is rebuilt when the browser restores the context (see lost()).
 *
 * Events: callbacks in the options (onPress, onRelease, onStroke, onHover; onReady and onFail as the mode settles, a lost
 * context included) and `haptics`, in events.js. A callback that throws never stops the renderer.
 *
 * Peer dependency: three (tested with 0.152.2), resolved through the page's import map or bundler.
 */
import { pickTier, TIERS } from './tier.js';
import { PUFF, COVER } from './shape.js';
import { MATERIALS, FEELS, keysOf } from './presets.js';
import { liveSupport, resolveElement, liveElement } from './live.js';
import { TEXT_DEFAULTS, checkText, setText } from './text.js';
import { follow } from './pointer.js';
import { emitter, gestures, report } from './events.js';

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
  breezeIdle: 0,           // ms: the breeze stops this long after the last touch (0: never), and a touch starts it again
  fillLight: true, idleSweep: true,
  dpr: undefined,          // device-pixel-ratio cap; undefined → the tier's (2 high, 1 low)
  reducedMotion: 'auto',
  tier: 'auto',            // 'auto' | 'high' | 'low' | 'static'
  worker: 'auto',          // 'auto' renders in a Web Worker when the browser can; false keeps it on the main thread
  threeUrl: undefined,     // absolute URL of three.module.js for the worker (default: import.meta.resolve('three'))
  poster: undefined,       // a still frame shown in the static tier (default: the picture itself)
  stepPerFrame: false,     // one solver step per drawn frame instead of 60 per second: frame-exact recordings only
  // events (events.js): the page's callbacks, and one short vibration on a touch press
  haptics: false,          // true (10 ms) | ms
  onHover: null, onPress: null, onRelease: null, onStroke: null, onReady: null, onFail: null,
};

const DEFAULTS = {
  sphere: { light: [0, 0, 1], floor: 0.05, sheen: 0.18, sheenPower: 22, phase: null, bump: null, bumpStrength: 7, spin: true, spinSpeed: 0.006, angle: 0 },
  image: { light: [-0.35, 0.45, 0.82], floor: 0.55, sheen: 0.3, sheenPower: 16, puff: 'dome', matte: 'auto', corner: 0.06, threshold: 0.5, albedo: null, grain: 0, fit: 1.3 },
};

/* live HTML: the element's box is the outline (live.js draws the stand-in), so these are fixed; a cushion by default */
const ELEMENT_DEFAULTS = { puff: 'cushion' };
const ELEMENT_FIXED = { matte: 'alpha', threshold: 0.5, corner: 0, albedo: null, grain: 0, poster: undefined, html: true };

const SVG_PX = 1024;   // an SVG picture is rasterised to this long side
const LOST = 'the WebGL context was lost (the browser took it back): a still frame until it is restored';
const TRAIL = 32;      // points of the pointer's path kept while the renderer loads (see `ptr`)

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
/** Whether a mount would try a worker first (live HTML also needs captureElementImage: see mount()). */
const workerFirst = (o) => o.worker !== false && canWorker() && location.protocol !== 'file:';

/* ---- prewarm: one spare worker that has already started and imported three.js, taken by the next mount ---- */
let spare = null;          // { worker, threeUrl, ok: undefined (warming) | true | false, ready: Promise<boolean> }
let warmMain = null;       // the main-thread path: serve.js (with core.js) and three, imported once
let warming = false;       // prewarm() was called and coolDown() has not been since: a spare taken is replaced
function warmWorker(threeUrl) {
  const s = { worker: spawnWorker(), threeUrl, ok: undefined };
  s.ready = new Promise((resolve) => {
    const done = s.done = (ok) => { s.ok = ok; resolve(ok); };
    // listeners, not onmessage / onerror: a mount that takes the worker while it is still warming sets those
    s.worker.addEventListener('message', (e) => { if (e.data.t === 'warm') done(e.data.ok); });
    s.worker.addEventListener('error', (e) => { e.preventDefault?.(); done(false); });
  });
  s.worker.postMessage({ t: 'warm', threeUrl });
  return s;
}
/** The spare, if it is warming or warm for this three.js; a new one is warmed when the page is next idle. */
function takeSpare(threeUrl) {
  if (!spare || spare.threeUrl !== threeUrl || spare.ok === false) return null;
  const { worker } = spare;
  spare = null;
  idle(() => { if (warming) spare ??= warmWorker(threeUrl); });
  return worker;
}
const idle = (f) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(f, { timeout: 2000 }) : setTimeout(f, 200));

/**
 * prewarm(options) → Promise<boolean>: do the slow, shared part of a mount before anyone touches an object, so that a
 * later silkify() only builds its scene. In a worker: start one and have it import three.js (and serve.js); the next
 * mount takes it, and another is warmed when the page is idle. On the main thread: import serve.js and three. Nothing
 * in the static tier. Pass the options the objects will use (tier, reducedMotion, worker, threeUrl). Idempotent;
 * resolves true once warm, false if it could not be (the mount then says why, as usual). Never rejects.
 */
export function prewarm(options = {}) {
  const o = { ...COMMON, ...options };
  if (pickTier(o.tier, o.reducedMotion).tier === 'static') return Promise.resolve(false);
  const threeUrl = resolveThree(o.threeUrl);
  if (workerFirst(o)) {
    warming = true;
    if (!spare || spare.threeUrl !== threeUrl) { spare?.worker.terminate(); spare = warmWorker(threeUrl); }
    return spare.ready;
  }
  return (warmMain ??= Promise.all([import('./serve.js'), import('three')]).then(() => true, () => false));
}

/** coolDown(): let the idle prewarmed worker go (a few MB with three.js parsed) and stop warming new ones, until
 *  prewarm() is called again. A pending prewarm() resolves false. Mounted objects are not touched. */
export function coolDown() {
  warming = false;
  spare?.worker.terminate();
  spare?.done(false);
  spare = null;
}

/** A picture ready to draw: a URL is loaded and decoded; an <img> that is still loading is waited for (and one that
 *  did not load rejects, rather than drawing nothing); a canvas or a bitmap is ready as it is. */
async function loadImage(src) {
  if (typeof HTMLImageElement !== 'undefined' && src instanceof HTMLImageElement) {
    if (!src.complete || !src.naturalWidth) await src.decode();
    return src;
  }
  if (typeof src !== 'string') return src;
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
  const el = kind === 'image' && options.element;   // live HTML: element mode ignores the picture-only options
  const words = kind === 'image' && options.text != null;   // text: the letters' alpha is the outline (text.js)
  return {
    ...COMMON, ...DEFAULTS[kind], ...(el ? ELEMENT_DEFAULTS : {}), ...(words ? TEXT_DEFAULTS : {}), ...preset(MATERIALS, options.material), ...preset(FEELS, options.feel),
    ...options, ...(el ? ELEMENT_FIXED : {}), shape: kind,
  };
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
  if (options.element != null) {
    if (options.image != null) throw new TypeError('silkify: pass options.image or options.element, not both');
    if (options.shape === 'sphere') throw new TypeError("silkify: options.element cannot be wrapped on a sphere (shape: 'sphere')");
  }
  if (options.text != null) checkText(options);   // text with image or element, an unreadable font or colour: text.js
  if ('element' in options && options.element == null && options.image == null && options.text == null) {
    // the usual cause: getElementById() or a ref read before the element was rendered
    throw new TypeError(`silkify: options.element is ${options.element}: call silkify() after the element is in the DOM`);
  }
  const o = resolveOptions(options);
  const emit = emitter(o);   // the page's callbacks, read from `o` when called (setTheme can swap them)
  const kind = o.shape;
  // a number written as a string ('1.5', from a data attribute or a form) worked in 0.3 and still does
  if (typeof o.fit === 'string' && o.fit !== 'cover' && o.fit.trim() && Number.isFinite(+o.fit)) o.fit = +o.fit;
  if (kind === 'image' && !(o.fit === 'cover' ? options.element == null : typeof o.fit === 'number' && o.fit > 0)) {
    throw new TypeError(o.fit === 'cover' ? "silkify: fit: 'cover' is for a picture or words; an element is drawn 1:1 (leave fit out) or scaled by a number"
      : `silkify: options.fit is the canvas's extent over the object's, a number above 0, or 'cover' (not ${JSON.stringify(options.fit)})`);
  }
  const element = options.element != null ? resolveElement(options.element) : null;
  if (!o.image && !element && o.text == null) throw new Error('silkify: options.image (or options.element, or options.text) is required');
  owner.get(canvasIn)?.dispose();   // one renderer per canvas: the newer call wins, the older one is disposed

  const reduceMq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduced = () => (o.reducedMotion === 'auto' ? !!reduceMq?.matches : !!o.reducedMotion);
  const tier = pickTier(o.tier, o.reducedMotion);

  let canvas = canvasIn;
  let send = () => {};
  let live = null;           // live HTML (options.element): live.js
  let passThrough = null;    // live HTML shown as plain HTML: the canvas's own pointer-events, restored on dispose()
  let worker = null, disposed = false, inView = true, staticPic = null, staticWhy = null, raster = null;
  const early = [];          // ripple() calls made before the renderer was ready: replayed by the renderer
  const asked = new Map();   // stats requests in flight: id → resolve
  const uvs = new Map();     // surface lookups in flight (events.js: a press, a release, a stroke): id → resolve
  let askId = 0;
  const ctl = new AbortController();
  const on = { signal: ctl.signal, passive: true };

  const handle = {
    get canvas() { return canvas; },
    mode: 'loading',          // → 'webgl' | 'static' | 'failed' | 'disposed'
    tier: tier.tier,          // may become 'low' once the renderer finds a software rasteriser, 'static' on a fallback
    thread: null,             // 'worker' | 'main' when live
    info: null,               // { tier, software, sim, steps, mesh, texture, ratioCap } when live
    reason: tier.why || null, // why it is static or failed, in words
    element,                  // live HTML: the element printed on the silk (null for a picture)
    ready: null,
    setTheme(patch) {
      // a preset name resets every key its group can set (to the new preset's value or the default), then the rest applies
      const base = { ...COMMON, ...DEFAULTS[kind] };
      const swap = (group, name, p = preset(group, name)) => Object.fromEntries(keysOf(group).map((k) => [k, k in p ? p[k] : base[k]]));
      if (patch.material !== undefined) patch = { ...swap(MATERIALS, patch.material), ...patch };
      if (patch.feel !== undefined) patch = { ...swap(FEELS, patch.feel), ...patch };
      if (element) patch = { ...patch, albedo: null, grain: 0 };   // ignored in element mode (they would paint over the words)
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
    /** For measuring: frames drawn since mount and the loop's current mode ('active', 'breeze', 'tail', 'sweep', 'rest';
     *  live HTML: 'html' while the loop rests but the element's snapshots keep coming, each one a frame). */
    stats() {
      if (handle.mode !== 'webgl') return Promise.resolve({ frames: 0, mode: handle.mode });
      return new Promise((resolve) => { asked.set(++askId, resolve); send({ t: 'stats', id: askId }); });
    },
    wake() { send({ t: 'wake' }); },
    dispose() {
      if (disposed) return;
      disposed = true;
      ctl.abort();
      unfollow();
      io.disconnect();
      ro.disconnect();
      send({ t: 'dispose' });
      worker?.terminate();
      worker = null;
      send = () => {};
      handle.mode = 'disposed';
      for (const resolve of asked.values()) resolve({ frames: 0, mode: 'disposed' });
      for (const resolve of uvs.values()) resolve(null);
      uvs.clear();
      asked.clear();
      if (owner.get(canvas) === handle) owner.delete(canvas);
      live?.restore();
      if (passThrough !== null) canvas.style.pointerEvents = passThrough;
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
    if (handle.mode === 'static') { if (!element) paintStatic(); return; }
    live?.resized();   // 1:1 element: the new fit reaches the renderer before the new view
    send({ t: 'view', view: view() });
  });
  io.observe(canvas);
  ro.observe(canvas);

  /* ---- failing: one sentence that says what went wrong and what to do ---- */
  function fail(reason) {
    unfollow();
    Object.assign(handle, { mode: 'failed', reason, thread: null, info: null });
    console.warn(`silkify: ${reason}`);
  }

  /* ---- static: no three.js; the poster (a rendered frame of this canvas) or the picture, drawn once.
   *      A poster that is a function is the page drawing the frame itself: it is called with this canvas's size in device
   *      pixels on every paint (a resize too), and only the newest answer is drawn.
   *      False when there is nothing to draw (the picture did not load, or it is empty). ---- */
  let painting = 0, newest = null;   // newest: the latest paint, which a superseded one waits for (so `ready` does)
  function paintStatic() { return (newest = paintOnce()); }
  async function paintOnce() {
    if (disposed) return true;
    const drawn = typeof o.poster === 'function', n = ++painting;
    if (drawn) {
      const k = Math.min(window.devicePixelRatio || 1, o.dpr ?? 2), size = { width: Math.round(canvas.clientWidth * k), height: Math.round(canvas.clientHeight * k) };
      if (!size.width || !size.height) return true;   // drawn when it gets a size (the ResizeObserver calls again)
      // a poster function that throws is the page's bug: reported as such (events.js), and the reason says it threw
      let threw = null;
      let pic = await Promise.resolve().then(() => o.poster(size)).catch((e) => { threw = e; return null; });
      if (typeof HTMLImageElement !== 'undefined' && pic instanceof HTMLImageElement && !pic.complete) await pic.decode().catch(() => {});
      if (n !== painting) return newest;
      if (threw) { staticWhy = `the poster function threw (${threw?.message || threw})`; report(threw); }
      else if (!(pic && (pic.naturalWidth || pic.width) > 0)) { staticWhy = `the poster function returned ${describe(pic)}, not a canvas or an image`; pic = null; }
      staticPic = pic;
    } else if (!staticPic) {
      const src = o.poster || o.image, name = typeof src === 'string' ? src : src?.currentSrc || src?.src || describe(src);
      staticPic = !o.poster && raster ? raster : await (isSvg(src) ? rasterize(src) : loadImage(src)).catch(() => null);
      if (!staticPic) staticWhy = `could not load the ${o.poster ? 'poster' : 'picture'} ${name}`;
      else if (!o.poster && !opaque(staticPic)) {
        staticPic = null;
        staticWhy = `the picture ${name} has nothing opaque in it: use a PNG whose subject is visible`;
      }
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
      const s = o.fit === 'cover' ? Math.max(cw / w, ch / h) / COVER : Math.min(cw / w, ch / h) / o.fit;
      g.drawImage(staticPic, (cw - w * s) / 2, (ch - h * s) / 2, w * s, h * s);
    }
    return true;
  }

  /** The picture as the renderer receives it: an absolute URL, or a transferable ImageBitmap (SVG, <img>, canvas…). */
  async function pictureFor() {
    if (raster) return createImageBitmap(raster);
    if (typeof o.image === 'string') return absolute(o.image);
    return createImageBitmap(await loadImage(o.image));   // an <img> still loading is waited for
  }

  /* ---- live: one attempt on a given thread; resolves with the ready info (null after dispose()) or rejects ---- */
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
      pointer: ptr.over ? { ...ptr.at, down: ptr.pressed } : null, trail: ptr.trail.slice(),
    };
    if (disposed) return null;
    return new Promise((resolve, reject) => {
      // dispose() while the renderer is starting (React StrictMode's first mount) terminates the worker, which will
      // never answer: the attempt ends here, so `ready` settles with mode 'disposed'
      ctl.signal.addEventListener('abort', () => resolve(null), { once: true });
      const receive = (m) => {
        if (m.t === 'ready') { const { t, ...info } = m; resolve(info); }   // handle.info: what the renderer built
        else if (m.t === 'hover') emit('onHover', m.on);
        else if (m.t === 'stats') { const { t, id, ...st } = m; asked.get(id)?.(st); asked.delete(id); }
        else if (m.t === 'uv') { uvs.get(m.id)?.(m.uv); uvs.delete(m.id); }
        else if (m.t === 'html' || m.t === 'shaped') live?.received(m);
        else if (m.t === 'lost') lost();
        else if (m.t === 'restored') restored();
        else if (m.t === 'fail') reject(Object.assign(new Error(m.reason), { fatal: !!m.fatal, picture: !!m.picture, svg: !!m.svg, code: !!m.code, lost: !!m.lost }));
      };
      if (onWorker) {
        const offscreen = canvas.transferControlToOffscreen();
        claimed.add(canvas);
        worker = takeSpare(threeUrl) || spawnWorker();
        worker.onmessage = (e) => receive(e.data);
        worker.onerror = (e) => { e.preventDefault?.(); reject(Object.assign(new Error(`the worker did not start (${e.message || 'worker.js or a module it imports could not be loaded'})`), { code: true })); };
        send = (m, transfer) => worker?.postMessage(m, transfer || []);
        msg.canvas = offscreen;
        send(msg, [offscreen, ...(picture instanceof ImageBitmap ? [picture] : [])]);
      } else {
        import('./serve.js').then(({ serve }) => {
          // three is imported only after the renderer has found WebGL2 on this canvas
          const endpoint = serve((m) => queueMicrotask(() => receive(m)), () => import('three'));
          send = endpoint;
          msg.canvas = canvas;
          claimed.add(canvas);
          endpoint(msg);
        }, (e) => reject(Object.assign(new Error(`serve.js could not be loaded (${e?.message || e})`), { code: true })));
      }
    });
  }

  /* ---- the pointer: only what happens over this canvas reaches the renderer, so a pointer moving or held anywhere
   *      else on the page never wakes a sleeping object (a long page with a hero would otherwise draw 60 fps).
   *      Listening starts at once, not when the renderer is ready: while it loads, `send` goes nowhere, so the state
   *      is kept here (where the pointer is, whether it is pressed, the points it crossed) and handed over in `init`.
   *      The renderer then hovers and presses under a pointer that is still there, or answers one that has already
   *      gone (a stroke across, a tap) with a ripple where it first crossed the object: the first touch is not lost. ---- */
  const ptr = { over: false, pressed: false, at: null, trail: [] };
  const point = (p) => {
    ptr.over = true;
    ptr.at = p;
    if (handle.mode === 'loading') {
      // thinned, not cut: a long hover keeps points from its whole path, at most TRAIL of them
      if (ptr.trail.length >= TRAIL) ptr.trail = ptr.trail.filter((_, i) => i % 2 === 0);
      ptr.trail.push(p);
    }
    send({ t: 'pointer', ...p });
  };
  const leave = () => { if (ptr.over || ptr.pressed) send({ t: 'lift' }); ptr.over = ptr.pressed = false; ptr.at = null; };
  // the page's onPress, onRelease and onStroke ride on the same pointer: wanted while the silk answers it
  // where a point lands on the surface: only the renderer knows (its camera, fit, the outline), so it is asked; null
  // while it loads, and when the point misses the object
  const surface = (p) => (handle.mode !== 'webgl' ? null : new Promise((resolve) => { uvs.set(++askId, resolve); send({ t: 'uv', id: askId, x: p.x, y: p.y }); }));
  const g = gestures({ o, emit, surface, canvas: () => canvas, listening: () => o.interactive !== false && (handle.mode === 'loading' || handle.mode === 'webgl') });
  // the window's listeners are shared by every object on the page (pointer.js): this is what they call for this one
  let unfollow = () => {};
  if (tier.tier !== 'static') {   // the static tier never needs the pointer
    unfollow = follow({
      canvas: () => canvas,
      near: () => inView,
      move: (p, e) => { point(p); g.move(p, e); },
      out: () => { g.out(); if (ptr.over) leave(); },
      down: (p, e) => { point(p); ptr.pressed = true; send({ t: 'press', down: true }); g.down(p, e); },
      up: (mouse, e, where) => {
        g.up(e, where);
        if (!mouse) return leave();
        if (ptr.pressed) { ptr.pressed = false; send({ t: 'press', down: false }); }
      },
      leave: () => { g.cancel(); leave(); },
    });
  }
  document.addEventListener('visibilitychange', () => send({ t: 'visible', visible: visible() }), on);
  reduceMq?.addEventListener?.('change', () => send({ t: 'still', still: reduced() }), on);

  /* ---- live HTML that cannot be live: the element stays (or goes back) where it was, as plain HTML ---- */
  function asHtml(reason) {
    unfollow();
    live?.restore();
    // the canvas stays an empty layer over the page: it must not take the clicks meant for the element under it
    passThrough ??= canvas.style.pointerEvents;
    canvas.style.pointerEvents = 'none';
    Object.assign(handle, { mode: 'static', tier: 'static', thread: null, info: null, reason });
    return handle;
  }
  /** The renderer ran, but no picture of the element came: a failure of the feature, so it says so once. */
  function giveUp(reason) {
    send({ t: 'dispose' });
    worker?.terminate();
    worker = null;
    send = () => {};
    asHtml(reason);
    freshCanvas();   // the transferred canvas still shows the stand-in: a blank one takes its place
    console.warn(`silkify: ${reason}`);
    return handle;
  }

  /* ---- a lost WebGL context: the browser took it back (a background tab, a GPU reset, more contexts than it allows).
   *      A still frame at once: the poster or the picture on a fresh canvas (the old one would keep its last frame,
   *      frozen, or go blank), or the live element back in the page as plain HTML; mode 'static' with the reason.
   *      When the browser gives the context back, the renderer is rebuilt on a new canvas, the still frame staying
   *      behind it (its CSS background) until the first new frame is up, and the mode is 'webgl' again.
   *      While it loads, both are noted and answered once the mount settles: a loss before the scene was built ends the
   *      attempt (fail { lost }: still frame, onFail), a loss after it ends in lost(); either way a restore that came
   *      meanwhile rebuilds at once, and one still to come rebuilds when it comes. ---- */
  let lostEarly = false, restoredEarly = false;
  function lost(quiet = false) {
    if (disposed) return;
    if (handle.mode === 'loading') { lostEarly = true; return; }
    if (handle.mode !== 'webgl') return;
    for (const resolve of asked.values()) resolve({ frames: 0, mode: 'static' });
    for (const resolve of uvs.values()) resolve(null);
    uvs.clear();
    asked.clear();
    stillFrame();
    if (!quiet) emit('onFail', handle);
  }
  /** mode 'static' for a lost context: the poster or the picture on a fresh canvas, or the element back in the page */
  function stillFrame() {
    Object.assign(handle, { mode: 'static', thread: null, info: null, reason: LOST });
    if (live) {
      live.restore();
      freshCanvas();   // the transferred canvas still shows its last frame over the element
      passThrough ??= canvas.style.pointerEvents;
      canvas.style.pointerEvents = 'none';
    } else {
      paintStatic();
    }
  }
  async function restored() {
    if (!disposed && handle.mode === 'loading' && lostEarly) restoredEarly = true;
    if (disposed || handle.mode !== 'static' || handle.reason !== LOST) return;
    restoredEarly = false;
    send({ t: 'dispose' });
    worker?.terminate();
    worker = null;
    send = () => {};
    let still = null;
    if (!live && canvas.width) { try { still = canvas.toDataURL(); } catch { /* a tainted canvas: no still frame behind */ } }
    freshCanvas();
    const was = { backgroundImage: canvas.style.backgroundImage, backgroundSize: canvas.style.backgroundSize, backgroundRepeat: canvas.style.backgroundRepeat };
    if (still) Object.assign(canvas.style, { backgroundImage: `url("${still}")`, backgroundSize: '100% 100%', backgroundRepeat: 'no-repeat' });
    if (passThrough !== null) { canvas.style.pointerEvents = passThrough; passThrough = null; }
    handle.mode = 'loading';
    await goLive();
    if (still) Object.assign(canvas.style, was);
    settled();
  }
  /** A restore that came while the mount was still settling: rebuilt once settled() has said onFail (a task later). */
  function afterLoss() { if (restoredEarly) setTimeout(restored); }
  /** onReady (live, or a still frame) or onFail (nothing drawn, or the context went while the scene was built), once
   *  per mount and once per restore, as `ready` resolves. A disposed object says nothing. */
  function settled() {
    if (disposed) return;
    emit(handle.mode === 'failed' || handle.reason === LOST ? 'onFail' : 'onReady', handle);
  }

  handle.ready = mount().catch((e) => {   // ready never rejects: anything unexpected is a failure with its reason
    if (!disposed) fail(`unexpected error (${e?.message || e})`);
    return handle;
  });
  handle.ready.then(settled);
  async function mount() {
    await sized(canvas, ctl.signal);
    if (disposed) return handle;
    if (o.text != null) {
      // the words become the picture here, once their font has loaded; from now on they are any picture
      const { picture, warning } = await setText(o, canvas);
      if (disposed) return handle;
      if (warning) console.warn(`silkify: ${warning}`);
      o.image = picture;
    }
    if (element) {
      // live HTML needs the feature and a live tier; otherwise the element simply stays where it is, as plain HTML.
      // Not an error, so no warning: the page reads as it would without silkify
      const why = tier.tier === 'static' ? tier.why : !liveSupport().main ? 'HTML-in-Canvas is not available in this browser: the element stays plain HTML' : null;
      if (why) return asHtml(why);
      live = liveElement(element, {
        canvas: () => canvas, send: (m, transfer) => send(m, transfer), o, fitAuto: options.fit === undefined, visible,
      });
    }
    return goLive();
  }
  /** Start the renderer (a worker first, then the main thread), or fall back to a still frame / plain HTML. Run once by
   *  mount(), and again when a lost WebGL context has been restored. */
  async function goLive() {
    let why = handle.reason, pictureError = null, codeError = null;
    // code that could not be loaded is said once, whatever the mount ends in
    const loudly = () => { if (codeError && !disposed) console.warn(`silkify: ${codeError}. Check the import map for three (or threeUrl) and that every file of silk.js is served.`); };
    if (tier.tier !== 'static') {
      // without an import map or threeUrl, the worker imports 'three' itself, which works where a bundler built it
      const threeUrl = resolveThree(o.threeUrl);
      // a page opened from file:// has an opaque origin: Chrome refuses its blob: worker and WebKit's cannot read
      // blobs, so it renders on the main thread (the Lab's downloaded pages open this way); live HTML in a worker
      // also needs captureElementImage()
      const tries = workerFirst(o) && (!live || liveSupport().worker) ? [true, false] : [false];
      for (let i = 0; i < tries.length; i++) {
        const onWorker = tries[i];
        try {
          if (claimed.has(canvas)) freshCanvas();
          if (live && !live.prepare()) return asHtml('the element has no size (display: none, or an empty box): it stays plain HTML');
          const info = await attempt(onWorker, threeUrl);
          if (disposed) { send({ t: 'dispose' }); worker?.terminate(); return handle; }
          early.length = 0;
          ptr.trail.length = 0;
          if (live) {
            // the element moves in now, and `ready` waits for its first picture
            const ok = await live.start(onWorker).catch((e) => e);
            if (disposed || ok === false) return handle;
            if (ok instanceof Error) return giveUp(ok.message);
          }
          Object.assign(handle, { mode: 'webgl', thread: onWorker ? 'worker' : 'main', tier: info.tier, info, reason: null });
          if (codeError) codeError = `${codeError}: rendering on the main thread`;
          loudly();
          if (lostEarly) { lostEarly = false; lost(true); afterLoss(); }   // the context went while the scene was being built (settled() says so)
          return handle;
        } catch (e) {
          if (e.lost && !disposed) {
            // the context went before the scene was built: a still frame now, as for a loss once live (settled() says
            // onFail); the worker stays, its canvas listening, so the restore reaches restored() and rebuilds
            lostEarly = false;
            stillFrame();
            afterLoss();
            return handle;
          }
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
          if (e.code) codeError = e.message;
          why = e.message;
        }
      }
    }
    loudly();
    if (live) return asHtml(why || 'no live renderer');   // the element goes back to the page as plain HTML
    unfollow();
    Object.assign(handle, { mode: 'static', tier: 'static', thread: null, info: null, reason: why || 'no live renderer' });
    if (!(await paintStatic()) && !disposed) {
      fail(pictureError || staticWhy || 'nothing could be drawn on this canvas');
    }
    return handle;
  }
  return handle;
}

export default silkify;
