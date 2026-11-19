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
 * onInk() moves the Touch and Stroke points onto the words' ink (two lines leave the canvas's middle empty).
 */
import { setText } from '../src/text.js';

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

/* ============================================
 * Touch and Stroke on words: the points moved onto the ink
 * ============================================ */
/**
 * onInk(points, o, canvas) → Promise<[x, y][]>: the Stroke's and Touch's points (canvas coordinates, 0–1 from the top
 * left), moved onto the words. Their fixed curve crosses the canvas's middle band, which for two lines of words is the
 * gap between them: every drop missed and the button did nothing. The words are set again exactly as silkify sets them
 * (src/text.js setText) and placed as core.js places a picture: centred, `fit` (or 'cover', 0.97 of the short axis)
 * over the ink's box. Each point goes to the middle of the nearest line's ink (its band of rows), then to the nearest
 * inked pixel there, so a stroke across two lines runs along the first, then the second. A picture's points stay.
 */
const masks = new WeakMap();   // canvas → the words' ink, read once per mount
export async function onInk(points, o, canvas) {
  if (!masks.has(canvas)) {
    masks.set(canvas, setText(o, canvas).then(({ picture }) => {
      const k = 128 / Math.max(picture.width, picture.height), w = Math.max(1, Math.round(picture.width * k)), h = Math.max(1, Math.round(picture.height * k));
      const g = Object.assign(document.createElement('canvas'), { width: w, height: h }).getContext('2d', { willReadFrequently: true });
      g.drawImage(picture, 0, 0, w, h);
      const a = g.getImageData(0, 0, w, h).data, ink = [], bands = [];
      for (let j = 0; j < h; j++) {
        let row = false;
        for (let i = 0; i < w; i++) if (a[(j * w + i) * 4 + 3] > 160) { ink.push([(i + 0.5) / w, (j + 0.5) / h]); row = true; }
        const last = bands.at(-1);
        if (row && last && last[1] === j - 1) last[1] = j; else if (row) bands.push([j, j]);   // a line: rows of ink in a run
      }
      return { ink, lines: bands.map(([j0, j1]) => (j0 + j1 + 1) / 2 / h), aspect: picture.height / picture.width };
    }).catch(() => null));
  }
  const m = await masks.get(canvas);
  if (!m?.ink.length || !canvas.clientHeight) return points;
  const A = canvas.clientWidth / canvas.clientHeight, fit = o.fit ?? 1.3;
  const halfH = fit === 'cover' ? 0.97 * Math.min(m.aspect, 1 / A) : Math.max(fit * m.aspect, fit / A);
  const fw = 1 / (halfH * A), fh = m.aspect / halfH;   // the words' box as a share of the canvas
  return points.map(([x, y]) => {
    const u = (x - 0.5) / fw + 0.5, v0 = (y - 0.5) / fh + 0.5;
    const v = m.lines.reduce((b, c) => (Math.abs(c - v0) < Math.abs(b - v0) ? c : b));
    let best = m.ink[0], d = Infinity;
    for (const p of m.ink) { const e = ((p[0] - u) * fw) ** 2 + ((p[1] - v) * fh / A) ** 2; if (e < d) { d = e; best = p; } }
    return [0.5 + (best[0] - 0.5) * fw, 0.5 + (best[1] - 0.5) * fh];
  });
}
