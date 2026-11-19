/**
 * verify-touch.mjs — shoot.mjs's checks of the first touch, run in its Chrome (`node scripts/shoot.mjs`, or
 * `--only touch` for these alone). A module of its own so shoot.mjs stays one readable file; it gets shoot.mjs's
 * DevTools helpers in `t` and adds what it finds to `t.problems`.
 *
 *   test/first-touch.html   the library: a hover, a stroke, a tap and a held button made while the renderer is still
 *                           loading are answered once it is ready; a canvas nobody touched rests (the page checks itself)
 *   the gallery, cold card  one real stroke across a card that is still a poster: it mounts and visibly ripples
 */

/** t: { send, evaluate, navigate, mouse, sleep, diffOf, clipOf, rectOf, strokeOver, base, problems } */
export async function verifyTouch(t) {
  const { send, evaluate, navigate, mouse, sleep, diffOf, clipOf, rectOf, strokeOver, base, problems } = t;
  const tag = (label, ok, detail) => {
    if (!ok) problems.push(`touch: ${label} (${detail})`);
    console.log('touch ', `${label}: ${detail}`, ok ? '' : 'FAILED');
  };

  // ---- the library: the pointer of the loading time ----
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 640, deviceScaleFactor: 1, mobile: false });
  await navigate('about:blank');
  await navigate(`${base}/test/first-touch.html`);
  const ft = await evaluate(`new Promise((r) => { const t = setInterval(() => window.__firstTouch && (clearInterval(t), r(window.__firstTouch)), 100); })`);
  for (const p of ft.problems) problems.push(`first-touch: ${p}`);
  tag('before ready', !ft.problems.length, Object.entries(ft.out).map(([k, v]) => `${k} → ${v.loop}`).join(', '));

  // ---- the gallery: one stroke across a cold card ----
  await send('Emulation.setDeviceMetricsOverride', { width: 1240, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate('about:blank');
  await navigate(`${base}/examples/`);
  const warm = await evaluate('window.__gallery.warm');
  const id = 'pomegranate';
  await mouse('mouseMoved', 2, 2);
  let r = await rectOf(id);
  // the same card, mounted with no pointer near it: the frame a stroke must visibly change
  await evaluate(`window.__gallery.activate('${id}')`);
  await sleep(600);
  const still = (await send('Page.captureScreenshot', { format: 'png', clip: clipOf(r, 0.5) })).data;
  await evaluate(`window.__gallery.release('${id}')`);
  await sleep(800);                                   // the spare worker is warmed again when the page is idle
  r = await rectOf(id);
  const at = await strokeOver(r, '-0.04,0.42,1.04,0.56');   // from outside, across, and out the other side
  for (let f = 0; f <= 22; f++) { const { x, y } = at(f, 22, [0, 22]); await mouse('mouseMoved', x, y); await sleep(30); }
  await mouse('mouseMoved', 2, 2);
  const h = await evaluate(`window.__gallery.activate('${id}').then((h) => ({ mode: h.mode, thread: h.thread }))`);
  await sleep(300);
  const [diff] = await diffOf(still, (await send('Page.captureScreenshot', { format: 'png', clip: clipOf(r, 0.5) })).data);
  tag('cold card', h.mode === 'webgl' && diff > 0.3, `prewarm ${warm ?? 'none'}, one stroke → ${h.mode}/${h.thread}, Δ ${diff.toFixed(2)} against the untouched card`);
}
