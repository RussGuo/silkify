# silkify reference (v0.2.0)

The full skill and its references in one file. Source: https://github.com/RussGuo/silkify

# silkify

silkify renders a picture as a physical object made of silk:

1. **Silhouette.** The subject's outline comes from the PNG's alpha channel. An opaque picture becomes a rounded rectangle.
2. **Dome.** The outline is inflated into a smooth 3D surface (a Poisson solve: a disc becomes a hemisphere, thin parts bulge less). A picture can also be wrapped on a **sphere** (the moon).
3. **Silk.** A wave simulation runs under the pointer and feeds the lighting. At rest the surface is matte (Lommel–Seeliger, the photometry of the Moon), so it looks like the original photo; where it ripples, a satin overlay and a highlight appear, so it looks like silk where it is touched.

Work through the steps in order: get the code, get the silhouette right, pick the puff, the material and the feel, render, verify.

## Get the code

There are two ways. Pick one before writing any markup.

**(a) From the CDN, nothing to copy.** Import the entry point straight from jsDelivr, pinned to a release tag:

```
https://cdn.jsdelivr.net/gh/RussGuo/silkify@v0.2.0/src/silk.js
```

`@v0.2.0` never changes. `@main` follows the repository and will change under you; use it only to try the newest version. The rest of `src/` loads from the same place automatically.

The renderer still runs in a Web Worker: a page cannot start a worker from another origin, so silk.js starts a same-origin `blob:` worker that imports the CDN one (tested in headless Chrome: `handle.thread` is `'worker'`).

**(b) Copy `src/` into the project.** Use this with a bundler, offline, or under a Content-Security-Policy that blocks the CDN. Copy the whole folder; the files import each other. The peer dependency is `three` (tested with 0.152.2).

The helper scripts are in the same repository: `https://cdn.jsdelivr.net/gh/RussGuo/silkify@v0.2.0/scripts/cutout.py` (download it with `curl -O` when you need it).

| File | What it is |
|---|---|
| `src/silk.js` | The entry point. `silkify(canvas, options)` returns a handle. It picks a tier, then renders in a Web Worker, on the main thread, or as a still frame. |
| `src/core.js`, `src/shaders.js` | The renderer (no DOM) and its GLSL. |
| `src/presets.js` | `MATERIALS` and `FEELS`: plain option fragments behind `material` and `feel`. |
| `src/worker.js`, `src/tier.js`, `src/shape.js` | The worker entry, device tiers, and silhouette → dome geometry. |
| `scripts/cutout.py` | Pillow + numpy background keying for pictures that are not already transparent. |
| `scripts/shoot.mjs` | Headless Chrome: checks that every gallery object goes live in its worker and ripples and that the Lab works; renders posters (`--posters`), GIFs (`--gif`), preset pictures (`--lab`), and checks the CDN build (`--cdn`). Fails on any console error. |
| `examples/index.html` | A working gallery of ten objects with the options that make each look right, and the many-objects pattern (poster first, go live on touch, at most 3 live). Start from the closest card. |
| `examples/lab.html` | The Lab ([live](https://russguo.github.io/silkify/examples/lab.html)): every option as a live control, presets, your own picture, Touch and Stroke buttons, hold B to compare with the defaults, and the options printed ready to copy. |
| `examples/cdn.html` | The smallest page that uses the CDN build. |
| `references/` | [parameters.md](https://github.com/RussGuo/silkify/blob/v0.2.0/references/parameters.md) (every option, presets, recipes), [performance.md](https://github.com/RussGuo/silkify/blob/v0.2.0/references/performance.md) (tiers, sleeping, many objects, measurements), [troubleshooting.md](https://github.com/RussGuo/silkify/blob/v0.2.0/references/troubleshooting.md). Read them when a step below points there. |

## Step 1: Get the silhouette right

The input decides the result more than any parameter does. Check the picture before you write code.

**Best input:** a PNG with a transparent background, the subject whole (not cropped by the frame), long side 512–1024 px. If the user gives you one of these, skip to step 2.

**Plain background** (studio white, paper, black velvet, a flat colour): key it out with `scripts/cutout.py`.

```bash
python3 scripts/cutout.py input.jpg out.png                        # background = median of the border
python3 scripts/cutout.py input.jpg out.png --bg "#efe6d2" --tolerance 0.14
python3 scripts/cutout.py input.jpg out.png --crop 120,40,980,1010 --keep-largest
```

It removes only background connected to the border, un-mixes the backdrop from edge pixels, crops, downsizes to ≤ 1024 px and feathers the outline. Always look at the output.

- Background left as speckles or a rim: raise `--tolerance` in 0.02 steps, or pass `--bg` sampled from the backdrop.
- Parts of the subject eaten (pale fur, a white collar): lower `--tolerance` or `--softness`.
- Stray islands (dust, a signature): `--keep-largest`, or `--crop` them away first. Cast shadows count as subject: crop them or raise the tolerance.

**Busy background** (a street, foliage, a room): colour keying will not work. Ask the user for a cut-out PNG or use a matting tool they already have (for example `rembg i in.jpg out.png`); do not install models without asking. Otherwise keep the rectangle (`cutout.py in.jpg out.png --rect`) and use `puff: 'cushion'`: a painting, poster or photo becomes a silk cushion, often better than a rough cut-out.

**Round things with a full texture** (the moon, a planet, a ball): `shape: 'sphere'` with a 2:1 equirectangular map; an optional elevation map (`bump`) adds relief near the terminator.

## Step 2: Pick the puff

The dome is built automatically when the picture loads. The only choice is how high it bulges:

| `puff` | Height | Use for |
|---|---|---|
| `'dome'` (1) | a disc becomes a hemisphere | round objects: fruit, drops, pebbles, logos with a round body |
| `'cushion'` (0.6) | pillow | rectangles, paintings, cards, flat animals |
| `'flat'` (0.35) | a soft relief | wide wordmarks, thin or spiky silhouettes, portraits whose face must stay true |
| any number | | the height multiplier itself |

## Step 3: Pick a material and a feel

One word each. Anything you also write explicitly wins over the preset.

| `material` | Reads as, untouched |
|---|---|
| `'silk'` (default) | the photograph itself; silk only where touched |
| `'satin'` | a broad pale band of sheen across the threads |
| `'velvet'` | a dark body whose edges glow in its own colour |
| `'wet'` | a gloss spot; touched, sharp white glints |
| `'foil'` | metal: a body-coloured highlight made of streaks along the threads |
| `'paper'` | flat, warm, toothy, no gloss anywhere |
| `'ink'` | raking light, grain, the far side in hard shadow |

| `feel` | Moves like |
|---|---|
| `'silk'` (default) | medium waves that ring for a few seconds |
| `'water'` | small fast rings that run a long time |
| `'gel'` | a deep, slow dent that settles at once |
| `'jelly'` | big wobbles; holding pushes far in |

A dark picture (lacquer, a black logo) needs a brighter, broader highlight: add `sheen: 0.5, sheenPower: 14`. A painting or poster: `puff: 'cushion', floor: 0.6, sheen: 0.25`. Exact preset values and every other option are in [references/parameters.md](https://github.com/RussGuo/silkify/blob/v0.2.0/references/parameters.md). To find values by eye, open the [Lab](https://russguo.github.io/silkify/examples/lab.html), drop the picture in, and copy the options it prints.

## Step 4: Render it

The canvas sets the size: style it with CSS (for example `width: 100%; aspect-ratio: 1`). The page must be served over http(s), not opened as `file://`. A picture on another origin must send CORS headers.

```html
<canvas id="pear" style="width: 420px; aspect-ratio: 1"></canvas>

<script type="importmap">
  { "imports": { "three": "https://cdn.jsdelivr.net/npm/three@0.152.2/build/three.module.js" } }
</script>
<script type="module">
  import { silkify } from 'https://cdn.jsdelivr.net/gh/RussGuo/silkify@v0.2.0/src/silk.js';
  // or, with src/ copied to ./silk/:  import { silkify } from './silk/silk.js';

  const pear = silkify(document.getElementById('pear'), { image: 'pear.png', material: 'satin' });
  await pear.ready;            // optional; pear.mode is then 'webgl', 'static' (no WebGL2: drawn once) or 'failed'
</script>
```

The import map is required: silk.js imports `three` by name and hands the worker the URL the map resolves to.

**Bundlers.** Inside a worker there is no import map, so silk.js passes the worker `import.meta.resolve('three')`. If that is not an http(s) URL, as in some bundler setups, it renders on the main thread instead. To keep the worker, pass `threeUrl` (in Vite: `import threeUrl from 'three/build/three.module.js?url'`). `worker: false` forces the main thread.

**The canvas belongs to the renderer.** In a worker the canvas is transferred and cannot be transferred again. On a remount, or when a failed worker falls back, silkify swaps in a fresh clone with the same attributes. Read the current element from `handle.canvas`.

### React (and Next.js)

```jsx
'use client';                                           // Next.js app router
import { useEffect, useRef } from 'react';
import { silkify } from '@/lib/silk/silk.js';           // src/ copied there, `npm i three`; or the CDN URL with an import map

export default function Silk({ src, options, className }) {
  const ref = useRef(null);
  useEffect(() => {
    const silk = silkify(ref.current, { image: src, ...options });
    return () => silk.dispose();                        // StrictMode's mount → unmount → mount is safe
  }, [src]);                                            // options are read once; use silk.setTheme() to change them live
  return <canvas ref={ref} className={className} style={{ width: '100%', aspectRatio: '1' }} aria-hidden />;
}
```

To keep three.js out of pages that do not use it, load the component lazily (`next/dynamic` with `ssr: false`, or `React.lazy`). Import a static asset as a URL string (`import pear from './pear.png'`, then `src={pear.src ?? pear}`).

### The handle

| Member | Purpose |
|---|---|
| `ready` | Resolves to the handle once the first frame is on screen, live or static. It never rejects; check `mode`. |
| `mode` | `'loading'`, `'webgl'`, `'static'` or `'failed'` (nothing could be drawn, for example the image did not load). |
| `tier`, `thread`, `info` | The tier used (`'high'`, `'low'`, `'static'`), `'worker'` or `'main'`, and `{ sim, steps, mesh, texture, software }`. |
| `setTheme(patch)` | Changes any material, light, ripple or motion option live (for example on a light/dark switch). `setTheme({ material: 'wet' })` swaps a preset. Scene options (`image`, `shape`, `puff`, `matte`, `corner`, `threshold`, `fit`, `angle`, `tier`, `worker`) need a new `silkify()`. |
| `ripple(x, y, { depth, radius, hold })` | A programmatic touch at canvas coordinates (0–1, top-left origin): a short press, then the ripples run. Never counts as hovering; up to 4 at once. |
| `stats()` | A promise of `{ frames, mode }`, for measuring sleep. |
| `setPhase(f)` | Sphere only: lunar phase 0–1 (0.5 full, `null` lit from the front). |
| `wake()`, `dispose()` | Restart a sleeping loop; remove listeners, observers and GPU resources (call it on unmount). |

## Performance rules

- One live object per WebGL context, and browsers allow about 16. With more than three objects on a page, use the gallery's pattern: a WebP poster first, `silkify()` on the first `pointerenter`, `dispose()` when the card scrolls away, at most 3 live.
- The loop sleeps by itself: 60 fps while touched and for 8 s after, a 12 fps tail, then no frames at all. Phones and small screens get the low tier; reduced motion, Save-Data and no WebGL2 get a still frame (pass a `poster`).
- `breeze` and `autoplay` keep the loop awake (breeze draws 30 fps while visible). Use them on one hero object, never on a grid.

Details and measurements: [references/performance.md](https://github.com/RussGuo/silkify/blob/v0.2.0/references/performance.md).

## Verify before you hand it over

1. Serve the page (`npx serve .`) and move the pointer across every object. Each should look like its material before it is touched, and ripple only where it is touched.
2. Check `handle.mode` is `'webgl'` and `handle.thread` is `'worker'` in the console; the console must have no errors.
3. Test a narrow viewport (375 px, low tier) and `prefers-reduced-motion` (still frame).
4. If something looks wrong, look it up in [references/troubleshooting.md](https://github.com/RussGuo/silkify/blob/v0.2.0/references/troubleshooting.md): black square, halo, crease, no ripple, `thread` stuck on `'main'`.

In this repository, `node scripts/shoot.mjs` does steps 1–2 for every gallery card and the Lab in headless Chrome and exits non-zero on any failure; re-render posters with `--posters` whenever the look changes.

# Parameters

All parameters are optional except `image`. Defaults marked *sphere / image* differ by shape. The fastest way to find values is the [Lab](https://russguo.github.io/silkify/examples/lab.html) (`examples/lab.html`): every option below is a live control there, and it prints the options to copy.

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
| `grain` | 0 | Procedural fine grain (0–1; up to 2 only adds contrast) | 1 for ink or paper logos |
| `grainScale` | 1 | Device pixels per grain speck | 2 for paper tooth |
| `gamma` | 1 | `albedo = pow(albedo, gamma)`; below 1 lifts mid-tones | 0.85–1.15 |
| `exposure` | 1 | Overall brightness of the lit face | |
| `sheenColor` | `[0.9, 0.95, 1]` | Colour of the highlight | warm `[1, 0.85, 0.6]` for gold |
| `metallic` | 0 | Metal: the highlight takes the body's own hue and the silk part of the body loses its diffuse light | 0.85 foil |
| `anisotropy` | 0 | Highlight stretched across the threads (Kajiya–Kay): 0 round, 1 fully anisotropic | 0.6 satin, 0.8 foil |
| `anisotropyAngle` | 0 | Thread direction in radians (image: in the picture's plane; sphere: along the map's u) | |
| `threads` | 0 | A fixed relief of fine striations along `anisotropyAngle`, seen only by the highlight: it breaks into streaks along the threads even at rest | 0.6 foil; 0.2–0.4 woven satin |
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

## Recipes (from the gallery)

| Subject | Options |
|---|---|
| One-colour logo as ink | `albedo: [0.15,0.15,0.165], grain: 1, light: [-0.66,0.72,0.2], exposure: 2.2, floor: 0.42, volume: 0.3, sheen: 0.5, sheenPower: 14` |
| Photo of an object (fruit, teapot, animal) | defaults; `puff: 'dome'` for round subjects, `'cushion'` for flat ones |
| Painting or poster | `puff: 'cushion'`, `floor: 0.6`, `sheen: 0.25` (opaque PNG ⇒ rectangle) |
| The moon on a light page | `shape: 'sphere', bump, phase: 0.38, floor: 0.6, bumpStrength: 7` |

**Presets.** `material` and `feel` set many options at once; anything you also write explicitly wins. Pictures of each are in `docs/shots/lab/`; `material-rest-strip.jpg` shows all seven untouched. A material must read as itself before anyone touches it.

| `material` | Sets | Reads as |
|---|---|---|
| `'silk'` | nothing | the classic look: matte photograph, silk where touched |
| `'satin'` | `sheen: 0.7, sheenPower: 9, anisotropy: 0.6, silkRest: 0.6` | a broad pale band of sheen even at rest, drawn out across the threads |
| `'velvet'` | `exposure: 0.55, floor: 0.15, volume: 0.4, sheen: 0.04, rim: 1.1, rimPower: 1.9, rimColor: null, silkRest: 0.15` | a dark body whose edges glow in its own colour, no shine |
| `'wet'` | `sheen: 1.1, sheenPower: 40, rim: 0.2, silkSpread: 1.6, silkRest: 0.35` | a gloss even at rest; touched, sharp white glints |
| `'foil'` | `silkRest: 1, metallic: 0.85, threads: 0.6, anisotropy: 1, sheen: 1.2, sheenPower: 18, iridescence: 0.25, grain: 0.3` | metal at rest: a body-coloured highlight band made of streaks along the threads |
| `'paper'` | `sheen: 0, satin: 0.35, grain: 1.3, grainScale: 2, displace: 0.14, floor: 0.95, volume: 0.05, light: [-0.2, 0.3, 0.93], lightColor: [1, 0.97, 0.9], gamma: 0.8, exposure: 1.1` | flat, warm and toothy, no gloss anywhere; dents without shine |
| `'ink'` | the ink-drop card's light and grain, `exposure: 1.35, floor: 0.2, volume: 0.5`, no `albedo` | raking light, grain, the far side in hard shadow |

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

# Performance and fallbacks

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

# Troubleshooting

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
| Nothing loads from the CDN | A Content-Security-Policy without `cdn.jsdelivr.net` in `script-src` (and `worker-src blob:` for the worker), or no import map for `three` | Allow both, or copy `src/` into the project |
| Black square or nothing at all | Page opened as `file://`, image CORS, or an unsized canvas | Serve over http, check CORS headers, and give the canvas a CSS size |
