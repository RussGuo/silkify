/**
 * verify-events.mjs — shoot.mjs's checks of what an object tells the page (issue #18), run in its Chrome
 * (`node scripts/shoot.mjs`, or `--only events` for these alone). It gets shoot.mjs's DevTools helpers in `t` and adds
 * what it finds to `t.problems`.
 *
 *   test/events.html      the library: onPress, onRelease, onStroke (throttled), onReady / onFail, callbacks that
 *                         throw, haptics before and after a user gesture (one real click here gives the gesture), words,
 *                         the static tier, interactive: false, a live element's link (the page checks itself)
 */

/** t: { send, evaluate, navigate, mouse, sleep, diffOf, clipOf, base, problems } */
export async function verifyEvents(t) {
  const { send, evaluate, navigate, mouse, base, problems } = t;
  const tag = (label, ok, detail) => {
    if (!ok) problems.push(`events: ${label} (${detail})`);
    console.log('events', `${label}: ${detail}`, ok ? '' : 'FAILED');
  };
  const click = async (x, y) => {
    await mouse('mouseMoved', x, y);
    await mouse('mousePressed', x, y, { button: 'left', clickCount: 1 });
    await mouse('mouseReleased', x, y, { button: 'left', clickCount: 1 });
  };

  // ---- the library ----
  await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 640, deviceScaleFactor: 1, mobile: false });
  await navigate('about:blank');
  await navigate(`${base}/test/events.html`);
  await evaluate(`new Promise((r) => { const t = setInterval(() => (window.__eventsWaiting || window.__events) && (clearInterval(t), r()), 100); })`);
  await click(4, 600);                                 // the user gesture haptics waits for, off every canvas
  const ev = await evaluate(`new Promise((r) => { const t = setInterval(() => window.__events && (clearInterval(t), r(window.__events)), 100); })`);
  for (const p of ev.problems) problems.push(`events: ${p}`);
  const o = ev.out;
  tag('library', !ev.problems.length, `presses ${o.press?.length}, releases ${o.release?.map((r) => (r.over ? 'over' : 'off')).join('/')}, `
    + `10 moves → ${o.stroke?.burst} stroke, thrown ${o.throws?.thrown.join(' ')} with ${o.throws?.frames} frames after (twin ${o.throws?.twinFrames}), `
    + `vibrated ${JSON.stringify(o.vibrated)}, element ${typeof o.element === 'string' ? o.element : `${o.element?.presses} press`}`);
}
