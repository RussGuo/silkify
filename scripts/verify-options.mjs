/**
 * verify-options.mjs — shoot.mjs's checks of the options the use-case pages asked for, run in its Chrome
 * (`node scripts/shoot.mjs`, or `--only options` for these alone). A module of its own so shoot.mjs stays one readable
 * file; it gets shoot.mjs's DevTools helpers in `t` and adds what it finds to `t.problems`.
 *
 *   test/options.html   corner: 0 is a square (the page checks itself)
 */
/** t: { send, evaluate, navigate, base, problems } */
export async function verifyOptions(t) {
  const { send, evaluate, navigate, base, problems } = t;
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
  await navigate('about:blank');
  await navigate(`${base}/test/options.html`);
  const { out, problems: ps } = await evaluate(`new Promise((r) => { const t = setInterval(() => window.__options && (clearInterval(t), r({ out: window.__options.out, problems: window.__options.problems })), 100); })`);
  for (const p of ps) problems.push(`options: ${p}`);
  console.log('option', Object.entries(out).map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(' | '), `${ps.length} problem(s)`);
  await evaluate(`Object.values(window.__options.handles).forEach((h) => h.dispose())`);
}
