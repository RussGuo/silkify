/**
 * text.js — words as the object: `silkify(canvas, { text: 'silk', font, color, lineHeight })`.
 *
 * The text is set in a 2D canvas on the page and then is an ordinary picture: its alpha is the silhouette, the
 * Poisson dome inflates the letters, and the static tier draws it flat like any other picture. silk.js calls this
 * file twice: checkText() inside silkify() (mistakes in the call throw at once, like a missing element), and
 * setText() at the start of the mount, before the picture is needed.
 *
 *   fonts      the canvas draws only fonts that are already loaded, so setText() waits for document.fonts.load()
 *              (FONT_MS at most). A family that still does not render is measured, not guessed: the text is drawn
 *              twice in each generic fallback, once behind the family; the same width both times means it is not
 *              there. Only what the page's author can fix is said, once: a web font the page declared (@font-face,
 *              or a <link>'s stylesheet) that failed or did not arrive, or a stack with no generic family (serif,
 *              sans-serif, system-ui…) none of whose fonts renders. A system font missing on the visitor's machine
 *              in a stack that ends in a generic family is the stack working, as in CSS: nothing is said.
 *   emoji, CJK the browser falls back glyph by glyph, as in the page: colour emoji keep their own colours.
 *   size       the font's own size only sets proportions: the lines are drawn TEXT_PX on the long side, whatever the
 *              size, so a 16px font inflates as well as a 200px one. The box is the glyphs' ink, not their advance.
 *   defaults   `color` is the canvas's CSS colour (the words take the page's ink, as text does); `font` a heavy
 *              weight of the canvas's own family, because a dome's height grows with the stroke's width. The puff
 *              stays 'dome': drawn TEXT_PX long, a heavy word inflates well at 1 (light weights and long lines
 *              read flatter; the docs say to raise it). TEXT_DEFAULTS reach resolveOptions(): the alpha is the outline.
 *
 * Errors are silk.js's style: a TypeError that names the option and the fix. Exported: TEXT_DEFAULTS, checkText,
 * setText. Only the page side imports it (core.js and the worker receive a bitmap).
 */

/* ============================================
 * Constants
 * ============================================ */
const TEXT_PX = 1024;       // the long side of the drawn text, like an SVG's (silk.js SVG_PX)
const MEASURE_PX = 200;     // the size the text is measured at
const EDGE = 4;             // px of clear border around the ink (antialiasing); shape.js adds its own room
const FONT_MS = 3000;       // the longest wait for document.fonts.load()
const LINE_HEIGHT = 1.15;   // × the font size, as CSS's unitless line-height
const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|emoji|math|fangsong)$/i;

/** What a text object starts from (explicit options still win, as everywhere): the letters' alpha is the outline,
 *  also for a single heavy glyph that fills its box (matte 'auto' would make that a rounded rectangle). */
export const TEXT_DEFAULTS = { matte: 'alpha' };

const describe = (x) => (x === null ? 'null' : x === undefined ? 'undefined' : x?.constructor?.name || typeof x);

/* ---- a scratch 2D context: canvas parsing is the validator for fonts and colours (it ignores what it cannot read) ---- */
let scratch = null;
const ctx = () => (scratch ??= document.createElement('canvas').getContext('2d'));
function parses(prop, value) {
  const g = ctx();
  const seen = ['10px a', '11px b'].map((probe, i) => {
    g[prop] = prop === 'font' ? probe : ['#010203', '#040506'][i];
    const before = g[prop];
    g[prop] = value;
    return g[prop] !== before;
  });
  return seen[0] || seen[1];
}

/**
 * Mistakes in the call, thrown at once: text with image or element, an empty text, a font or colour the browser
 * cannot read, a lineHeight that is not a positive number, a sphere.
 */
export function checkText(options) {
  const { text, font, color, lineHeight } = options;
  if (options.image != null) throw new TypeError('silkify: pass options.image or options.text, not both');
  if (options.element != null) throw new TypeError('silkify: pass options.element or options.text, not both');
  if (options.shape === 'sphere') throw new TypeError("silkify: options.text cannot be wrapped on a sphere (shape: 'sphere')");
  if (typeof text !== 'string' || !text.trim()) {
    throw new TypeError(`silkify: options.text must be a string with something to draw, not ${typeof text === 'string' ? JSON.stringify(text) : describe(text)}`);
  }
  if (font != null && (typeof font !== 'string' || !parses('font', font))) {
    throw new TypeError(`silkify: options.font must be a CSS font shorthand with a size and a family, such as '800 160px Georgia, serif' (not ${JSON.stringify(font)})`);
  }
  if (color != null && (typeof color !== 'string' || !parses('fillStyle', color))) {
    throw new TypeError(`silkify: options.color must be a CSS colour (not ${JSON.stringify(color)})`);
  }
  if (lineHeight != null && !(typeof lineHeight === 'number' && lineHeight > 0)) {
    throw new TypeError(`silkify: options.lineHeight is a multiple of the font size, a number above 0 (not ${JSON.stringify(lineHeight)})`);
  }
}

/* ============================================
 * Fonts
 * ============================================ */
/**
 * A font shorthand as the canvas serialises it (sizes in px, the line height dropped): '800 160px "Fraunces", serif'
 * → { lead: '800 160px', family: '"Fraunces", serif', families: ['Fraunces', 'serif'] }.
 */
function split(font) {
  const g = ctx();
  g.font = font;
  const [, lead = g.font, family = ''] = g.font.match(/^(.*?\d(?:\.\d+)?px)(?:\s*\/\s*\S+)?\s+(.+)$/) || [];
  return { lead, family, families: family.split(',').map((f) => f.trim().replace(/^(["'])(.*)\1$/, '$2')).filter(Boolean) };
}
/** The same font at another size: sized(font)(48) → '800 48px "Fraunces", serif'. */
function sized(font) {
  const { lead, family } = split(font);
  return (px) => `${lead.replace(/[\d.]+px$/, `${px}px`)} ${family}`;
}

/** Does `family` render at all? Measured against two generic fallbacks: identical widths behind both means it is not there. */
function renders(family, style, sample) {
  const g = ctx();
  const quoted = `"${family.replace(/"/g, '\\"')}"`;
  return ['monospace', 'serif'].some((generic) => {
    g.font = `${style} ${generic}`;
    const alone = g.measureText(sample).width;
    g.font = `${style} ${quoted}, ${generic}`;
    return g.measureText(sample).width !== alone;
  });
}

/** The @font-face rules the page declared for `family` (its own CSS and its stylesheets' land in document.fonts too). */
const declared = (family) => [...(document.fonts ?? [])].filter((f) => f.family.replace(/^(["'])(.*)\1$/, '$2').toLowerCase() === family.toLowerCase());
const listed = (families) => families.map((f) => `"${f}"`).join(', ');

/**
 * Wait for the font (FONT_MS at most). `asked`: the font came from the options (the default, the page's own family,
 * is never warned about). Null when there is nothing the page could fix, else the sentence the warning says.
 */
async function loadFont(font, text, asked) {
  let timer;
  await Promise.race([
    document.fonts?.load(font, text).catch(() => null),
    new Promise((r) => { timer = setTimeout(r, FONT_MS); }),
  ]);
  clearTimeout(timer);
  if (!asked) return null;
  const { lead, families } = split(sized(font)(MEASURE_PX));   // measured large: small sizes round widths
  const named = families.filter((f) => !GENERIC.test(f));
  const sample = `mmmmmmmmmmlli0WQ@${text}`;
  // a web font the page declared that is not here: its file failed, or it is still on its way after FONT_MS
  const lost = named.filter((f) => {
    const faces = declared(f);
    return faces.length && !faces.some((x) => x.status === 'loaded') && !renders(f, lead, sample);
  });
  if (lost.length) {
    const slow = lost.some((f) => declared(f).some((x) => x.status === 'loading'));
    return `the web font ${listed(lost)} ${slow ? `did not load within ${FONT_MS / 1000} s` : 'failed to load (its @font-face source could not be fetched or read)'}: the text is drawn in the next font of the stack. Check the @font-face src or the <link>`;
  }
  // a stack with no generic family to fall back on, and none of its fonts here
  if (named.length === families.length && !named.some((f) => renders(f, lead, sample))) {
    return `none of the fonts ${listed(named)} is available and the stack has no generic family: the text is drawn in the browser's default font. Load the font before silkify() (a <link> or @font-face), or end the stack with serif, sans-serif or system-ui`;
  }
  return null;   // a system font missing in a stack with a generic family: the stack is working, as in CSS
}

/* ============================================
 * Setting the text
 * ============================================ */
/**
 * The text as a picture: a canvas TEXT_PX on its long side, the ink of every line inside, transparent around it.
 * `canvas` is the silk canvas, read for its CSS colour and family (the defaults). Resolves to { picture, warning }.
 */
export async function setText(o, canvas) {
  const cs = getComputedStyle(canvas);
  const font = o.font ?? `800 160px ${cs.fontFamily || 'sans-serif'}`;
  const text = String(o.text).replace(/\r\n?/g, '\n');
  const warning = await loadFont(font, text, o.font != null);

  // measured at MEASURE_PX and drawn at the size that makes the long side TEXT_PX: the font's own size only sets
  // the proportions (lineHeight is a multiple of it), and small sizes are not measured from hinted, rounded boxes
  const at = sized(font);
  const lines = text.split('\n'), lh = o.lineHeight ?? LINE_HEIGHT;
  const g = ctx();
  g.font = at(MEASURE_PX);
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  // every line centred on x = 0, baselines lh apart (in font sizes); the box is the union of their ink
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const m = g.measureText(line), y = i * lh * MEASURE_PX;
    x0 = Math.min(x0, -m.actualBoundingBoxLeft);
    x1 = Math.max(x1, m.actualBoundingBoxRight);
    y0 = Math.min(y0, y - m.actualBoundingBoxAscent);
    y1 = Math.max(y1, y + m.actualBoundingBoxDescent);
  });
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const k = (TEXT_PX - 2 * EDGE) / Math.max(w, h), px = MEASURE_PX * k;

  const c = document.createElement('canvas');
  c.width = Math.round(w * k) + 2 * EDGE;
  c.height = Math.round(h * k) + 2 * EDGE;
  const d = c.getContext('2d');
  d.font = at(px);
  d.textAlign = 'center';
  d.textBaseline = 'alphabetic';
  d.fillStyle = o.color ?? cs.color ?? '#000';
  lines.forEach((line, i) => d.fillText(line, EDGE - x0 * k, EDGE - y0 * k + i * lh * px));
  return { picture: c, warning };
}
