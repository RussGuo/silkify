/*
 * lab-record.js — the Lab's "Record": a 3 or 5 s clip of the object, square or 9:16, to post where people share
 * screen recordings. Made in the browser, saved by the browser; nothing is uploaded.
 *
 *   framing    while the panel is open the canvas itself takes the clip's shape (the largest square or 9:16 box
 *              between the title and the panel) and its background is the clip's: what the stage shows is what the
 *              clip shows. The renderer just sees a resize; a remount (a scene option changed) is framed again.
 *   capture    canvas.captureStream() on the silk canvas. With the renderer in a Web Worker that canvas is the
 *              placeholder of its OffscreenCanvas, and its stream carries the worker's frames: checked in Chrome,
 *              Firefox and WebKit. The stream plays into a <video>; every animation frame paints the background,
 *              that video and the corner mark into a 2D canvas of the same size, and MediaRecorder records that
 *              canvas's own stream. A renderer at rest sends no frames; the last one stays in the video, so a still
 *              moment is still recorded, at an even frame rate.
 *   format     MP4 (H.264) where MediaRecorder makes it (Chrome, Safari), else WebM (Firefox). Without MediaRecorder or
 *              captureStream there is no Record button.
 *   motion     "A stroke" plays the Lab's own Stroke, then a Touch, on a timetable; "Your hand" records whatever the
 *              pointer does. A still frame (the static tier, reduced motion) has nothing to record: the panel says
 *              why and, for reduced motion, offers the stage's "Play anyway".
 *   mark       "silkify · github.com/RussGuo/silkify" in the corner, on by default, one click to leave it off (#20).
 *
 * recorder({ stage, button, handle, bg, name, stroke, touch, playAnyway }) → { open, close, reframe, record }; `bg` is the
 * Lab's background name, read from the page's own colours (dark mode too).
 * lab.html calls reframe() after every mount; scripts/shoot.mjs calls record() through window.__lab.
 */

const TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
export const MARK = 'silkify · github.com/RussGuo/silkify';
const FRAMES = { square: 1, story: 9 / 16 };       // width ÷ height
const MARK_FONT = 'ui-sans-serif, -apple-system, "Segoe UI", system-ui, sans-serif';
const MARK_DARK = 'rgba(31, 29, 26, 0.55)', MARK_LIGHT = 'rgba(236, 231, 221, 0.6)';
const markPx = (h) => Math.max(1, Math.round(h * 0.024));   // the mark's size in a frame h pixels tall
const GAP = 12;                                     // px between the frame and the title, the panel, the sides

/** The format this browser records in, or null when it cannot record a canvas at all. */
export function recordable() {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;
  return TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) || null;
}

const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function recorder({ stage, button, handle, bg, name, stroke, touch, playAnyway }) {
  const type = recordable();
  button.hidden = !type;
  const opts = { frame: 'square', motion: 'stroke', seconds: 5, mark: true };
  let open = false, busy = null;

  /* ---- the panel: one row of choices, then the button; it wraps on a phone ---- */
  const seg = (label, key, choices) => {
    const box = el('div', { className: 'seg', role: 'group' });
    box.setAttribute('aria-label', label);
    for (const [value, text] of choices) {
      const b = el('button', { type: 'button', textContent: text });
      b.dataset.value = value;
      b.dataset.key = key;
      b.onclick = () => { opts[key] = value; show(); if (key === 'frame') reframe(); };
      box.append(b);
    }
    return box;
  };
  const mark = el('input', { type: 'checkbox', checked: true });
  mark.onchange = () => { opts.mark = mark.checked; reframe(); };
  const go = el('button', { type: 'button', className: 'go', textContent: 'Record' });
  const shut = el('button', { type: 'button', className: 'shut', textContent: '×', title: 'Close' });
  shut.setAttribute('aria-label', 'Close the recorder');
  const note = el('p', { className: 'rec-note' });
  const preview = el('span', { className: 'rec-mark', textContent: MARK, hidden: true });   // the mark, where the clip has it
  preview.setAttribute('aria-hidden', 'true');
  stage.append(preview);
  note.setAttribute('aria-live', 'polite');
  const panel = el('div', { className: 'rec', hidden: true },
    seg('Frame', 'frame', [['square', 'Square'], ['story', '9:16']]),
    seg('Motion', 'motion', [['stroke', 'A stroke'], ['hand', 'Your hand']]),
    seg('Length', 'seconds', [[3, '3 s'], [5, '5 s']]),
    el('label', { className: 'mark', title: MARK }, mark, ' silkify mark'),
    go, shut, note);
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'Record a clip');
  stage.append(panel);

  /** Buttons and the note ← the options and the object's mode. */
  function show(text) {
    for (const b of panel.querySelectorAll('.seg button')) {
      b.setAttribute('aria-pressed', String(String(opts[b.dataset.key]) === b.dataset.value));
      b.disabled = !!busy;
    }
    mark.disabled = !!busy;
    const h = handle();
    const still = !h || h.mode !== 'webgl';
    go.disabled = !busy && (still || h.mode === 'loading');
    go.textContent = busy ? 'Stop' : 'Record';
    if (text !== undefined) note.replaceChildren(...[].concat(text));
    else if (!busy && h && h.mode === 'static' && /reduced motion/.test(h.reason || '')) {
      const play = el('button', { type: 'button', textContent: 'Play anyway', onclick: playAnyway });
      note.replaceChildren('Your system asks for reduced motion, so the object is a still frame. ', play, ' to record it moving.');
    } else if (!busy && h && h.mode === 'static') note.textContent = 'The object is a still frame here, so there is nothing to record.';
    else if (!busy && h && h.mode === 'failed') note.textContent = h.reason;
    else if (!busy) note.textContent = opts.motion === 'hand' ? `Press Record, then touch the object: ${opts.seconds} s.` : `${opts.seconds} s of a stroke and a touch, in the frame you see.`;
  }

  /* ---- framing: the canvas takes the clip's shape, between the title and the panel ---- */
  const FRAMED = ['left', 'top', 'width', 'height', 'right', 'bottom', 'background', 'outline'];
  function reframe() {
    const c = handle()?.canvas;
    preview.hidden = !open || !opts.mark;
    if (!open) { stage.style.removeProperty('height'); for (const k of FRAMED) c?.style.removeProperty(k); return; }
    if (!c) return;
    const k = FRAMES[opts.frame], top = stage.querySelector('.top').getBoundingClientRect();
    let s = stage.getBoundingClientRect();
    if (matchMedia('(max-width: 820px)').matches) {     // one column (a phone): the stage grows to a frame as wide as it
      const want = Math.round(top.bottom - s.top + 2 * GAP + (s.width - 2 * GAP) / k + panel.offsetHeight + 12);
      if (Math.abs(want - s.height) > 1) { stage.style.height = `${want}px`; s = stage.getBoundingClientRect(); }
    }
    const p = panel.getBoundingClientRect();
    const y0 = top.bottom - s.top + GAP, y1 = p.top - s.top - GAP, x0 = GAP, x1 = s.width - GAP;
    const hh = Math.max(40, y1 - y0), w = Math.min(x1 - x0, hh * k), h = w / k;
    const [a, b] = background();
    Object.assign(c.style, { left: `${Math.round((s.width - w) / 2)}px`, top: `${Math.round(y0 + (hh - h) / 2)}px`, width: `${Math.round(w)}px`,
      height: `${Math.round(h)}px`, right: 'auto', bottom: 'auto', background: `radial-gradient(120% 90% at 30% 20%, ${a}, ${b})`,
      outline: '1px solid color-mix(in srgb, currentColor 18%, transparent)' });
    const px = markPx(h);                               // in proportion, so the same at any resolution
    Object.assign(preview.style, { font: `500 ${px}px ${MARK_FONT}`, right: `${s.width - (s.width + w) / 2 + px * 1.2}px`,
      top: `${y0 + (hh + h) / 2 - px * 1.1 - px * 0.8}px`, color: light(b) ? MARK_DARK : MARK_LIGHT });
  }
  /** The clip's background, [centre, edge] of the stage's gradient, in the page's colours: a video has no transparency. */
  function background() {
    const css = (v) => getComputedStyle(stage).getPropertyValue(v).trim();
    const name = bg();
    if (name === 'white' || name === 'black') return [name, name];
    if (name !== 'stage') return [css('--paper'), css('--paper')];          // paper, and the checkerboard
    return [mix(css('--stage'), css('--paper'), 0.6), css('--stage')];
  }
  new ResizeObserver(() => open && reframe()).observe(stage);

  function toggle(on) {
    if (busy && !on) busy.stop();
    open = on;
    panel.hidden = !on;
    stage.classList.toggle('recording', on);
    button.setAttribute('aria-pressed', String(on));
    show();
    reframe();
    if (on) handle()?.wake();     // the resize draws a frame anyway; at rest this makes sure
  }
  button.onclick = () => toggle(!open);
  shut.onclick = () => toggle(false);
  go.onclick = () => (busy ? busy.stop() : record().catch((e) => show(`Could not record: ${e.message}`)));

  /* ============================================
   * Recording
   * ============================================ */
  /** Paint one frame of the clip: the background, the silk, the mark. */
  function paint(g, video, w, h) {
    const [a, b] = background();
    g.save();                                           // the stage's own gradient: radial-gradient(120% 90% at 30% 20%, a, b)
    g.translate(w * 0.3, h * 0.2);
    g.scale(w * 1.2, h * 0.9);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    grad.addColorStop(0, a);
    grad.addColorStop(1, b);
    g.fillStyle = grad;
    g.fillRect(-1, -1, 2, 2);
    g.restore();
    g.drawImage(video, 0, 0, w, h);
    if (!opts.mark) return;
    const px = markPx(h);
    g.font = `500 ${px}px ${MARK_FONT}`;
    g.textAlign = 'right';
    g.textBaseline = 'alphabetic';
    g.fillStyle = light(b) ? MARK_DARK : MARK_LIGHT;
    g.fillText(MARK, w - px * 1.2, h - px * 1.1);
  }

  /**
   * Record one clip with the current options (or `over`), and save it unless `save` is false.
   * Resolves to { blob, type, size, width, height, seconds, file }.
   */
  async function record(over = {}, { save = true } = {}) {
    Object.assign(opts, over);
    if (!open) toggle(true);
    else { show(); reframe(); }
    const h = handle();
    if (!type || !h || h.mode !== 'webgl' || busy) throw new Error(busy ? 'already recording' : h ? `the object is ${h.mode}` : 'no object');
    const video = el('video', { muted: true, playsInline: true });
    let raf = 0, stopped = false, timer = 0, rec = null;
    busy = { stop: () => { stopped = true; clearTimeout(timer); if (rec?.state === 'recording') rec.stop(); } };
    show('Getting ready…');
    const source = h.canvas.captureStream();
    video.srcObject = source;
    h.wake();
    await video.play();
    // the first frame of the silk, in the frame's shape (a new frame is a resize: the renderer takes a moment)
    const fits = () => video.videoWidth && Math.abs(video.videoWidth / video.videoHeight - FRAMES[opts.frame]) < 0.03;
    for (let t = 0; t < 80 && !fits(); t++) await sleep(25);
    const w = video.videoWidth & ~1, hh = video.videoHeight & ~1;          // H.264 wants even sizes
    if (!w || !hh || stopped) {
      busy = null;
      source.getTracks().forEach((t) => t.stop());
      show();
      if (stopped) return null;                         // stopped before it started
      throw new Error('the canvas gave no picture');
    }
    const out = el('canvas', { width: w, height: hh }), g = out.getContext('2d');
    const draw = () => { paint(g, video, w, hh); raf = requestAnimationFrame(draw); };
    draw();
    const stream = out.captureStream(30);
    rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8e6 });
    const parts = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    const done = new Promise((r) => { rec.onstop = r; });
    const t0 = performance.now();
    rec.start(250);
    if (opts.motion === 'stroke') {                    // the Lab's own Stroke, then a Touch, on a timetable
      setTimeout(() => !stopped && stroke(), 250);
      setTimeout(() => !stopped && touch(), opts.seconds * 520);
    }
    const tick = setInterval(() => show(`Recording · ${Math.max(0, Math.ceil(opts.seconds - (performance.now() - t0) / 1000))} s`), 200);
    show(`Recording · ${opts.seconds} s`);
    timer = setTimeout(() => busy?.stop(), opts.seconds * 1000 + 200);   // the encoder's first frames come a little late
    await done;
    clearInterval(tick);
    cancelAnimationFrame(raf);
    [...stream.getTracks(), ...source.getTracks()].forEach((t) => t.stop());
    busy = null;
    const blob = new Blob(parts, { type: rec.mimeType || type });
    const seconds = Math.round((performance.now() - t0) / 100) / 10;
    const file = `silkify-${name()}-${opts.frame === 'square' ? 'square' : '9x16'}.${/mp4/.test(blob.type) ? 'mp4' : 'webm'}`;
    const clip = { blob, type: blob.type, size: blob.size, width: w, height: hh, seconds, file };
    if (save) saveAs(blob, file);
    const again = el('a', { href: '#', textContent: 'save again', onclick: (e) => { e.preventDefault(); saveAs(blob, file); } });
    show([`${save ? 'Saved' : 'Made'} ${file}: ${seconds} s, ${w}×${hh}, ${(blob.size / 1048576).toFixed(1)} MB · `, again]);
    return clip;
  }

  return { open: () => toggle(true), close: () => toggle(false), reframe: () => { reframe(); if (open) show(); }, record, stop: () => busy?.stop() };
}

function saveAs(blob, file) {
  const a = el('a', { href: URL.createObjectURL(blob), download: file });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

/** a·k + b·(1 − k) for two #rrggbb colours (color-mix(in srgb, a k, b)). */
function mix(a, b, k) {
  const ch = (c, i) => parseInt(c.slice(i, i + 2), 16);
  return '#' + [1, 3, 5].map((i) => Math.round(ch(a, i) * k + ch(b, i) * (1 - k)).toString(16).padStart(2, '0')).join('');
}

/** Is a colour (#rrggbb, rgb() or a name) light? For the mark: dark on paper, light on black. */
function light(c) {
  if (c === 'white' || c === 'black') return c === 'white';
  const n = c.startsWith('#') ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : (c.match(/[\d.]+/g) || [0, 0, 0]).map(Number);
  return 0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2] > 140;
}
