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
 * mount must be mode 'webgl' on thread 'worker', ripple under a pointer stroke, and the console must stay clean.
 * Nothing is installed into the repository. CHROME=/path/to/chrome picks the browser (default: Playwright's).
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
    let ripples = false;
    if (box?.width) {
      await sleep(800);
      const a = await page.screenshot({ clip: box });
      await page.mouse.move(box.x + 10, box.y + box.height * 0.35);
      await page.mouse.move(box.x + box.width - 10, box.y + box.height * 0.65, { steps: 20 });
      await sleep(150);
      ripples = !a.equals(await page.screenshot({ clip: box }));
      await page.mouse.move(2, 2);
    }
    const ok = h.mode === 'webgl' && h.thread === 'worker' && h.canvases === 1 && ripples;
    steps.push(`${label} ${ok ? 'ok' : `FAIL (${h.mode}/${h.thread}, ${h.canvases} canvas, ${ripples ? 'ripples' : 'no ripple'})`}`);
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
    process.kill(-server.pid);
    console.log(`${mode.padEnd(11)}`, r.ok ? 'ok   ' : 'FAIL ', r.steps.join(' · '));
    for (const n of r.noise) console.log('           ', n);
    if (!r.ok) failures.push(mode);
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
