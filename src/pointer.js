/**
 * pointer.js — one set of window pointer listeners for every silkify() on the page.
 *
 * A page with one hero object would not notice, but a product grid or a logo wall of 20 objects with listeners of
 * their own did 20 handlers and 20 getBoundingClientRect() calls per pointer event. Here there is one handler per
 * event type, attached while at least one object follows the pointer and removed with the last one, and a rect is read
 * only for an object that is near the viewport (`near()`: silk.js's IntersectionObserver, 100 px margin). An object far
 * off-screen cannot be under the pointer, so it costs nothing; if it was being touched, it is told the pointer left.
 *
 * What each object does with the pointer (keeping it while loading, sending it to its renderer, the page's onPress and
 * the like: events.js) stays in silk.js: a member is { canvas(), near(), move(p, e), out(), down(p, e),
 * up(mouse, e, where), leave() }, p = { x, y } in -1…1 with y up, e the PointerEvent. Only what happens over an
 * object's canvas reaches it, so a pointer moving or held anywhere else wakes nothing.
 * silk.js is its only user: `follow(member)` returns the function that stops following.
 */

const members = new Set();
let ctl = null;

/** Where an event is on a canvas, or null when it is not over it. One getBoundingClientRect(). */
function at(canvas, e) {
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  return r.width && r.height && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x: x * 2 - 1, y: 1 - y * 2 } : null;
}

function attach() {
  ctl = new AbortController();
  const on = { signal: ctl.signal, passive: true };
  const all = (f) => () => { for (const m of members) f(m); };
  window.addEventListener('pointermove', (e) => {
    for (const m of members) {
      const p = m.near() ? at(m.canvas(), e) : null;
      if (p) m.move(p, e); else m.out();
    }
  }, on);
  window.addEventListener('pointerdown', (e) => {
    for (const m of members) {
      const p = m.near() ? at(m.canvas(), e) : null;
      if (p) m.down(p, e);
    }
  }, on);
  // a mouse that lets go is still there; a lifted finger or pen is not (else its last point "hovers" forever)
  // where(): the point on that canvas or null, read only by an object that was pressed (most objects never ask)
  window.addEventListener('pointerup', (e) => {
    for (const m of members) m.up(e.pointerType === 'mouse', e, () => (m.near() ? at(m.canvas(), e) : null));
  }, on);
  window.addEventListener('pointercancel', all((m) => m.leave()), on);   // a touch that turns into a scroll
  document.documentElement.addEventListener('pointerleave', all((m) => m.leave()), on);
  window.addEventListener('blur', all((m) => m.leave()), on);
}

/** Start following the pointer for one object; the returned function stops it (safe to call twice). */
export function follow(member) {
  members.add(member);
  if (!ctl) attach();
  return () => {
    if (!members.delete(member) || members.size) return;
    ctl.abort();
    ctl = null;
  };
}
