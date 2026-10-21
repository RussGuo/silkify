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
- **Active, 60 fps:** while the object is touched or held, for 8 s after the last touch, and while the pointer moved in the last 2.5 s or the fill light is still travelling. "Travelling" is judged by distance to its target, not by speed: the idle sweep never has zero speed.
- **Tail, 12 fps, 8–20 s after the last touch:** the solver catches up the steps it skipped. Then the field is cleared.
- **Rest:** high tier, one idle light loop (≈ 28.6 s at 12 fps). After that, and always in the low tier, no frames at all.
- **Stopped:** off-screen or in a hidden tab.

`breeze` and `autoplay` are off by default because they give up the rest state. Turn them on only where a moving object is worth it, and still only one or two per page:
- **`breeze` > 0:** the loop never rests while visible: instead of sleeping it draws 30 fps, the solver catching up the skipped steps so the motion keeps its speed. On the low tier that is still 30 frames a second of GPU work.
- **`autoplay`:** each drop is a touch, so the usual rules follow it: 60 fps for 8 s, then the tail. With the default 2.5 s interval the loop never leaves the 60 fps state while visible; at `interval` ≥ 20 000 ms it reaches rest between drops, and waits on a single timer instead of drawing.
- `ripple()` is one touch: the same 8 s + tail as a pointer, then rest.
- Off-screen, a hidden tab or reduced motion stops all three. `handle.stats()` reports what the loop is doing.

A lifted finger, a cancelled touch, or a pointer leaving the window ends "hovering", so a phone does not keep rendering its last touch point. If full-speed frames average more than 28 ms, the pixel ratio steps down 2 → 1.5 → 1.

**No MSAA, no depth or stencil buffer.** The triangles never overlap on screen and the outline is cut per pixel by the alpha, so these buffers add nothing. At ratio 2 they would cost about 18 MB per 373 px canvas.

**Many objects on one page.** Each live canvas is a WebGL context, and browsers allow about 16. Use the gallery's pattern (`examples/index.html`):
- Show a **poster** first: an `<img loading="lazy">` WebP at 1x and 2x, rendered by `node scripts/shoot.mjs --posters`.
- Mount `silkify` on the first `pointerenter` or `pointerdown`, and fade the canvas in when `ready` resolves.
- `dispose()` it when the card leaves the viewport.
- Keep at most 3 live, releasing the least recently touched.

**Measured on the gallery** (eight objects; Lighthouse 12.8.2, mobile preset with 4× CPU slowdown, median of 3; headless Chrome):

| | Before (all eight live on the main thread) | After |
|---|---|---|
| Performance score | 73 | **100** |
| Total Blocking Time | 964 ms | **18 ms** |
| Main-thread work | 5.14 s | **0.25 s** |
| Bytes transferred | 8.0 MB | **0.49 MB** |
| CLS | 0.086 | **0** |
| Long task while an object mounts | — | 94 ms on the main thread, **none** in the worker |
| Frames in 10 s of idle (35–45 s after a touch) | 264, never sleeps | **0** |
| GPU buffers (estimate, 373 px card at ratio 2) | ≈ 29 MB × 8 ≈ 230 MB | ≈ 5 MB × ≤ 3 live, 0 until touched |

Lighthouse does not touch the page, so the interactive rows were measured separately in headless Chrome.
