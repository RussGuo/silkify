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
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

/** t: { send, evaluate, navigate, sleep, diffOf, clipOf, openLab, stageRect, base, profile, problems } */
export async function verifyLabExtras(t) {
  await verifyLabWords(t);
  await verifyRecord(t);
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
