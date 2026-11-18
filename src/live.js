/**
 * live.js — live HTML, the page side: `silkify(canvas, { element })` prints a real element on the silk with
 * HTML-in-Canvas (Chrome 157+), and the element stays text in the page: selectable, clickable, editable, found by
 * the browser's search and read by screen readers. silk.js calls this file; core.js does the printing.
 *
 *   support      detected by the feature itself, never by the browser's name: <canvas content="drawable">, its paint
 *                event, requestPaint(), updateElementGeometry() and WebGL2's texElementSubImage2D(); the worker also
 *                needs captureElementImage() (a transferable ElementImage). Only the current generation of the API is
 *                recognised (the older layoutsubtree / texElementImage2D existed only in expired origin-trial builds).
 *   stand-in     the dome is built from a picture of the element's own box: its size, its border-radius, its
 *                background colour. The element's picture then replaces it, alpha included, so its rounded corners
 *                are the outline.
 *   when to shoot  the browser fires `paint` on the canvas whenever the element's rendering changes (text, style,
 *                layout, focus, selection, hover, the caret blinking); each paint is one snapshot: captured on the page
 *                and transferred to the worker, or uploaded from the element directly on the main thread. Nothing
 *                changes → no paint, no snapshot, no frame. requestPaint() asks for one more (after a rebuild).
 *   geometry     the camera is orthographic and the silk moves only along the line of sight, so the element is drawn
 *                where its flat rectangle is: one fixed scale and offset, set on mount, when the canvas or the
 *                element changes size, never per frame. By default it is 1:1 (fit = canvas ÷ element): the words are
 *                the size they are in the page. An element larger than the canvas is shrunk to fit, with a margin, and
 *                says so once (console.warn). An explicit `fit` scales it like a picture, and is never second-guessed.
 *   stand-off    while the element is in the canvas, an invisible box of its size holds its place in the page (same
 *                display, margins and flex / grid placement, no hit testing), so the layout around it does not move:
 *                a stage the element held open stays open. It follows the element's size, and leaves with it.
 *   giving up    no picture with anything in it within 4 s of the canvas being visible → the element goes back
 *                where it was, as plain HTML (silk.js turns that into mode 'static', its reason and one warn).
 *
 * The element moves into the canvas only once the renderer is running, and goes back to where it was (the stand-off's
 * place) on dispose() or any failure; either way it keeps the focus and the selection inside it (move()). While it is in the canvas the canvas belongs to the library: an aria-hidden on it would hide the
 * element from assistive technology too, so it is removed, and put back on the way out.
 */

const FIRST_PICTURE_MS = 4000;   // visible time allowed for the first picture with something in it
const STAND_IN_SCALE = 2;        // the stand-in's pixels per CSS px (the dome's outline is cut from it)
const ROOM = 0.92;               // an element larger than the canvas is shrunk to this share of it (a margin all round)
/* what the stand-off copies from the element, so it takes the same place in the page's layout */
const PLACED = ['marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'float', 'flexGrow', 'flexShrink', 'flexBasis', 'order',
  'alignSelf', 'justifySelf', 'gridRowStart', 'gridRowEnd', 'gridColumnStart', 'gridColumnEnd', 'verticalAlign'];

/* ---- support: { main, worker } — main: printable on the main thread; worker: also capturable for a worker ---- */
let support;
export function liveSupport() {
  if (support) return support;
  support = { main: false, worker: false };
  try {
    const c = document.createElement('canvas');
    c.setAttribute('content', 'drawable');
    const P = HTMLCanvasElement.prototype;
    support.main = c.content === 'drawable' && 'onpaint' in P && 'requestPaint' in P && 'updateElementGeometry' in P
      && typeof WebGL2RenderingContext !== 'undefined' && 'texElementSubImage2D' in WebGL2RenderingContext.prototype;
    support.worker = support.main && 'captureElementImage' in P && typeof ElementImage !== 'undefined';
  } catch { /* no support */ }
  return support;
}

/** `element` as given (an Element or a selector) → the Element; throws on anything else. */
export function resolveElement(x) {
  const el = typeof x === 'string' ? document.querySelector(x) : x;
  if (!(typeof Element !== 'undefined' && el instanceof Element)) {
    throw new TypeError(typeof x === 'string'
      ? `silkify: options.element '${x}' matched nothing: call silkify() after the element is in the DOM`
      : `silkify: options.element must be an element or a selector that matches one (not ${String(x)})`);
  }
  return el;
}

/** border-radius of one corner, in px: "12px", "12px 6px" or percentages of the box. */
function corner(value, w, h) {
  const [a, b = a] = String(value || '0').split(/\s+/);
  const px = (t, of) => (t.endsWith('%') ? (parseFloat(t) / 100) * of : parseFloat(t) || 0);
  return { x: px(a, w), y: px(b, h) };
}

/** The stand-in: the element's box with its corners and background, STAND_IN_SCALE px per CSS px. */
function standIn(el, w, h) {
  const cs = getComputedStyle(el), k = STAND_IN_SCALE;
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(w * k));
  c.height = Math.max(2, Math.round(h * k));
  const g = c.getContext('2d');
  const radii = [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomRightRadius, cs.borderBottomLeftRadius]
    .map((v) => { const r = corner(v, w, h); return { x: r.x * k, y: r.y * k }; });
  const bg = cs.backgroundColor;
  g.fillStyle = !bg || /^transparent$|rgba\([^)]*,\s*0\)$/.test(bg) ? '#fff' : bg;
  g.beginPath();
  g.roundRect(0, 0, c.width, c.height, radii);
  g.fill();
  return c;
}

/** The element's layout box (a transform does not change it), in fractional CSS px. */
function layoutBox(el) {
  const r = el.getBoundingClientRect();
  return getComputedStyle(el).transform === 'none' ? { w: r.width, h: r.height } : { w: el.offsetWidth, h: el.offsetHeight };
}

/** The stand-off: an invisible, inert box that keeps the element's place in the page while it is in the canvas. */
function standOff(el, { w, h }) {
  const cs = getComputedStyle(el), d = document.createElement('div');
  for (const k of PLACED) d.style[k] = cs[k];
  Object.assign(d.style, {
    display: cs.display === 'inline' ? 'inline-block' : cs.display,
    position: cs.position === 'absolute' || cs.position === 'fixed' ? cs.position : 'static',
    boxSizing: 'border-box', width: `${w}px`, height: `${h}px`, minWidth: '0', minHeight: '0', maxWidth: 'none', maxHeight: 'none',
    padding: '0', border: '0', visibility: 'hidden', pointerEvents: 'none',
  });
  d.setAttribute('aria-hidden', 'true');
  d.setAttribute('data-silkify-stand-off', '');
  return d;
}

/**
 * Move `node` into `parent` before `ref` without taking the focus or the selection away from what is inside it.
 * moveBefore() keeps both where the browser has it; otherwise (or if it refuses) the node is re-inserted and the
 * focus and the document selection are put back.
 */
function move(node, parent, ref = null) {
  const active = node.contains(document.activeElement) ? document.activeElement : null;
  const sel = getSelection();
  const kept = sel?.rangeCount && node.contains(sel.anchorNode) && node.contains(sel.focusNode)
    ? [sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset] : null;
  try { parent.moveBefore(node, ref); } catch { parent.insertBefore(node, ref); }   // no moveBefore: a TypeError, caught
  if (active && document.activeElement !== active) active.focus({ preventScroll: true });
  if (kept && (sel.anchorNode !== kept[0] || sel.anchorOffset !== kept[1] || sel.focusNode !== kept[2] || sel.focusOffset !== kept[3])) {
    try { sel.setBaseAndExtent(...kept); } catch { /* the nodes changed meanwhile: leave it */ }
  }
}

/**
 * The live element for one silkify() call.
 *   ctx: { canvas() → the current canvas, send(m, transfer), o (the options, read and written: image, fit),
 *          fitAuto (no explicit fit: 1:1), visible() → whether the canvas can paint now }
 */
export function liveElement(element, ctx) {
  const { o } = ctx;
  let home = null, hidden = null, size = null, thread = null, ctl = null, ro = null, stub = null;
  let reshaping = false, settle = null, warned = false;

  /** fit for 1:1 (canvas ÷ element); an element that does not fit is shrunk to ROOM of the canvas, said once. */
  function fitFor(cw, ch, w, h) {
    const one = Math.min(cw / w, ch / h);
    if (one >= 1 || !Number.isFinite(one) || one <= 0) return one;
    if (!warned) {
      warned = true;
      const px = (a, b) => `${Math.round(a)}×${Math.round(b)} px`;
      console.warn(`silkify: the element (${px(w, h)}) is larger than the canvas (${px(cw, ch)}): it is drawn at ${Math.round(one * ROOM * 100)}% to fit. Give the canvas room for the element, or pass fit to choose the scale.`);
    }
    return 1 / ROOM;
  }
  const boxOf = () => ({ w: element.offsetWidth, h: element.offsetHeight });

  /** The rectangle the element is drawn in, as the browser must know it for hit testing (CSS px of the canvas). */
  function place() {
    const canvas = ctx.canvas();
    if (!home || element.parentNode !== canvas || !size) return;
    const cw = canvas.clientWidth, ch = canvas.clientHeight, { w, h } = size;
    if (!cw || !ch) return;
    const halfH = Math.max(o.fit * (h / w), o.fit / (cw / ch));   // core.js applyView: the camera's half height
    const k = ch / halfH / w;                                     // the element is 2 world units wide
    canvas.updateElementGeometry(element, { canvasTransform: new DOMMatrix([k, 0, 0, k, (cw - k * w) / 2, (ch - k * h) / 2]) });
  }

  function onPaint() {
    if (reshaping || element.parentNode !== ctx.canvas()) return;
    if (thread === 'worker') {
      let img;
      try { img = ctx.canvas().captureElementImage(element); } catch { return; }   // no paint record yet: the next paint
      ctx.send({ t: 'html', img }, [img]);
    } else {
      ctx.send({ t: 'html', img: element });   // the main-thread renderer uploads inside this paint event
    }
  }

  /* ---- the element changed size: 1:1 keeps it 1:1, and the dome is rebuilt for the new box ---- */
  async function resizedElement(entry) {
    const bb = entry?.borderBoxSize?.[0], b = bb ? { w: bb.inlineSize, h: bb.blockSize } : boxOf();
    if (stub && b.w && b.h) Object.assign(stub.style, { width: `${b.w}px`, height: `${b.h}px` });   // the page keeps its place
    if (!size || !b.w || !b.h || (Math.abs(b.w - size.w) < 0.5 && Math.abs(b.h - size.h) < 0.5)) return;
    size = b;
    const canvas = ctx.canvas();
    if (ctx.fitAuto) o.fit = fitFor(canvas.clientWidth, canvas.clientHeight, b.w, b.h);
    reshaping = true;
    const picture = await createImageBitmap(standIn(element, b.w, b.h));
    ctx.send({ t: 'shape', picture, patch: { fit: o.fit } }, [picture]);
  }

  return {
    /** Before a renderer starts: measure the element where it is, and give the renderer its stand-in and fit. */
    prepare() {
      const b = boxOf();
      if (!b.w || !b.h) return false;
      size = b;
      o.image = standIn(element, b.w, b.h);
      if (ctx.fitAuto) {
        const canvas = ctx.canvas();
        o.fit = fitFor(canvas.clientWidth, canvas.clientHeight, b.w, b.h);
      }
      return true;
    },

    /** The renderer is up: move the element in and wait for its first picture. Resolves true, or false on dispose;
     *  rejects with a reason when no picture with anything in it comes. */
    start(onWorker) {
      thread = onWorker ? 'worker' : 'main';
      const canvas = ctx.canvas();
      home = { parent: element.parentNode, next: element.nextSibling };
      stub = standOff(element, layoutBox(element));
      element.parentNode?.insertBefore(stub, element);
      hidden = canvas.getAttribute('aria-hidden');
      canvas.removeAttribute('aria-hidden');
      canvas.setAttribute('content', 'drawable');
      element.setAttribute('drawable', '');
      move(element, canvas);   // with its focus and selection: typing in it goes on
      ctl = new AbortController();
      canvas.addEventListener('paint', onPaint, { signal: ctl.signal });
      ro = new ResizeObserver((es) => { resizedElement(es[es.length - 1]).catch(() => { reshaping = false; }); });
      ro.observe(element);
      place();
      // inside the canvas the element is laid out against it: a different box rebuilds the dome (the observer's first
      // call would too; this one does not wait for it)
      resizedElement().catch(() => { reshaping = false; });
      canvas.requestPaint();
      return new Promise((resolve, reject) => {
        let waited = 0;
        const timer = setInterval(() => {
          if (ctx.visible()) waited += 250;
          if (waited >= FIRST_PICTURE_MS) {
            clearInterval(timer);
            settle = null;
            reject(new Error('HTML-in-Canvas gave no picture of the element (the canvas stayed empty): it stays plain HTML'));
          }
        }, 250);
        settle = (ok) => { clearInterval(timer); settle = null; resolve(ok); };
        ctl.signal.addEventListener('abort', () => settle?.(false), { once: true });
      });
    },

    /** Messages from the renderer: html { ok, empty } after each snapshot, shaped after a rebuild. */
    received(m) {
      if (m.t === 'html' && m.ok && !m.empty) settle?.(true);
      else if (m.t === 'shaped') {
        reshaping = false;
        place();
        ctx.canvas().requestPaint();
      }
    },

    /** The canvas changed size: 1:1 stays 1:1 (the renderer gets the new fit before the new view), geometry follows. */
    resized() {
      if (!home || !size) return;
      const canvas = ctx.canvas();
      if (ctx.fitAuto) {
        const fit = fitFor(canvas.clientWidth, canvas.clientHeight, size.w, size.h);
        if (fit !== o.fit && Number.isFinite(fit) && fit > 0) { o.fit = fit; ctx.send({ t: 'options', patch: { fit } }); }
      }
      place();
    },

    /** Back to where it was, as plain HTML: dispose(), a failure, or a fallback. */
    restore() {
      ctl?.abort();
      ro?.disconnect();
      ctl = ro = null;
      if (!home) return;
      const canvas = element.parentNode;
      element.removeAttribute('drawable');
      if (stub?.parentNode) move(element, stub.parentNode, stub);   // where it was, even if the page changed around it
      else if (home.parent) move(element, home.parent, home.next && home.next.parentNode === home.parent ? home.next : null);
      else element.remove();
      stub?.remove();
      stub = null;
      if (canvas instanceof HTMLCanvasElement) {
        canvas.removeAttribute('content');
        if (hidden !== null) canvas.setAttribute('aria-hidden', hidden);
      }
      home = null;
    },
  };
}
