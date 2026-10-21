---
name: silkify
description: Turn a picture into a touchable silk object on a web page. At rest it is matte and photographic; where the pointer touches it, the surface dents, ripples and shines like satin. Use when someone wants to "silkify" a logo, product shot, fruit, animal, portrait, painting, the moon or any other image, or asks for a silk, satin or fabric ripple-on-hover effect, or wants an interactive WebGL hero object made from a PNG. Covers cutting the subject out, inflating its silhouette into a dome, and embedding the three.js renderer in plain HTML or React.
---

# silkify

silkify renders a picture as a physical object made of silk. It does three things:

1. **Silhouette.** It takes the subject's outline from the PNG's alpha channel. An opaque picture becomes a rounded rectangle.
2. **Dome.** It inflates that outline into a smooth 3D surface by solving Poisson's equation (∇²u = −1, height = 2√u). A disc becomes an exact hemisphere, and thin parts bulge less. A picture can also be wrapped on a **sphere** instead (the moon).
3. **Silk.** It runs a wave simulation under the pointer and feeds it into the lighting. The surface is lit by a matte back-scattering model (Lommel–Seeliger, the photometry of the lunar surface). A satin overlay and a soft highlight appear only where ripple energy is non-zero, so the object looks like the original photo at rest and like silk where it is touched.

Files in this skill:

| File | What it is |
|---|---|
| `src/silk.js` | The renderer. `silkify(canvas, options)` returns a handle. Its peer dependency is `three` (tested with 0.152.2). |
| `src/shape.js` | Silhouette → dome geometry, using only plain arrays and a 2D canvas. `silk.js` imports it, so always copy both files. |
| `scripts/cutout.py` | Pillow + numpy background keying for pictures that are not already transparent. |
| `scripts/shoot.mjs` | Renders a gallery page in headless Chrome, saves rest and ripple screenshots, and fails on any console error. |
| `examples/index.html` | A working gallery: seven objects, each with the options that make it look right. Start from the closest one. |

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
  import { silkify } from './silk/silk.js';            // silk.js and shape.js side by side

  const pear = silkify(document.getElementById('pear'), { image: 'pear.png' });
  await pear.ready;                                     // optional: resolves once mounted
  // pear.mode is 'webgl', 'static' (no WebGL2: the picture is drawn once) or 'failed'
</script>
```

The page must be served over http(s), not opened as `file://`, because module imports and image decoding need it. A picture on another origin must send CORS headers.

### React (and Next.js)

```jsx
'use client';                                           // Next.js app router
import { useEffect, useRef } from 'react';
import { silkify } from '@/lib/silk/silk.js';           // copy src/ there; `npm i three`

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
| `ready` | A promise that resolves to the handle once mounted. It rejects if the image fails to load. |
| `mode` | `'loading'`, `'webgl'`, `'static'` or `'failed'`. |
| `setTheme({ exposure, floor, volume, sheen, albedo, light, … })` | Changes any lighting option live, for example on a light/dark theme switch. |
| `setPhase(f)` | Sphere only: lunar phase from 0 to 1 (0.5 is full, `null` is lit from the front). |
| `wake()` | Restarts a sleeping render loop, for example after you move the canvas yourself. |
| `dispose()` | Removes listeners, observers and GPU resources. Call it on unmount. |

## Parameters

All parameters are optional except `image`. Defaults marked *sphere / image* differ by shape.

| Option | Default | What it does | Tuning |
|---|---|---|---|
| `image` | (required) | URL, `<img>`, `ImageBitmap` or canvas | PNG with alpha; ≤ 1024 px |
| `shape` | `'image'` | `'image'` inflates the silhouette; `'sphere'` wraps an equirectangular map | |
| **Ripple** | | | |
| `pressDepth` | 0.30 | Dent depth under a hovering pointer | 0.15 is a light touch, 0.45 is squishy |
| `pressDepthHold` | 0.60 | Dent depth while the button or finger is down | |
| `pressRadius` | 0.075 | Dent radius, in the moon's UV units (≈ 12% of an image object's width) | 0.05–0.11 |
| `waveSpeed` | 1.6 | Wave propagation per frame (stable below 2) | lower for heavier, slower silk |
| `damping` | 0.996 | Energy kept per frame | 0.99 calms quickly; 0.998 rings longer |
| `displace` | 0.32 | How far the height field moves the surface | 0.2 is subtle; 0.45 is dramatic |
| `ripple` | 62 | Ripple slope → normal perturbation (satin contrast) | 40–80 |
| **Material** | | | |
| `sheen` | 0.18 *sphere* / 0.3 *image* | Highlight strength on ripples | dark objects need 0.4–0.6 |
| `sheenPower` | 22 / 16 | Highlight exponent; lower is broader | 12–24 |
| `satin` | 0.9 | Overlay of the satin term at full ripple energy | |
| `albedo` | `null` | `null` uses the picture's colours; `[r, g, b]` (0–1) paints a flat colour, which suits one-colour logos | |
| `grain` | 0 | Procedural fine grain, one texel per device pixel (0–1) | 1 for ink or paper logos |
| `gamma` | 1 | `albedo = pow(albedo, gamma)`; below 1 lifts mid-tones | 0.85–1.15 |
| `exposure` | 1 | Overall brightness of the lit face | |
| **Light** | | | |
| `light` | `[0,0,1]` *sphere* / `[-0.35,0.45,0.82]` *image* | Key light direction in view space (x right, y up, z towards the viewer) | small z means grazing light and strong shading |
| `floor` | 0.05 / 0.55 | Brightness on the side facing away from the light (lunar "earthshine") | raise it on light pages so the dark side is not a hole |
| `volume` | 0.28 | Fill-light gradient across the object (0 = none) | |
| `fillLight` | `true` | The fill light follows the pointer, springs home and sweeps slowly when idle | |
| `idleSweep` | `true` | The slow idle sweep (runs at 12 fps) | `false` lets the loop stop completely when idle |
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
| `dpr` | 2 | Device-pixel-ratio cap | 1.5 on heavy pages |
| `reducedMotion` | `'auto'` | Follows `prefers-reduced-motion`; `true` or `false` to force | |
| `poster` | — | Image to draw when WebGL2 is unavailable (defaults to `image`) | |
| `onHover` | — | `(isOver) => {}` | for a cursor or caption change |

### Recipes (from the gallery)

| Subject | Options |
|---|---|
| One-colour logo as ink | `albedo: [0.15,0.15,0.165], grain: 1, light: [-0.66,0.72,0.2], exposure: 2.2, floor: 0.42, volume: 0.3, sheen: 0.5, sheenPower: 14` |
| Photo of an object (fruit, teapot, animal) | defaults; `puff: 'dome'` for round subjects, `'cushion'` for flat ones |
| Painting or poster | `puff: 'cushion'`, `floor: 0.6`, `sheen: 0.25` (opaque PNG ⇒ rectangle) |
| The moon on a light page | `shape: 'sphere', bump, phase: 0.38, floor: 0.6, bumpStrength: 7` |

## Performance and fallbacks

- **One canvas per object.** Each canvas has its own WebGL context, and browsers allow about 16, so keep a page under roughly 10.
- **DPR cap.** `dpr: 2` by default. Fill rate is the main cost, so lower it for large canvases.
- **The loop sleeps.** It runs at 60 fps while touched and for 8 s after the last touch, at 12 fps while only the idle sweep or spin runs, and stops when the canvas is off-screen or the tab is hidden. With `prefers-reduced-motion` it draws one frame and ignores the pointer. Set `idleSweep: false` (and `spin: false` for spheres) to make it fully idle.
- **Mount cost.** The dome is built on the main thread, which takes about 100–300 ms for a 1024 px picture. Mount after first paint, or when the canvas scrolls into view.
- **No WebGL2** (or no renderable half-float textures): the picture is drawn once on the same canvas with 2D, and `mode === 'static'`. Nothing throws.

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
| Black square or nothing at all | Page opened as `file://`, image CORS, or an unsized canvas | Serve over http, check CORS headers, and give the canvas a CSS size |

## Verify before you hand it over

1. Serve the page (`npx serve .`) and move the pointer across every object. Each should stay matte until touched and ripple only where touched.
2. For a gallery like `examples/`, run `node scripts/shoot.mjs`. It saves real headless-Chrome screenshots (rest and ripple) to `docs/shots/` and exits non-zero on any console error or any object that did not mount with WebGL. Look at the screenshots.
3. Test a narrow viewport (375 px) and `prefers-reduced-motion`.
