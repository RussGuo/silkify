/**
 * verify-pages.mjs — shoot.mjs's checks of the pages around the library, run in its Chrome (`node scripts/shoot.mjs`,
 * or `--only pages` for these alone). A module of its own so shoot.mjs stays one readable file; it gets shoot.mjs's
 * DevTools helpers in `t` and adds what it finds to `t.problems`, each line prefixed with the page and the case.
 *
 *   link previews   every public page (index.html and examples/, not cdn.html or the framework projects) has og:title,
 *                   og:description, og:image (a file in this repository, of the size it claims), og:url (the page's own
 *                   GitHub Pages address) and twitter:card. Read from the files: no browser
 *   posters         no 0-byte WebP anywhere in examples/; every @2x is exactly twice its 1x; the use-case pages' posters
 *                   have the sizes their pages lay out (hero 560, 404 760 × 380, the marks 280)
 *   how it works    both languages: 1440 px scrolled top to bottom and 375 px with touch, no sideways scroll, never more
 *                   than 3 WebGL contexts (also with every figure asked for at once). In English: each live figure goes
 *                   live and ripples under a stroke; figures 1 and 2 redraw for another subject; figure 4 moves after
 *                   Drop; figure 3's button ripples both hares; the teapot's meter wakes; the live-HTML card prints
 *                   (where Chrome has HTML-in-Canvas). Reduced motion: the static tier, nothing mounted, three.js never
 *                   fetched, figure 3 showing its just-touched frames, figure 4 a still frame. No WebGL2 (simulated: no
 *                   OffscreenCanvas transfer, getContext('webgl2') null): every live figure static, its poster showing
 *   use cases       examples/demos/*.html: each object goes live and ripples under a stroke (the logo wall never holds
 *                   more than 3), no sideways scroll at 375 px, and with reduced motion no canvas and nothing mounted
 *   words           examples/text.html: live, a word ripples, no sideways scroll at 375 px, still with reduced motion
 *   button          examples/button.html, when there is one: it loads clean, at 1440 px, 375 px and with reduced motion
 *   contrast        the gallery, the Lab, the long read in both languages, text, button and live, light and dark: every
 *                   piece of text set on a plain colour reads at 4.5:1 or better (3:1 from 24 px, or 18.66 px bold), as WCAG
 *                   AA asks. Text over a picture or a gradient (the stages) is left to the eye
 * Every case also fails on a console error or warning (shoot.mjs's own listeners) and on any response of 400 or more.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PAGES = 'https://russguo.github.io/silkify/';
const NOT_PUBLIC = /^examples\/(cdn\.html|react\/|next\/)/;   // a CDN test page and the framework projects
const DEMO_POSTERS = { hero: [560, 560], 404: [760, 380], 'mark-': [280, 280] };   // 1x, in CSS px as the pages lay them out

/** t: { send, evaluate, navigate, mouse, sleep, diffOf, clipOf, on, base, problems } */
export async function verifyPages(t) {
  const { send, on, problems } = t;
  // ---- 4xx: Network events, counted only while a page of this module is open ----
  let watching = null;
  on('Network.responseReceived', (p) => { if (watching && p.response.status >= 400) problems.push(`${watching}: HTTP ${p.response.status} ${p.response.url}`); });
  on('Network.loadingFailed', (p) => { if (watching && !p.canceled) problems.push(`${watching}: request failed (${p.errorText}) ${p.type}`); });
  await send('Network.enable');
  const c = { ...t, watch: (label) => { watching = label; } };
  try {
    await checkPreviews(c);
    await checkPosters(c);
    await checkHow(c);
    await checkDemos(c);
    await checkText(c);
    if (existsSync(path.join(ROOT, 'examples/button.html'))) await checkButton(c);
    await checkContrast(c);
  } finally {
    watching = null;
    await send('Network.disable');
    await send('Emulation.setEmulatedMedia', { features: [] });
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  }
}

/* ============================================
 * Shared: one case = a page in one setting; what goes wrong in it is labelled with it
 * ============================================ */
async function scope(c, label, fn) {
  const mark = c.problems.length;
  c.watch(label);
  const t0 = Date.now();
  let detail = '';
  try { detail = (await fn()) || ''; } catch (e) { c.problems.push(`${label}: ${e.message}`); }
  c.watch(null);
  for (let i = mark; i < c.problems.length; i++) if (!c.problems[i].startsWith(label)) c.problems[i] = `${label}: ${c.problems[i]}`;
  const failed = c.problems.length - mark;
  console.log('pages ', `${label}: ${detail}`, failed ? `FAILED (${failed})` : '', `[${((Date.now() - t0) / 1000).toFixed(1)} s]`);
}
const expect = (c, label, ok, what) => { if (!ok) c.problems.push(`${label}: ${what}`); return ok; };

/** Open a page fresh: desktop 1440 or a phone (375 px, touch), with or without reduced motion. */
async function open(c, file, { phone = false, reduced = false, inject = null } = {}) {
  await c.send('Emulation.setDeviceMetricsOverride', phone
    ? { width: 375, height: 812, deviceScaleFactor: 2, mobile: true } : { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await c.send('Emulation.setTouchEmulationEnabled', phone ? { enabled: true, maxTouchPoints: 5 } : { enabled: false });
  await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
  await c.navigate('about:blank');
  const added = inject && await c.send('Page.addScriptToEvaluateOnNewDocument', { source: inject });
  await c.navigate(`${c.base}/${file}`);
  if (added) await c.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: added.identifier });
}
const overflow = (c) => c.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth');
const threeFetched = (c) => c.evaluate(`performance.getEntriesByType('resource').some((e) => /three(\\.module)?\\.js/.test(e.name))`);
const boxOf = (c, js) => c.evaluate(`(() => { const e = ${js}; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect();
  return { x: b.left, y: b.top, w: b.width, h: b.height, sx: scrollX, sy: scrollY }; })()`);

/** A pointer stroke across the middle of an element: the frame must visibly change (mean |Δ| per channel > 0.3). */
async function ripples(c, js, settle = 900) {
  const { mouse, sleep, send, diffOf, clipOf } = c;
  await mouse('mouseMoved', 2, 2);
  const r = await boxOf(c, js);
  await sleep(settle);
  const shot = async () => (await send('Page.captureScreenshot', { format: 'png', clip: clipOf(r, 0.5) })).data;
  const before = await shot();
  const [vx, vy] = [r.x, r.y];   // the box in the viewport (scrollIntoView already ran)
  for (let i = 0; i <= 16; i++) { await mouse('mouseMoved', vx + r.w * (0.3 + 0.4 * i / 16), vy + r.h * (0.45 + 0.1 * Math.sin(i / 3))); await sleep(25); }
  await sleep(250);
  const [d] = await diffOf(before, await shot());
  await mouse('mouseMoved', 2, 2);
  return d;
}

/** Scroll a page from top to bottom a viewport at a time; returns the most live renderers seen (live: a JS expression). */
async function readThrough(c, live, pause = 220) {
  const h = await c.evaluate('document.documentElement.scrollHeight');
  const vh = await c.evaluate('innerHeight');
  let most = 0;
  for (let y = 0; y <= h; y += vh * 0.9) {
    await c.evaluate(`scrollTo(0, ${y})`);
    await c.sleep(pause);
    most = Math.max(most, await c.evaluate(live));
  }
  await c.evaluate('scrollTo(0, 0)');
  return most;
}

/* ============================================
 * Link previews: Open Graph and X tags, from the files
 * ============================================ */
async function checkPreviews(c) {
  const files = ['index.html', ...(await readdir(path.join(ROOT, 'examples'), { recursive: true }))
    .map((f) => `examples/${f.split(path.sep).join('/')}`).filter((f) => f.endsWith('.html') && !NOT_PUBLIC.test(f))].sort();
  await scope(c, 'link previews', async () => {
    for (const file of files) {
      const html = await readFile(path.join(ROOT, file), 'utf8');
      const meta = {};
      for (const [tag] of html.matchAll(/<meta\b[^>]*>/g)) {
        const key = tag.match(/\b(?:property|name)="([^"]+)"/)?.[1], value = tag.match(/\bcontent="([^"]*)"/)?.[1];
        if (key && value !== undefined) meta[key] = value;
      }
      const missing = ['og:title', 'og:description', 'og:image', 'og:url', 'twitter:card'].filter((k) => !meta[k]?.trim());
      if (!expect(c, file, !missing.length, `no ${missing.join(', ')}`)) continue;
      const url = PAGES + file.replace(/(^|\/)index\.html$/, '$1');
      expect(c, file, meta['og:url'] === url, `og:url is ${meta['og:url']}, the page is at ${url}`);
      const img = meta['og:image'].startsWith(PAGES) ? meta['og:image'].slice(PAGES.length) : null;
      if (!expect(c, file, img && existsSync(path.join(ROOT, img)), `og:image ${meta['og:image']} is not a file in this repository`)) continue;
      const size = imageSize(await readFile(path.join(ROOT, img)));
      if (meta['og:image:width'] || meta['og:image:height']) {
        expect(c, file, size && `${size[0]}×${size[1]}` === `${meta['og:image:width']}×${meta['og:image:height']}`,
          `og:image is ${size?.join('×')}, the tags say ${meta['og:image:width']}×${meta['og:image:height']}`);
      }
    }
    return `${files.length} pages: og:title, og:description, og:image, og:url, twitter:card`;
  });
}

/** [width, height] of a JPEG, PNG or WebP, from its header (no image library). */
function imageSize(b) {
  if (b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (kind === 'VP8L') { const v = b.readUInt32LE(21); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
    if (kind === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + len;
    }
  }
  return null;
}

/* ============================================
 * Posters: none empty, @2x twice the 1x, the use-case pages' at the size they are laid out
 * ============================================ */
async function checkPosters(c) {
  await scope(c, 'posters', async () => {
    const all = (await readdir(path.join(ROOT, 'examples'), { recursive: true })).map((f) => f.split(path.sep).join('/')).filter((f) => f.endsWith('.webp'));
    let pairs = 0;
    for (const f of all) {
      const file = path.join(ROOT, 'examples', f);
      if (!expect(c, `examples/${f}`, (await stat(file)).size > 0, '0 bytes')) continue;
      if (!f.includes('@2x.')) continue;
      const one = file.replace('@2x.', '.');
      if (!existsSync(one)) continue;
      const [a, b] = [imageSize(await readFile(one)), imageSize(await readFile(file))];
      pairs++;
      expect(c, `examples/${f}`, a && b && b[0] === 2 * a[0] && b[1] === 2 * a[1], `${b?.join('×')}, not twice the 1x (${a?.join('×')})`);
      const want = f.startsWith('demos/posters/') && Object.entries(DEMO_POSTERS).find(([k]) => path.basename(one).startsWith(k))?.[1];
      if (want) expect(c, `examples/${f}`, a && a[0] === want[0] && a[1] === want[1], `1x is ${a?.join('×')}, the page lays it out at ${want.join('×')}`);
    }
    return `${all.length} WebP in examples/, none empty; ${pairs} @2x pairs exactly twice their 1x; use-case posters at their laid-out size`;
  });
}

/* ============================================
 * How it works: examples/how-it-works.html and .zh.html (hooks: window.__how, see examples/how/page.js)
 * ============================================ */
async function checkHow(c) {
  const { evaluate, sleep } = c;
  const live = 'window.__how.live.size';
  const all = async () => evaluate(`(async () => { let top = 0;
    for (const id of window.__how.ids) { window.__how.activate(id); top = Math.max(top, window.__how.live.size); }
    for (let k = 0; k < 15; k++) { await new Promise((r) => setTimeout(r, 100)); top = Math.max(top, window.__how.live.size); }
    return top; })()`);

  for (const file of ['examples/how-it-works.html', 'examples/how-it-works.zh.html']) {
    const lang = file.includes('.zh.') ? 'zh' : 'en';
    await scope(c, `how ${lang} 1440`, async () => {
      await open(c, file);
      const most = await readThrough(c, live);
      const x = await overflow(c);
      expect(c, `how ${lang} 1440`, x <= 0, `${x} px of sideways scroll`);
      let detail = '';
      if (lang === 'en') detail = await howFigures(c);
      const top = await all();
      expect(c, `how ${lang} 1440`, most <= 3 && top <= 3, `${Math.max(most, top)} live at once (cap 3)`);
      return `read through with at most ${most} live, every figure at once → ${top}; ${detail}`;
    });
    await scope(c, `how ${lang} 375`, async () => {
      await open(c, file, { phone: true });
      const most = await readThrough(c, live);
      const x = await overflow(c);
      expect(c, `how ${lang} 375`, x <= 0 && most <= 3, `${x} px of sideways scroll, at most ${most} live`);
      return `touch, ${x} px sideways, at most ${most} live`;
    });
  }

  await scope(c, 'how en reduced motion', async () => {
    await open(c, 'examples/how-it-works.html', { reduced: true });
    await readThrough(c, live, 120);
    await evaluate(`document.getElementById('fig-waves').scrollIntoView({ block: 'center' })`);
    await sleep(600);
    const s = await evaluate(`(() => {
      const touched = ['mask-on', 'mask-off'].every((id) => /-touched/.test(document.querySelector('.stage[data-silk="' + id + '"] .poster').currentSrc));
      const cv = document.querySelector('#fig-waves canvas'), px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let drawn = 0; for (let i = 3; i < px.length; i += 4 * 97) drawn += px[i] > 0;
      return { tier: window.__how.tier, live: window.__how.live.size, canvases: document.querySelectorAll('.stage[data-silk] canvas').length, touched, drawn };
    })()`);
    const three = await threeFetched(c);
    expect(c, 'how en reduced motion', s.tier === 'static' && s.live === 0 && s.canvases === 0 && !three && s.touched && s.drawn > 0,
      JSON.stringify({ ...s, three }));
    return `tier ${s.tier}, ${s.live} live, three.js ${three ? 'FETCHED' : 'not fetched'}, figure 3 just-touched ${s.touched}, figure 4 still frame ${s.drawn > 0}`;
  });

  await scope(c, 'how en no WebGL2', async () => {
    await open(c, 'examples/how-it-works.html', { inject: `delete HTMLCanvasElement.prototype.transferControlToOffscreen;
      { const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (k, o) { return /webgl/.test(k) ? null : get.call(this, k, o); }; }` });
    const r = await evaluate(`(async () => { const out = {};
      for (const id of window.__how.ids) {
        const h = await window.__how.activate(id), poster = document.querySelector('.stage[data-silk="' + id + '"] .poster');
        out[id] = { mode: h.mode, poster: poster ? getComputedStyle(poster).opacity !== '0' && poster.complete && poster.naturalWidth > 0 : null };
        window.__how.release(id);
      }
      return out; })()`);
    const bad = Object.entries(r).filter(([, v]) => v.mode !== 'static' || v.poster === false);
    expect(c, 'how en no WebGL2', !bad.length, JSON.stringify(r));
    return Object.entries(r).map(([id, v]) => `${id} ${v.mode}${v.poster ? ' + poster' : ''}`).join(', ');
  });
}

/** The English page's figures, each one asked to do its thing (1440 px, a mouse). */
async function howFigures(c) {
  const { evaluate, sleep } = c;
  const L = 'how en 1440';
  const until = (js, ms = 15000) => evaluate(`(async () => { for (let t = 0; t < ${ms / 100}; t++) { if (${js}) return true; await new Promise((r) => setTimeout(r, 100)); } return false; })()`);
  const out = [];
  // the live figures: each goes live and ripples under a stroke
  for (const id of ['hero', 'mask-on', 'mask-off', 'sleep']) {
    await evaluate(`document.querySelector('.stage[data-silk="${id}"]').scrollIntoView({ block: 'center' })`);
    const mode = await evaluate(`window.__how.activate('${id}').then((h) => h.mode)`);
    const d = await ripples(c, `document.querySelector('.stage[data-silk="${id}"]')`);
    expect(c, L, mode === 'webgl' && d > 0.3, `${id}: ${mode}, stroke Δ ${d.toFixed(2)}`);
    out.push(`${id} Δ ${d.toFixed(1)}`);
  }
  // figures 1 and 2: drawn on the page, redrawn for another subject
  for (const [fig, first, next] of [['fig-dome', 'portrait', 'hare'], ['fig-light', 'moon', 'pomegranate']]) {
    await evaluate(`document.getElementById('${fig}').scrollIntoView({ block: 'center' })`);
    const a = await until(`document.getElementById('${fig}').dataset.ready === '${first}'`);
    await evaluate(`(() => { const i = document.querySelector('#${fig} input[value="${next}"]'); i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); i.click(); })()`);
    const b = await until(`document.getElementById('${fig}').dataset.ready === '${next}'`);
    expect(c, L, a && b, `${fig}: drawn ${a}, redrawn for ${next} ${b}`);
  }
  // figure 4: Drop moves the field
  await evaluate(`document.getElementById('fig-waves').scrollIntoView({ block: 'center' })`);
  await sleep(400);
  await evaluate(`document.querySelector('#fig-waves button.drop').click()`);
  await sleep(300);
  const energy = +(await evaluate(`document.getElementById('fig-waves').dataset.energy`));
  expect(c, L, energy > 0.01, `figure 4: energy ${energy} after Drop`);
  // figure 3: one button, both hares
  await evaluate(`document.getElementById('fig-silk').scrollIntoView({ block: 'center' })`);
  const s0 = await evaluate(`Promise.all(['mask-on', 'mask-off'].map((id) => window.__how.activate(id).then((h) => h.stats()).then((s) => s.steps)))`);
  await evaluate(`document.querySelector('button.drop-both').click()`);
  await sleep(800);
  const s1 = await evaluate(`Promise.all(['mask-on', 'mask-off'].map((id) => window.__how.live.get(id)?.handle.stats().then((s) => s.steps)))`);
  expect(c, L, s1.every((s, i) => s > s0[i]), `figure 3: solver steps ${s0} → ${s1} after the button`);
  // figure 5: the teapot's meter wakes when it is touched
  await evaluate(`document.querySelector('.stage[data-silk="sleep"]').scrollIntoView({ block: 'center' })`);
  await evaluate(`window.__how.activate('sleep').then((h) => h.ripple(0.45, 0.55, { hold: 300 }))`);
  const awake = await until(`document.querySelector('.meter').dataset.mode === 'active'`, 3500);
  expect(c, L, awake, `figure 5: the meter says ${await evaluate(`document.querySelector('.meter').dataset.mode`)}`);
  // figure 7: the live-HTML card prints (only where this Chrome has HTML-in-Canvas)
  await evaluate(`document.getElementById('fig-html').scrollIntoView({ block: 'center' })`);
  const card = await evaluate(`window.__how.activate('html').then(async (h) => { if (h.mode !== 'webgl') return { mode: h.mode };
    for (let t = 0; t < 40 && !(await h.stats()).snapshots; t++) await new Promise((r) => setTimeout(r, 100)); return { mode: h.mode, snapshots: (await h.stats()).snapshots }; })`);
  const hic = await evaluate(`!document.documentElement.classList.contains('no-hic')`);
  expect(c, L, hic ? card.mode === 'webgl' && card.snapshots >= 1 : card.mode === 'static', `figure 7: ${JSON.stringify(card)} (HTML-in-Canvas ${hic})`);
  return `${out.join(', ')}; figures 1, 2 redrawn; figure 4 energy ${energy.toFixed(2)}; figure 3 both stepped; teapot awake; card ${card.mode}${card.snapshots ? ` ×${card.snapshots}` : ''}`;
}

/* ============================================
 * Use cases: examples/demos/*.html (hooks: window.__demo { ids, stageOf, activate?, release?, state, posterOf? })
 * ============================================ */
async function checkDemos(c) {
  const { evaluate } = c;
  const pages = (await readdir(path.join(ROOT, 'examples/demos'))).filter((f) => f.endsWith('.html') && !f.startsWith('_')).sort();
  const live = `(() => { const s = window.__demo.state(); return Array.isArray(s) ? s.length : s ? 1 : 0; })()`;
  for (const p of pages) {
    const file = `examples/demos/${p}`, name = p.replace('.html', '');
    await scope(c, `${name} 1440`, async () => {
      await open(c, file);
      const ids = await evaluate('window.__demo.ids');
      const out = [];
      let most = 0;
      for (const id of ids) {
        // a hook to mount it now if the page has one; otherwise it mounts on its own once the page is idle
        const mode = await evaluate(`(async () => { const d = window.__demo;
          if (d.activate) return (await d.activate('${id}')).mode;
          for (let t = 0; t < 100; t++) { const s = d.state(); if (s && s.mode !== 'loading') return s.mode; await new Promise((r) => setTimeout(r, 100)); }
          return 'not mounted'; })()`);
        const d = await ripples(c, `window.__demo.stageOf('${id}')`, ids.length > 3 ? 600 : 900);
        most = Math.max(most, await evaluate(live));
        expect(c, `${name} 1440`, mode === 'webgl' && d > 0.3, `${id}: ${mode}, stroke Δ ${d.toFixed(2)}`);
        out.push(`${id} Δ ${d.toFixed(1)}`);
      }
      expect(c, `${name} 1440`, most <= 3, `${most} live at once (cap 3)`);
      return `${out.join(', ')}; at most ${most} live`;
    });
    await scope(c, `${name} 375`, async () => {
      await open(c, file, { phone: true });
      await c.sleep(400);
      const x = await overflow(c);
      expect(c, `${name} 375`, x <= 0, `${x} px of sideways scroll`);
      return `touch, ${x} px sideways`;
    });
    await scope(c, `${name} reduced motion`, async () => {
      await open(c, file, { reduced: true });
      await c.sleep(1500);   // past the idle mount the other tiers do
      const s = await evaluate(`({ canvases: document.querySelectorAll('canvas').length, live: ${live} })`);
      const three = await threeFetched(c);
      expect(c, `${name} reduced motion`, !s.canvases && !s.live && !three, `${s.canvases} canvas(es), ${s.live} mounted, three.js fetched ${three}`);
      return `${s.canvases} canvases, ${s.live} mounted, three.js ${three ? 'FETCHED' : 'not fetched'}`;
    });
  }
}

/* ============================================
 * Words: examples/text.html (the handle is window.silk)
 * ============================================ */
async function checkText(c) {
  const { evaluate } = c;
  await scope(c, 'text 1440', async () => {
    await open(c, 'examples/text.html');
    const h = await evaluate(`new Promise((r) => { const t = setInterval(() => window.silk && (clearInterval(t), r(window.silk.ready)), 50); })
      .then((h) => ({ mode: h.mode, thread: h.thread, tier: h.tier }))`);
    const d = await ripples(c, `document.getElementById('silk')`);
    expect(c, 'text 1440', h.mode === 'webgl' && d > 0.3, `${h.mode}, stroke Δ ${d.toFixed(2)}`);
    return `${h.mode} ${h.tier}/${h.thread}, stroke Δ ${d.toFixed(2)}`;
  });
  await scope(c, 'text 375', async () => {
    await open(c, 'examples/text.html', { phone: true });
    await evaluate(`new Promise((r) => { const t = setInterval(() => window.silk && (clearInterval(t), r(window.silk.ready)), 50); })`);
    const x = await overflow(c);
    expect(c, 'text 375', x <= 0, `${x} px of sideways scroll`);
    return `touch, ${x} px sideways`;
  });
  await scope(c, 'text reduced motion', async () => {
    await open(c, 'examples/text.html', { reduced: true });
    const mode = await evaluate(`new Promise((r) => { const t = setInterval(() => window.silk && (clearInterval(t), r(window.silk.ready)), 50); }).then((h) => h.mode)`);
    expect(c, 'text reduced motion', mode === 'static', `mode ${mode}`);
    return `mode ${mode}`;
  });
}

/* ============================================
 * examples/button.html, when it exists: it loads clean in every setting (its own behaviour is its own page's business)
 * ============================================ */
async function checkButton(c) {
  for (const [label, o] of [['button 1440', {}], ['button 375', { phone: true }], ['button reduced motion', { reduced: true }]]) {
    await scope(c, label, async () => {
      await open(c, 'examples/button.html', o);
      await c.sleep(1500);
      const x = await overflow(c);
      expect(c, label, x <= 0, `${x} px of sideways scroll`);
      return `${x} px sideways`;
    });
  }
}

/* ============================================
 * Contrast: text on a plain colour, light and dark (the stages' gradients and pictures are not measured)
 * ============================================ */
const CONTRAST_PAGES = ['examples/index.html', 'examples/lab.html', 'examples/how-it-works.html', 'examples/how-it-works.zh.html',
  'examples/text.html', 'examples/button.html', 'examples/live.html'];
const CONTRAST = `(() => {
  const rgb = (c) => {   // 'rgb(a)(…)', or 'color(srgb r g b / a)' (what color-mix() computes to), channels 0–1
    const k = c.startsWith('color(') ? 255 : 1, m = c.replace('color(srgb', '').match(/[\\d.]+/g)?.map(Number) || [0, 0, 0, 0];
    return { r: m[0] * k, g: m[1] * k, b: m[2] * k, a: m.length > 3 ? m[3] : 1 };
  };
  const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(el), box = el.getBoundingClientRect();
    if (!box.width || cs.visibility === 'hidden' || +cs.opacity === 0 || el.closest('[hidden], [aria-hidden="true"], canvas, .stage, svg')) continue;
    let bg = null, fade = 1;
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      fade *= +s.opacity;
      if (s.backgroundImage !== 'none') { bg = 'image'; break; }
      const b = rgb(s.backgroundColor);
      if (b.a > 0) { bg = bg ? over(bg, b) : b; if (bg.a >= 1 || b.a >= 1) break; }
    }
    if (bg === 'image' || fade < 1) continue;
    bg = bg && bg.a >= 1 ? bg : over(bg || { r: 0, g: 0, b: 0, a: 0 }, rgb(getComputedStyle(document.documentElement).backgroundColor).a ? rgb(getComputedStyle(document.documentElement).backgroundColor) : { r: 255, g: 255, b: 255, a: 1 });
    const fg = over(rgb(cs.color), bg), [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a), ratio = (l1 + 0.05) / (l2 + 0.05);
    const px = parseFloat(cs.fontSize), large = px >= 24 || (px >= 18.66 && +cs.fontWeight >= 700);
    if (ratio < (large ? 3 : 4.5) - 0.005) bad.push(el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') + ' ' + ratio.toFixed(2) + ' "' + el.textContent.trim().slice(0, 24) + '"');
  }
  return bad;
})()`;
async function checkContrast(c) {
  for (const scheme of ['light', 'dark']) {
    await scope(c, `contrast ${scheme}`, async () => {
      const out = [];
      for (const file of CONTRAST_PAGES) {
        await open(c, file);
        await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
        await c.sleep(300);
        const bad = await c.evaluate(CONTRAST);
        expect(c, `contrast ${scheme}`, !bad.length, `${file}: ${bad.slice(0, 6).join('; ')}`);
        out.push(`${file.replace('examples/', '')} ${bad.length}`);
      }
      return `below AA: ${out.join(', ')}`;
    });
  }
}
