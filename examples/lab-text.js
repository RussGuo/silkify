/*
 * lab-text.js — the Lab's words (Object → Words): which fonts it offers, how a font shorthand reads back into the
 * two pickers, and the one stylesheet a web font needs.
 *
 * The options themselves are silkify's own (`text`, `font`, `color`, `lineHeight`, references/parameters.md "Text"):
 * the Lab keeps them in its state like any other option, so the link, Copy options and Download HTML carry them as
 * they are. `font` is always a full shorthand, `<weight> 160px <family>`: silkify only takes proportions from the size.
 *
 * Fonts: four system stacks (nothing to load) and three Google Fonts, one with Chinese. A Google Font's <link> goes
 * into the page only when that font is picked, and the Lab waits for it before mounting: document.fonts.load() can
 * only find a font whose @font-face is already in the page. A downloaded page gets the same <link>.
 *
 * wordRows() builds the rows under Object → Words with lab.html's own row helpers (passed in: the Lab's state stays in lab.html).
 */

/* ============================================
 * The fonts on offer
 * ============================================ */
const GOOGLE = 'https://fonts.googleapis.com/css2?display=swap&family=';
export const FONTS = [
  { id: 'serif', label: 'Serif (system)', family: 'ui-serif, Georgia, "Times New Roman", serif' },
  { id: 'sans', label: 'Sans (system)', family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { id: 'rounded', label: 'Rounded (system)', family: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif' },
  { id: 'mono', label: 'Mono (system)', family: 'ui-monospace, Menlo, Consolas, monospace' },
  { id: 'fraunces', label: 'Fraunces (Google Fonts)', family: '"Fraunces", serif', css: `${GOOGLE}Fraunces:opsz,wght@9..144,100..900` },
  { id: 'bricolage', label: 'Bricolage Grotesque (Google Fonts)', family: '"Bricolage Grotesque", sans-serif', css: `${GOOGLE}Bricolage+Grotesque:opsz,wght@12..96,200..800` },
  { id: 'noto-serif-sc', label: '思源宋体 Noto Serif SC (Google Fonts)', family: '"Noto Serif SC", serif', css: `${GOOGLE}Noto+Serif+SC:wght@200..900` },
];
export const WEIGHTS = [[400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold'], [800, 'Extra bold'], [900, 'Black']];

/** What a new text object starts from: a heavy system serif (no request), in a deep red that reads on paper and on black. */
export const TEXT_START = { text: 'silk', font: '800 160px ui-serif, Georgia, "Times New Roman", serif', color: '#6b2737' };
export const LINE_HEIGHT = 1.15;            // silkify's default (src/text.js), shown when the link does not set one
export const TEXT_KEYS = ['text', 'font', 'color', 'lineHeight'];

/* ============================================
 * A font shorthand ↔ the two pickers
 * ============================================ */
const fontOf = (family) => FONTS.find((f) => f.family === family);
/** '900 160px "Fraunces", serif' → { weight: 900, id: 'fraunces' }; a family the Lab does not offer is id null. */
export function readFont(font = '') {
  const [, weight = '800', family = ''] = font.match(/^(\d{3})\s+[\d.]+px\s+(.+)$/) || [];
  return { weight: +weight, id: fontOf(family)?.id ?? null };
}
export const writeFont = (weight, id) => `${weight} 160px ${FONTS.find((f) => f.id === id).family}`;
/** The stylesheet a font needs (a Google Font), or null for a system stack. */
export function stylesheetOf(font) {
  const [, family = ''] = (font || '').match(/^\d{3}\s+[\d.]+px\s+(.+)$/) || [];
  return fontOf(family)?.css ?? null;
}

/** Put a stylesheet in the page once, and resolve when it has loaded (or failed: silkify then warns and draws the fallback). */
const sheets = new Map();
export function useStylesheet(href) {
  if (!href) return Promise.resolve();
  if (!sheets.has(href)) {
    sheets.set(href, new Promise((resolve) => {
      const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href, onload: resolve, onerror: resolve });
      document.head.append(link);
    }));
  }
  return sheets.get(href);
}

/** A string as a single-quoted JavaScript literal, for the printed call: 'it\'s', 'two\nlines'. */
export const quote = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/</g, '\\x3c')}'`;

/* ============================================
 * The rows under Object → Words
 * ============================================ */
/**
 * The text, a font and a weight, a colour, and the line height (lab.html shows it once there is a second line).
 * Built with the Lab's own row helpers, so each row has its name, its API name and its line from parameters.md;
 * each pushes a view that lab.html's sync() refreshes. Returns the rows' box.
 */
export function wordRows({ row, named, number, set, views, el }) {
  const box = el('div', { className: 'words' });
  const [r1, w1, main1] = row('text');
  const area = main1(el('textarea', { rows: 2, spellcheck: false }));
  area.oninput = () => area.value.trim() && set('text', area.value);   // no words, nothing to draw: keep the last ones
  w1.append(area);
  const [r2, w2, main2] = row('font');
  const family = main2(el('select'));
  for (const f of FONTS) family.append(el('option', { value: f.id, textContent: f.label }));
  family.append(el('option', { value: '', textContent: 'the link’s own font', disabled: true }));
  const weight = named(el('select'), 'Font weight');
  for (const [w, name] of WEIGHTS) weight.append(el('option', { value: w, textContent: `${w} · ${name}` }));
  family.onchange = weight.onchange = () => set('font', writeFont(weight.value, family.value || 'serif'));
  w2.append(family, weight);
  const [r3, w3, main3] = row('color');
  const pick = main3(el('input', { type: 'color' }));
  pick.oninput = () => set('color', pick.value);
  w3.append(pick);
  const lh = number('lineHeight', 0.7, 1.6, 0.01);
  box.append(r1, r2, r3, lh.row);
  views.push(
    { key: 'text', row: r1, show(v) { if (document.activeElement !== area) area.value = v ?? ''; } },
    { key: 'font', row: r2, show(v) { const f = readFont(v); family.value = f.id ?? ''; weight.value = f.weight; } },
    { key: 'color', row: r3, show(v) { if (/^#[0-9a-f]{6}$/i.test(v)) pick.value = v; } },
    { ...lh, show: (v) => lh.show(v ?? LINE_HEIGHT) },
  );
  return box;
}
