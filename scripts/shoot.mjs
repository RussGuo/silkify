#!/usr/bin/env node
/**
 * shoot.mjs — render the gallery in headless Chrome and take real screenshots.
 *
 *   node scripts/shoot.mjs                 # verify: rest JPEGs + every card goes live in its Worker and ripples
 *   node scripts/shoot.mjs --gif           # docs/shots/<id>-ripple.gif (needs ffmpeg)
 *   node scripts/shoot.mjs --posters       # examples/posters/<id>.webp and @2x (needs python3 + Pillow)
 *   node scripts/shoot.mjs --lab           # docs/shots/lab/: every material and feel preset, from examples/lab.html
 *   node scripts/shoot.mjs --cdn [ref]     # examples/cdn.html: silk.js from jsDelivr (default ref: the release tag)
 *   node scripts/shoot.mjs --only moon     # any mode, one card
 *   CHROME=/path/to/chrome node scripts/shoot.mjs
 *
 * verify   the gallery as a visitor gets it (auto tier): a JPEG of each poster at rest, then each card is
 *          activated, must mount with WebGL in its Web Worker, and must change under a pointer stroke.
 *          Then the Lab (low tier): presets switch, a dragged slider changes the frame through setTheme, the link
 *          restores every control in a fresh page, and at rest the renderer draws 0 frames in 10 s.
 * --gif    a stroke, a short press and the ripples decaying, 2.8 s. Recorded on the main thread (worker: false)
 *          and frame-stepped: 3 solver steps per GIF frame at 20 fps, so the timing is real 60 fps however slow
 *          the software GPU is. Palette-optimised and stepped down in size until each GIF is ≤ 1.5 MB.
 * --posters  the rest frames the gallery shows before anyone touches a card: high tier, no fill-light motion,
 *          transparent background, 400 px and 800 px, WebP q92 with lossless alpha.
 * --lab    one picture per preset on the pomegranate: material-<name>.jpg (at rest | just touched),
 *          material-rest-strip.jpg (every material untouched, side by side) and feel-<name>.jpg (0.15 s | 0.9 s
 *          after a stroke and a press), plus lab.jpg, the page itself, and lab-mobile.jpg at 375 px.
 * --cdn    examples/cdn.html with silk.js from jsDelivr at ref (default: the page's pinned tag): it must go live in
 *          its Web Worker across origins and ripple under a stroke. Needs the network.
 * Every mode exits non-zero on any console error, uncaught exception, or a card that did not mount as expected.
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
const TYPES = { '.webp': 'image/webp', '.gif': 'image/gif', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css', '.md': 'text/plain' };
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
const run = (cmd, argv) => new Promise((resolve, reject) => {
  const p = spawn(cmd, argv, { stdio: 'inherit' });
  p.on('exit', (c) => (c ? reject(new Error(`${cmd} exited ${c}`)) : resolve()));
});
const mode = args.includes('--gif') ? 'gif' : args.includes('--posters') ? 'posters' : args.includes('--lab') ? 'lab' : args.includes('--cdn') ? 'cdn' : 'verify';

/** Mean |Δ| per channel between two PNG/JPEG screenshots (base64), and the second one's contrast (std). */
async function diffOf(before, after) {
  const [fa, fb] = [path.join(profile, 'a.png'), path.join(profile, 'b.png')];
  await writeFile(fa, Buffer.from(before, 'base64'));
  await writeFile(fb, Buffer.from(after, 'base64'));
  return new Promise((resolve) => {
    const p = spawn('python3', ['-c', 'import sys; from PIL import Image, ImageChops, ImageStat; a=Image.open(sys.argv[1]).convert("RGB"); b=Image.open(sys.argv[2]).convert("RGB"); print(sum(ImageStat.Stat(ImageChops.difference(a,b)).mean)/3, sum(ImageStat.Stat(b).stddev)/3)', fa, fb]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('exit', () => resolve(out.trim().split(' ').map(Number)));
  });
}
async function navigate(url) {
  const loaded = new Promise((r) => on('Page.loadEventFired', r));
  await send('Page.navigate', { url });
  await loaded;
}
/* ---- the Lab: a state in the hash, as the page writes it (JSON → base64url) ---- */
async function openLab(query = '', state = null) {
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await navigate('about:blank');                     // a hash-only change would not load a new document
  await navigate(`${base}/examples/lab.html${query}${state ? '#' + Buffer.from(JSON.stringify(state)).toString('base64url') : ''}`);
  return evaluate(`window.__lab.ready().then((h) => ({ mode: h.mode, thread: h.thread, tier: h.tier }))`);
}
const labRow = (key) => `[...document.querySelectorAll('#controls .row')].find((r) => r.querySelector('label')?.textContent === '${key}')`;
const stageRect = () => evaluate(`(() => { const b = document.getElementById('stage').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, sx: 0, sy: 0 }; })()`);
const labStats = () => evaluate('window.__lab.handle.stats()');
async function touchStroke(r, press = true) {
  const at = await strokeOver(r, '0.32,0.42,0.66,0.56');
  let p;
  for (let f = 0; f <= 22; f++) { p = at(f, 22, [0, 22]); await mouse('mouseMoved', p.x, p.y); await sleep(30); }
  if (press) {
    await mouse('mousePressed', p.x, p.y, { button: 'left', clickCount: 1 });
    await sleep(250);
    await mouse('mouseReleased', p.x, p.y, { button: 'left', clickCount: 1 });
  }
  await mouse('mouseMoved', 2, 2);
}

async function load(dpr, query = '', width = 1240) {
  await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: dpr, mobile: false });
  const loaded = new Promise((r) => on('Page.loadEventFired', r));
  await send('Page.navigate', { url: `${base}/examples/${query}` });
  await loaded;
  return evaluate('window.__gallery.ids');
}
async function rectOf(id, sel = '.stage') {
  return evaluate(`(() => {
    const fig = document.querySelector('figure[data-id="${id}"]');
    fig.scrollIntoView({ block: 'center' });
    const s = fig.querySelector('${sel}').getBoundingClientRect();
    return { x: s.left, y: s.top, w: s.width, h: s.height, sx: scrollX, sy: scrollY };
  })()`);
}
const clipOf = (r, scale) => ({ x: r.x + r.sx, y: r.y + r.sy, width: r.w, height: r.h, scale });
async function activate(id, extra) {
  const h = await evaluate(`window.__gallery.activate('${id}', ${JSON.stringify(extra || {})})
    .then((h) => ({ mode: h.mode, thread: h.thread, tier: h.tier, info: h.info }))`);
  return h;
}
async function strokeOver(r, spec, perFrame) {
  const [fx0, fy0, fx1, fy1] = (spec || '0.28,0.40,0.70,0.58').split(',').map(Number);
  return (f, total, stroke, press) => {
    const t = Math.min(1, Math.max(0, (f - stroke[0]) / (stroke[1] - stroke[0])));
    return { x: r.x + r.w * (fx0 + (fx1 - fx0) * t), y: r.y + r.h * (fy0 + (fy1 - fy0) * t + 0.05 * Math.sin(t * Math.PI * 2)) };
  };
}

let ids;
if (mode === 'cdn') {
  /* ---- the CDN build: only silk.js's URL differs from the gallery; the worker must start across origins ---- */
  const ref = args[args.indexOf('--cdn') + 1];
  const query = ref && !ref.startsWith('--') ? `?ref=${encodeURIComponent(ref)}` : '';
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
  await navigate(`${base}/examples/cdn.html${query}`);
  const h = await evaluate(`new Promise((r) => { const t = setInterval(() => window.__cdn && (clearInterval(t), r()), 50); })
    .then(() => window.__cdn.ready).then((h) => ({ mode: h.mode, thread: h.thread, tier: h.tier, info: h.info }))`);
  const r = await evaluate(`(() => { const b = document.getElementById('pear').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, sx: 0, sy: 0 }; })()`);
  await sleep(1500);
  const before = (await send('Page.captureScreenshot', { format: 'png', clip: clipOf(r, 0.5) })).data;
  const at = await strokeOver(r);
  for (let f = 0; f <= 22; f++) { const { x, y } = at(f, 22, [0, 22]); await mouse('mouseMoved', x, y); await sleep(30); }
  await sleep(300);
  const [diff] = await diffOf(before, (await send('Page.captureScreenshot', { format: 'png', clip: clipOf(r, 0.5) })).data);
  const src = await evaluate(`performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/silk.js'))`);
  if (h.mode !== 'webgl' || h.thread !== 'worker' || !(diff > 0.3)) problems.push(`cdn: ${h.mode} on ${h.thread}, Δ ${diff.toFixed(2)}`);
  console.log('cdn   ', src);
  console.log('cdn   ', `${h.mode} ${h.tier}/${h.thread}`, `sim ${h.info?.sim}×${h.info?.steps} mesh ${h.info?.mesh}`, `Δ ${diff.toFixed(2)}`, diff > 0.3 ? 'ripples' : 'NO RIPPLE');
} else if (mode === 'posters') {
  /* ---- rest frames for the gallery: high tier, no fill-light motion, transparent ---- */
  const dir = path.join(ROOT, 'examples', 'posters');
  await mkdir(dir, { recursive: true });
  for (const [dpr, suffix] of [[1, ''], [2, '@2x']]) {
    ids = (await load(dpr, '?poster=1&tier=high', 1400)).filter((id) => !only || id === only);
    await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    for (const id of ids) {
      const h = await activate(id, { fillLight: false, idleSweep: false, interactive: false });
      if (h.mode !== 'webgl') problems.push(`poster ${id}: mounted as ${h.mode}`);
      const r = await rectOf(id, 'canvas');
      await sleep(500);                      // the canvas fades in over 0.25 s
      const { data } = await send('Page.captureScreenshot', { format: 'png', clip: clipOf(r, 1) });
      const png = path.join(profile, `${id}${suffix}.png`);
      await writeFile(png, Buffer.from(data, 'base64'));
      await run('python3', ['-c', 'import sys; from PIL import Image; Image.open(sys.argv[1]).save(sys.argv[2], "WEBP", quality=92, alpha_quality=100, method=6)',
        png, path.join(dir, `${id}${suffix}.webp`)]);
      console.log('poster', `examples/posters/${id}${suffix}.webp`, `${((await stat(path.join(dir, `${id}${suffix}.webp`))).size / 1024).toFixed(0)} KB`);
      await evaluate(`window.__gallery.release('${id}')`);
    }
  }
} else if (mode === 'lab') {
  /* ---- one picture per preset, made in the Lab: same object, same stroke, same timing ---- */
  const dir = path.join(OUT, 'lab');
  await mkdir(dir, { recursive: true });
  const { MATERIALS, FEELS } = await import('../src/presets.js');
  const state = (material, feel) => ({ obj: 'pomegranate', url: null, material, feel, bg: 'stage', set: {} });
  const grab = async (r) => {
    const side = Math.min(r.w, r.h) * 0.84;
    const clip = { x: r.x + (r.w - side) / 2, y: r.y + (r.h - side) / 2 + 10, width: side, height: side, scale: 1 };
    return (await send('Page.captureScreenshot', { format: 'png', clip })).data;
  };
  const pair = async (a, b, labels, file) => {
    const [fa, fb] = [path.join(profile, 'a.png'), path.join(profile, 'b.png')];
    await writeFile(fa, Buffer.from(a, 'base64'));
    await writeFile(fb, Buffer.from(b, 'base64'));
    await run('python3', ['-c', `import sys
from PIL import Image, ImageDraw
a, b = (Image.open(f).convert("RGB").resize((480, 480), Image.LANCZOS) for f in sys.argv[1:3])
s = Image.new("RGB", (968, 480), (235, 230, 220)); s.paste(a, (0, 0)); s.paste(b, (488, 0))
d = ImageDraw.Draw(s)
for x, t in ((12, sys.argv[3]), (500, sys.argv[4])): d.text((x, 456), t, fill=(122, 116, 106))
s.save(sys.argv[5], quality=86)`, fa, fb, ...labels, path.join(dir, file)]);
    console.log('lab   ', `docs/shots/lab/${file}`);
  };
  const rests = [];
  for (const m of Object.keys(MATERIALS)) {
    await openLab('', state(m, 'silk'));
    await sleep(800);
    const r = await stageRect();
    const rest = await grab(r);
    await touchStroke(r);
    await sleep(250);
    await pair(rest, await grab(r), [`material: '${m}' - at rest`, 'just touched'], `material-${m}.jpg`);
    const f = path.join(profile, `rest-${m}.png`);
    await writeFile(f, Buffer.from(rest, 'base64'));
    rests.push(m, f);
  }
  // every material untouched, side by side: the rest state alone has to tell them apart
  await run('python3', ['-c', `import sys
from PIL import Image, ImageDraw
args = sys.argv[2:]; names, files = args[0::2], args[1::2]; S = 300
s = Image.new("RGB", (S * len(files), S + 26), (235, 230, 220)); d = ImageDraw.Draw(s)
for i, (n, f) in enumerate(zip(names, files)):
  s.paste(Image.open(f).convert("RGB").resize((S, S), Image.LANCZOS), (i * S, 0)); d.text((i * S + 10, S + 7), n, fill=(122, 116, 106))
s.save(sys.argv[1], quality=88)`, path.join(dir, 'material-rest-strip.jpg'), ...rests]);
  console.log('lab   ', 'docs/shots/lab/material-rest-strip.jpg');
  for (const f of Object.keys(FEELS)) {
    await openLab('', state('silk', f));
    await sleep(800);
    const r = await stageRect();
    await touchStroke(r);
    await sleep(150);
    const early = await grab(r);
    await sleep(750);
    await pair(early, await grab(r), [`feel: '${f}' - 0.15 s after a stroke and a press`, '0.9 s'], `feel-${f}.jpg`);
  }
  await openLab('', { ...state('foil', 'water'), obj: 'teapot', set: { puff: 'cushion' } });
  await sleep(800);
  await touchStroke(await stageRect());
  await sleep(300);
  await writeFile(path.join(dir, 'lab.jpg'), Buffer.from((await send('Page.captureScreenshot', { format: 'jpeg', quality: 84 })).data, 'base64'));
  console.log('lab   ', 'docs/shots/lab/lab.jpg');
  // the Lab on a phone: 375 px, the controls folded under the stage
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await navigate('about:blank');
  await navigate(`${base}/examples/lab.html#${Buffer.from(JSON.stringify(state('satin', 'water'))).toString('base64url')}`);
  await evaluate('window.__lab.ready()');
  await evaluate(`document.getElementById('touch').click()`);
  await sleep(700);
  await writeFile(path.join(dir, 'lab-mobile.jpg'), Buffer.from((await send('Page.captureScreenshot', { format: 'jpeg', quality: 80 })).data, 'base64'));
  console.log('lab   ', 'docs/shots/lab/lab-mobile.jpg');
} else if (mode === 'gif') {
  /* ---- ripple GIFs: main thread, frame-stepped ---- */
  const FPS = 20, STEPS = 3, TOTAL = 56;            // 2.8 s
  const STROKE = [4, 26], PRESS = [24, 30];         // frame ranges: stroke across, then a short press at its end
  const GIF_BUDGET = 1.5 * 1024 * 1024;
  ids = (await load(1, '?tier=high')).filter((id) => !only || id === only);
  for (const id of ids) {
    await load(1, '?tier=high');
    await mouse('mouseMoved', 2, 2);
    const h = await activate(id, { worker: false });
    if (h.mode !== 'webgl') problems.push(`gif ${id}: mounted as ${h.mode}`);
    const r = await rectOf(id);
    const at = await strokeOver(r, await evaluate(`window.__gallery.stroke('${id}')`));
    await frames(10);
    const dir = await mkdtemp(path.join(tmpdir(), `silkify-${id}-`));
    for (let f = 0; f < TOTAL; f++) {
      const { x, y } = at(f, TOTAL, STROKE, PRESS);
      if (f >= STROKE[0] && f <= PRESS[1]) await mouse('mouseMoved', x, y);
      if (f === PRESS[0]) await mouse('mousePressed', x, y, { button: 'left', clickCount: 1 });
      if (f === PRESS[1]) await mouse('mouseReleased', x, y, { button: 'left', clickCount: 1 });
      if (f === PRESS[1] + 1) await mouse('mouseMoved', 2, 2);   // pointer leaves; the ripples decay
      await frames(STEPS);
      const { data } = await send('Page.captureScreenshot', { format: 'png', clip: clipOf(r, 1) });
      await writeFile(path.join(dir, `f${String(f).padStart(3, '0')}.png`), Buffer.from(data, 'base64'));
    }
    const gif = path.join(OUT, `${id}-ripple.gif`);
    for (const [width, colors] of [[320, 128], [288, 128], [288, 96], [256, 96], [240, 64]]) {
      await run('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'f%03d.png'),
        '-vf', `scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
        '-loop', '0', gif]);
      if ((await stat(gif)).size <= GIF_BUDGET) break;
    }
    await rm(dir, { recursive: true, force: true });
    console.log('ripple', `docs/shots/${id}-ripple.gif`, `${((await stat(gif)).size / 1024).toFixed(0)} KB`);
  }
} else {
  /* ---- verify: posters at rest (JPEG), then each card live in its Worker, and it must ripple ---- */
  await mkdir(OUT, { recursive: true });
  ids = (await load(2)).filter((id) => !only || id === only);
  await mouse('mouseMoved', 2, 2);
  for (const id of ids) {
    const r = await rectOf(id);
    await evaluate(`(() => { const i = document.querySelector('figure[data-id="${id}"] .poster'); i.loading = 'eager'; return i.decode(); })()`);
    await sleep(200);
    const { data } = await send('Page.captureScreenshot', { format: 'jpeg', quality: 86, clip: clipOf(r, 0.8) });
    await writeFile(path.join(OUT, `${id}-rest.jpg`), Buffer.from(data, 'base64'));
    console.log('rest  ', `docs/shots/${id}-rest.jpg`);
  }
  for (const id of ids) {
    let r = await rectOf(id);
    await mouse('mouseMoved', r.x + r.w / 2, r.y + r.h / 2);           // pointerenter mounts the live renderer
    const h = await evaluate(`window.__gallery.activate('${id}').then((h) => ({ mode: h.mode, thread: h.thread, tier: h.tier, info: h.info }))`);
    if (h.mode !== 'webgl' || h.thread !== 'worker') problems.push(`card ${id}: ${h.mode} on ${h.thread}`);
    await mouse('mouseMoved', 2, 2);
    await sleep(1500);
    r = await rectOf(id);
    const before = (await send('Page.captureScreenshot', { format: 'png', clip: clipOf(r, 0.5) })).data;
    const at = await strokeOver(r, await evaluate(`window.__gallery.stroke('${id}')`));
    for (let f = 0; f <= 22; f++) {
      const { x, y } = at(f, 22, [0, 22]);
      await mouse('mouseMoved', x, y);
      await sleep(30);
    }
    await sleep(300);
    const after = (await send('Page.captureScreenshot', { format: 'png', clip: clipOf(r, 0.5) })).data;
    // the stroke must visibly change the object (mean |Δ| per channel), and the object must have real content (std)
    const [diff, std] = await diffOf(before, after);
    const ok = diff > 0.3 && std > 12;
    if (!ok) problems.push(`card ${id}: no visible ripple (mean diff ${diff?.toFixed(2)}, std ${std?.toFixed(1)})`);
    console.log('live  ', id, `${h.tier}/${h.thread}`, `sim ${h.info?.sim}×${h.info?.steps} mesh ${h.info?.mesh}`, h.info?.software ? 'software' : '',
      `Δ ${diff.toFixed(2)} std ${std.toFixed(1)}`, ok ? 'ripples' : 'NO RIPPLE');
    await mouse('mouseMoved', 2, 2);
  }
  const alive = await evaluate('window.__gallery.live.size');
  console.log('live renderers at the end:', alive);
  if (alive > 3) problems.push(`${alive} live renderers (cap is 3)`);
  if (!only) await verifyLab();
}

/* ---- verify, part 2: the Lab in the low tier ---- */
async function verifyLab() {
  const h = await openLab('?tier=low');
  if (h.mode !== 'webgl' || h.tier !== 'low') problems.push(`lab: ${h.mode} / ${h.tier}`);
  for (const [field, value] of [['material', 'foil'], ['feel', 'water'], ['material', 'velvet'], ['feel', 'jelly'], ['material', 'ink']]) {
    await evaluate(`(() => { const s = ${labRow(field)}.querySelector('select'); s.value = '${value}'; s.dispatchEvent(new Event('change')); })()`);
    await sleep(300);
  }
  const st = await evaluate('window.__lab.state');
  if (st.material !== 'ink' || st.feel !== 'jelly') problems.push(`lab: presets did not switch (${st.material} / ${st.feel})`);

  // drag the exposure slider: setTheme must reach the renderer and change the frame
  const r = await stageRect();
  const before = (await send('Page.captureScreenshot', { format: 'png', clip: clipOf(r, 0.5) })).data;
  const s = await evaluate(`(() => { const i = ${labRow('exposure')}.querySelector('input[type=range]'); i.scrollIntoView({ block: 'center' });
    const b = i.getBoundingClientRect(); return { x: b.left, y: b.top + b.height / 2, w: b.width }; })()`);
  await mouse('mousePressed', s.x + s.w * 0.15, s.y, { button: 'left', clickCount: 1 });
  for (let k = 1; k <= 8; k++) { await mouse('mouseMoved', s.x + s.w * (0.15 + 0.08 * k), s.y, { button: 'left', buttons: 1 }); await sleep(40); }
  await mouse('mouseReleased', s.x + s.w * 0.79, s.y, { button: 'left', clickCount: 1 });
  await sleep(600);
  const after = (await send('Page.captureScreenshot', { format: 'png', clip: clipOf(r, 0.5) })).data;
  const [diff] = await diffOf(before, after);
  const exposure = await evaluate('window.__lab.state.set.exposure');
  if (!(diff > 1) || !(exposure > 1.5)) problems.push(`lab: slider → setTheme did not change the frame (Δ ${diff.toFixed(2)}, exposure ${exposure})`);
  console.log('lab   ', `${h.tier}/${h.thread}`, `presets ${st.material} + ${st.feel}`, `slider exposure → ${exposure}, Δ ${diff.toFixed(2)}`);

  // Touch and Stroke (handle.ripple) move the object without a pointer; holding Compare shows the defaults and lets go
  const shot = async () => (await send('Page.captureScreenshot', { format: 'png', clip: clipOf(r, 0.5) })).data;
  await sleep(1500);
  for (const id of ['touch', 'stroke']) {
    const a0 = await shot();
    await evaluate(`document.getElementById('${id}').click()`);
    await sleep(id === 'stroke' ? 700 : 350);
    const [d] = await diffOf(a0, await shot());
    if (!(d > 0.3)) problems.push(`lab: the ${id} button did not move the object (Δ ${d.toFixed(2)})`);
    console.log('lab   ', `${id} button: Δ ${d.toFixed(2)}`);
  }
  await sleep(2500);
  const c0 = await shot();
  await evaluate('window.__lab.compare(true)');
  await sleep(400);
  const c1 = await shot();
  await evaluate('window.__lab.compare(false)');
  await sleep(400);
  const c2 = await shot();
  const [[dOn], [dOff]] = [await diffOf(c0, c1), await diffOf(c0, c2)];
  if (!(dOn > 1) || !(dOff < dOn / 3)) problems.push(`lab: compare did not switch to the defaults and back (Δ on ${dOn.toFixed(2)}, off ${dOff.toFixed(2)})`);
  console.log('lab   ', `compare: Δ ${dOn.toFixed(2)} while held, ${dOff.toFixed(2)} after`);

  // the link restores every control in a fresh page
  const snap = `JSON.stringify([...document.querySelectorAll('#controls input, #controls select')].map((i) => i.type === 'checkbox' ? i.checked : i.value)) + document.getElementById('code').textContent`;
  const [url, a] = [await evaluate('location.href'), await evaluate(snap)];
  await navigate('about:blank');
  await navigate(url);
  await evaluate('window.__lab.ready()');
  const b = await evaluate(snap);
  const n = await evaluate(`document.querySelectorAll('#controls input, #controls select').length`);
  if (a !== b) problems.push('lab: the link did not restore the controls');
  console.log('lab   ', `link round trip: ${n} controls`, a === b ? 'identical' : 'DIFFERENT');

  // breeze and autoplay off → the loop sleeps: 0 frames in 10 s once it reaches rest
  let mode = '';
  for (let t = 0; t < 40 && mode !== 'rest'; t++) { await sleep(1000); mode = (await labStats()).mode; }
  const f0 = (await labStats()).frames;
  await sleep(10000);
  const f1 = (await labStats()).frames;
  if (mode !== 'rest' || f1 !== f0) problems.push(`lab: ${f1 - f0} frames in 10 s at rest (mode ${mode})`);
  console.log('lab   ', `rest: ${f1 - f0} frames in 10 s`);
  // and breeze keeps it drawing
  await evaluate('window.__lab.handle.setTheme({ breeze: 0.6 })');
  await sleep(1000);
  const g0 = await labStats();
  await sleep(2000);
  const g1 = await labStats();
  if (g1.mode !== 'breeze' || g1.frames - g0.frames < 10) problems.push(`lab: breeze drew ${g1.frames - g0.frames} frames in 2 s (mode ${g1.mode})`);
  console.log('lab   ', `breeze 0.6: ${((g1.frames - g0.frames) / 2).toFixed(0)} fps, mode ${g1.mode}`);
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
