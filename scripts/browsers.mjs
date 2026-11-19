#!/usr/bin/env node
/**
 * browsers.mjs — the checks that only another engine can fail: WebKit (Safari's engine) and Firefox.
 * Run it as `node scripts/shoot.mjs --browsers [webkit,firefox,chromium] [--ref <tag|branch|commit>]`.
 *
 * For each browser, through Playwright (see harness.mjs; not a dependency of this repository):
 *   edge     test/edge.html checks itself: SVG goes live, an empty or missing picture fails with a reason, calls made
 *            while loading are kept, display: none and dispose() settle `ready`.
 *   origin   examples/cdn.html with silk.js from a second origin (this repository served on another port, a stand-in
 *            CDN): it must start its Web Worker through the blob: trampoline, ripple under a pointer stroke, and its
 *            solver must take 60 steps a second whatever the browser's frame rate.
 *   cdn      with --ref: the same page with silk.js from jsDelivr at that ref (needs the ref on GitHub).
 *   live     live HTML where the browser has no HTML-in-Canvas: examples/live.html and the gallery's live-HTML card
 *            must stay plain HTML (mode 'static', the element where it was, readable, its link working), say so in
 *            one line, and log nothing. Where the browser has the feature, the card must go live instead.
 * chromium is optional (CHROME=/path picks an installed Chrome); shoot.mjs covers Chrome in depth over its own protocol.
 * The console must stay clean (no errors, no warnings) apart from the 404 that test/edge.html asks for on purpose.
 */
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { playwright, serve } from './harness.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const at = args.indexOf('--browsers');
const list = (at >= 0 && args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : 'webkit,firefox').split(',');
const ref = args.includes('--ref') ? args[args.indexOf('--ref') + 1] : null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || (await mkdtemp(path.join(tmpdir(), 'silkify-browsers-')));   // the gallery card as each browser shows it

const pw = await playwright();
const site = await serve(ROOT);
const cdn = await serve(ROOT, { cors: true });   // another port is another origin
const LAUNCH = {
  webkit: {},
  firefox: { firefoxUserPrefs: { 'webgl.force-enabled': true } },
  chromium: { ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...(process.env.CI ? ['--no-sandbox'] : [])] },
};

const problems = [];
for (const name of list) {
  const browser = await pw[name].launch(LAUNCH[name]);
  const tag = `${name} ${browser.version()}`;
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const noise = [];
  page.on('console', (m) => {
    if (!['error', 'warning'].includes(m.type())) return;
    if (/404/.test(m.text()) && /not-here\.png/.test(m.location()?.url || m.text())) return;   // asked for on purpose
    noise.push(`console.${m.type()}: ${m.text().slice(0, 200)}`);
  });
  page.on('pageerror', (e) => noise.push(`exception: ${e.message.slice(0, 200)}`));

  // ---- edge ----
  await page.goto(`${site.base}/test/edge.html`);
  const edge = await page.waitForFunction(() => window.__edge?.out, null, { timeout: 120000 }).then((h) => h.jsonValue());
  for (const p of edge.problems) problems.push(`${tag} edge: ${p}`);
  console.log(tag.padEnd(22), 'edge  ', `svg ${edge.svg.mode}/${edge.svg.thread}, empty ${edge.empty.mode}, 404 ${edge.missing.mode}, ${edge.problems.length} problem(s)`);

  // ---- origin, and cdn with --ref ----
  for (const [label, query] of [['origin', `silk=${encodeURIComponent(`${cdn.base}/src/silk.js`)}`], ...(ref ? [['cdn', `ref=${encodeURIComponent(ref)}`]] : [])]) {
    await page.goto(`${site.base}/examples/cdn.html?${query}`);
    const h = await page.waitForFunction(() => window.__cdn?.mode && window.__cdn.mode !== 'loading' && window.__cdn, null, { timeout: 120000 })
      .then(() => page.evaluate(() => ({ mode: __cdn.mode, thread: __cdn.thread, tier: __cdn.tier, reason: __cdn.reason })));
    const box = await page.evaluate(() => { const r = document.getElementById('pear').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
    await sleep(1200);
    const before = await page.screenshot({ clip: box });
    await page.mouse.move(box.x + box.width * 0.28, box.y + box.height * 0.4);
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.58, { steps: 22 });
    await sleep(300);
    const moved = !before.equals(await page.screenshot({ clip: box }));
    await page.mouse.move(1, 1);
    // The solver must step 60 times a second whatever the frame rate. A shared CI runner can stall for a moment
    // (the first measurement after a browser starts is the usual one), and a stalled frame is clamped, so one slow
    // sample says nothing about the solver: measure up to three times and keep the first that is in range.
    let fps = 0, sps = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const s0 = await page.evaluate(() => __cdn.stats());
      const t0 = Date.now();
      await page.evaluate(() => __cdn.ripple(0.5, 0.5));
      await sleep(2000);
      const s1 = await page.evaluate(() => __cdn.stats());
      const secs = (Date.now() - t0) / 1000;
      fps = (s1.frames - s0.frames) / secs; sps = (s1.steps - s0.steps) / secs;
      if (sps > 50 && sps < 70) break;
      console.log(tag.padEnd(22), label.padEnd(6), `sample ${attempt + 1}: ${fps.toFixed(0)} fps drawn, ${sps.toFixed(0)} solver steps/s, measuring again`);
    }
    const ok = h.mode === 'webgl' && h.thread === 'worker' && moved && sps > 50 && sps < 70;
    if (!ok) problems.push(`${tag} ${label}: ${h.mode}/${h.thread} (${h.reason}), ${moved ? 'ripples' : 'no ripple'}, ${sps.toFixed(0)} solver steps/s`);
    console.log(tag.padEnd(22), label.padEnd(6), `${h.mode} ${h.tier}/${h.thread}, ${moved ? 'ripples' : 'NO RIPPLE'}, ${fps.toFixed(0)} fps drawn, ${sps.toFixed(0)} solver steps/s`);
  }
  // ---- live HTML: the fallback is the element itself ----
  await page.goto(`${site.base}/examples/live.html`);
  const lv = await page.waitForFunction(() => window.silk?.mode && window.silk.mode !== 'loading' && window.silk, null, { timeout: 60000 })
    .then(() => page.evaluate(() => { const c = document.getElementById('card');
      return { mode: silk.mode, reason: silk.reason, parent: c.parentElement.className, h: c.offsetHeight, text: c.innerText.slice(0, 40),
        status: document.getElementById('status').textContent,
        native: (() => { const x = document.createElement('canvas'); x.setAttribute('content', 'drawable'); return x.content === 'drawable'; })() }; }));
  await page.click('#link');
  const followed = await page.evaluate(() => location.hash === '#followed');
  const liveOk = lv.native ? lv.mode === 'webgl' : lv.mode === 'static' && lv.parent === 'stage' && lv.h > 100 && /Pomegranate/.test(lv.text) && /^Plain HTML/.test(lv.status);
  if (!liveOk || !followed) problems.push(`${tag} live: ${JSON.stringify(lv)}, link ${followed}`);
  // the gallery's card: plain HTML with a one-line note, and still plain after someone reaches for it
  await page.goto(`${site.base}/examples/`);
  await page.locator('figure[data-id="html"]').scrollIntoViewIfNeeded();
  await page.hover('figure[data-id="html"] .stage');
  const card = await page.evaluate(() => window.__gallery.activate('html').then((h) => ({ mode: h.mode, parent: h.element.parentElement.className,
    note: document.getElementById('html-note').textContent })));
  const cardOk = lv.native ? card.mode === 'webgl' : card.mode === 'static' && /stage/.test(card.parent) && /plain HTML/.test(card.note);
  if (!cardOk) problems.push(`${tag} gallery card: ${JSON.stringify(card)}`);
  await page.screenshot({ path: path.join(SHOTS, `${name}-live.png`), fullPage: false, clip: await page.evaluate(() => {
    const r = document.querySelector('figure[data-id="html"]').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }) });
  console.log(tag.padEnd(22), 'live  ', `live.html ${lv.mode} (${lv.reason}), link ${followed ? 'works' : 'BROKEN'}; gallery card ${card.mode}: ${card.note}`);

  for (const n of noise) problems.push(`${tag} ${n}`);
  if (!noise.length) console.log(tag.padEnd(22), 'console clean');
  await browser.close();
}
site.close();
cdn.close();
console.log(`screenshots of the gallery's live-HTML card: ${SHOTS}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n  ` + problems.join('\n  '));
  process.exit(1);
}
