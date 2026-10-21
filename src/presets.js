/**
 * presets.js — named bundles of options, so one word can change what an object is made of and how it moves.
 *
 *   material   what the surface is: its sheen, rim, thread direction, grain, and how much of it is silk at rest
 *   feel       how it answers a touch: wave speed, damping, dent size and depth
 *
 * Both are plain option fragments with no logic. silk.js merges them in this order, so anything written
 * explicitly always wins:  COMMON < DEFAULTS[shape] < MATERIALS[material] < FEELS[feel] < explicit options.
 * `silk` in each group is the classic look (no keys at all). examples/lab.html lists both groups in its menus;
 * every value was tuned there against the gallery's pictures until each preset reads differently at a glance
 * (`node scripts/shoot.mjs --lab` renders one picture per preset into docs/shots/lab/).
 *
 * The test for a material is its rest state: untouched, it must already read as what it is.
 *   satin   most of it is silk at rest (silkRest 0.6): a broad pale band of sheen drawn out across the threads
 *   foil    silk everywhere (silkRest 1), the highlight tinted by the body (metallic) and broken into streaks by a
 *           fixed thread relief (threads), stretched across the threads (anisotropy)
 *   velvet  a dark body (low exposure and floor) whose edges glow in its own colour (rim, rimColor: null), because
 *           a white rim reads as fog on a coloured object
 *   paper   no sheen at all, flat frontal light in a warm tone, coarse grain (grain above 1, grainScale 2)
 *   ink     the ink-drop card's raking light and grain, with a deeper floor so the far side falls into hard shadow;
 *           not its exposure 2.2, which only suits a near-black albedo (that card sets albedo and exposure itself)
 */

export const MATERIALS = {
  silk: {},
  satin: { sheen: 0.7, sheenPower: 9, anisotropy: 0.6, silkRest: 0.6 },
  velvet: { exposure: 0.55, floor: 0.15, volume: 0.4, sheen: 0.04, rim: 1.1, rimPower: 1.9, rimColor: null, silkRest: 0.15 },
  wet: { sheen: 1.1, sheenPower: 40, rim: 0.2, silkSpread: 1.6, silkRest: 0.35 },
  foil: { silkRest: 1, metallic: 0.85, threads: 0.6, anisotropy: 1, sheen: 1.2, sheenPower: 18, iridescence: 0.25, grain: 0.3 },
  paper: {
    sheen: 0, satin: 0.35, grain: 1.3, grainScale: 2, displace: 0.14, floor: 0.95, volume: 0.05,
    light: [-0.2, 0.3, 0.93], lightColor: [1, 0.97, 0.9], gamma: 0.8, exposure: 1.1,
  },
  ink: { grain: 1, light: [-0.66, 0.72, 0.2], exposure: 1.35, floor: 0.2, volume: 0.5, sheen: 0.5, sheenPower: 14 },
};

export const FEELS = {
  silk: {},
  water: { waveSpeed: 1.9, damping: 0.998, displace: 0.22, ripple: 80, pressRadius: 0.05 },
  gel: { waveSpeed: 1.0, damping: 0.985, displace: 0.45, pressDepth: 0.45 },
  jelly: { waveSpeed: 1.3, damping: 0.993, displace: 0.5, pressDepthHold: 0.8 },
};

/** Every key some preset in the group sets: switching presets live resets all of them, not only the new ones. */
export const keysOf = (group) => [...new Set(Object.values(group).flatMap(Object.keys))];
