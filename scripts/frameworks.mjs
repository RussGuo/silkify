#!/usr/bin/env node
/**
 * frameworks.mjs — the React component from SKILL.md, built the way people build it: Vite dev and build, Next.js
 * dev and build (Turbopack, Next's default). Each must render in its Web Worker and survive what React does to it.
 *
 *   node scripts/frameworks.mjs                    # all four
 *   node scripts/frameworks.mjs vite-build next-dev
 *
 * It copies examples/react and examples/next (with src/ and two pictures, as their `npm run silk` does) into a
 * temporary folder, installs their pinned dependencies there (network), starts each server and drives the page in
 * Chrome through Playwright (see harness.mjs): mount, switch the picture three times, unmount, mount again. Every
 * mount must be mode 'webgl' on thread 'worker', ripple under a pointer stroke, and call the component's onPress prop
 * once for one press (the events reach React through the component); the console must stay clean.
 * Nothing is installed into the repository. CHROME=/path/to/chrome picks the browser (default: Playwright's).
 *
 * Then live HTML (SilkHtml: /?live in Vite, /live in Next.js): mount, switch to another card three times (a new
 * element each time), change the words in place (the card grows), unmount, mount again, all under StrictMode. In a
 * Chrome with HTML-in-Canvas every mount must be 'webgl' on 'worker' with the card inside the canvas, hit-tested 1:1
 * where it is drawn, and ripple; the words changed by React must reach the silk. In a Chrome without it, every mount
 * must leave the card in its stage as plain HTML. Either way the card must be back in the page after each unmount.
 */
import { spawn } from 'node:child_process';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { playwright } from './harness.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const MODES = {
  'vite-dev': { app: 'react', run: ['npx', 'vite', '--port', 'PORT', '--strictPort'] },
  'vite-build': { app: 'react', build: ['npx', 'vite', 'build'], run: ['npx', 'vite', 'preview', '--port', 'PORT', '--strictPort'] },
  'next-dev': { app: 'next', run: ['npx', 'next', 'dev', '--port', 'PORT'] },
  'next-build': { app: 'next', build: ['npx', 'next', 'build'], run: ['npx', 'next', 'start', '--port', 'PORT'] },
};
const pick = process.argv.slice(2).filter((a) => MODES[a]);
const modes = pick.length ? pick : Object.keys(MODES);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- a copy of the examples, laid out as in the repository, with their dependencies installed ---- */
const work = await mkdtemp(path.join(tmpdir(), 'silkify-frameworks-'));
const skip = (f) => !/node_modules|[/\\](dist|\.next|lib|public)$|[/\\]src[/\\]silk$/.test(f);
await cp(path.join(ROOT, 'src'), path.join(work, 'src'), { recursive: true });
await cp(path.join(ROOT, 'examples', 'images'), path.join(work, 'examples', 'images'), { recursive: true });
const run = (cmd, cwd, quiet = true) => new Promise((resolve, reject) => {
  const p = spawn(cmd[0], cmd.slice(1), { cwd, stdio: quiet ? 'ignore' : 'inherit' });
  p.on('exit', (c) => (c ? reject(new Error(`${cmd.join(' ')} exited ${c}`)) : resolve()));
});
for (const app of new Set(modes.map((m) => MODES[m].app))) {
  await cp(path.join(ROOT, 'examples', app), path.join(work, 'examples', app), { recursive: true, filter: skip });
  const dir = path.join(work, 'examples', app);
  console.log('setup ', `examples/${app}: npm install, npm run silk`);
  await run(['npm', 'install', '--no-audit', '--no-fund', '--loglevel=error'], dir, false);
  await run(['npm', 'run', 'silk'], dir);
}

/* ---- the page: mount, switch src three times, unmount, mount ---- */
const { chromium } = await playwright();
const browser = await chromium.launch({
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...(process.env.CI ? ['--no-sandbox'] : [])],
});
async function probe(url) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const noise = [];
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && noise.push(`console.${m.type()}: ${m.text().slice(0, 160)}`));
  page.on('pageerror', (e) => noise.push(`exception: ${e.message.slice(0, 160)}`));
  page.on('response', (r) => r.status() >= 400 && noise.push(`HTTP ${r.status()} ${r.url()}`));
  await page.goto(url);
  const steps = [];
  const mounted = async (label) => {
    await page.waitForFunction(() => window.__silk?.mode === 'webgl' && window.__silk.canvas.isConnected, null, { timeout: 60000 }).catch(() => {});
    const h = await page.evaluate(() => ({ mode: window.__silk?.mode, thread: window.__silk?.thread, canvases: document.querySelectorAll('canvas').length }));
    const box = await page.evaluate(() => { const r = window.__silk?.canvas.getBoundingClientRect(); return r && { x: r.x, y: r.y, width: r.width, height: r.height }; });
    let ripples = false, pressed = false;
    if (box?.width) {
      await sleep(800);
      const a = await page.screenshot({ clip: box });
      await page.mouse.move(box.x + 10, box.y + box.height * 0.35);
      await page.mouse.move(box.x + box.width - 10, box.y + box.height * 0.65, { steps: 20 });
      await sleep(150);
      ripples = !a.equals(await page.screenshot({ clip: box }));
      // the component's onPress prop hears a press (the page counts them in window.__presses)
      const p0 = await page.evaluate(() => window.__presses || 0);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.up();
      pressed = (await page.evaluate(() => window.__presses || 0)) === p0 + 1;
      await page.mouse.move(2, 2);
    }
    const ok = h.mode === 'webgl' && h.thread === 'worker' && h.canvases === 1 && ripples && pressed;
    steps.push(`${label} ${ok ? 'ok' : `FAIL (${h.mode}/${h.thread}, ${h.canvases} canvas, ${ripples ? 'ripples' : 'no ripple'}, ${pressed ? 'onPress' : 'no onPress'})`}`);
    return ok;
  };
  let ok = await mounted('mount');
  for (let i = 1; i <= 3; i++) {
    await page.evaluate(() => { window.__silk = null; });
    await page.click('#toggle');
    ok = (await mounted(`switch ${i}`)) && ok;
  }
  await page.click('#hide');
  await sleep(400);
  const gone = (await page.locator('canvas').count()) === 0 && (await page.locator('#toggle').count()) === 1;
  steps.push(`unmount ${gone ? 'ok' : 'FAIL'}`);
  await page.evaluate(() => { window.__silk = null; });
  await page.click('#hide');
  ok = (await mounted('remount')) && gone && ok;
  await page.close();
  return { ok: ok && !noise.length, steps, noise };
}

/* ---- live HTML: mount, switch the card three times, change its words, unmount, mount ---- */
async function probeLive(url) {
  const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
  const noise = [];
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && noise.push(`console.${m.type()}: ${m.text().slice(0, 160)}`));
  page.on('pageerror', (e) => noise.push(`exception: ${e.message.slice(0, 160)}`));
  page.on('response', (r) => r.status() >= 400 && noise.push(`HTTP ${r.status()} ${r.url()}`));
  await page.goto(url);
  const native = await page.evaluate(() => { const c = document.createElement('canvas'); c.setAttribute('content', 'drawable'); return c.content === 'drawable'; });
  const steps = [];
  const look = () => page.evaluate(() => {
    const h = window.__silk, e = h?.element, c = h?.canvas;
    if (!e) return null;
    const r = e.getBoundingClientRect(), cr = c.getBoundingClientRect(), t = document.getElementById('title').getBoundingClientRect();
    return {
      mode: h.mode, thread: h.thread, inCanvas: e.parentElement === c, canvases: c.parentElement?.querySelectorAll('canvas').length,
      off: Math.max(Math.abs(r.width - e.offsetWidth), Math.abs(r.left - (cr.left + (cr.width - e.offsetWidth) / 2)), Math.abs(r.top - (cr.top + (cr.height - e.offsetHeight) / 2))),
      hit: document.elementFromPoint(t.left + 10, t.top + t.height / 2)?.id, text: e.innerText,
    };
  });
  const mounted = async (label) => {
    await page.waitForFunction(() => window.__silk && window.__silk.mode !== 'loading' && window.__silk.canvas.isConnected, null, { timeout: 60000 }).catch(() => {});
    const h = await look();
    let ripples = !native;
    if (native && h) {
      const box = await page.evaluate(() => { const r = window.__silk.canvas.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
      await sleep(600);
      const a = await page.screenshot({ clip: box });
      await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.45);
      await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.55, { steps: 20 });
      await sleep(150);
      ripples = !a.equals(await page.screenshot({ clip: box }));
      await page.mouse.move(2, 2);
    }
    const ok = !!h && (native
      ? h.mode === 'webgl' && h.thread === 'worker' && h.inCanvas && h.canvases === 1 && h.off < 1 && h.hit === 'title' && ripples
      : h.mode === 'static' && !h.inCanvas && h.hit === 'title');
    steps.push(`${label} ${ok ? 'ok' : `FAIL (${JSON.stringify(h)}, ${ripples ? 'ripples' : 'no ripple'})`}`);
    return ok;
  };
  let ok = await mounted('mount');
  for (let i = 1; i <= 3; i++) {
    await page.evaluate(() => { window.__silk = null; });
    await page.click('#toggle');
    ok = (await mounted(`switch ${i}`)) && ok;
  }
  // the words change in place: React writes into the card while it is in the canvas; the silk must follow
  const s0 = native ? await page.evaluate(() => window.__silk.stats()) : null;
  await page.click('#words');
  await sleep(1200);
  const w = await look();
  const s1 = native ? await page.evaluate(() => window.__silk.stats()) : null;
  const wordsOk = /second sentence/.test(w?.text || '') && (native ? w.inCanvas && w.off < 1 && w.hit === 'title' && s1.snapshots > s0.snapshots : !w.inCanvas);
  steps.push(`words ${wordsOk ? 'ok' : `FAIL (${JSON.stringify(w)})`}`);
  await page.click('#hide');
  await sleep(400);
  const gone = (await page.locator('canvas').count()) === 0 && (await page.locator('#title').count()) === 0;
  steps.push(`unmount ${gone ? 'ok' : 'FAIL'}`);
  await page.evaluate(() => { window.__silk = null; });
  await page.click('#hide');
  ok = (await mounted('remount')) && wordsOk && gone && ok;
  await page.close();
  return { ok: ok && !noise.length, steps: [native ? 'HTML-in-Canvas' : 'no HTML-in-Canvas', ...steps], noise };
}

/* ---- each mode: (build), start, wait for it to answer, probe, stop ---- */
const failures = [];
let port = 5370;
for (const mode of modes) {
  const m = MODES[mode], dir = path.join(work, 'examples', m.app), p = String(++port);
  try {
    if (m.build) await run(m.build, dir);
    const server = spawn(m.run[0], m.run.slice(1).map((a) => (a === 'PORT' ? p : a)), { cwd: dir, stdio: 'ignore', detached: true });
    const url = `http://localhost:${p}/`;
    for (let t = 0; t < 120; t++) { if (await fetch(url).then((r) => r.ok, () => false)) break; await sleep(500); }
    const r = await probe(url);
    const l = await probeLive(m.app === 'next' ? `${url}live` : `${url}?live`);
    process.kill(-server.pid);
    console.log(`${mode.padEnd(11)}`, r.ok ? 'ok   ' : 'FAIL ', r.steps.join(' · '));
    for (const n of r.noise) console.log('           ', n);
    console.log(`${''.padEnd(11)}`, l.ok ? 'ok   ' : 'FAIL ', 'live HTML:', l.steps.join(' · '));
    for (const n of l.noise) console.log('           ', n);
    if (!r.ok || !l.ok) failures.push(mode);
  } catch (e) {
    console.log(`${mode.padEnd(11)}`, 'FAIL ', e.message);
    failures.push(mode);
  }
}
const version = browser.version();
await browser.close();
await rm(work, { recursive: true, force: true }).catch(() => {});
console.log(`\nChrome ${version} · ${modes.length - failures.length}/${modes.length} passed`);
if (failures.length) process.exit(1);
