/**
 * pool.js — many objects on one page, the way the gallery and examples/demos/logo-wall.html do it, as one call:
 *
 *   import { pool } from './silk/pool.js';
 *   const wall = pool({ max: 3 });
 *   for (const tile of tiles) wall.add(tile, (canvas) => silkify(canvas, { image: …, poster: … }));
 *
 * Each element added shows what the page put in it (a poster <img>) until someone reaches for it. The first
 * pointerenter or pointerdown on it mounts silkify on a fresh canvas, prepended to the element; once the first frame
 * is up the element gets the class `live` (the page's CSS fades the canvas in over the poster). An element that
 * scrolls away (200 px past the viewport), or the least recently touched one beyond `max`, is disposed and goes back
 * to its poster. Browsers keep about 16 WebGL contexts per page, and a context dropped for being one too many is never
 * restored, so the cap is what keeps every object answering.
 *
 * Why a pool and not silkify() on each: a live object holds a WebGL context and a few MB of GPU memory; a poster holds
 * nothing. The pool also prewarms (prewarm(), in silk.js) once the page is idle, so a mount on the first touch only
 * builds its scene (about 0.1 s instead of 1.2–1.4 s), and silkify keeps the pointer of the loading time, so the touch
 * that mounted an object is answered. dispose() lets the idle prewarmed worker go too (coolDown()).
 *
 * In the static tier (reduced motion, Save-Data, a very small device: tier.js) nothing listens and nothing mounts:
 * the posters stay, and three.js is never loaded. Pass the options the objects will use for the tier and the worker
 * (tier, reducedMotion, worker, threeUrl): the pool decides the tier and prewarms with them.
 *
 * A mount() that throws (a mistake in its options) is the page's bug: the canvas made for it goes again, activate()
 * rejects with the error, and a pointer that set it off reports it once as an uncaught error (events.js's report(), as
 * for a callback that throws); that element is not mounted on a pointer again until it is add()ed again.
 *
 * What a page adds of its own (a hint, greeting each card on a touch screen) stays in the page: activate() is the
 * hook. The pool only imports silk.js's prewarm and coolDown, tier.js and events.js's report; silk.js does not import it.
 */
import { prewarm, coolDown } from './silk.js';
import { pickTier } from './tier.js';
import { report } from './events.js';

const MARGIN = '200px';   // how far past the viewport an element may go before its object is disposed

/**
 * pool({ max = 3, warm = true, listen = true, liveClass = 'live', tier, reducedMotion, worker, threeUrl })
 *   → { add, activate, release, live, warm, still, dispose }
 * `listen: false` mounts only through activate() (a renderer of still frames, a test); `warm: false` skips prewarm().
 */
export function pool({ max = 3, warm = true, listen = true, liveClass = 'live', ...options } = {}) {
  const still = pickTier(options.tier, options.reducedMotion).tier === 'static';
  const listening = listen && !still;
  const mounts = new Map();   // element → mount(canvas, extra) → handle
  const live = new Map();     // element → the handle of its live object
  const used = new Map();     // element → when it was last reached for
  const broken = new Set();   // elements whose mount() threw on a pointer: reported once, not tried again
  const ctl = new AbortController();
  const io = listening ? new IntersectionObserver((es) => { for (const e of es) if (!e.isIntersecting) release(e.target); }, { rootMargin: MARGIN }) : null;

  /** Add an element; `mount(canvas, extra)` calls silkify() on the canvas the pool made and returns its handle. */
  function add(el, mount) {
    mounts.set(el, mount);
    broken.delete(el);
    if (!listening) return;
    const reach = () => { if (!broken.has(el)) activate(el).catch((e) => { if (!broken.has(el) && mounts.get(el) === mount) { broken.add(el); report(e); } }); };
    for (const ev of ['pointerenter', 'pointerdown']) el.addEventListener(ev, reach, { passive: true, signal: ctl.signal });
    io.observe(el);
  }

  /** Mount the element's object now (idempotent); `extra` reaches mount(). Resolves with the handle once it is up;
   *  rejects, leaving no canvas behind, when mount() throws or returns something that is not silkify()'s handle. */
  function activate(el, extra) {
    const have = live.get(el);
    used.set(el, performance.now());
    if (have) return have.ready;
    const mount = mounts.get(el);
    if (!mount) return Promise.reject(new Error('silkify pool: activate() an element that was not add()ed first'));
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');   // live HTML: silkify takes it off while the element is in the canvas
    el.prepend(canvas);
    let handle;
    try {
      handle = mount(canvas, extra);
      if (!handle || typeof handle.dispose !== 'function' || !handle.ready) throw new TypeError(`silkify pool: mount() must return silkify()'s handle, not ${handle === null ? 'null' : typeof handle}`);
    } catch (e) {
      handle?.dispose?.();
      canvas.remove();
      return Promise.reject(e);
    }
    live.set(el, handle);
    for (const other of [...live.keys()].sort((a, b) => used.get(a) - used.get(b))) {
      if (live.size <= max) break;
      if (other !== el) release(other);
    }
    return handle.ready.then((h) => {
      if (live.get(el) === h && h.mode === 'webgl') el.classList.add(liveClass);
      return h;
    });
  }

  /** Dispose the element's object: its canvas goes, and the poster shows again. */
  function release(el) {
    const h = live.get(el);
    if (!h) return;
    live.delete(el);
    h.dispose();
    el.classList.remove(liveClass);
    h.canvas.remove();   // the handle's canvas: silkify may have swapped the one the pool made
  }

  // the slow, shared part of a mount (a worker with three.js) once the page is idle
  const warmed = !warm || still ? Promise.resolve(false) : new Promise((resolve) => {
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 200));
    const go = () => idle(() => resolve(ctl.signal.aborted ? false : prewarm(options)), { timeout: 2000 });
    document.readyState === 'complete' ? go() : addEventListener('load', go, { once: true, signal: ctl.signal });
  });

  return {
    add, activate, release, live, warm: warmed, still,
    /** Release every object, stop listening, and let the prewarmed worker go. */
    dispose() {
      ctl.abort();
      io?.disconnect();
      for (const el of [...live.keys()]) release(el);
      mounts.clear();
      coolDown();
    },
  };
}
