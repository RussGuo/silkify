/**
 * verify-events.mjs — shoot.mjs's checks of what an object tells the page (issue #18), run in its Chrome
 * (`node scripts/shoot.mjs`, or `--only events` for these alone). It gets shoot.mjs's DevTools helpers in `t` and adds
 * what it finds to `t.problems`.
 *
 *   test/events.html      the library: onPress, onRelease, onStroke (throttled), onReady / onFail, callbacks that
 *                         throw, haptics before and after a user gesture (one real click here gives the gesture), words,
 *                         the static tier, interactive: false, a live element's link (the page checks itself)
 *   examples/button.html  the silk button pressed three ways, each a click of the <button>: a real mouse press (the silk
 *                         reports it), a finger (touch emulation), and the keyboard (Tab shows the focus ring; Enter and
 *                         Space ripple the silk from its centre: the frame changes); under reduced motion the face
 *                         stays the poster <img> (no canvas, no three.js) and Enter still clicks it
 *   the gallery           a real press on a live card is counted through onPress (__gallery.presses)
 */

/** t: { send, evaluate, navigate, mouse, sleep, diffOf, clipOf, base, problems } */
export async function verifyEvents(t) {
  const { send, evaluate, navigate, mouse, sleep, diffOf, clipOf, base, problems } = t;
  const tag = (label, ok, detail) => {
    if (!ok) problems.push(`events: ${label} (${detail})`);
    console.log('events', `${label}: ${detail}`, ok ? '' : 'FAILED');
  };
  const click = async (x, y) => {
    await mouse('mouseMoved', x, y);
    await mouse('mousePressed', x, y, { button: 'left', clickCount: 1 });
    await mouse('mouseReleased', x, y, { button: 'left', clickCount: 1 });
  };
  // a key with text (Enter, Space) goes down as keyDown, so the browser also makes its keypress: a button needs that
  const key = async (k, code, keyCode, text) => {
    await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code, windowsVirtualKeyCode: keyCode, ...(text ? { text } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: keyCode });
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

  // ---- the silk button: mouse, touch, keyboard ----
  await navigate('about:blank');
  await navigate(`${base}/examples/button.html`);
  const b = await evaluate(`window.__button.handle.ready.then((h) => { const r = document.getElementById('buy').querySelector('canvas').getBoundingClientRect();
    return { mode: h.mode, thread: h.thread, x: r.left + r.width / 2, y: r.top + r.height / 2, r: { x: r.left, y: r.top, w: r.width, h: r.height, sx: 0, sy: 0 } }; })`);
  const state = () => evaluate(`({ clicks: window.__button.clicks, presses: window.__button.presses.slice(), focus: document.activeElement?.id || null,
    ring: getComputedStyle(document.getElementById('buy')).outlineStyle, visible: document.getElementById('buy').matches(':focus-visible'),
    text: document.getElementById('count').textContent })`);
  // calm: not 'active' (the loop is 'active' for 8 s after a touch, then a 12 fps 'tail' while the waves fade)
  const calmed = () => evaluate(`(async () => { const h = window.__button.handle; for (let t = 0; t < 120 && (await h.stats()).mode === 'active'; t++) await new Promise((r) => setTimeout(r, 100)); return (await h.stats()).mode; })()`);
  const loop = () => evaluate('window.__button.handle.stats().then((s) => s.mode)');
  const shot = async () => (await send('Page.captureScreenshot', { format: 'png', clip: clipOf(b.r, 1) })).data;

  await mouse('mouseMoved', 2, 2);
  await click(b.x, b.y);
  await mouse('mouseMoved', 2, 2);
  const m = await state();
  tag('button, mouse', b.mode === 'webgl' && m.clicks === 1 && m.presses.join() === 'mouse', `${b.mode}/${b.thread}, ${m.clicks} click, onPress ${m.presses}`);

  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  try {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x, y: b.y }] });
    await sleep(60);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(100);
  } finally {
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  }
  const f = await state();
  tag('button, touch', f.clicks === 2 && f.presses.join() === 'mouse,touch', `${f.clicks} clicks, onPress ${f.presses}`);

  // the keyboard: focus by Tab (the ring shows), then Enter and Space each click it and ripple the silk
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });   // a headless page without focus gets no keys
  await click(2, 2);                                   // Tab starts from here (after the click on the button, it would leave the page)
  const rest = await calmed();
  const calm = await shot();
  await key('Tab', 'Tab', 9);
  const k0 = await state();
  await key('Enter', 'Enter', 13, '\r');
  await sleep(120);
  const [[dEnter], lEnter] = [await diffOf(calm, await shot()), await loop()];
  const rest2 = await calmed();
  const calm2 = await shot();
  await key(' ', 'Space', 32, ' ');
  await sleep(120);
  const [[dSpace], lSpace] = [await diffOf(calm2, await shot()), await loop()];
  const k = await state();
  tag('button, keyboard', k0.focus === 'buy' && k0.visible && k0.ring !== 'none' && k.clicks === 4 && k.presses.length === 2
    && rest !== 'active' && rest2 !== 'active' && lEnter === 'active' && lSpace === 'active' && dEnter > 0.3 && dSpace > 0.3,
    `Tab → focus ${k0.focus}, :focus-visible ${k0.visible}, outline ${k0.ring}; Enter and Space → ${k.clicks - f.clicks} clicks, loop ${rest} → ${lEnter}, ${rest2} → ${lSpace}, ripple Δ ${dEnter.toFixed(2)} / ${dSpace.toFixed(2)} (no onPress: ${k.presses.length - f.presses.length}), "${k.text}"`);

  // reduced motion (the static tier): the face stays the poster <img>, no canvas, no three.js, and the button still works
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  try {
    await navigate('about:blank');
    await navigate(`${base}/examples/button.html`);
    await click(2, 2);
    await key('Tab', 'Tab', 9);
    await key('Enter', 'Enter', 13, '\r');
    await sleep(300);
    const r = await evaluate(`({ canvases: document.querySelectorAll('canvas').length, img: document.querySelector('#buy img.face')?.complete,
      three: performance.getEntriesByType('resource').filter((e) => /three/.test(e.name)).length, clicks: window.__button.clicks })`);
    tag('button, reduced motion', r.canvases === 0 && r.img && r.three === 0 && r.clicks === 1, `${r.canvases} canvas, poster ${r.img ? 'shown' : 'missing'}, ${r.three} three.js requests, Enter → ${r.clicks} click`);
  } finally {
    await send('Emulation.setEmulatedMedia', { features: [] });
  }

  // ---- the gallery: a press on a live card goes through onPress ----
  await send('Emulation.setDeviceMetricsOverride', { width: 1240, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate('about:blank');
  await navigate(`${base}/examples/`);
  const id = 'pomegranate';
  const g = await evaluate(`(async () => {
    document.querySelector('figure[data-id="${id}"] .stage').scrollIntoView({ block: 'center' });
    const h = await window.__gallery.activate('${id}');
    const r = h.canvas.getBoundingClientRect();
    return { mode: h.mode, x: r.left + r.width / 2, y: r.top + r.height / 2, before: window.__gallery.presses.get('${id}') || 0 };
  })()`);
  await click(g.x, g.y);
  await click(g.x, g.y);
  await mouse('mouseMoved', 2, 2);
  const after = await evaluate(`window.__gallery.presses.get('${id}') || 0`);
  tag('gallery', g.mode === 'webgl' && after - g.before === 2, `${id} ${g.mode}: two presses → ${after - g.before} counted by onPress`);
}
