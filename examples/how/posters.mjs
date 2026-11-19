/**
 * posters.mjs — the still frames the "How silkify works" pages show before a figure comes alive, and instead of it in
 * the static tier (reduced motion, Save-Data, no WebGL2). The gallery's recipe (scripts/shoot.mjs --posters): high tier,
 * no fill-light motion, transparent background, 1x and 2x, WebP q92 with lossless alpha.
 *
 *   <id>.webp, <id>@2x.webp            the rest frame of every live figure in page.js (hero, mask-on, mask-off, sleep)
 *   <id>-touched.webp, …@2x.webp        figure 3 only: the frame just after one ripple(), which the static tier shows,
 *                                       because the point of that figure is what a touch does
 *
 * Run from the repository root:  PLAYWRIGHT=…/playwright/index.mjs CHROME=/path/to/chrome node examples/how/posters.mjs
 * Needs Playwright (never a dependency: see scripts/harness.mjs), python3 with Pillow, and the network (three.js from
 * jsDelivr, as the page itself). Writes examples/how/posters/ and nothing else.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, playwright } from '../../scripts/harness.mjs';

/* ============================================
 * What is rendered
 * ============================================ */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(HERE, 'posters');
const REST = { fillLight: false, idleSweep: false, interactive: false };
const TOUCHED = ['mask-on', 'mask-off'];
const TOUCH = { x: 0.46, y: 0.56, radius: 0.12, depth: 0.6, hold: 220 };   // the same drop as the figure's button
const TOUCH_MS = 450;                                                       // how long after the drop the frame is taken

/* ============================================
 * Render
 * ============================================ */
const tmp = mkdtempSync(path.join(tmpdir(), 'how-posters-'));
const srv = await serve(ROOT);
const { chromium } = await playwright();
const browser = await chromium.launch({
  ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars'],
});
const toWebp = (png, webp) => execFileSync('python3', ['-c',
  'import sys; from PIL import Image; Image.open(sys.argv[1]).save(sys.argv[2], "WEBP", quality=92, alpha_quality=100, method=6)', png, webp]);

try {
  for (const [dpr, suffix] of [[1, ''], [2, '@2x']]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: dpr });
    const noise = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') noise.push(m.text()); });
    await page.goto(`${srv.base}/examples/how-it-works.html?poster=1&tier=high`);
    await page.waitForFunction(() => window.__how);
    const ids = await page.evaluate(() => window.__how.ids.filter((id) => id !== 'html'));
    for (const id of ids) {
      for (const touched of TOUCHED.includes(id) ? [false, true] : [false]) {
        const stage = page.locator(`.stage[data-silk="${id}"]`);
        await stage.scrollIntoViewIfNeeded();
        const mode = await page.evaluate(([i, o]) => window.__how.activate(i, o).then((h) => h.mode), [id, REST]);
        if (mode !== 'webgl') throw new Error(`${id}: mounted as ${mode}`);
        await page.waitForTimeout(600);                           // the canvas fades in over 0.25 s
        if (touched) {
          await page.evaluate(([i, t]) => window.__how.live.get(i).handle.ripple(t.x, t.y, t), [id, TOUCH]);
          await page.waitForTimeout(TOUCH_MS);
        }
        const name = `${id}${touched ? '-touched' : ''}${suffix}`, png = path.join(tmp, `${name}.png`);
        await stage.screenshot({ path: png, omitBackground: true });
        toWebp(png, path.join(OUT, `${name}.webp`));
        console.log('poster', `examples/how/posters/${name}.webp`);
        await page.evaluate((i) => window.__how.release(i), id);
      }
    }
    await page.close();
    if (noise.length) throw new Error(`console: ${noise.join(' | ')}`);
  }
} finally {
  await browser.close();
  srv.close();
  rmSync(tmp, { recursive: true, force: true });
}
