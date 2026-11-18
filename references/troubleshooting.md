<!-- Part of the silkify skill: ../SKILL.md links here. Symptom, cause, fix. -->

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
| Live on desktop, but a still image on a phone | The static tier: reduced motion, Save-Data, or no WebGL2 in workers or on the page | Expected. Ship a `poster`. Force `tier: 'low'` only if the user really wants motion there. |
| Works, but `handle.thread` is `'main'` | The worker could not load three.js (bundler, CSP) | Pass `threeUrl`, or accept the main thread |
| Only if silk.js is imported from the CDN: nothing loads, or `thread` is `'main'` under a Content-Security-Policy | The policy blocks the CDN module, the `blob:` trampoline worker, or the CDN worker it imports; or there is no import map for `three` | Copy `src/` into the project (the default way: no CDN, no `blob:`), or use the CDN line below (checked in Chrome 156, Firefox 157 and WebKit 27.2: `'worker'`, console clean) |
| Nothing at all, `mode: 'failed'` and a `silkify:` warning | The picture did not load (404, CORS), could not be decoded, or has nothing opaque in it (a fully transparent PNG, or `threshold` above every alpha) | Read `handle.reason`: fix the URL or the CORS headers, re-export the picture, or lower `threshold` |
| `ready` never resolves | The canvas has no size yet (`display: none`, a closed tab or panel, a zero-height parent) | Expected: it starts once the canvas is shown. Give the canvas a CSS size; call `dispose()` if it will never be shown |
| Black square or nothing at all | Page opened as `file://`, image CORS, or an unsized canvas | Serve over http, check CORS headers, and give the canvas a CSS size |

## Live HTML (element mode)

| Symptom | Cause | Fix |
|---|---|---|
| The element stays plain HTML, `mode: 'static'`, nothing logged | No HTML-in-Canvas (anything but Chrome 157 and later), the static tier (reduced motion, Save-Data), no WebGL2, or the element had no size when silkify started | Expected outside Chrome 157+. `handle.reason` says which. Mount once the element is visible |
| The element stays plain HTML with a warning that HTML-in-Canvas gave no picture | The browser has the feature but every picture of the element came back empty within 4 s of the canvas being visible | A browser fault; the page stays readable. Report it with the browser version |
| The words cannot be selected | `user-select: none` on the canvas or one of its ancestors (a common rule for canvases) | Set `user-select: auto` on the canvas, as the gallery's live-HTML card does |
| The element loses its styles when it goes live | A selector that depends on where the element sits (`.stage > #card`): it moves into the canvas while live | Style it by its own id or class |
| Holes in the silk, or the silk cut to the letters | The element (or part of it) has no background: its painted alpha is the outline | Give the element a background colour |
| Square corners on a rounded card | The rounding is on an inner element, not the element passed to silkify | Put `border-radius` and the background on the element itself (in React, `cardStyle` on `SilkHtml`) |
| The card is smaller on the silk than in the page, with a warning that it is larger than the canvas | At 1:1 the element would not fit in the canvas, so it is shrunk to fit | Give the canvas room for the element (a card width such as `min(420px, 100% - 32px)` with `box-sizing: border-box` fits a phone), or pass a `fit` |
| Screen readers skip the card while it is live | `aria-hidden` or `inert` on an ancestor of the canvas (silkify only removes `aria-hidden` from the canvas itself) | Remove it from the ancestor |
| It keeps drawing while nothing is touched | Something in the element keeps repainting: a CSS animation, a video, a focused editable line (the caret blinks about twice a second) | Keep continuous animation out of the element; `handle.stats()` shows `snapshots` climbing |
| The words look soft | The low tier renders at pixel ratio 1 | Expected on phones and software GPUs; `tier: 'high'` where it must be sharp |
| A cross-origin image in the element is blank on the silk | HTML-in-Canvas never paints cross-origin content (images, iframes), `:visited` styles or spelling marks into the picture | Serve the image from the same origin; the plain-HTML fallback shows it as usual |

## Content-Security-Policy

With `src/` copied into the project (the default way) nothing beyond `'self'` is needed: the worker is a file on the same origin, and so is three.js. Only inline scripts need a hash or a nonce: the import map, and your module script if it is inline too (and `style-src` covers inline styles, as on any page):

```
default-src 'self'; script-src 'self' 'sha256-<hash of each inline script>'; connect-src 'self' <picture origins>; img-src 'self' data: blob: <picture origins>
```

Checked in headless Chrome 156 with three 0.186.1 from `node_modules`: `'webgl'` on `'worker'`, ripples under the pointer, no request to another origin, console clean.

With the CDN way, the import map is an inline script, so it needs its hash (or a nonce); the worker needs `blob:` and the CDN in `worker-src` (with only `blob:`, the worker cannot import the CDN one and silkify falls back to the main thread); `connect-src` must reach the picture, which the worker fetches; `img-src` covers the poster and the still frame:

```
default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'sha256-<hash of your import map>'; worker-src 'self' blob: https://cdn.jsdelivr.net; connect-src 'self' <picture origins>; img-src 'self' data: blob: <picture origins>
```
