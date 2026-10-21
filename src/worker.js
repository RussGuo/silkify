/**
 * worker.js — the Web Worker side. silk.js transfers the canvas here (transferControlToOffscreen), so parsing
 * and running three.js, decoding the picture, inflating the dome, compiling shaders and drawing every frame all
 * happen off the main thread; the page only forwards pointer, size and visibility messages.
 *
 * Import maps do not apply inside workers, so three.js is loaded from the absolute URL the page resolved
 * (`import.meta.resolve('three')`, or the `threeUrl` option).
 */
import { serve } from './core.js';

const handle = serve((m) => self.postMessage(m), (url) => import(url));
self.onmessage = (e) => {
  handle(e.data);
  if (e.data.t === 'dispose') self.close();
};
