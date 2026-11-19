/**
 * page.js — the "How silkify works" pages (how-it-works.html, how-it-works.zh.html): the live silk figures and the
 * three drawn ones, wired up with the gallery's rules for many objects on one page.
 *
 *   live figures   silkify() itself (src/silk.js): the hero, the two hares of figure 3, the teapot that counts its
 *                  frames (figure 5) and the live-HTML card (figure 7). Each shows a poster first (a rest frame rendered
 *                  from this page by examples/how/posters.mjs), mounts when it comes into view, is disposed when it leaves,
 *                  and at most MAX_LIVE are alive at once (the least recently used is released): the gallery's pattern,
 *                  so the page never holds more than 3 WebGL contexts.
 *   drawn figures  dome.js (figure 1), light.js (figure 2), waves.js (figure 4): 2D canvases computed on the page,
 *                  started when they come near the viewport. They need no WebGL, so they work everywhere.
 *   static         reduced motion, Save-Data, a very small device (src/tier.js pickTier): nothing is mounted, the posters
 *                  stay (figure 3 shows its "just touched" frames instead), figure 4 draws still frames, the card stays HTML.
 *
 * ?tier=high|low|static forces a tier, as in the gallery; ?poster=1 mounts nothing, for the poster script.
 * Hooks for the check script: window.__how.
 */
import { silkify } from '../../src/silk.js';
import { pickTier } from '../../src/tier.js';
import { idle } from './shapes.js';
import { initDome } from './dome.js';
import { initLight } from './light.js';
import { initWaves } from './waves.js';

/* ============================================
 * Words the scripts write (the rest is in the HTML)
 * ============================================ */
const zh = document.documentElement.lang.startsWith('zh');
const T = zh ? {
  modes: { poster: '还是静态帧：一帧不画', loading: '正在准备', active: '醒着：每一帧都画', tail: '涟漪收尾：每秒 12 帧', sweep: '补光慢慢绕一圈：每秒 12 帧', rest: '睡着了：一帧不画', breeze: '微风：每秒 30 帧', html: '醒着' },
  perSecond: (n) => `最近一秒画了 ${n} 帧`,
  total: (n) => `出现以来共 ${n} 帧`,
  live: (n) => `${n} 个`,
  plainHtml: (why) => `这里显示为普通 HTML：${why}。`,
} : {
  modes: { poster: 'a still poster for now: no frames at all', loading: 'getting ready', active: 'awake: drawing every frame', tail: 'the ripples’ tail: 12 frames a second', sweep: 'one slow loop of the light: 12 frames a second', rest: 'asleep: no frames at all', breeze: 'breeze: 30 frames a second', html: 'awake' },
  perSecond: (n) => `${n} ${n === 1 ? 'frame' : 'frames'} in the last second`,
  total: (n) => `${n} since it appeared`,
  live: (n) => `${n}`,
  plainHtml: (why) => `Shown as plain HTML here: ${why}.`,
};

/* ============================================
 * Page modes
 * ============================================ */
const qs = new URLSearchParams(location.search);
const forced = qs.get('tier') || 'auto';
const posterMode = qs.has('poster');
const tier = pickTier(forced);          // decided once, like the library; 'static' never mounts a renderer
const still = tier.tier === 'static';
const MAX_LIVE = 3;
const root = document.documentElement;
root.classList.toggle('static', still);
root.classList.toggle('poster-mode', posterMode);
const probe = document.createElement('canvas');
probe.setAttribute('content', 'drawable');
root.classList.toggle('no-hic', probe.content !== 'drawable');   // no HTML-in-Canvas: the card's note says so

/* ============================================
 * Live figures: silkify with the gallery's budget
 * ============================================ */
const HARE = { image: 'images/hare.webp', puff: 'cushion' };
const SILK = {
  hero: { image: 'images/pomegranate.webp', puff: 'dome' },
  'mask-on': HARE,
  'mask-off': { ...HARE, silkRest: 1 },
  sleep: { image: 'images/teapot.webp', puff: 'cushion', sheen: 0.5, sheenPower: 14 },
  html: { element: '#how-card' },
};
const live = new Map();                 // id → { handle, used }
// figure 3 without motion: its point is what a touch does, so it shows the frames taken just after one
if (still) {
  for (const id of ['mask-on', 'mask-off']) {
    const img = document.querySelector(`.stage[data-silk="${id}"] .poster`);
    if (img) img.srcset = `how/posters/${id}-touched.webp 1x, how/posters/${id}-touched@2x.webp 2x`;
  }
}
const stageOf = (id) => document.querySelector(`.stage[data-silk="${id}"]`);
const liveCount = document.getElementById('live-count');
const counted = () => { if (liveCount) liveCount.textContent = T.live(live.size); };

function activate(id, extra = {}) {
  const have = live.get(id);
  if (have) { have.used = performance.now(); return have.handle.ready; }
  const stage = stageOf(id), o = SILK[id];
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');   // live HTML: silkify takes it off while the card is in the canvas
  stage.prepend(canvas);
  const poster = o.element ? {} : { poster: `how/posters/${id}.webp` };
  const handle = silkify(canvas, { ...o, ...poster, tier: forced, ...extra });
  live.set(id, { handle, used: performance.now() });
  for (const [other] of [...live].sort((a, b) => a[1].used - b[1].used)) {
    if (live.size <= MAX_LIVE) break;
    if (other !== id && !(pair(id) === other)) release(other);
  }
  counted();
  return handle.ready.then((h) => {
    if (live.get(id)?.handle !== h) return h;
    if (h.mode === 'webgl') stage.classList.add('live');
    if (id === 'html' && h.mode === 'static' && !root.classList.contains('no-hic')) {
      const note = document.getElementById('html-note');
      if (note) note.textContent = T.plainHtml(h.reason);
    }
    return h;
  });
}
const pair = (id) => ({ 'mask-on': 'mask-off', 'mask-off': 'mask-on' })[id];

function release(id) {
  const l = live.get(id);
  if (!l) return;
  live.delete(id);
  l.handle.dispose();
  stageOf(id).classList.remove('live');
  l.handle.canvas.remove();
  counted();
}

if (!still && !posterMode) {
  // in view → mounted (when the browser is idle); out of view → released, its context given back
  const io = new IntersectionObserver((es) => {
    for (const e of es) {
      const id = e.target.dataset.silk;
      if (e.isIntersecting) idle(() => { if (e.target.dataset.seen === '1') activate(id); });
      e.target.dataset.seen = e.isIntersecting ? '1' : '0';
      if (!e.isIntersecting) release(id);
    }
  }, { rootMargin: '120px 0px' });
  for (const id of Object.keys(SILK)) {
    const stage = stageOf(id);
    if (!stage) continue;
    io.observe(stage);
    for (const ev of ['pointerenter', 'pointerdown']) stage.addEventListener(ev, () => activate(id), { passive: true });
  }
}

/* ---- figure 3: one ripple, at the same place, on both ---- */
document.querySelector('button.drop-both')?.addEventListener('click', async () => {
  const hs = await Promise.all([activate('mask-on'), activate('mask-off')]);
  for (const h of hs) h.ripple(0.46, 0.56, { radius: 0.12, depth: 0.6, hold: 220 });   // as examples/how/posters.mjs
});

/* ---- figure 5: the teapot counts its own frames (stats() only reads; it never wakes the loop) ---- */
const meter = document.querySelector('.meter');
if (meter && !still && !posterMode) {
  const [mode, rate, total] = ['mode', 'rate', 'total'].map((k) => meter.querySelector(`[data-k="${k}"]`));
  let before = null;
  setInterval(async () => {
    const l = live.get('sleep');
    if (!l || l.handle.mode !== 'webgl') {
      // not mounted, or mounted as a still frame (no WebGL2): either way the poster shows and nothing is drawn
      const waiting = l?.handle.mode === 'loading';
      before = null;
      mode.textContent = waiting ? T.modes.loading : T.modes.poster;
      meter.dataset.mode = waiting ? 'loading' : 'poster';
      rate.textContent = total.textContent = '';
      return;
    }
    const s = await l.handle.stats();
    mode.textContent = T.modes[s.mode] || s.mode;
    meter.dataset.mode = s.mode;
    rate.textContent = before === null ? '' : T.perSecond(s.frames - before);
    total.textContent = T.total(s.frames);
    before = s.frames;
  }, 1000);
}

/* ============================================
 * Drawn figures: started when they come near the viewport
 * ============================================ */
const reduced = still || matchMedia('(prefers-reduced-motion: reduce)').matches;
let waves = null;
const drawn = new IntersectionObserver((es) => {
  for (const e of es) {
    const f = e.target;
    if (f.id === 'fig-waves') {
      if (e.isIntersecting) { waves ??= initWaves(f, { reduced }); waves.show(true); } else waves?.show(false);
      continue;
    }
    if (!e.isIntersecting || f.dataset.started) continue;
    f.dataset.started = '1';
    idle(() => (f.id === 'fig-dome' ? initDome(f) : initLight(f)));
  }
}, { rootMargin: '300px 0px' });
for (const id of ['fig-dome', 'fig-light', 'fig-waves']) { const f = document.getElementById(id); if (f) drawn.observe(f); }
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => waves?.recolour());

/* ---- hooks for the check script and the poster script ---- */
window.__how = { tier: tier.tier, live, activate, release, ids: Object.keys(SILK) };
