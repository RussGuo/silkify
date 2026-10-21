#!/usr/bin/env node
/**
 * shoot.mjs — render the gallery in headless Chrome and take real screenshots.
 *
 *   node scripts/shoot.mjs                 # all cards → docs/shots/<id>-rest.jpg and <id>-ripple.jpg
 *   node scripts/shoot.mjs --only moon     # one card
 *   CHROME=/path/to/chrome node scripts/shoot.mjs
 *
 * For every card: one frame at rest, then a pointer stroke across the object and a frame mid-ripple.
 * Exits non-zero on any console error, uncaught exception, or a card that did not mount with WebGL.
 * No dependencies: a tiny static server, Chrome's DevTools protocol over Node's built-in WebSocket.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
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
await send('Emulation.setDeviceMetricsOverride', { width: 1240, height: 900, deviceScaleFactor: 2, mobile: false });
const loaded = new Promise((r) => on('Page.loadEventFired', r));
await send('Page.navigate', { url: `${base}/examples/` });
await loaded;
const modes = await evaluate('window.__silkReady');
console.log('mounted:', modes.map((m) => `${m.id}=${m.mode}`).join(' '));
for (const m of modes) if (m.mode !== 'webgl') problems.push(`card ${m.id} mounted as ${m.mode}`);

const mouse = (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'none', ...extra });
await mkdir(OUT, { recursive: true });

async function rectOf(id) {
  return evaluate(`(() => {
    const fig = document.querySelector('figure[data-id="${id}"]');
    fig.scrollIntoView({ block: 'center' });
    const s = fig.querySelector('.stage').getBoundingClientRect();
    return { x: s.left, y: s.top, w: s.width, h: s.height, sx: scrollX, sy: scrollY };
  })()`);
}
async function shot(id, suffix, r) {
  const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 86, clip: { x: r.x + r.sx, y: r.y + r.sy, width: r.w, height: r.h, scale: 0.8 } });
  const file = path.join(OUT, `${id}-${suffix}.jpg`);
  await writeFile(file, Buffer.from(data, 'base64'));
  return file;
}
const frames = (n) => evaluate(`new Promise((r) => { let k = ${n}; const f = () => (--k ? requestAnimationFrame(f) : r()); requestAnimationFrame(f); })`);

const ids = modes.map((m) => m.id).filter((id) => !only || id === only);

// pass 1: everything at rest (pointer parked in a corner, never touched)
await mouse('mouseMoved', 2, 2);
for (const id of ids) {
  const r = await rectOf(id);
  await sleep(400);
  await frames(6);
  console.log('rest  ', path.relative(ROOT, await shot(id, 'rest', r)));
}

// pass 2: a stroke across each object, a short press, then capture mid-ripple
const stroke = await evaluate('JSON.stringify(Object.fromEntries((window.__silk||[]).map((h,i)=>[h.canvas.closest("figure").dataset.id, h.canvas.dataset.stroke || ""])))').then(JSON.parse);
for (const id of ids) {
  const r = await rectOf(id);
  await sleep(300);
  const [fx0, fy0, fx1, fy1] = (stroke[id] || '0.28,0.40,0.70,0.58').split(',').map(Number);
  const steps = 26;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = r.x + r.w * (fx0 + (fx1 - fx0) * t);
    const y = r.y + r.h * (fy0 + (fy1 - fy0) * t + 0.05 * Math.sin(t * Math.PI * 2));
    await mouse('mouseMoved', x, y);
    await frames(1);
  }
  const px = r.x + r.w * fx1, py = r.y + r.h * fy1;
  await mouse('mousePressed', px, py, { button: 'left', clickCount: 1 });
  await frames(8);
  await mouse('mouseReleased', px, py, { button: 'left', clickCount: 1 });
  await frames(10);
  console.log('ripple', path.relative(ROOT, await shot(id, 'ripple', r)));
  await mouse('mouseMoved', 2, 2);
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
