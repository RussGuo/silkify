#!/usr/bin/env node
/**
 * shoot.mjs — render the gallery in headless Chrome and take real screenshots.
 *
 *   node scripts/shoot.mjs                 # all cards → docs/shots/<id>-rest.jpg and <id>-ripple.gif
 *   node scripts/shoot.mjs --only moon     # one card
 *   CHROME=/path/to/chrome node scripts/shoot.mjs
 *
 * For every card: one JPEG at rest, then a GIF of a pointer stroke, a short press and the ripples decaying.
 * The GIFs are frame-stepped (3 simulation steps per GIF frame at 20 fps), so they play at real 60 fps
 * timing however slow the software GPU is. Needs ffmpeg on PATH for the GIFs.
 * Exits non-zero on any console error, uncaught exception, or a card that did not mount with WebGL.
 * No dependencies: a tiny static server, Chrome's DevTools protocol over Node's built-in WebSocket.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs', 'shots');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const CHROME = process.env.CHROME || {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: 'google-chrome',
  win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
}[process.platform];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- static server for the repo root ---- */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css', '.md': 'text/plain' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

/* ---- Chrome ---- */
const profile = await mkdtemp(path.join(tmpdir(), 'silkify-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  chrome.stderr.on('data', (d) => {
    buf += d;
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) resolve(m[1]);
  });
  chrome.on('exit', (c) => reject(new Error(`chrome exited (${c})`)));
});
const port = new URL(wsUrl).port;
const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');

/* ---- DevTools protocol ---- */
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map(), listeners = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  } else if (msg.method) {
    (listeners.get(msg.method) || []).forEach((fn) => fn(msg.params));
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const on = (method, fn) => listeners.set(method, [...(listeners.get(method) || []), fn]);
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

const problems = [];
on('Runtime.exceptionThrown', (p) => problems.push(`exception: ${p.exceptionDetails.exception?.description || p.exceptionDetails.text}`));
on('Runtime.consoleAPICalled', (p) => {
  if (p.type === 'error' || p.type === 'warning') problems.push(`console.${p.type}: ${p.args.map((a) => a.value ?? a.description).join(' ')}`);
});
on('Log.entryAdded', (p) => { if (p.entry.level === 'error') problems.push(`log: ${p.entry.text} ${p.entry.url || ''}`); });

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'none', ...extra });
const frames = (n) => evaluate(`new Promise((r) => { let k = ${n}; const f = () => (--k ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); })`);
await mkdir(OUT, { recursive: true });

async function load(dpr) {
  await send('Emulation.setDeviceMetricsOverride', { width: 1240, height: 900, deviceScaleFactor: dpr, mobile: false });
  const loaded = new Promise((r) => on('Page.loadEventFired', r));
  await send('Page.navigate', { url: `${base}/examples/` });
  await loaded;
  const modes = await evaluate('window.__silkReady');
  for (const m of modes) if (m.mode !== 'webgl') problems.push(`card ${m.id} mounted as ${m.mode}`);
  return modes;
}
async function rectOf(id) {
  return evaluate(`(() => {
    const fig = document.querySelector('figure[data-id="${id}"]');
    fig.scrollIntoView({ block: 'center' });
    const s = fig.querySelector('.stage').getBoundingClientRect();
    return { x: s.left, y: s.top, w: s.width, h: s.height, sx: scrollX, sy: scrollY };
  })()`);
}
const clipOf = (r, scale) => ({ x: r.x + r.sx, y: r.y + r.sy, width: r.w, height: r.h, scale });

// ---- rest: every object untouched, pointer parked in a corner (DPR 2, JPEG) ----
const modes = await load(2);
console.log('mounted:', modes.map((m) => `${m.id}=${m.mode}`).join(' '));
const ids = modes.map((m) => m.id).filter((id) => !only || id === only);
await mouse('mouseMoved', 2, 2);
for (const id of ids) {
  const r = await rectOf(id);
  await sleep(400);
  await frames(6);
  const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 86, clip: clipOf(r, 0.8) });
  await writeFile(path.join(OUT, `${id}-rest.jpg`), Buffer.from(data, 'base64'));
  console.log('rest  ', `docs/shots/${id}-rest.jpg`);
}

// ---- ripple: a GIF per object. The simulation advances one step per animation frame, so instead of
//      recording wall-clock time (SwiftShader is far below 60 fps) we step it: per GIF frame, move the
//      pointer, let exactly STEPS frames run, capture. 3 steps per frame at 20 fps = real 60 fps timing ----
const FPS = 20, STEPS = 3, TOTAL = 56;            // 2.8 s
const GIF_BUDGET = 1.5 * 1024 * 1024;
const STROKE = [4, 26], PRESS = [24, 30];         // frame ranges: stroke across, then a short press at its end
for (const id of ids) {
  await load(1);
  const strokeSpec = await evaluate(`(() => {
    // record one object alone: the others would only slow the software GPU down
    for (const h of window.__silk) if (h.canvas.closest('figure').dataset.id !== '${id}') { h.dispose(); h.canvas.closest('figure').remove(); }
    return document.querySelector('figure[data-id="${id}"] canvas').dataset.stroke || '';
  })()`);
  const [fx0, fy0, fx1, fy1] = (strokeSpec || '0.28,0.40,0.70,0.58').split(',').map(Number);
  await mouse('mouseMoved', 2, 2);
  const r = await rectOf(id);
  await frames(10);
  const dir = await mkdtemp(path.join(tmpdir(), `silkify-${id}-`));
  for (let f = 0; f < TOTAL; f++) {
    const t = Math.min(1, Math.max(0, (f - STROKE[0]) / (STROKE[1] - STROKE[0])));
    const x = r.x + r.w * (fx0 + (fx1 - fx0) * t);
    const y = r.y + r.h * (fy0 + (fy1 - fy0) * t + 0.05 * Math.sin(t * Math.PI * 2));
    if (f >= STROKE[0] && f <= PRESS[1]) await mouse('mouseMoved', x, y);
    if (f === PRESS[0]) await mouse('mousePressed', x, y, { button: 'left', clickCount: 1 });
    if (f === PRESS[1]) await mouse('mouseReleased', x, y, { button: 'left', clickCount: 1 });
    if (f === PRESS[1] + 1) await mouse('mouseMoved', 2, 2);   // pointer leaves; the ripples decay
    await frames(STEPS);
    const { data } = await send('Page.captureScreenshot', { format: 'png', clip: clipOf(r, 1) });
    await writeFile(path.join(dir, `f${String(f).padStart(3, '0')}.png`), Buffer.from(data, 'base64'));
  }
  // encode with an optimised palette; step width and colours down until it fits the size budget
  const gif = path.join(OUT, `${id}-ripple.gif`);
  for (const [width, colors] of [[320, 128], [288, 128], [288, 96], [256, 96], [240, 64]]) {
    await new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'f%03d.png'),
        '-vf', `scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
        '-loop', '0', gif], { stdio: 'inherit' });
      ff.on('exit', (c) => (c ? reject(new Error(`ffmpeg exited ${c}`)) : resolve()));
    });
    if ((await stat(gif)).size <= GIF_BUDGET) break;
  }
  await rm(dir, { recursive: true, force: true });
  console.log('ripple', `docs/shots/${id}-ripple.gif`, `${((await stat(gif)).size / 1024).toFixed(0)} KB`);
}

ws.close();
chrome.kill();
server.close();
await rm(profile, { recursive: true, force: true }).catch(() => {});

if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n  ` + problems.join('\n  '));
  process.exit(1);
}
console.log('\nconsole clean: 0 errors, 0 warnings');
