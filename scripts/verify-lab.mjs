/**
 * verify-lab.mjs — shoot.mjs's checks of what the Lab makes besides a look, run in its Chrome (`node scripts/shoot.mjs`,
 * or `--only lab` with the rest of the Lab's checks). A module of its own so shoot.mjs stays one readable file; it gets
 * shoot.mjs's DevTools helpers in `t` and adds what it finds to `t.problems`.
 *
 *   words    Object → Words: one word mounts and ripples under the Stroke with a system font (no font request; one
 *            line, so the drops land on ink whatever font the machine falls back to), and with two lines the link
 *            restores every control and the text, the printed call and Download HTML carry text, font, colour and
 *            line height, and the downloaded page runs from file://
 *   record   Record: a 3 s clip, square and 9:16, comes back as a non-empty video/mp4 or video/webm of the frame's shape
 *   controls the light disc answers the arrow keys and has x and y boxes; with reduced motion the stage's note is the one
 *            place that says the object is still (no readout repeats it) and Touch and Stroke are not shown
 *   links    a link is anyone's to make: hashes that try to break out of a string (a closing quote, `</script>`, a
 *            template string, a line break, a javascript: picture) open the Lab without running anything, and the
 *            printed call and Download HTML's script, run as they are, change nothing in the page and carry no foreign key
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

/** t: { send, evaluate, navigate, sleep, diffOf, clipOf, openLab, stageRect, base, profile, problems } */
export async function verifyLabExtras(t) {
  await verifyLabWords(t);
  await verifyRecord(t);
  await verifyLinks(t);
  await verifyControls(t);
}

/* ---- verify, part 6: the Lab's words (Object → Words), with a system font (no network) ---- */
async function verifyLabWords(t) {
  const { send, evaluate, navigate, sleep, diffOf, clipOf, openLab, stageRect, base, profile, problems } = t;
  const words = { obj: 'text', url: null, material: 'satin', feel: 'silk', bg: 'stage',
    set: { text: 'Silk\nit\'s soft', font: '900 160px ui-serif, Georgia, "Times New Roman", serif', color: '#2f4f6b', lineHeight: 1.05, tier: 'low' } };
  // the Stroke runs across the middle of the object, and two lines leave the middle a gap whose height is the font's
  // (in a fallback serif, as on a machine without Georgia, every drop lands between the lines): it is measured on one
  const h = await openLab('', { ...words, set: { ...words.set, text: 'Silk' } });
  await sleep(800);
  const st = await stageRect(), r = { ...st, x: st.x + st.w * 0.2, y: st.y + st.h * 0.3, w: st.w * 0.6, h: st.h * 0.4 };   // the words' band
  const shot = async () => (await send('Page.captureScreenshot', { format: 'png', clip: clipOf(r, 0.5) })).data;
  const a0 = await shot();
  await evaluate(`document.getElementById('stroke').click()`);
  await sleep(700);
  const [d] = await diffOf(a0, await shot());
  const fonts = await evaluate(`performance.getEntriesByType('resource').filter((e) => /fonts\.(googleapis|gstatic)/.test(e.name)).length`);
  const ok = h.mode === 'webgl' && d > 0.3 && fonts === 0;
  if (!ok) problems.push(`lab words: ${h.mode}, stroke Δ ${d.toFixed(2)}, ${fonts} Google Fonts request(s) for a system font`);
  console.log('words ', `${h.mode} ${h.tier}/${h.thread}`, `stroke Δ ${d.toFixed(2)}`, `${fonts} font requests`);

  // the link restores every control, the words included (the textarea, two lines), and the printed call
  await openLab('', words);
  const snap = `JSON.stringify([...document.querySelectorAll('#controls input, #controls select, #controls textarea')].map((i) => i.type === 'checkbox' ? i.checked : i.value)) + document.getElementById('code').textContent`;
  const [url, a] = [await evaluate('location.href'), await evaluate(snap)];
  await navigate('about:blank');
  await navigate(url);
  await evaluate('window.__lab.ready()');
  const b = await evaluate(snap);
  const shown = await evaluate(`['text', 'font', 'color', 'lineHeight'].filter((k) => ![...document.querySelectorAll('#controls .row')].find((r) => r.dataset.key === k).hidden)`);
  const code = await evaluate(`document.getElementById('code').textContent`);
  const printed = /text: 'Silk\\nit\\'s soft'/.test(code) && /font: '900 160px ui-serif/.test(code) && /color: '#2f4f6b'/.test(code) && /lineHeight: 1\.05/.test(code) && !/image:/.test(code);
  if (a !== b || shown.length !== 4 || !printed) problems.push(`lab words: link ${a === b ? 'identical' : 'DIFFERENT'}, rows shown ${shown}, printed ${JSON.stringify(code)}`);
  console.log('words ', `link round trip: ${a === b ? 'identical' : 'DIFFERENT'}`, `rows ${shown.join(' ')}`, printed ? 'printed with text, font, color, lineHeight' : 'PRINTED WRONG');

  // Download HTML: the words, from file:// (silk.js from this server instead of the CDN)
  const html = await evaluate('window.__lab.exportHtml()');
  const cdn = /https:\/\/cdn\.jsdelivr\.net\/gh\/RussGuo\/silkify@[\w.-]+\/src\/silk\.js/;
  if (/PICTURE/.test(html) || !/text: 'Silk\\nit\\'s soft'/.test(html) || !cdn.test(html)) problems.push('lab words: Download HTML does not carry the words');
  const file = path.join(profile, 'words.html');
  await writeFile(file, html.replace(cdn, `${base}/src/silk.js`));
  await navigate('about:blank');
  await navigate(`file://${file}`);
  const w = await evaluate(`new Promise((r) => { const t = setInterval(() => window.silk && (clearInterval(t), r(window.silk.ready)), 50); })
    .then((h) => h.stats().then((s0) => { for (const y of [0.4, 0.6]) for (const x of [0.3, 0.42, 0.58, 0.7]) h.ripple(x, y, { hold: 200 });   // two lines
      return new Promise((r) => setTimeout(r, 600)).then(() => h.stats()).then((s1) => ({ mode: h.mode, frames: s1.frames - s0.frames })); }))`);
  if (w.mode !== 'webgl' || !(w.frames > 5)) problems.push(`lab words: the downloaded page from file:// is ${w.mode} (${w.frames} frames after a ripple)`);
  console.log('words ', `Download HTML: ${(html.length / 1024).toFixed(1)} KB, from file:// ${w.mode}, ${w.frames} frames after ripple()`);
}

/* ---- verify, part 7: the Lab's Record (MediaRecorder on the canvas's stream; lab-record.js) ---- */
async function verifyRecord(t) {
  const { evaluate, openLab, problems } = t;
  await openLab('?tier=low');
  const shown = await evaluate(`!document.getElementById('record').hidden`);
  for (const frame of ['square', 'story']) {
    const c = await evaluate(`window.__lab.record({ frame: '${frame}', seconds: 3, motion: 'stroke' }).catch((e) => ({ error: e.message }))`);
    const shape = c.width / c.height, want = frame === 'square' ? 1 : 9 / 16;
    const ok = shown && !c.error && c.size > 20000 && /^video\/(mp4|webm)/.test(c.type) && Math.abs(shape - want) < 0.03 && c.seconds >= 2.9;
    if (!ok) problems.push(`lab record ${frame}: ${JSON.stringify(c)} (button shown: ${shown})`);
    console.log('record', frame, c.error || `${c.type}, ${(c.size / 1024).toFixed(0)} KB, ${c.width}×${c.height}, ${c.seconds} s`, ok ? '' : 'FAILED');
  }
  await evaluate('window.__lab.recorder.close()');
}

/* ---- verify, part 8: links that try to inject code into the printed call and the downloaded page ---- */
async function verifyLinks(t) {
  const { evaluate, openLab, problems } = t;
  const base = { url: null, material: 'silk', feel: 'silk', bg: 'stage' };
  const bad = "'+(document.title='PWNED')+'";
  const links = {
    quote: { ...base, obj: 'ink-drop', set: { exposure: `1${bad}`, sheenColor: [`1${bad}`, 0, 0], light: [-0.66, 0.72, 0.2], autoplay: { interval: bad } } },
    template: { ...base, obj: 'pomegranate', set: { foo: '`${document.title="PWNED"}`', puff: '${document.title="PWNED"}', tier: `low${bad}` } },
    script: { ...base, obj: 'text', set: { text: `a</script><script>document.title='PWNED'</script><!--\n${bad}\u2028`, font: `800 160px x${bad}`, color: `red${bad}`, lineHeight: 1.1 } },
    picture: { ...base, obj: 'custom', url: "javascript:document.title='PWNED'", set: { exposure: 1.2 } },
    relative: { ...base, obj: 'custom', url: `x.png${bad}`, set: {} },
  };
  for (const [name, state] of Object.entries(links)) {
    await openLab('', state);
    const r = await evaluate(`(async () => {
      const code = document.getElementById('code').textContent, html = await window.__lab.exportHtml();
      const script = html.slice(html.indexOf('<script type="module">') + 22, html.lastIndexOf('</script>'));
      let seen = null; const run = (src) => { try { new Function('silkify', 'canvas', 'PICTURE', 'BUMP', src)((c, o) => (seen = o), null, 'p', 'b'); return seen; } catch (e) { return 'threw ' + e.message; } };
      const printed = run(code), exported = run('return silkify(null, ' + script.slice(script.indexOf('{', script.indexOf('getElementById')), script.lastIndexOf('}') + 1) + ');');
      return { title: document.title, printed, exported, closings: (script.match(/<\\/script|<!--/gi) || []).length };
    })()`);
    const keys = (o) => (o && typeof o === 'object' ? Object.keys(o) : []);
    const foreign = [...keys(r.printed), ...keys(r.exported)].filter((k) => !/^(image|bump|text|font|color|lineHeight|material|feel|light|exposure|sheenColor|autoplay|puff|tier|albedo|grain|volume|floor|sheen|sheenPower)$/.test(k));
    const clean = r.title === 'silkify Lab' && typeof r.printed === 'object' && typeof r.exported === 'object' && !r.closings && !foreign.length;
    if (!clean) problems.push(`lab link ${name}: ${JSON.stringify(r).slice(0, 400)}`);
    console.log('link  ', name.padEnd(9), clean ? `nothing ran; printed ${keys(r.printed).join(' ')}` : 'INJECTED');
  }
}

/* ---- verify, part 9: the light disc from the keyboard; reduced motion says it once and hides what cannot move ---- */
async function verifyControls(t) {
  const { send, evaluate, openLab, problems } = t;
  await openLab('', { obj: 'pomegranate', url: null, material: 'silk', feel: 'silk', bg: 'stage', set: { puff: 'dome', light: [0, 0, 1] } });
  const disc = await evaluate(`(async () => {
    const row = [...document.querySelectorAll('#controls .row')].find((r) => r.dataset.key === 'light');
    row.closest('details.advanced').open = true;
    const d = row.querySelector('.disc'); d.focus();
    for (const key of ['ArrowRight', 'ArrowRight', 'ArrowUp']) d.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    const boxes = [...row.querySelectorAll('.xy input')].map((n) => n.getAttribute('aria-label'));
    return { light: window.__lab.state.set.light, focus: document.activeElement === d, name: d.getAttribute('aria-label'), boxes };
  })()`);
  const okDisc = disc.focus && disc.name && disc.boxes.length === 2 && JSON.stringify(disc.light) === '[0.04,0.02,1]';
  if (!okDisc) problems.push(`lab controls: the light disc from the keyboard ${JSON.stringify(disc)}`);
  console.log('lab   ', `light disc: keys → ${JSON.stringify(disc.light)}, x and y boxes ${disc.boxes.length}`, okDisc ? '' : 'FAILED');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  try {
    await openLab();
    await new Promise((r) => setTimeout(r, 1300));   // past a readout tick
    const rm = await evaluate(`({ mode: window.__lab.handle.mode, note: !document.getElementById('still').hidden, read: document.getElementById('read').textContent,
      touch: document.getElementById('touch').hidden, stroke: document.getElementById('stroke').hidden })`);
    const ok = rm.mode === 'static' && rm.note && !rm.read && rm.touch && rm.stroke;
    if (!ok) problems.push(`lab controls: reduced motion ${JSON.stringify(rm)}`);
    console.log('lab   ', `reduced motion: ${rm.mode}, the note once, readout "${rm.read}", Touch and Stroke hidden ${rm.touch && rm.stroke}`, ok ? '' : 'FAILED');
  } finally {
    await send('Emulation.setEmulatedMedia', { features: [] });
  }
}
