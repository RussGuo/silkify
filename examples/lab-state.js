/*
 * lab-state.js — what the Lab accepts from a link, and how it writes a value back out as code.
 *
 * A Lab link carries the whole state in its hash, and the Lab prints that state as a silkify() call (Copy options)
 * and writes it into a page (Download HTML). A link is anyone's to make, so nothing in it is trusted:
 *   cleanState()  keeps only what the Lab's own controls could have set: known keys, each of its control's type and
 *                 within its range (numbers clamped, choices from their list, colours as [r, g, b] in 0–1, words and
 *                 fonts as plain strings of bounded length that the browser can read). Anything else is dropped.
 *   safeUrl()     a picture's address: http(s), blob:, data:image/… or a relative path; never javascript: or the like.
 *   js()          a value as JavaScript source that cannot break out of itself: strings through quote(), which also
 *                 escapes `<`, so neither `</script>` nor `<!--` can appear in a page that embeds the code.
 * GROUPS (every option the Advanced panel shows, with its control and range) lives here because cleanState() reads it.
 */
import { MATERIALS, FEELS, PUFF } from '../src/silk.js';
import { quote, TEXT_KEYS } from './lab-text.js';

/* ============================================
 * Every option, grouped as in SKILL.md. Ranges are SKILL's tuning ranges, widened to show the extremes, but
 * never past what still draws: satin above 1 overshoots into black, a threshold near 0 or 1 loses the outline,
 * and the number boxes clamp to the same range (a typed damping of 1.01 would blow the waves up).
 *   [key, kind, ...]  kind: n (min, max, step, nullable) · c colour (nullable) · d direction · b boolean · s select (choices)
 * ============================================ */
export const GROUPS = [
  ['Ripple', [
    ['pressDepth', 'n', 0, 0.9, 0.01], ['pressDepthHold', 'n', 0, 1.2, 0.01], ['pressRadius', 'n', 0.02, 0.16, 0.005],
    ['waveSpeed', 'n', 0.2, 1.98, 0.01], ['damping', 'n', 0.95, 0.9995, 0.0005], ['displace', 'n', 0, 0.9, 0.01], ['ripple', 'n', 0, 140, 1],
  ]],
  ['Material', [
    ['sheen', 'n', 0, 2, 0.01], ['sheenPower', 'n', 2, 80, 1], ['sheenColor', 'c'], ['satin', 'n', 0, 1, 0.01],
    ['albedo', 'c', true], ['grain', 'n', 0, 2, 0.01], ['grainScale', 'n', 1, 4, 0.1], ['gamma', 'n', 0.5, 1.6, 0.01], ['exposure', 'n', 0.2, 3, 0.01],
    ['metallic', 'n', 0, 1, 0.01], ['anisotropy', 'n', 0, 1, 0.01], ['anisotropyAngle', 'n', -3.1416, 3.1416, 0.01], ['threads', 'n', 0, 1, 0.01],
    ['rim', 'n', 0, 2, 0.01], ['rimPower', 'n', 0.5, 8, 0.1], ['rimColor', 'c', true],
    ['iridescence', 'n', 0, 1, 0.01], ['silkRest', 'n', 0, 1, 0.01], ['silkSpread', 'n', 0.2, 4, 0.05],
  ]],
  ['Light', [
    ['light', 'd'], ['lightColor', 'c'], ['satinLight', 'd'], ['floor', 'n', 0, 1, 0.01], ['volume', 'n', 0, 1, 0.01],
    ['fillLight', 'b'], ['idleSweep', 'b'],
  ]],
  ['Motion', [['autoplay', 'auto'], ['breeze', 'n', 0, 1, 0.01]]],
  ['Shape', [
    ['shape', 's', ['image', 'sphere']], ['puff', 'puff'], ['matte', 's', ['auto', 'alpha', 'rect']],
    ['corner', 'n', 0, 0.5, 0.01], ['threshold', 'n', 0.1, 0.9, 0.01], ['fit', 'n', 1, 2.2, 0.01],
    ['phase', 'n', 0, 1, 0.005, true], ['bumpStrength', 'n', 0, 30, 0.5], ['spin', 'b'], ['spinSpeed', 'n', 0, 0.06, 0.001], ['angle', 'n', 0, 1, 0.01],
  ]],
  ['Runtime', [['interactive', 'b'], ['tier', 's', ['auto', 'high', 'low', 'static']], ['worker', 's', ['auto', false]]]],
];
export const BACKGROUNDS = ['stage', 'paper', 'white', 'black', 'checker'];

/* ============================================
 * Reading a link: one check per kind of control
 * ============================================ */
const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined);
const triple = (v, lo, hi) => (Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x))
  ? v.map((x, i) => Math.min(hi[i], Math.max(lo[i], x))) : undefined);
const plain = (v, max) => (typeof v === 'string' && v.length <= max ? v : undefined);
const CHECK = {
  n: (v, [min, max, , nullable]) => (nullable && v === null ? null : num(v, min, max)),
  c: (v, [nullable]) => (nullable && v === null ? null : triple(v, [0, 0, 0], [1, 1, 1])),
  d: (v) => triple(v, [-1, -1, 0.05], [1, 1, 1.5]),
  b: (v) => (typeof v === 'boolean' ? v : undefined),
  s: (v, [choices]) => (choices.includes(v) ? v : undefined),
  puff: (v) => (typeof v === 'string' ? (v in PUFF ? v : undefined) : num(v, 0.1, 1.5)),
  auto: (v) => (v === false ? false : v && typeof v === 'object'
    ? { interval: num(v.interval, 600, 8000) ?? 2500, depth: num(v.depth, 0.05, 0.8) ?? 0.3 } : undefined),
};
const SPEC = new Map(GROUPS.flatMap(([, params]) => params.map(([key, kind, ...a]) => [key, (v) => CHECK[kind](v, a)])));
/* the words: a CSS font shorthand the Lab writes ("800 160px <family>") and a colour, both as the browser reads them */
const cssOk = (prop, v) => typeof CSS === 'undefined' || CSS.supports(prop, v);
SPEC.set('text', (v) => (plain(v, 400)?.trim() ? v : undefined));
SPEC.set('font', (v) => (plain(v, 200) && /^\d{3}\s+[\d.]+px\s+[\w\s",.-]+$/.test(v) && cssOk('font', v) ? v : undefined));
SPEC.set('color', (v) => (plain(v, 64) && /^[#\w\s(),.%-]+$/.test(v) && cssOk('color', v) ? v : undefined));
SPEC.set('lineHeight', (v) => num(v, 0.7, 1.6));

/** A picture's address from a link or the URL box: http(s), blob:, data:image/… or a relative path; else null. */
export function safeUrl(u) {
  if (typeof u !== 'string' || !u.trim() || u.length > 4096) return null;
  const s = u.trim();
  if (!/^[a-z][a-z\d+.-]*:/i.test(s)) return /^[^\s<>"'`\\]+$/.test(s) ? s : null;   // relative: no scheme at all
  return /^(https?:\/\/|blob:)[^\s<>"'`\\]+$/i.test(s) || /^data:image\/[\w.+-]+(;[\w=.+-]+)*,[\w+/=%.-]*$/i.test(s) ? s : null;
}

/**
 * cleanState(s, objects) → the state with only what the Lab's controls could have set, or null when the link names no
 * object the Lab has. `objects` is the Lab's OBJECTS table; words need some text, since silkify throws on none.
 */
export function cleanState(s, objects) {
  if (!s || typeof s !== 'object') return null;
  const url = s.url == null ? null : safeUrl(s.url);
  const obj = s.obj === 'custom' ? (url ? 'custom' : null) : Object.hasOwn(objects, s.obj) ? s.obj : null;
  if (!obj || !Object.hasOwn(MATERIALS, s.material) || !Object.hasOwn(FEELS, s.feel)) return null;
  const set = {};
  for (const [k, v] of Object.entries(s.set && typeof s.set === 'object' ? s.set : {})) {
    const check = SPEC.get(k);
    if (!check || (TEXT_KEYS.includes(k) && obj !== 'text')) continue;
    const ok = check(v);
    if (ok !== undefined) set[k] = ok;
  }
  if (obj === 'text' && !set.text) return null;
  return { obj, url: obj === 'custom' ? url : null, material: s.material, feel: s.feel, bg: BACKGROUNDS.includes(s.bg) ? s.bg : 'stage', set };
}

/* ============================================
 * Writing a value back out as code
 * ============================================ */
/** A value as JavaScript source: numbers, booleans, null, strings (quote()), arrays and plain objects of those. */
export function js(v) {
  if (typeof v === 'string') return quote(v);
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  if (typeof v === 'boolean' || v === null) return String(v);
  if (Array.isArray(v)) return `[${v.map(js).join(', ')}]`;
  if (v && typeof v === 'object') return `{ ${Object.entries(v).map(([k, x]) => `${/^[A-Za-z_]\w*$/.test(k) ? k : quote(k)}: ${js(x)}`).join(', ')} }`;
  return 'undefined';
}
