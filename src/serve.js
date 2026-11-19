/**
 * serve.js — the renderer's message endpoint: what the page says to a renderer, and what it hears back. The worker
 * (worker.js) wires it to postMessage; the main-thread fallback (silk.js) calls it directly. No DOM, like core.js.
 *
 * core.js draws one scene; this file owns everything around that scene's life:
 *   loading      the WebGL2 probe on the canvas, three.js (imported once per URL: a prewarmed worker has it before
 *                `init`), the picture and the bump decoded here, a software rasteriser downgraded to the low tier
 *   waiting      messages that arrive before the scene exists are kept (the newest view, visibility and stillness,
 *                every option patch, every programmatic touch, the pointer) and replayed once it is up
 *   the pointer  of the loading time: one still over the canvas hovers (and presses) at once; one that has gone gets
 *                one ripple where its path first crossed the object, so a stroke or a tap made while loading is answered
 *   rebuilding   live HTML whose element changed size: a new dome from a new stand-in, on the same context
 *   losing       the browser taking the WebGL context back: the scene stops and goes, the page shows a still frame,
 *                and rebuilds once the context is restored (frame and step counts carry over). Listened to from the
 *                moment the context exists, so a loss while three.js or the picture is still loading is seen too (and
 *                restorable): the scene is then not built at all, and `fail { lost }` tells the page so
 *
 * Messages in: warm { threeUrl } (prewarm: import three.js before init; answered with warm { ok }), init, pointer,
 * press, lift, touch, view, visible, still, options, wake, stats, uv { id, x, y } (where a point lands on the surface,
 * answered with uv { id, uv }), dispose (init carries the pointer of the loading time,
 * pointer { x, y, down } | null and trail [{ x, y }]: see replayPointer); for live HTML also html { img } (an Element or
 * ElementImage to print on the albedo) and shape { picture, patch } (the element changed size). Messages out:
 * ready { tier, sim, steps, mesh, software }, hover { on }, stats { frames, steps, mode, touches, snapshots? },
 * html { ok, empty }, shaped, lost and restored (the WebGL context was taken back, and given back: the page shows a
 * still frame, then rebuilds), fail { reason, fatal, picture, svg, code, lost }. `lost`: the context went while the scene
 * was being built, so there is none (the page shows a still frame and rebuilds on `restored`, as for a loss once live).
 * `code`: the code could not be loaded (three.js),
 * a mistake in the page rather than a missing feature, so the page says so. `fatal` means another thread would fail the same
 * way (an HTTP error, or nothing in the picture is opaque); `picture` that the picture could not be decoded here,
 * which another thread may still manage; `svg` that the picture is an SVG the page must rasterise.
 */
import { loadBitmap } from './shape.js';
import { openContext, openRenderer, createSilk } from './core.js';

export function serve(post, loadThreeOnce) {
  let silk = null, dead = false;
  // three.js, imported once per URL: a prewarmed worker (message 'warm') has it ready before `init` arrives
  const threes = new Map();
  const loadThree = (url) => { if (!threes.has(url)) threes.set(url, loadThreeOnce(url)); return threes.get(url); };
  // messages that arrive before the scene exists: the newest view / visibility / stillness, every option patch
  // merged in order, every programmatic touch, and the pointer (where it is, whether it is pressed, the points it
  // crossed), replayed once the scene is up
  const latest = { options: {}, touches: [], at: null, down: false, trail: [] };
  let scene = null;                                   // what a rebuilt dome needs: THREE, the renderer, tier, options
  const before = { frames: 0, steps: 0, snapshots: 0, touches: 0 };   // counts from scenes a rebuild replaced
  const carry = (s) => { for (const k of Object.keys(before)) before[k] += s[k] || 0; };
  let reshaping = Promise.resolve();
  const watch = new AbortController();               // the canvas's context-loss listeners, removed on dispose

  const make = (picture) => createSilk(scene.THREE, scene.opened, { picture }, scene.o, scene.tier, {
    view: latest.view, visible: latest.visible, still: latest.still,
    onHover: (on) => post({ t: 'hover', on }),
  });

  async function init(m) {
    Object.assign(latest, { view: m.view, visible: m.visible, still: m.still });
    latest.touches.unshift(...(m.touches || []));
    if (m.pointer) Object.assign(latest, { at: { x: m.pointer.x, y: m.pointer.y }, down: !!m.pointer.down });
    latest.trail.unshift(...(m.trail || []));
    const gl = openContext(m.canvas);
    if (!gl) return post({ t: 'fail', reason: 'no WebGL2 with renderable half floats' });
    // the browser can take the context back (a background tab, a GPU reset, too many contexts on the page): the scene
    // stops and the page shows a still frame; once the context is back, the page rebuilds the renderer. A context that
    // is lost and never restored stays lost: the still frame is the answer then. Listened to from here on, before
    // anything is loaded: a loss nobody answers with preventDefault() is never restored
    let lostEarly = false;   // lost at any moment before the scene was up (restored since or not): it is not built
    m.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();   // without it the browser would never restore the context
      if (silk) {
        carry(silk.stats());
        silk.dispose(true);
        silk = null;
      } else lostEarly = true;
      post({ t: 'lost' });
    }, { signal: watch.signal });
    m.canvas.addEventListener('webglcontextrestored', () => post({ t: 'restored' }), { signal: watch.signal });
    const gone = () => lostEarly || gl.isContextLost();
    const LOST = { t: 'fail', reason: 'the WebGL context was lost while the scene was being built', lost: true };
    // three.js that cannot be loaded is a mistake in the page (no import map, a wrong URL), not a missing feature
    const THREE = await loadThree(m.threeUrl).catch((e) => { throw Object.assign(new Error(`three.js could not be loaded (${e?.message || e})`), { code: true }); });
    if (dead) return;
    if (gone()) return post(LOST);
    const opened = openRenderer(THREE, m.canvas, gl);
    if (!opened) return post(gone() ? LOST : { t: 'fail', reason: 'three.js could not start a WebGL2 renderer' });
    // a software rasteriser cannot afford the high tier, unless the caller forced it
    const tier = opened.software && m.tier.tier === 'high' && !m.forced ? m.lowTier : m.tier;
    const sphere = m.options.shape === 'sphere';
    let picture, bump;
    try {
      [picture, bump] = await Promise.all([
        loadBitmap(m.picture, { flipY: sphere }),
        sphere && m.bump ? loadBitmap(m.bump, { flipY: true }).catch(() => null) : null,
      ]);
    } catch (e) {
      opened.renderer.dispose();
      // an HTTP error is the same on every thread; a decoding error may not be (WebKit cannot read a data: URL's blob
      // in a worker on a file:// page), so the page tries the main thread before it gives up
      return post({ t: 'fail', reason: e.svg ? 'svg' : `could not load the picture (${e?.message || e})`, fatal: !!e.http, picture: !e.svg, svg: !!e.svg });
    }
    if (dead) return opened.renderer.dispose();
    if (gone()) { picture.close?.(); bump?.close?.(); opened.renderer.dispose(); return post(LOST); }
    scene = { THREE, opened, tier, o: { ...m.options, ...latest.options } };
    silk = createSilk(THREE, opened, { picture, bump }, scene.o, tier, {
      view: latest.view, visible: latest.visible, still: latest.still,
      onHover: (on) => post({ t: 'hover', on }),
    });
    picture.close?.();
    bump?.close?.();
    if (!silk) {
      opened.renderer.dispose();
      return post({ t: 'fail', reason: `the picture has nothing opaque in it (no pixel above threshold ${m.options.threshold}): use a PNG whose subject is visible`, fatal: true });
    }
    for (const t of latest.touches.splice(0)) silk.touch(t.x, t.y, t);
    replayPointer();
    post({ t: 'ready', tier: tier.tier, software: opened.software, ...silk.info });   // the first frame is already drawn
  }

  /* ---- live HTML: the element changed size, so the dome is rebuilt from a new stand-in on the same context ---- */
  async function reshape(m) {
    const picture = await loadBitmap(m.picture);
    if (dead || !silk) return picture.close?.();
    carry(silk.stats());
    silk.dispose(true);
    Object.assign(scene.o, m.patch);
    silk = make(picture);
    picture.close?.();
    post({ t: 'shaped' });
  }

  /* ---- the pointer of the loading time: a pointer still over the canvas hovers (and presses) at once; one that has
   *      gone gets one ripple where its path first crossed the object, so a stroke or a tap made while loading is
   *      answered. Pointer coordinates are -1…1 (y up); touch() takes 0…1 from the top left ---- */
  function replayPointer() {
    const { at, down, trail } = latest;
    latest.trail = [];
    if (at) {
      silk.pointer(at.x, at.y);
      if (down) silk.press(true);
    } else {
      for (const p of trail) if (silk.touch((p.x + 1) / 2, (1 - p.y) / 2)) break;
    }
  }

  const stats = () => {
    if (!silk) return { frames: 0, mode: 'loading' };
    const s = silk.stats();
    return { ...s, frames: s.frames + before.frames, steps: s.steps + before.steps, touches: s.touches + before.touches, ...('snapshots' in s ? { snapshots: s.snapshots + before.snapshots } : {}) };
  };

  return (m) => {
    switch (m.t) {
      case 'warm': loadThree(m.threeUrl).then(() => post({ t: 'warm', ok: true }), () => post({ t: 'warm', ok: false })); break;
      case 'init': init(m).catch((e) => post({ t: 'fail', reason: String(e?.message || e), code: !!e?.code })); break;
      case 'pointer': latest.at = { x: m.x, y: m.y }; if (silk) silk.pointer(m.x, m.y); else if (latest.trail.length < 64) latest.trail.push(latest.at); break;
      case 'press': latest.down = m.down; silk?.press(m.down); break;
      case 'lift': latest.at = null; latest.down = false; silk?.lift(); break;
      case 'touch': if (silk) silk.touch(m.x, m.y, m); else latest.touches.push(m); break;
      case 'stats': post({ t: 'stats', id: m.id, ...stats() }); break;
      case 'uv': post({ t: 'uv', id: m.id, uv: silk ? silk.surfaceAt(m.x, m.y) : null }); break;
      case 'view': latest.view = m.view; silk?.resize(m.view); break;
      case 'visible': latest.visible = m.visible; silk?.setVisible(m.visible); break;
      case 'still': latest.still = m.still; silk?.setStill(m.still); break;
      case 'options': if (silk) silk.setOptions(m.patch); else Object.assign(latest.options, m.patch); break;
      case 'wake': silk?.wake(); break;
      case 'html': post({ t: 'html', ...(silk ? silk.html(m.img) : { ok: false }) }); break;
      case 'shape': reshaping = reshaping.then(() => reshape(m)).catch((e) => post({ t: 'fail', reason: `could not rebuild the dome (${e?.message || e})` })); break;
      case 'dispose': dead = true; watch.abort(); if (silk) silk.dispose(); else scene?.opened.renderer.dispose(); silk = null; break;
    }
  };
}
