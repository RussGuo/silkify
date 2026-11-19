<!-- Part of the silkify skill: ../SKILL.md links here. Tiers, sleeping, many objects on a page, and what was measured. -->

# Performance and fallbacks

**Three tiers, decided once at mount.** `tier: 'auto'` reads the device; pass `'high'`, `'low'` or `'static'` to force one.

| Tier | Chosen when | Renders |
|---|---|---|
| `high` | anything else (desktop-class) | Live in a worker. Pixel ratio up to 2. Simulation up to 256 cells, mesh up to 240 segments. One idle light loop, then sleep. |
| `low` | `(pointer: coarse)`, a screen < 1024 px on its long side (the screen, not the window: a desktop window split in half stays high), ≤ 4 CPU cores, ≤ 4 GB memory, or a software rasteriser (SwiftShader, llvmpipe), which is detected inside the renderer | Live in a worker. Pixel ratio 1. Simulation ≤ 128 cells, mesh ≤ 120. No idle sweep: frames are drawn only around interaction. |
| `static` | reduced motion, Save-Data, 2G, ≤ 2 cores or ≤ 2 GB, or no WebGL2 / renderable half floats | three.js is never loaded. The canvas shows `poster` (or the picture), drawn once. `handle.reason` says which. |

WebGL2 is probed on the canvas itself, by the renderer (in the worker), before three.js is loaded: no throwaway context on the main thread, which used to cost 2.5 s of main-thread time on a software GPU.

**Resolution follows the object on screen**, not the source picture:
- At most one simulation cell per 3.15 CSS px and one mesh segment per 2.8 CSS px.
- The colour/silhouette texture is as many device pixels as the object covers.

Below the reference grid, the solver takes sub-steps with rescaled constants, so dents and waves keep their size and speed on the object. `handle.info` reports what was chosen.

**The loop sleeps.**
- **Active, every frame:** while the object is touched or held, for 8 s after the last touch, and while the pointer moved over the canvas in the last 2.5 s or the fill light is still travelling. A pointer that moves or is held anywhere else on the page is not passed to the renderer at all, so it never wakes a sleeping object (measured in the Lab: 0 frames in 3 s of moving and holding over the control panel). "Travelling" is judged by distance to its target, not by speed: the idle sweep never has zero speed.
- **Tail, 12 fps, 8–20 s after the last touch:** the solver catches up the steps it skipped. Then the field is cleared.
- **The solver's clock:** one wave step per 1/60 s of wall time, whatever the display draws: a 120 Hz screen steps every other frame, 30 fps steps twice per frame, and a frame slower than 4 steps simply lags. Measured in Firefox 157 with the refresh rate forced to 30, 60 and 120 Hz: 59.8, 60.7 and 59.7 solver steps a second after a `ripple()`. `handle.stats()` reports `steps`. (`stepPerFrame: true` takes one step per frame instead; `scripts/shoot.mjs --gif` uses it for frame-exact recordings.)
- **Rest:** high tier, one idle light loop (≈ 28.6 s at 12 fps). After that, and always in the low tier, no frames at all.
- **Stopped:** off-screen or in a hidden tab.

`breeze` and `autoplay` are off by default because they give up the rest state. Turn them on only where a moving object is worth it, and still only one or two per page:
- **`breeze` > 0:** the loop never rests while visible: instead of sleeping it draws 30 fps, the solver catching up the skipped steps so the motion keeps its speed. On the low tier that is still 30 frames a second of GPU work.
- **`autoplay`:** each drop is a touch, so the usual rules follow it: 60 fps for 8 s, then the tail. With the default 2.5 s interval the loop never leaves the 60 fps state while visible; at `interval` ≥ 20 000 ms it reaches rest between drops, and waits on a single timer instead of drawing.
- `ripple()` is one touch: the same 8 s + tail as a pointer, then rest.
- Off-screen, a hidden tab or reduced motion stops all three. `handle.stats()` reports what the loop is doing.

A lifted finger, a cancelled touch, or a pointer leaving the window ends "hovering", so a phone does not keep rendering its last touch point. If full-speed frames average more than 28 ms, the pixel ratio steps down 2 → 1.5 → 1.

**No MSAA, no depth or stencil buffer.** The triangles never overlap on screen and the outline is cut per pixel by the alpha, so these buffers add nothing. At ratio 2 they would cost about 18 MB per 373 px canvas.

**Many objects on one page.** The pointer costs the same for one object or twenty: every object shares one set of window listeners (`src/pointer.js`), and a pointer move reads the position of a canvas only when it is within 100 px of the viewport, once per move (`test/many.html` checks it with twenty objects: 30 moves, 30 reads for each object in view, 0 for the twelve far below, frames drawn only by the one under the pointer). Each live canvas is a WebGL context, and browsers allow about 16. Use the gallery's pattern (`examples/index.html`):
- Show a **poster** first: an `<img loading="lazy">` WebP at 1x and 2x, rendered by `node scripts/shoot.mjs --posters`.
- **Prewarm** once the page is idle: `prewarm({ tier })` (with the options the objects will use) starts one worker and has it import three.js, without a canvas and without a WebGL context. The next `silkify()` takes that worker, and another is warmed when the page is next idle; on the main-thread path it imports the renderer and three instead, and in the static tier it does nothing. It holds one idle worker with three.js parsed, a few MB, for as long as the page is open.
- Mount `silkify` on the first `pointerenter` or `pointerdown`, and fade the canvas in when `ready` resolves. silkify listens to the pointer from the call on, so the touch that mounted it is not lost: a pointer still over the canvas when the renderer is up hovers and presses at once, and one that already left (a stroke across, a tap) gets one ripple where it first crossed the object.
- On a touch screen (`(hover: none)`) nothing hovers, so nothing would say the objects are alive: keep the hint visible, and the first time a card is mostly in view (60 %), mount it and play one `handle.ripple()` on the object. The static tier (reduced motion) never mounts, so it never moves; the cap below still holds while scrolling.
- `dispose()` it when the card leaves the viewport.
- Keep at most 3 live, releasing the least recently touched.

**The context budget.** A browser keeps a limited number of WebGL contexts per page (Chrome about 16; it drops the oldest when one more is made), and takes contexts back on its own: a phone reclaiming GPU memory from a tab in the background, a GPU driver reset. silkify listens for it (`webglcontextlost`, in the worker too): the object shows its poster or picture at once on a fresh canvas (the old one would keep its last frame, frozen, or go blank; a live element goes back to the page as plain HTML), `mode` turns `'static'` with a `reason`, and when the browser restores the context the renderer is rebuilt, the still frame staying behind the new canvas until its first frame is up, and `mode` is `'webgl'` again. A context dropped for being one too many is not given back, so the still frame stays: count your live objects, keep them at 3 or so, and release them off-screen as above. `test/lost.html` checks a loss and a restore (`WEBGL_lose_context`) for a picture in a worker, with a poster, on the main thread, for words and for a live element: the still frame comes 2–15 ms after the loss on the main thread and 130–180 ms in a worker (when the browser tells the worker), the object is live again 50–250 ms after the restore.

**Measured on the gallery** (`examples/`, ten cards, nothing touched: every card is a poster until someone reaches for it). Lighthouse 12.8.2, mobile preset (simulated 4× CPU slowdown), median of 3 runs, Chrome 156 on an Apple M1 Pro, macOS 26.5. Two GPUs: the real one (headed Chrome, Metal), and SwiftShader, the software GPU of headless Chrome and CI, where creating a WebGL context is slow.

| | v0.2.0 | v0.2.1 |
|---|---|---|
| Performance score, real GPU | 100 | **100** |
| Total Blocking Time, real GPU | 14 ms | **0 ms** |
| Main-thread work, real GPU | 0.25 s | **0.18 s** |
| Performance score, SwiftShader | 69 | **99** |
| Total Blocking Time, SwiftShader | 9,744 ms | **0 ms** |
| Main-thread work, SwiftShader | 10.2 s | **0.16 s** |
| Bytes transferred | 0.48 MB | 0.49 MB |
| Cumulative Layout Shift | 0 | 0 |

v0.2.0 probed WebGL2 by creating a throwaway context on the main thread at load: 15–240 ms on a real GPU, 2.5 s per probe on SwiftShader. v0.2.1 probes the canvas's own context inside the worker.

Measured separately, because Lighthouse never touches the page:
- **First touch of a card, `activate()` → `ready`** (headless Chrome 157, a fresh browser context each run, three.js from the CDN, 3 runs): 1.2–1.4 s without prewarm (3.1 s once, the first run), 0.11–0.12 s after `prewarm()`, on SwiftShader and on the real GPU alike: what is left is building the scene.
- **Main-thread long tasks while one card mounts** (headed Chrome, real GPU, 3 runs): none in a worker; 57–59 ms with `worker: false`. The same in v0.2.0 and v0.2.1.
- **Frames drawn at rest:** 0 in 10 s (`scripts/shoot.mjs`, the Lab in the low tier), in v0.2.0 and v0.2.1 alike, and 0 in 3 s with the pointer moving and held elsewhere on the page (measured on v0.2.1).
- **GPU buffers** (estimate, 373 px card at ratio 2): ≈ 5 MB per live object, at most 3 live, 0 until touched.

**Live HTML (`element`).** The element is printed again only when its rendering changes: the browser fires a `paint` event on the canvas for a change of text, style, layout, focus, hover or selection, and for the caret blinking in a focused editable line (about twice a second). Each paint is one snapshot: captured on the page and transferred to the worker (`captureElementImage`), or uploaded from the element directly on the main thread, then mipmapped, then one frame is drawn. Nothing changes, no paint, no frame: a resting card draws 0 frames, like a resting picture (`scripts/shoot.mjs` checks it: one change, one snapshot, one frame, then 0 frames). Hit geometry is set on mount and when the canvas or the element changes size, never per frame; an element that changes size rebuilds its dome (a new stand-in, the same WebGL context).

Measured on `examples/live.html` (a 420 × 307 px card), 40 text changes each, Chrome 157.0.8103.79 on an Apple M1 Pro, median / 90th percentile:

| | real GPU, headed, ratio 2 (890² texture) | SwiftShader, headless, ratio 1 (446² texture) |
|---|---|---|
| Capture on the page (worker path) | 0.0 / 0.1 ms | 0.0 / 0.1 ms |
| Upload, element rasterised into the texture, to completion (main-thread path) | 1.2 / 2.9 ms | 20.3 / 22.8 ms |
| Mipmaps, to completion | 0.4 / 1.8 ms | 0.5 / 0.6 ms |
| Change → printed, worker path (until the worker has issued the upload) | 2.1 / 2.4 ms | 2.0 / 2.3 ms |

The upload and mipmap rows are timed on the main-thread path with a 1-pixel read-back before and after each call, which waits for the GPU; in a worker the same GPU work happens off the page's thread, and the page itself spends only the capture. On a software GPU the main-thread path costs about 20 ms of main-thread time per change, one more reason to keep the default worker.
