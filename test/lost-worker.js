/**
 * lost-worker.js — silkify's worker, plus a way for test/lost.html to lose and restore its WebGL context.
 *
 * A page cannot reach the context of an OffscreenCanvas that lives in a worker, so this file stands in for
 * src/worker.js (lost.html swaps the URL when silk.js starts its worker): it runs the real worker, notes every WebGL2
 * context the worker opens, and on { t: 'test-lose' } / { t: 'test-restore' } calls WEBGL_lose_context on the newest
 * one, which is what a GPU reset or the browser reclaiming memory does. core.js ignores messages it does not know.
 */
import '../src/worker.js';

let ext = null;
const open = OffscreenCanvas.prototype.getContext;
OffscreenCanvas.prototype.getContext = function (type, ...rest) {
  const gl = open.call(this, type, ...rest);
  if (gl && type === 'webgl2') ext = gl.getExtension('WEBGL_lose_context');
  return gl;
};
self.addEventListener('message', (e) => {
  if (e.data.t === 'test-lose') ext?.loseContext();
  if (e.data.t === 'test-restore') ext?.restoreContext();
});
