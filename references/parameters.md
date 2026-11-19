<!-- Part of the silkify skill: ../SKILL.md links here. Every option, the presets and the gallery's recipes. -->

# Parameters

All parameters are optional except `image` (or `element`, see [Element mode](#element-mode-live-html), or `text`, see [Text](#text-words-as-the-object)). Defaults marked *sphere / image* differ by shape. The fastest way to find values is the [Lab](https://russguo.github.io/silkify/examples/lab.html) (`examples/lab.html`): every option below is a live control there, and it prints the options to copy.

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
| `corner` | 0.06 | Corner radius of `'rect'`, as a fraction of the short side; 0 is a square | |
| `threshold` | 0.5 | Alpha that counts as inside | |
| `fit` | 1.3 | Canvas extent ÷ object extent; leaves room for the bulge. `'cover'`: the object fills the canvas whatever their proportions, cropped on the canvas's long axis, its outline just past the edges, and it follows the canvas when it is resized (no new `silkify()`); for a full-bleed sheet, with `matte: 'rect', corner: 0` and a low `puff` | 1.15 is tight, 1.5 is airy |
| **Shape (sphere)** | | | |
| `phase` | `null` | Lunar phase 0–1; overrides `light` | 0.35–0.42 gives a gibbous moon |
| `bump` | `null` | Elevation map URL (same projection) for relief near the terminator | |
| `bumpStrength` | 7 | How strongly the `bump` map raises the relief | 20 on dark pages |
| `spin`, `spinSpeed`, `angle` | `true`, 0.006, 0 | Slow rotation of the texture; initial longitude offset (0–1) | |
| **Runtime** | | | |
| `interactive` | `true` | `false` keeps it still and ignores the pointer | |
| `tier` | `'auto'` | `'high'`, `'low'` or `'static'` forces a tier (see Performance) | `'low'` for a page that must stay light |
| `worker` | `'auto'` | Render in a Web Worker when the browser can; `false` keeps rendering on the main thread | |
| `threeUrl` | — | Absolute URL of `three.module.js` for the worker (default: `import.meta.resolve('three')`) | needed with some bundlers |
| `dpr` | per tier (2 / 1) | Device-pixel-ratio cap; the renderer lowers it further (2 → 1.5 → 1) if frames take > 28 ms | |
| `reducedMotion` | `'auto'` | Follows `prefers-reduced-motion`, which selects the static tier; `true` or `false` to force | |
| `stepPerFrame` | `false` | One solver step per drawn frame instead of 60 per second: for frame-exact recordings (`shoot.mjs --gif`), never for pages | |
| `poster` | — | A still frame of this canvas, shown in the static tier (default: the picture, drawn flat) | render one with `scripts/shoot.mjs --posters` |
| **Events** | | Callbacks the page passes; see [Events](#events-what-the-object-tells-the-page) | |
| `onPress` | — | `({ x, y, pointerType }) => {}`: a pointer went down on the canvas (x, y from 0 to 1, top left) | analytics, a sound, a haptic |
| `onRelease` | — | `({ x, y, over, held, pointerType }) => {}`: that press ended; `over` is false when it was lifted off the canvas or cancelled | |
| `onStroke` | — | `({ x, y, dx, dy, pressed, pointerType }) => {}`: the pointer moving on the canvas, at most every 100 ms | |
| `onHover` | — | `(isOver) => {}`: the pointer came onto the object, or left it (the outline, not the canvas) | for a cursor or caption change |
| `onReady` | — | `(handle) => {}`: drawn, live (`mode` `'webgl'`) or as a still frame (`'static'`); again after a lost context is restored | count the fallbacks in the field |
| `onFail` | — | `(handle) => {}`: nothing could be drawn (`'failed'`), or a live object lost its WebGL context (`'static'`) | |
| `haptics` | `false` | `true`: one short vibration (10 ms) when a finger or pen presses the object, where the browser can; a number sets the milliseconds | Android Chrome; iOS has no vibration API |

## Element mode (live HTML)

`silkify(canvas, { element })` prints a real element on the silk instead of a picture (HTML-in-Canvas, Chrome 157 and later; elsewhere the element stays plain HTML). Every option above keeps its meaning unless the table says otherwise.

| Option | In element mode |
|---|---|
| `element` | An `Element`, or a selector for one. Takes the place of `image`; passing both throws a `TypeError`. It must already be in the DOM: a selector that matches nothing, or `null` (a `getElementById()` or a React ref read too early), throws a `TypeError` at once, so call `silkify()` after the element is rendered (in React, in an effect). |
| `fit` | Default: canvas ÷ element, the smaller of the two ratios, so the element is drawn 1:1 (its words the size they are in the page), recomputed whenever the canvas or the element changes size. An element larger than the canvas is shrunk to 92% of it instead, and one `console.warn` gives both sizes. A number scales it like a picture, and never warns. `'cover'` throws a `TypeError`. |
| `puff` | Default `'cushion'`. |
| `matte`, `threshold`, `corner` | Ignored: the outline is the element's own painted box, its `border-radius` included. |
| `albedo`, `grain` | Ignored, also when a preset (`foil`, `paper`, `ink`) or `setTheme()` sets them: they would paint over the words. |
| `poster` | Ignored: the fallback is the element itself. |
| `shape: 'sphere'` (and `phase`, `bump`, `spin`, `angle`) | `shape: 'sphere'` throws a `TypeError`; the rest only ever apply to a sphere. |

The handle is the same, with `handle.element` (the element) and `snapshots` in `stats()` (pictures of the element printed since mount); `stats().mode` is `'html'` while the loop rests but a snapshot came within the last second (each snapshot is a frame), and `'rest'` only when nothing is drawn. `mode` is `'static'` when the element stays plain HTML: no HTML-in-Canvas, the static tier, no WebGL2, an element with no size (`reason` says which, and nothing is logged), or a browser that has the feature but gave no picture of the element within 4 s of the canvas being visible (this one also logs one `console.warn`). A live element whose WebGL context the browser takes back goes back to the page as plain HTML (`mode` `'static'`), and moves into the canvas again when the context is restored. Code that could not be loaded (no import map for `three`) also leaves the element as plain HTML, with one `console.warn`. `ready` resolves once the element's first picture is on the silk.

## Events: what the object tells the page

The page passes callbacks in the options, as with `onHover`, and silkify calls them. They are options, not DOM events on the canvas, because silkify replaces the canvas element on a fallback, a lost context and a restore: a listener on the canvas you passed would stop hearing without a word. As options they work the same in a plain page and as props of a framework component (`examples/react/src/Silk.jsx` passes `onPress` and the rest through). They are read when called, so `setTheme({ onPress })` swaps one.

- **`onPress`, `onRelease`, `onStroke`** follow the pointer on the canvas's box, the transparent parts around the object included (`onHover` is the outline). `x`, `y` are canvas coordinates from 0 to 1, top left, the ones `handle.ripple()` takes; `pointerType` is `'mouse'`, `'touch'` or `'pen'`. A press is reported from the moment `silkify()` is called, also while the renderer is still loading. `onRelease` follows every `onPress`: lifted on the canvas (`over: true`, where it was lifted), lifted elsewhere or cancelled (a touch that became a scroll, the window losing focus: `over: false`, the last point on the canvas), with `held` in milliseconds. `onStroke` is throttled to one call per 100 ms; `dx`, `dy` are the way it moved since the last call (0 for the first after the pointer came onto the canvas), `pressed` whether a button or finger is down. None of the three is called in the static tier, with `interactive: false`, after a lost context (until it is restored) or after `dispose()`; `handle.ripple()` and `autoplay` are not presses.
- **`onReady` and `onFail`** say how the object settled, with the handle: read `mode` and `reason`. `onReady` comes when `ready` resolves with `'webgl'` or `'static'` (the static tier, reduced motion, no WebGL2: a still frame is not a failure), `onFail` when it resolves with `'failed'`. A live object whose WebGL context the browser takes back calls `onFail` (`mode` `'static'`, `reason` says so) and, once the context is restored and it is live again, `onReady` (`'webgl'`): the page hears it without polling `handle.mode`. A disposed object calls neither.
- **Live HTML (`element`).** A press on the element's plain words or its background is a press on the silk. A press on a control inside the element (a link, a button, a form field, a `<label>` or `<summary>`, editable text, anything with `role="button"` or `role="link"`) belongs to that control: no `onPress` and no `onRelease` (the silk still dents under it, as it always does). A card that should act as a button as a whole is better made a real button (below) than given an `onPress`.
- **A callback that throws** is a bug in the page, not in the renderer: it is reported as an uncaught error (`reportError`, so it shows in the console and in `window.onerror`) and everything else goes on: the frame, the other callbacks, the other objects sharing the pointer listeners.
- **`haptics`** vibrates only for a finger or a pen, only where `navigator.vibrate` exists (Android Chrome and Firefox; not Safari), and only once the page has had a user gesture: browsers refuse a vibration before that and log the refusal, so the very first tap on a page is silent.

**The silk button.** A silk object that is also a real `<button>`: put the canvas inside the button with `aria-hidden="true"` and give the button its own text, so it takes focus, Enter and Space press it, and a screen reader reads it. Mouse and touch dent the silk by themselves; the keyboard has no pointer, so on Enter or Space call `handle.ripple(0.5, 0.5)` at the centre (choose a picture whose centre is the object, not a gap); the action is the button's `click`, never `onPress` (which is for feedback: `haptics: true`, a sound). Draw the focus ring outside the canvas with `:focus-visible` and `outline-offset`. In the static tier the face is the poster and the button works the same. `examples/button.html` is the whole pattern; `scripts/shoot.mjs` presses it with a mouse, a finger and the keyboard.

## Text: words as the object

`silkify(canvas, { text: 'silk', font: '800 200px Georgia, serif' })` makes a word, a headline, a letter or an emoji the object, with no picture at all. silkify sets the text in a canvas once its font has loaded, and from then on it is a picture like any other: the letters inflate into a dome, dent and ripple, and every material and feel applies. Every option above keeps its meaning unless the table says otherwise.

| Option | Default | What it does |
|---|---|---|
| `text` | (takes the place of `image`) | The words. `\n` starts a new line; lines are centred. Emoji keep their own colours, and CJK and other scripts fall back glyph by glyph, as in the page. Passing `image` or `element` too, an empty string, or a non-string throws a `TypeError`. |
| `font` | `800 160px` in the canvas's own CSS `font-family` | A CSS font shorthand: weight, size and family, as in `font: 700 200px "Fraunces", serif`. The size only sets proportions (with `lineHeight`): the text is drawn 1024 px on its long side whatever it is. Use a heavy weight: a dome's height grows with the width of the stroke, so hairlines barely inflate. A shorthand the browser cannot read (`'Georgia'` alone, no size) throws a `TypeError`. |
| `color` | the canvas's CSS `color` | Any CSS colour. By default the words take the ink of the page around them, as text does: set `color` on the canvas or pass it here. Ignored by colour emoji. An unreadable colour throws a `TypeError`. |
| `lineHeight` | 1.15 | Distance between baselines, as a multiple of the font size (CSS's unitless `line-height`). Anything but a number above 0 throws a `TypeError`. |
| `puff` | `'dome'` | Unchanged. A heavy word inflates well at 1; a light weight or a long line reads flatter: try 1.3–1.6. |
| `matte` | `'alpha'` | The letters' own edges are the outline, also for a single glyph that fills its box. |
| `fit` | 1.3 | Unchanged: the text's box, not the canvas, is what fits. A wide word in a square canvas leaves room above and below; give the canvas the word's proportions (`aspect-ratio: 16 / 10` for a short word). |
| `shape: 'sphere'` | | Throws a `TypeError`. |

**Fonts.** The canvas only draws fonts that are already loaded, so silkify asks `document.fonts.load()` for the font and the exact text first, and waits up to 3 s. A web font needs its `<link>` or `@font-face` in the page; silkify loads it, you need not wait for it. A font that is not there is drawn in the next one of the stack, as in CSS, and silkify speaks only about what the page can fix, with one `console.warn` starting with `silkify:` that names the font: **a web font the page declared** (`@font-face`, or a `<link>`'s stylesheet) whose file failed or did not arrive in 3 s, and **a stack with no generic family** (`serif`, `sans-serif`, `monospace`, `system-ui`, `ui-serif`…) none of whose fonts is there, which the browser's default font then stands in for. A system font that is simply not installed on the visitor's machine, in a stack that ends in a generic family (`800 200px Georgia, serif` on a Linux machine without Georgia), is the stack working: nothing is said, and nothing is waited for. Either way the object goes live, `mode` is `'webgl'`. End a stack with a generic family. The default font (the canvas's own family) is never warned about. `text`, `font`, `color` and `lineHeight` are scene options: changing them needs a new `silkify()`, not `setTheme()`.

**Static tier and reduced motion.** The words are drawn flat, in their colour, at the same place and size: a still frame needs no `poster`. Pass one (`shoot.mjs --posters` renders it) for the lit, inflated look.

```js
silkify(canvas, { text: 'silk', font: '800 200px Georgia, serif', color: '#6b2737', material: 'satin' });
silkify(canvas, { text: 'Hello\nworld', font: '900 160px system-ui, sans-serif', lineHeight: 1, material: 'foil' });
silkify(canvas, { text: '🍐' });                                        // an emoji, in its own colours
```

The handle is the same; `ready` waits for the font as well. `examples/text.html` is the smallest page (any option can be tried from its address bar), and `test/text.html` checks every case above (`node scripts/shoot.mjs --only text`). The Lab has words as an object of their own (Object → Words: four system fonts and three Google Fonts, one with Chinese, a Google Font's stylesheet added only when it is picked), and its link, Copy options and Download HTML carry the text, the font, the colour and the line height. The gallery's word card declares its font with `@font-face` and no `<link>`, so the font file is fetched only when silkify asks for it.

## Recipes (from the gallery)

| Subject | Options |
|---|---|
| One-colour logo as ink | `albedo: [0.15,0.15,0.165], grain: 1, light: [-0.66,0.72,0.2], exposure: 2.2, floor: 0.42, volume: 0.3, sheen: 0.5, sheenPower: 14` |
| Photo of an object (fruit, teapot, animal) | defaults; `puff: 'dome'` for round subjects, `'cushion'` for flat ones |
| Painting or poster | `puff: 'cushion'`, `floor: 0.6`, `sheen: 0.25` (opaque PNG ⇒ rectangle) |
| A card of live HTML | `element: '#card'` and the defaults; a resting sheen (`satin`, `wet`, `foil`) washes over the words, so keep those for touch; `ink` (the far side in hard shadow) and `velvet` (a dark body, low `floor`) darken part of the card until the words there cannot be read, so not those either |
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

## Exports

What `silk.js` exports by name (`silkify` is also the default export). The handle that `silkify()` returns is described in [SKILL.md](../SKILL.md#the-handle).

| Export | What it is |
|---|---|
| `silkify(canvas, options)` | Mounts one object; returns the handle. |
| `prewarm(options)` | Does the slow, shared part of a mount ahead of time: starts one worker and has it import three.js (on the main-thread path: imports the renderer and three), so the next `silkify()` only builds its scene. Pass the options the objects will use (`tier`, `reducedMotion`, `worker`, `threeUrl`). Nothing in the static tier. A promise of `true` once warm, `false` if it could not be; never rejects. Call it when the page is idle, on a page that mounts objects on their first touch ([performance.md](performance.md)). |
| `resolveOptions(options)` | The options silkify will actually use, presets merged (the Lab prints only what differs from it). |
| `MATERIALS`, `FEELS`, `PUFF` | The presets and the puff heights, as plain objects. |
