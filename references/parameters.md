<!-- Part of the silkify skill: ../SKILL.md links here. Every option, the presets and the gallery's recipes. -->

# Parameters

All parameters are optional except `image`. Defaults marked *sphere / image* differ by shape. The fastest way to find values is the [Lab](https://russguo.github.io/silkify/examples/lab.html) (`examples/lab.html`): every option below is a live control there, and it prints the options to copy.

| Option | Default | What it does | Tuning |
|---|---|---|---|
| `image` | (required) | URL, `<img>`, `ImageBitmap`, canvas, or a `Blob` / `File`. SVG is rasterised to 1024 px | PNG with alpha; ≤ 1024 px |
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
