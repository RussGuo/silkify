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
| Nothing loads from the CDN | A Content-Security-Policy without `cdn.jsdelivr.net` in `script-src` (and `worker-src blob:` for the worker), or no import map for `three` | Allow both, or copy `src/` into the project |
| Nothing at all, `mode: 'failed'` and a `silkify:` warning | The picture did not load (404, CORS), could not be decoded, or has nothing opaque in it (a fully transparent PNG, or `threshold` above every alpha) | Read `handle.reason`: fix the URL or the CORS headers, re-export the picture, or lower `threshold` |
| `ready` never resolves | The canvas has no size yet (`display: none`, a closed tab or panel, a zero-height parent) | Expected: it starts once the canvas is shown. Give the canvas a CSS size; call `dispose()` if it will never be shown |
| Black square or nothing at all | Page opened as `file://`, image CORS, or an unsized canvas | Serve over http, check CORS headers, and give the canvas a CSS size |
