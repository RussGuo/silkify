/**
 * worker.js — the Web Worker side. silk.js transfers the canvas here (transferControlToOffscreen), so parsing
 * and running three.js, decoding the picture, inflating the dome, compiling shaders and drawing every frame all
 * happen off the main thread; the page only forwards pointer, size and visibility messages.
 *
 * Import maps do not apply inside workers, so without a bundler three.js is loaded from the absolute URL the page
 * resolved (`import.meta.resolve('three')`, or the `threeUrl` option); the comments keep bundlers from trying to
 * resolve that URL at build time. With a bundler there is no URL: `import('three')` is bundled into this worker.
 */
import { serve } from './core.js';

const loadThree = (url) => (url ? import(/* @vite-ignore */ /* webpackIgnore: true */ /* turbopackIgnore: true */ url) : import('three'));
const handle = serve((m) => self.postMessage(m), loadThree);
self.onmessage = (e) => {
  handle(e.data);
  if (e.data.t === 'dispose') self.close();
};
