/**
 * tier.js — how much rendering a device gets. Decided once, at mount; a tier change would mean rebuilding the scene.
 *
 *   high    desktop-class: device-pixel-ratio cap 2 (steps down to 1.5 / 1 if the GPU falls behind),
 *           simulation up to 256 cells, mesh up to 240 segments, the idle light sweep runs one loop then stops
 *   low     touch-first, narrow (< 1024 px), ≤ 4 cores, ≤ 4 GB, or a software rasteriser (found inside the renderer):
 *           ratio 1, simulation ≤ 128, mesh ≤ 120, no idle sweep — frames are drawn only while someone interacts
 *   static  reduced motion, Save-Data, 2G, ≤ 2 cores or ≤ 2 GB, or no WebGL2: three.js is never loaded;
 *           the canvas shows `poster` (or the picture itself) once
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

/** Can this browser render live at all (WebGL2 with renderable half floats)? Probed on a throwaway canvas. */
let support;
export function hasWebGL2() {
  if (support !== undefined) return support;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    support = !!gl && !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    support = false;
  }
  return support;
}

/** 'auto' looks at the device; 'high' | 'low' | 'static' force it. `reducedMotion` follows the silkify option. */
export function pickTier(force = 'auto', reducedMotion = 'auto') {
  if (force !== 'auto' && TIERS[force]) return force === 'static' || hasWebGL2() ? TIERS[force] : TIERS.static;
  const nav = navigator;
  const mq = (q) => !!window.matchMedia?.(q).matches;
  const cores = nav.hardwareConcurrency || 4;
  const memory = nav.deviceMemory ?? 8;           // Safari and Firefox do not say: assume plenty
  const conn = nav.connection;
  const reduced = reducedMotion === 'auto' ? mq('(prefers-reduced-motion: reduce)') : !!reducedMotion;
  if (reduced || conn?.saveData || /(^|-)2g$/.test(conn?.effectiveType ?? '') || cores <= 2 || memory <= 2 || !hasWebGL2()) return TIERS.static;
  if (mq('(pointer: coarse)') || window.innerWidth < 1024 || cores <= 4 || memory <= 4) return TIERS.low;
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
