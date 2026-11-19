/**
 * lost-worker.js — silkify's worker, plus a way for test/lost.html to lose and restore its WebGL context.
 *
 * A page cannot reach the context of an OffscreenCanvas that lives in a worker, so this file stands in for
 * src/worker.js (lost.html swaps the URL when silk.js starts its worker): it runs the real worker, notes every WebGL2
 * context the worker opens, and on { t: 'test-lose' } / { t: 'test-restore' } calls WEBGL_lose_context on the newest
 * one, which is what a GPU reset or the browser reclaiming memory does. serve.js ignores messages it does not know.
 *
 * A loss while the renderer is still loading is too short a window to hit from the page, so the worker's URL can arm
 * one (lost.html adds the query), at a fixed point of serve.js's loading:
 *   ?lose=three              the moment the context exists, before three.js is imported (a microtask after
 *                            getContext(): serve.js is then waiting for three.js, and has not built the renderer)
 *   ?lose=picture[&restore]  while the picture is decoded (createImageBitmap), after the renderer exists; with
 *                            `restore`, the context is also given back there, before the scene is built
 */
import '../src/worker.js';

const arm = new URL(self.location.href).searchParams;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ext = null, armed = arm.get('lose');

const open = OffscreenCanvas.prototype.getContext;
OffscreenCanvas.prototype.getContext = function (type, ...rest) {
  const gl = open.call(this, type, ...rest);
  if (gl && type === 'webgl2') {
    const mine = ext = gl.getExtension('WEBGL_lose_context');
    if (armed === 'three') { armed = null; queueMicrotask(() => mine.loseContext()); }
  }
  return gl;
};

const decode = self.createImageBitmap;
self.createImageBitmap = async (...args) => {
  if (armed === 'picture' && ext) {
    armed = null;
    const mine = ext;
    mine.loseContext();
    await sleep(60);                  // the webglcontextlost event is dispatched
    if (arm.has('restore')) { mine.restoreContext(); await sleep(60); }
  }
  return decode.apply(self, args);
};

self.addEventListener('message', (e) => {
  if (e.data.t === 'test-lose') ext?.loseContext();
  if (e.data.t === 'test-restore') ext?.restoreContext();
});
