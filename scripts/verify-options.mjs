/**
 * verify-options.mjs — shoot.mjs's checks of the options the use-case pages asked for, run in its Chrome
 * (`node scripts/shoot.mjs`, or `--only options` for these alone). A module of its own so shoot.mjs stays one readable
 * file; it gets shoot.mjs's DevTools helpers in `t` and adds what it finds to `t.problems`.
 *
 *   test/options.html   corner: 0 is a square, fit: 'cover' (also in the static tier, and the mistakes that throw), a
 *                       poster that is a canvas or a function, breezeIdle and no frames out of view (the page checks itself)
 *                       a sphere pressed hard near its limb and poles covers no pixel outside its rest outline (the
 *                       displacement runs along the line of sight; along the normal it pushed the limb out and opened
 *                       the poles into spikes: thousands of pixels)
 *                       a live 'y' is centred on its ink (its descender included), within 1 % of the canvas
 *   test/pool.html      pool(): at most `max` live, the least recently touched released, a pointer mounts, a scroll away
 *                       releases, dispose() lets the prewarmed worker go, the static tier mounts nothing (it checks itself)
 *   a screenshot        what the page cannot read back from a live canvas: fit: 'cover' leaves none of a 3:1 canvas
 *                       empty, fit: 1 (contain) leaves about two thirds, and a wide canvas turned tall stays covered
 */
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Pixels that are the page's background (its colour at the top left) in `rest` and something else in `after`. */
async function grown(rest, after, profile) {
  const [fa, fb] = [path.join(profile, 'rest.png'), path.join(profile, 'after.png')];
  await writeFile(fa, Buffer.from(rest, 'base64'));
  await writeFile(fb, Buffer.from(after, 'base64'));
  return new Promise((resolve) => {
    const p = spawn('python3', ['-c', `import sys
from PIL import Image
a = Image.open(sys.argv[1]).convert("RGB"); b = Image.open(sys.argv[2]).convert("RGB"); c = a.getpixel((1, 1))
bg = lambda p: all(abs(p[i] - c[i]) <= 6 for i in range(3))
print(sum(1 for p, q in zip(a.getdata(), b.getdata()) if bg(p) and not bg(q)))`, fa, fb]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('exit', () => resolve(Number(out.trim())));
  });
}

/** How far the centre of the ink (pixels darker than 128) is from the screenshot's centre, as shares of its size. */
async function inkOffset(png, profile) {
  const file = path.join(profile, 'ink.png');
  await writeFile(file, Buffer.from(png, 'base64'));
  return new Promise((resolve) => {
    const p = spawn('python3', ['-c', `import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("L"); w, h = im.size; box = im.point(lambda v: 255 if v < 128 else 0).getbbox()
print((box[0] + box[2]) / 2 / w - 0.5, (box[1] + box[3]) / 2 / h - 0.5)`, file]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('exit', () => resolve(out.trim().split(' ').map(Number)));
  });
}

/** The share of a screenshot's pixels within 10 of a colour (python3 + Pillow, as shoot.mjs's diffOf). */
async function shareOf(png, rgb, profile) {
  const file = path.join(profile, 'share.png');
  await writeFile(file, Buffer.from(png, 'base64'));
  return new Promise((resolve) => {
    const p = spawn('python3', ['-c', `import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB"); c = [int(v) for v in sys.argv[2:5]]; px = list(im.getdata())
print(sum(1 for q in px if all(abs(q[i] - c[i]) <= 10 for i in range(3))) / len(px))`, file, ...rgb.map(String)]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('exit', () => resolve(Number(out.trim())));
  });
}

/** t: { send, evaluate, navigate, sleep, clipOf, base, profile, problems } */
export async function verifyOptions(t) {
  const { send, evaluate, navigate, sleep, clipOf, base, profile, problems } = t;
  const tag = (label, ok, detail) => {
    if (!ok) problems.push(`options: ${label} (${detail})`);
    console.log('option', `${label}: ${detail}`, ok ? '' : 'FAILED');
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
  await navigate('about:blank');
  await navigate(`${base}/test/options.html`);
  const { out, problems: ps } = await evaluate(`new Promise((r) => { const t = setInterval(() => window.__options && (clearInterval(t), r({ out: window.__options.out, problems: window.__options.problems })), 100); })`);
  for (const p of ps) problems.push(`options: ${p}`);
  console.log('option', Object.entries(out).map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(' | '), `${ps.length} problem(s)`);

  // fit: 'cover' on a live canvas: the page background (240, 240, 240) must not show through anywhere
  const box = (id) => evaluate(`(() => { const b = document.getElementById('${id}').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, sx: scrollX, sy: scrollY }; })()`);
  const empty = async (id) => shareOf((await send('Page.captureScreenshot', { format: 'png', clip: clipOf(await box(id), 1) })).data, [240, 240, 240], profile);
  await evaluate('scrollTo(0, 0)');
  await sleep(300);
  const cover = await empty('cover-wide'), contain = await empty('contain-wide');
  await evaluate(`document.getElementById('cover-wide').style.cssText = 'width: 100px; height: 300px'`);
  await sleep(500);
  const tall = await empty('cover-wide');
  tag('fit cover', cover < 0.01 && tall < 0.01 && contain > 0.5,
    `${(cover * 100).toFixed(1)} % of a 3:1 canvas empty, ${(tall * 100).toFixed(1)} % once it is 1:3 (no remount); fit 1: ${(contain * 100).toFixed(0)} %`);

  // a sphere pressed hard near its limb and its poles: its outline must not move
  const sb = await box('sphere');
  const sphereShot = async () => (await send('Page.captureScreenshot', { format: 'png', clip: clipOf(sb, 1) })).data;
  const still = await sphereShot();
  await evaluate(`[[0.5, 0.2], [0.5, 0.8], [0.2, 0.5], [0.8, 0.5]].forEach(([x, y]) => window.__options.handles.sphere.ripple(x, y, { depth: 0.9, radius: 0.12, hold: 400 }))`);
  let outside = 0;
  for (let k = 0; k < 6; k++) { await sleep(150); outside = Math.max(outside, await grown(still, await sphereShot(), profile)); }
  tag('sphere outline', outside < 20, `${outside} px outside the rest outline while pressed hard at the limb and the poles`);
  // words, live: centred on their ink
  await evaluate(`document.getElementById('ink-live').scrollIntoView({ block: 'center' })`);
  await sleep(400);
  const [ix, iy] = await inkOffset((await send('Page.captureScreenshot', { format: 'png', clip: clipOf(await box('ink-live'), 1) })).data, profile);
  tag('words on their ink', Math.abs(ix) <= 0.01 && Math.abs(iy) <= 0.01, `a live 'y' is ${(ix * 100).toFixed(1)} %, ${(iy * 100).toFixed(1)} % off the centre`);
  await evaluate(`Object.values(window.__options.handles).forEach((h) => h.dispose())`);

  // pool()
  await navigate('about:blank');
  await navigate(`${base}/test/pool.html`);
  const pool = await evaluate(`new Promise((r) => { const t = setInterval(() => window.__pool && (clearInterval(t), r(window.__pool)), 100); })`);
  for (const p of pool.problems) problems.push(`pool: ${p}`);
  tag('pool', !pool.problems.length, Object.entries(pool.out).map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(' | '));
}
