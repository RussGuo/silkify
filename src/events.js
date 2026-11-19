/**
 * events.js — what one object tells the page: the page's callbacks, and the gestures behind three of them.
 *
 *   onPress({ x, y, pointerType })                     a pointer went down on the canvas
 *   onRelease({ x, y, over, held, pointerType })       that press ended: lifted (over: lifted on the canvas), cancelled
 *   onStroke({ x, y, dx, dy, pressed, pointerType })   the pointer moving on the canvas, at most every STROKE_MS
 *   onHover(isOver), onReady(handle), onFail(handle)   called from silk.js (the renderer's hover; the mode settling)
 *
 * Callbacks in the options, as onHover always was, not DOM events: the canvas is swapped for a fresh one on a fallback,
 * a lost context and a restore, so a listener on it would silently go deaf, and the handle is not an EventTarget. An
 * option is one way that works the same in a plain page and as a framework prop. x, y are canvas coordinates 0–1
 * from the top left, as handle.ripple() takes them.
 *
 * A callback that throws is the page's bug, not the renderer's: it is reported as an uncaught error (reportError) and
 * everything else goes on, the frame, the other objects on the shared listeners, the next callback.
 *
 * Live HTML: a press on a control inside the element (a link, a button, a field, editable text) belongs to that control,
 * so it is not reported (the silk still dents under it); a press on its plain words is. `haptics`: one short vibration
 * on a touch or pen press where the browser can (navigator.vibrate), only once the page has had a user gesture, so the
 * browser never logs a refusal. silk.js is the only user: it calls gestures() once per object and feeds it the pointer
 * from pointer.js.
 */

const STROKE_MS = 100;    // onStroke: at most one call per 100 ms (10 a second: enough for a sound or a counter)
const BUZZ_MS = 10;       // haptics: true → one 10 ms pulse, a tick rather than a buzz
// what a press inside a live element belongs to, not the silk
const CONTROLS = 'a[href], button, input, select, textarea, label, summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"]';

const report = (e) => (typeof reportError === 'function' ? reportError(e) : setTimeout(() => { throw e; }));

/** emit(name, arg): call the page's callback o[name] if there is one, never letting it throw into the caller.
 *  Read at call time, so setTheme({ onPress }) swaps it. */
export function emitter(o) {
  return (name, arg) => {
    const f = o[name];
    if (typeof f !== 'function') return;
    try { f(arg); } catch (e) { report(e); }
  };
}

/** p from pointer.js (-1…1, y up) → canvas coordinates (0–1, top left) */
const toCanvas = (p) => ({ x: (p.x + 1) / 2, y: (1 - p.y) / 2 });

function buzz(o, e) {
  if (!o.haptics || e?.pointerType === 'mouse' || typeof navigator.vibrate !== 'function') return;
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;   // the very first tap: refused, and logged
  try { navigator.vibrate(typeof o.haptics === 'number' ? o.haptics : BUZZ_MS); } catch { /* not allowed here: quiet */ }
}

/**
 * The gestures of one object: { down(p, e), move(p, e), out(), up(e, where), cancel() }, called by silk.js beside what it
 * sends the renderer. `listening()` says whether events are wanted now (live or loading, interactive);
 * `canvas()` is the current canvas (live HTML: the element is inside it).
 */
export function gestures({ o, emit, listening, canvas }) {
  let press = null;                  // { at, t, pointerType } while pressed
  let stroke = null;                 // { at, t }: the last onStroke, null when the pointer is not on the canvas
  const ofControl = (e) => {
    const c = canvas(), hit = e?.target instanceof Element ? e.target.closest(CONTROLS) : null;
    return !!hit && hit !== c && c.contains(hit);
  };
  const release = (at, over, t) => {
    const p = press;
    press = null;
    emit('onRelease', { ...p.at, ...at, over, held: Math.round(Math.max(0, t - p.t)), pointerType: p.pointerType });
  };
  return {
    down(p, e) {
      if (!listening() || ofControl(e)) return;
      const at = toCanvas(p), t = e?.timeStamp ?? performance.now();
      press = { at, t, pointerType: e?.pointerType || 'mouse' };
      buzz(o, e);
      emit('onPress', { ...at, pointerType: press.pointerType });
    },
    move(p, e) {
      if (press) press.at = toCanvas(p);
      if (!listening()) return;
      const at = toCanvas(p), t = e?.timeStamp ?? performance.now();
      if (stroke && t - stroke.t < STROKE_MS) return;
      const dx = stroke ? at.x - stroke.at.x : 0, dy = stroke ? at.y - stroke.at.y : 0;
      stroke = { at, t };
      emit('onStroke', { ...at, dx, dy, pressed: !!press, pointerType: e?.pointerType || 'mouse' });
    },
    out() { stroke = null; },
    /** the pointer went up somewhere; where() is its point on the canvas or null (a rect read only for a press) */
    up(e, where) {
      if (!press) return;
      const p = where();
      release(p ? toCanvas(p) : {}, !!p, e?.timeStamp ?? performance.now());
    },
    /** cancelled: a touch that became a scroll, the pointer leaving the window, the window losing focus */
    cancel() {
      stroke = null;
      if (press) release({}, false, performance.now());
    },
  };
}
