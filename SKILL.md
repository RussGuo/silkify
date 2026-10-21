---
name: silkify
description: Turn a picture into a touchable silk object on a web page. At rest it is matte and photographic; where the pointer touches it, the surface dents, ripples and shines like satin. Use when someone wants to "silkify" a logo, product shot, fruit, animal, portrait, painting, the moon or any other image, or asks for a silk, satin or fabric ripple-on-hover effect, or wants an interactive WebGL hero object made from a PNG. Covers cutting the subject out, inflating its silhouette into a dome, choosing a material and feel (satin, velvet, wet, foil, paper, ink; water, gel, jelly), tuning it live in the Lab, and embedding the three.js renderer in plain HTML or React.
---

# silkify

silkify renders a picture as a physical object made of silk. It does three things:

1. **Silhouette.** It takes the subject's outline from the PNG's alpha channel. An opaque picture becomes a rounded rectangle.
2. **Dome.** It inflates that outline into a smooth 3D surface by solving Poisson's equation (∇²u = −1, height = 2√u). A disc becomes an exact hemisphere, and thin parts bulge less. A picture can also be wrapped on a **sphere** instead (the moon).
3. **Silk.** It runs a wave simulation under the pointer and feeds it into the lighting. The surface is lit by a matte back-scattering model (Lommel–Seeliger, the photometry of the lunar surface). A satin overlay and a soft highlight appear only where ripple energy is non-zero, so the object looks like the original photo at rest and like silk where it is touched.

Files in this skill:

| File | What it is |
|---|---|
| `src/silk.js` | The entry point. `silkify(canvas, options)` returns a handle. It picks a tier, then renders in a Web Worker, on the main thread, or as a still frame. |
| `src/core.js` | The renderer itself (no DOM): render targets, uniforms and the sleeping loop. It runs in the worker, or on the main thread as a fallback. |
| `src/shaders.js` | The GLSL: the wave solver and the object shader, one source for both shapes. |
| `src/presets.js` | `MATERIALS` and `FEELS`: plain option fragments behind `material` and `feel`. |
| `src/worker.js` | The Web Worker entry. |
| `src/tier.js` | Device tiers and grid sizing. |
| `src/shape.js` | Silhouette → dome geometry, using only plain arrays and a 2D canvas. |
| | Copy the whole `src/` folder; the files import each other. The peer dependency is `three` (tested with 0.152.2). |
| `scripts/cutout.py` | Pillow + numpy background keying for pictures that are not already transparent. |
| `scripts/shoot.mjs` | Headless Chrome. The default run checks that every object goes live in its worker and ripples, then that the Lab switches presets, changes the frame on a slider, restores itself from its link and draws 0 frames at rest; it saves rest JPEGs. `--posters` renders the still frames; `--gif` records ripple GIFs (needs ffmpeg); `--lab` renders one picture per preset into `docs/shots/lab/`. It fails on any console error. |
| `examples/index.html` | A working gallery of ten objects, each with the options that make it look right (the last two use presets). It also shows the many-objects pattern: poster first, go live on touch, at most 3 live. Start from the closest card. |
| `examples/lab.html` | The Lab: every option as a live control, presets, your own picture by drop / paste / URL, the options printed ready to copy, and the whole state in the URL hash. Tune here, then paste. |

## Step 1: Get the silhouette right

The input decides the result more than any parameter does. Check the picture before you write code.

**Best input:** a PNG with a transparent background. The subject should be whole (not cropped by the frame) and the long side should be 512–1024 px. Larger files only cost memory and mount time. If the user gives you one of these, skip to step 2.

**Plain background** (studio white, paper, black velvet, a flat colour): key it out.

```bash
python3 scripts/cutout.py input.jpg out.png                        # background = median of the border
python3 scripts/cutout.py input.jpg out.png --bg "#efe6d2" --tolerance 0.14
python3 scripts/cutout.py input.jpg out.png --crop 120,40,980,1010 --keep-largest
```

The script only removes background that is connected to the image border, so white highlights or eyes inside the subject survive. It un-mixes the old backdrop from edge pixels so no halo is left, crops to the subject, downsizes to ≤ 1024 px and feathers the outline by about 1 px. Always open the output and look at it:

- If background remains as speckles or a rim, raise `--tolerance` in 0.02 steps, or pass `--bg` with a colour sampled from the backdrop.
- If parts of the subject were eaten (pale fur, a white collar), lower `--tolerance` or `--softness`.
- If stray islands remain (dust, a signature, a label), add `--keep-largest` or `--crop` them away first.
- Shadows on the backdrop count as subject. Crop them out or raise the tolerance.

**Busy background** (a street, foliage, a room): colour keying will not work. In order of preference:

1. Ask the user for a cut-out PNG, or use a matting tool they already have installed (for example `rembg i in.jpg out.png`). Do not install models without asking.
2. Keep the rectangle. Run `python3 scripts/cutout.py in.jpg out.png --rect`, then use `puff: 'cushion'`. A painting, poster or photo becomes a silk cushion, which often looks better than a rough cut-out. `matte: 'auto'` detects an opaque picture by itself.

**Round things with a full texture** (the moon, a planet, a ball): use `shape: 'sphere'` with a 2:1 equirectangular map. An optional elevation map (`bump`) adds relief near the terminator.

## Step 2: Inflate it (automatic)

`silkify` builds the dome when the picture loads. The only choice is how high it bulges:

| `puff` | Height | Use for |
|---|---|---|
| `'dome'` (1) | a disc becomes a hemisphere | round objects: fruit, drops, pebbles, logos with a round body |
| `'cushion'` (0.6) | pillow | rectangles, paintings, cards, flat animals |
| `'flat'` (0.35) | a soft relief | wide wordmarks, thin or spiky silhouettes, portraits where the face must stay undistorted |
| any number | | the height multiplier itself |

## Step 3: Render it

The canvas sets the size: style it with CSS (for example `width: 100%; aspect-ratio: 1`). The object is contain-fitted with a margin of `fit`.

### Plain HTML (native ES modules)

```html
<canvas id="pear" style="width: 420px; aspect-ratio: 1"></canvas>

<script type="importmap">
  { "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.152.2/build/three.module.js" } }
</script>
<script type="module">
  import { silkify } from './silk/silk.js';            // the whole src/ folder, copied to ./silk/

  const pear = silkify(document.getElementById('pear'), { image: 'pear.png' });
  await pear.ready;                                     // optional: resolves once mounted
  // pear.mode is 'webgl', 'static' (no WebGL2: the picture is drawn once) or 'failed'
</script>
```

The page must be served over http(s), not opened as `file://`, because module imports, workers and image fetches need it. A picture on another origin must send CORS headers.

**Worker and three.js.** By default the renderer runs in a Web Worker on an OffscreenCanvas, so three.js, decoding, the dome and every frame stay off the main thread. Import maps do not apply inside workers, so silk.js resolves `three` on the page (`import.meta.resolve('three')`) and hands the worker that absolute URL. If that does not give an http(s) URL, as in some bundler setups, silk.js renders on the main thread instead. To keep the worker, pass `threeUrl` (in Vite: `import threeUrl from 'three/build/three.module.js?url'`). Pass `worker: false` to force the main thread.

**The canvas belongs to the renderer.** In a worker, the canvas is transferred and cannot be transferred again. If silkify meets a canvas that is already transferred (a remount, or a failed worker falling back), it swaps in a fresh clone with the same attributes. Read the current element from `handle.canvas`.

### React (and Next.js)

```jsx
'use client';                                           // Next.js app router
import { useEffect, useRef } from 'react';
import { silkify } from '@/lib/silk/silk.js';           // copy src/ there; `npm i three`

export default function Silk({ src, options, className }) {
  const ref = useRef(null);
  useEffect(() => {
    const silk = silkify(ref.current, { image: src, ...options });
    return () => silk.dispose();                        // StrictMode's mount → unmount → mount is safe (see above)
  }, [src]);                                            // options are read once; use silk.setTheme() to change them live
  return <canvas ref={ref} className={className} style={{ width: '100%', aspectRatio: '1' }} aria-hidden />;
}
```

To keep three.js out of pages that do not use it, load the component lazily (`next/dynamic` with `ssr: false`, or `React.lazy`). Import a static asset as a URL string (`import pear from './pear.png'`, then `src={pear.src ?? pear}`).

### The handle

| Member | Purpose |
|---|---|
| `ready` | A promise that resolves to the handle once the first frame is on screen, live or static. It never rejects; check `mode`. |
| `mode` | `'loading'`, `'webgl'`, `'static'` or `'failed'` (nothing could be drawn, for example because the image did not load). |
| `tier`, `thread`, `info` | The tier actually used (`'high'`, `'low'` or `'static'`), `'worker'` or `'main'`, and `{ sim, steps, mesh, texture, software }`. |
| `setTheme({ exposure, floor, volume, sheen, albedo, light, … })` | Changes any material, light, ripple or motion option live, for example on a light/dark theme switch. `setTheme({ material: 'wet' })` swaps a preset: every key the group can set goes to the new preset's value or the default first. Scene options (`image`, `shape`, `puff`, `matte`, `corner`, `threshold`, `fit`, `angle`, `tier`, `worker`) need a new `silkify()`. |
| `ripple(x, y, { depth, radius, hold })` | A programmatic touch at canvas coordinates (0–1, top-left origin): a press (`hold` 120 ms of solver frames, `depth` = `pressDepth`, `radius` = `pressRadius`), then the ripples run. It never counts as hovering and never takes the pointer's place; up to 4 at once. Ignored on a miss or with reduced motion. |
| `stats()` | A promise of `{ frames, mode }`: frames drawn since mount and the loop's mode (`'active'`, `'breeze'`, `'tail'`, `'sweep'`, `'rest'`). For measuring sleep; the Lab shows it as fps. |
| `setPhase(f)` | Sphere only: lunar phase from 0 to 1 (0.5 is full, `null` is lit from the front). |
| `wake()` | Restarts a sleeping render loop, for example after you move the canvas yourself. |
| `dispose()` | Removes listeners, observers and GPU resources. Call it on unmount. |

## Parameters

All parameters are optional except `image`. Defaults marked *sphere / image* differ by shape. The fastest way to find values is the Lab (`examples/lab.html`): every option below is a live control there, and it prints the options to copy.

| Option | Default | What it does | Tuning |
|---|---|---|---|
| `image` | (required) | URL, `<img>`, `ImageBitmap` or canvas | PNG with alpha; ≤ 1024 px |
| `shape` | `'image'` | `'image'` inflates the silhouette; `'sphere'` wraps an equirectangular map | |
| **Presets** | | Merged as defaults < `material` < `feel` < your explicit options | |
| `material` | `'silk'` | What the surface is: `'silk'` (the classic look), `'satin'`, `'velvet'`, `'wet'`, `'foil'`, `'paper'`, `'ink'` | see Recipes |
| `feel` | `'silk'` | How it answers a touch: `'silk'`, `'water'`, `'gel'`, `'jelly'` | |
| **Ripple** | | | |
| `pressDepth` | 0.30 | Dent depth under a hovering pointer | 0.15 is a light touch, 0.45 is squishy |
| `pressDepthHold` | 0.60 | Dent depth while the button or finger is down | |
| `pressRadius` | 0.075 | Dent radius, in the moon's UV units (≈ 12% of an image object's width) | 0.05–0.11 |
| `waveSpeed` | 1.6 | Wave propagation per frame (stable below 2) | lower for heavier, slower silk |
| `damping` | 0.996 | Energy kept per frame | 0.99 calms quickly; 0.998 rings longer |
| `displace` | 0.32 | How far the height field moves the surface | 0.2 is subtle; 0.45 is dramatic |
| `ripple` | 62 | Ripple slope → normal perturbation (satin contrast) | 40–80 |
| `silkSpread` | 1 | How far silk spreads from a touch (× the ripple energy that turns matte into silk) | 1.6 for wet; 0.5 keeps silk tight |
| **Material** | | | |
| `sheen` | 0.18 *sphere* / 0.3 *image* | Highlight strength on ripples | dark objects need 0.4–0.6 |
| `sheenPower` | 22 / 16 | Highlight exponent; lower is broader | 12–24 |
| `satin` | 0.9 | Overlay of the satin term at full ripple energy | |
| `albedo` | `null` | `null` uses the picture's colours; `[r, g, b]` (0–1) paints a flat colour, which suits one-colour logos | |
| `grain` | 0 | Procedural fine grain, one texel per device pixel (0–1) | 1 for ink or paper logos |
| `gamma` | 1 | `albedo = pow(albedo, gamma)`; below 1 lifts mid-tones | 0.85–1.15 |
| `exposure` | 1 | Overall brightness of the lit face | |
| `sheenColor` | `[0.9, 0.95, 1]` | Colour of the highlight | warm `[1, 0.85, 0.6]` for gold |
| `anisotropy` | 0 | Highlight stretched across the threads (Kajiya–Kay): 0 round, 1 fully anisotropic | 0.6 satin, 0.8 foil |
| `anisotropyAngle` | 0 | Thread direction in radians (image: in the picture's plane; sphere: along the map's u) | |
| `rim` | 0 | Fresnel edge light, strongest where the surface turns away | 0.2 wet, 0.5 velvet |
| `rimPower` | 3 | Rim falloff; lower is wider | 2–4 |
| `rimColor` | `[1, 1, 1]` | Rim colour; `null` takes the picture's own colour, lifted (velvet pile) | |
| `iridescence` | 0 | The highlight's hue turns with view angle and ripple height (shot silk) | 0.3–0.6 |
| `silkRest` | 0 | How much of the object is silk untouched: 0 only where touched, 1 everywhere | 0.15 velvet, 1 foil |
| **Light** | | | |
| `light` | `[0,0,1]` *sphere* / `[-0.35,0.45,0.82]` *image* | Key light direction in view space (x right, y up, z towards the viewer) | small z means grazing light and strong shading |
| `lightColor` | `[1, 1, 1]` | Key light colour (multiplies the matte term) | `[1, 0.92, 0.82]` for warm light |
| `satinLight` | `[0.5, 0.6, 0.45]` | Direction of the light the satin and the highlight use | |
| `floor` | 0.05 / 0.55 | Brightness on the side facing away from the light (lunar "earthshine") | raise it on light pages so the dark side is not a hole |
| `volume` | 0.28 | Fill-light gradient across the object (0 = none) | |
| `fillLight` | `true` | The fill light follows the pointer, springs home and sweeps slowly when idle | |
| `idleSweep` | `true` | High tier: after the pointer leaves, the fill light (and a sphere's spin) makes one slow loop (≈ 28.6 s at 12 fps), then nothing is drawn. The low tier never sweeps. | `false` makes the loop stop as soon as the ripples have died away |
| **Motion** | | | |
| `autoplay` | `false` | `true` or `{ interval: 2500, depth: 0.3, radius }`: a drop at a random point inside the outline (a sphere: its visible face) every `interval` ms while visible, skipped while someone touches it | costs frames, see Performance |
| `breeze` | 0 | A slow drifting noise field keeps the whole surface faintly alive (0–1) | 0.3 is a breath, 1 is wind; costs 30 fps, see Performance |
| **Shape (image)** | | | |
| `puff` | `'dome'` | `'dome'`, `'cushion'`, `'flat'` or a number (see step 2) | |
| `matte` | `'auto'` | `'alpha'` uses the PNG's alpha; `'rect'` uses the whole picture as a rounded rectangle; `'auto'` picks one | |
| `corner` | 0.06 | Corner radius of `'rect'`, as a fraction of the short side | |
| `threshold` | 0.5 | Alpha that counts as inside | |
| `fit` | 1.3 | Canvas extent ÷ object extent; leaves room for the bulge | 1.15 is tight, 1.5 is airy |
| **Shape (sphere)** | | | |
| `phase` | `null` | Lunar phase 0–1; overrides `light` | 0.35–0.42 gives a gibbous moon |
| `bump` | `null` | Elevation map URL (same projection) for relief near the terminator | |
| `bumpStrength` | 7 | | 20 on dark pages |
| `spin`, `spinSpeed`, `angle` | `true`, 0.006, 0 | Slow rotation of the texture; initial longitude offset (0–1) | |
| **Runtime** | | | |
| `interactive` | `true` | `false` keeps it still and ignores the pointer | |
| `tier` | `'auto'` | `'high'`, `'low'` or `'static'` forces a tier (see Performance) | `'low'` for a page that must stay light |
| `worker` | `'auto'` | Render in a Web Worker when the browser can; `false` keeps rendering on the main thread | |
| `threeUrl` | — | Absolute URL of `three.module.js` for the worker (default: `import.meta.resolve('three')`) | needed with some bundlers |
| `dpr` | per tier (2 / 1) | Device-pixel-ratio cap; the renderer lowers it further (2 → 1.5 → 1) if frames take > 28 ms | |
| `reducedMotion` | `'auto'` | Follows `prefers-reduced-motion`, which selects the static tier; `true` or `false` to force | |
| `poster` | — | A still frame of this canvas, shown in the static tier (default: the picture, drawn flat) | render one with `scripts/shoot.mjs --posters` |
| `onHover` | — | `(isOver) => {}` | for a cursor or caption change |

### Recipes (from the gallery)

| Subject | Options |
|---|---|
| One-colour logo as ink | `albedo: [0.15,0.15,0.165], grain: 1, light: [-0.66,0.72,0.2], exposure: 2.2, floor: 0.42, volume: 0.3, sheen: 0.5, sheenPower: 14` |
| Photo of an object (fruit, teapot, animal) | defaults; `puff: 'dome'` for round subjects, `'cushion'` for flat ones |
| Painting or poster | `puff: 'cushion'`, `floor: 0.6`, `sheen: 0.25` (opaque PNG ⇒ rectangle) |
| The moon on a light page | `shape: 'sphere', bump, phase: 0.38, floor: 0.6, bumpStrength: 7` |

**Presets.** `material` and `feel` set many options at once; anything you also write explicitly wins. Pictures of each are in `docs/shots/lab/`.

| `material` | Sets | Reads as |
|---|---|---|
| `'silk'` | nothing | the classic look: matte photograph, silk where touched |
| `'satin'` | `sheen: 0.55, sheenPower: 9, anisotropy: 0.6` | broad pale highlights drawn out along the threads |
| `'velvet'` | `floor: 0.3, sheen: 0.04, rim: 0.5, rimPower: 2.2, rimColor: null, silkRest: 0.15` | deep body, edges glowing in their own colour, almost no shine |
| `'wet'` | `sheen: 1.1, sheenPower: 40, rim: 0.2, silkSpread: 1.6, silkRest: 0.35` | a gloss even at rest; touched, sharp white glints |
| `'foil'` | `silkRest: 1, anisotropy: 0.8, iridescence: 0.5, grain: 0.3` | metallic all over, the highlight streaked and shifting hue |
| `'paper'` | `sheen: 0.06, satin: 0.35, grain: 0.9, displace: 0.14, floor: 0.7, volume: 0.15` | flat, grainy, dents without shine |
| `'ink'` | the ink-drop card without `albedo` and with `exposure: 1.35` | raking light, grain, hard shadow |

| `feel` | Sets | Moves like |
|---|---|---|
| `'silk'` | nothing | the classic: medium waves that ring for a few seconds |
| `'water'` | `waveSpeed: 1.9, damping: 0.998, displace: 0.22, ripple: 80, pressRadius: 0.05` | small fast rings that run a long time |
| `'gel'` | `waveSpeed: 1.0, damping: 0.985, displace: 0.45, pressDepth: 0.45` | a deep, slow dent that settles at once |
| `'jelly'` | `waveSpeed: 1.3, damping: 0.993, displace: 0.5, pressDepthHold: 0.8` | big wobbles; holding pushes far in |

```js
silkify(canvas, { image: 'pear.png', material: 'velvet' });
silkify(canvas, { image: 'teapot.png', puff: 'cushion', material: 'wet', feel: 'water' });
silkify(canvas, { image: 'logo.png', material: 'ink', albedo: [0.15, 0.15, 0.165], exposure: 2.2 });   // the ink-drop card
silkify(canvas, { image: 'pear.png', material: 'satin', autoplay: true });                           // a hero that moves by itself
```

## Performance and fallbacks

**Three tiers, decided once at mount.** `tier: 'auto'` reads the device; pass `'high'`, `'low'` or `'static'` to force one.

| Tier | Chosen when | Renders |
|---|---|---|
| `high` | anything else (desktop-class) | Live in a worker. Pixel ratio up to 2. Simulation up to 256 cells, mesh up to 240 segments. One idle light loop, then sleep. |
| `low` | `(pointer: coarse)`, viewport < 1024 px, ≤ 4 CPU cores, ≤ 4 GB memory, or a software rasteriser (SwiftShader, llvmpipe), which is detected inside the renderer | Live in a worker. Pixel ratio 1. Simulation ≤ 128 cells, mesh ≤ 120. No idle sweep: frames are drawn only around interaction. |
| `static` | reduced motion, Save-Data, 2G, ≤ 2 cores or ≤ 2 GB, or no WebGL2 / renderable half floats | three.js is never loaded. The canvas shows `poster` (or the picture), drawn once. |

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

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Dark fringe or jagged black specks along the outline | Background colour baked into edge pixels, or a hard 1-bit alpha | Re-run `cutout.py` (it un-mixes edges and feathers). Use a PNG with a soft alpha edge. Avoid a very grazing `light` (z below 0.2). |
| A crease or dark notch where a tail, stem or ear meets the body | Concave corner in the silhouette, where the dome pinches | Use a smaller `puff` (`'cushion'`), feather the alpha more (`--feather 2`), or smooth that corner in the PNG |
| Background halo (white or grey rim) | Keying tolerance too low | `--tolerance` +0.02, or `--bg` with the exact backdrop colour |
| Too grey or flat | `floor` too high, or `light` too frontal | Lower `floor` (0.35) and give `light` a smaller z (0.5); raise `volume` |
| Too bright or washed out | `exposure` or `gamma` | `exposure: 0.9`; `gamma: 1.1` |
| Dark object shows no silk | Overlay cannot lift a dark albedo | Raise `sheen` to 0.5 and lower `sheenPower` to 14 |
| The ripple is invisible | Pointer events blocked by an overlay, or `interactive: false` / reduced motion | Check `pointer-events` on elements above the canvas |
| Ripples feel jittery or slow on a 120 Hz display | The simulation steps once per frame | Lower `waveSpeed` (1.2) and raise `damping` slightly |
| Live on desktop, but a still image on a phone | The static tier: reduced motion, Save-Data, or no WebGL2 in workers or on the page | Expected. Ship a `poster`. Force `tier: 'low'` only if the user really wants motion there. |
| Works, but `handle.thread` is `'main'` | The worker could not load three.js (bundler, CSP) | Pass `threeUrl`, or accept the main thread |
| Black square or nothing at all | Page opened as `file://`, image CORS, or an unsized canvas | Serve over http, check CORS headers, and give the canvas a CSS size |

## Verify before you hand it over

1. Serve the page (`npx serve .`) and move the pointer across every object. Each should stay matte until touched and ripple only where touched.
2. For a gallery like `examples/`, run `node scripts/shoot.mjs`. It activates every object in headless Chrome and checks three things: each mounts with WebGL in its worker, each visibly changes under a pointer stroke, and the console has no errors. It exits non-zero otherwise. It also saves rest JPEGs to `docs/shots/`; look at them. Re-render posters with `--posters` whenever the look changes, or the static tier will no longer match the live one.
3. Test a narrow viewport (375 px, low tier) and `prefers-reduced-motion` (static tier).
