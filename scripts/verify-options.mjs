/**
 * verify-options.mjs — shoot.mjs's checks of the options the use-case pages asked for, run in its Chrome
 * (`node scripts/shoot.mjs`, or `--only options` for these alone). A module of its own so shoot.mjs stays one readable
 * file; it gets shoot.mjs's DevTools helpers in `t` and adds what it finds to `t.problems`.
 *
 *   test/options.html   corner: 0 is a square, fit: 'cover' (also in the static tier, and the mistakes that throw), a
 *                       poster that is a canvas or a function (the page checks itself)
 *   a screenshot        what the page cannot read back from a live canvas: fit: 'cover' leaves none of a 3:1 canvas
 *                       empty, fit: 1 (contain) leaves about two thirds, and a wide canvas turned tall stays covered
 */
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

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
  await evaluate(`Object.values(window.__options.handles).forEach((h) => h.dispose())`);
}
