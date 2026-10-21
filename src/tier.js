/**
 * tier.js — how much rendering a device gets. Decided once, at mount; a tier change would mean rebuilding the scene.
 *
 *   high    desktop-class: device-pixel-ratio cap 2 (steps down to 1.5 / 1 if the GPU falls behind),
 *           simulation up to 256 cells, mesh up to 240 segments, the idle light sweep runs one loop then stops
 *   low     touch-first, a small screen (< 1024 px on its long side), ≤ 4 cores, ≤ 4 GB, or a software rasteriser
 *           (found inside the renderer): ratio 1, simulation ≤ 128, mesh ≤ 120, no idle sweep — frames are drawn
 *           only while someone interacts
 *   static  reduced motion, Save-Data, 2G, ≤ 2 cores or ≤ 2 GB: three.js is never loaded; the canvas shows
 *           `poster` (or the picture itself) once. A browser without WebGL2 ends up here too, but that is found by
 *           the renderer on the canvas itself (core.js openContext), before three.js is loaded: probing here would
 *           mean a throwaway WebGL context on the main thread, which costs seconds on a software GPU.
 *
 * The screen, not the window, decides "small": a desktop window split in half is still a desktop.
 *
 * Simulation and mesh resolution also follow the object's size on screen: one cell ≈ 3.15 CSS px and one mesh
 * segment ≈ 2.8 CSS px at most, so a small canvas does not pay for detail it cannot show. Below the reference
 * resolution the solver takes several sub-steps per frame with rescaled constants (see core.js), so dents and
 * waves keep the same size and speed relative to the object.
 */

export const TIERS = {
  high: { tier: 'high', dprCap: 2, simMax: 256, meshMax: 240, sphereSegments: 192, grain: 1024, idleSweep: true },
  low: { tier: 'low', dprCap: 1, simMax: 128, meshMax: 120, sphereSegments: 96, grain: 512, idleSweep: false },
  static: { tier: 'static' },
};

const CELL_PX = 3.15;   // CSS px per simulation cell at most
const QUAD_PX = 2.8;    // CSS px per mesh segment at most

/**
 * 'auto' looks at the device; 'high' | 'low' | 'static' force it. `reducedMotion` follows the silkify option.
 * A static tier carries `why`, in words (it becomes handle.reason). Cheap checks only: nothing here touches WebGL.
 */
export function pickTier(force = 'auto', reducedMotion = 'auto') {
  const still = (why) => ({ ...TIERS.static, why });
  if (force === 'static') return still("tier: 'static' was asked for");
  if (force !== 'auto' && TIERS[force]) return TIERS[force];
  const nav = navigator;
  const mq = (q) => !!window.matchMedia?.(q).matches;
  const cores = nav.hardwareConcurrency || 4;
  const memory = nav.deviceMemory ?? 8;           // Safari and Firefox do not say: assume plenty
  const conn = nav.connection;
  const reduced = reducedMotion === 'auto' ? mq('(prefers-reduced-motion: reduce)') : !!reducedMotion;
  if (reduced) return still('reduced motion is asked for (prefers-reduced-motion, or the reducedMotion option)');
  if (conn?.saveData) return still('Save-Data is on');
  if (/(^|-)2g$/.test(conn?.effectiveType ?? '')) return still('a 2G connection');
  if (cores <= 2 || memory <= 2) return still('a very small device (≤ 2 cores or ≤ 2 GB)');
  const screenLong = Math.max(window.screen?.width || 0, window.screen?.height || 0) || window.innerWidth;
  if (mq('(pointer: coarse)') || screenLong < 1024 || cores <= 4 || memory <= 4) return TIERS.low;
  return TIERS.high;
}

/**
 * Simulation cells and mesh segments for an object whose reference grid has `simRef` cells and whose
 * UV domain spans `uvCssPx` CSS pixels on screen. Mesh segments are a multiple of 4 (the Poisson solve halves twice).
 */
export function gridFor(params, simRef, uvCssPx) {
  const sim = Math.max(64, Math.min(params.simMax, simRef, Math.round(uvCssPx / CELL_PX)));
  const mesh = Math.max(40, Math.min(params.meshMax, Math.round(uvCssPx / QUAD_PX / 4) * 4));
  return { sim, mesh };
}
