/**
 * verify-touch.mjs — shoot.mjs's checks of the first touch, run in its Chrome (`node scripts/shoot.mjs`, or
 * `--only touch` for these alone). A module of its own so shoot.mjs stays one readable file; it gets shoot.mjs's
 * DevTools helpers in `t` and adds what it finds to `t.problems`.
 *
 *   test/first-touch.html   the library: a hover, a stroke, a tap and a held button made while the renderer is still
 *                           loading are answered once it is ready; a canvas nobody touched rests (the page checks itself)
 *   the gallery, cold card  one real stroke across a card that is still a poster: it mounts and visibly ripples
 *   the gallery, a phone    375 px with touch: the hint shows without hover, a card in view mounts and ripples on its
 *                           own, one tap on a cold card visibly dents it (against the same card untouched), a scroll
 *                           greets every card with at most 3 live; in the static tier no hint and nothing mounts
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

  // ---- a phone: 375 px, touch, no hover ----
  await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  try {
    await navigate('about:blank');
    await navigate(`${base}/examples/`);
    const g = await evaluate(`(async () => {
      await new Promise((r) => setTimeout(r, 600));   // the hint fades in over 0.4 s
      return { hoverNone: matchMedia('(hover: none)').matches, hint: +getComputedStyle(document.querySelector('.stage .hint')).opacity, ids: window.__gallery.ids };
    })()`);
    tag('hint', g.hoverNone && g.hint > 0.5, `(hover: none) ${g.hoverNone}, the hint shows without hover at opacity ${g.hint}`);

    // the card in view at load says it is alive: it mounts and plays one ripple, with nobody touching it
    const first = g.ids[0];
    const hello = await evaluate(`(async () => {
      for (let t = 0; t < 100 && !window.__gallery.live.has('${first}'); t++) await new Promise((r) => setTimeout(r, 100));
      const l = window.__gallery.live.get('${first}');
      if (!l) return { mode: 'not mounted' };
      const h = await l.handle.ready;
      await new Promise((r) => setTimeout(r, 300));
      const s = await h.stats();
      return { mode: h.mode, loop: s.mode, steps: s.steps };
    })()`);
    tag('alive on its own', hello.mode === 'webgl' && hello.loop === 'active' && hello.steps > 0, `${first}: ${hello.mode}, loop ${hello.loop}, ${hello.steps} solver steps`);

    // one tap on a card that is still a poster (half in view, so not greeted yet): it mounts and the tap dents it
    const id = 'pomegranate';
    const r = await evaluate(`(() => {
      const s = document.querySelector('figure[data-id="${id}"] .stage'), b0 = s.getBoundingClientRect();
      scrollBy(0, b0.top - (innerHeight - b0.height * 0.55));   // its top 55 % in view: the centre, but under 60 %
      const b = s.getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, cold: !window.__gallery.live.has('${id}') && !window.__gallery.greeted.has('${id}'),
        clip: { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: innerHeight - b.top, scale: 0.5 } };   // its part in view
    })()`);
    await sleep(300);
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x, y: r.y }] });
    await sleep(60);
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const tap = await evaluate(`(async () => {
      for (let t = 0; t < 100 && !window.__gallery.live.has('${id}'); t++) await new Promise((r) => setTimeout(r, 50));
      const h = await window.__gallery.live.get('${id}')?.handle.ready;
      if (!h) return { mode: 'not mounted' };
      await new Promise((r) => setTimeout(r, 150));
      const s = await h.stats();
      return { mode: h.mode, loop: s.mode, greeted: window.__gallery.greeted.has('${id}') };
    })()`);
    const tapped = (await send('Page.captureScreenshot', { format: 'png', clip: r.clip })).data;
    // the same card mounted again where it is, untouched (still under 60 % in view, so not greeted): what a dent changes
    const calm = await evaluate(`(async () => {
      window.__gallery.release('${id}');
      const h = await window.__gallery.activate('${id}');
      await new Promise((r) => setTimeout(r, 150));
      return { mode: h.mode, loop: (await h.stats()).mode };
    })()`);
    const [dent] = await diffOf((await send('Page.captureScreenshot', { format: 'png', clip: r.clip })).data, tapped);
    tag('one tap', r.cold && tap.mode === 'webgl' && tap.loop === 'active' && !tap.greeted && calm.loop === 'rest' && dent > 0.3,
      `${id} cold ${r.cold} → ${tap.mode}, loop ${tap.loop} after one tap, Δ ${dent.toFixed(2)} against the same card untouched (${calm.loop})`);

    // a scroll through the whole page greets every card once, and never holds more than 3 live
    const tour = await evaluate(`(async () => {
      let most = 0;
      for (const f of document.querySelectorAll('#grid figure')) {
        f.querySelector('.stage').scrollIntoView({ block: 'center' });
        for (let t = 0; t < 12; t++) { await new Promise((r) => setTimeout(r, 100)); most = Math.max(most, window.__gallery.live.size); }
      }
      return { greeted: window.__gallery.greeted.size, cards: document.querySelectorAll('#grid figure').length, most };
    })()`);
    tag('scroll', tour.greeted === tour.cards && tour.most <= 3, `${tour.greeted} of ${tour.cards} cards greeted, at most ${tour.most} live`);

    // the static tier (reduced motion, a slow phone): posters that do not move, so no hint and no greeting
    await navigate('about:blank');
    await navigate(`${base}/examples/?tier=static`);
    const still = await evaluate(`(async () => {
      await new Promise((r) => setTimeout(r, 1000));
      return { hint: getComputedStyle(document.querySelector('.stage .hint')).display, live: window.__gallery.live.size };
    })()`);
    tag('static tier', still.hint === 'none' && still.live === 0, `hint ${still.hint}, ${still.live} live`);
  } finally {
    await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  }
}
