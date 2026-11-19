English | [简体中文](CONTRIBUTING.zh-CN.md)

# Contributing to silkify

Bugs and ideas go in [issues](https://github.com/RussGuo/silkify/issues); a bug report has its own template. A pull request is welcome for anything an issue has agreed on.

## Rules

- **The default look is pixel-for-pixel fixed.** Every new option defaults to off, and the gallery posters in `examples/posters/` are not re-rendered unless their card changed. `node scripts/shoot.mjs --posters` followed by `git status` shows whether a change moved a single pixel.
- **`node scripts/shoot.mjs` passes before every commit** (headless Chrome, Python with Pillow; about five minutes). It writes nothing into the repository (`--shots` rewrites `docs/shots/*-rest.jpg` when the look changed). CI also runs `--browsers` (WebKit and Firefox) and `scripts/frameworks.mjs` (React in Vite and Next.js); both need Playwright, which is never a dependency.
- **One source for the agent docs.** `SKILL.md` and `references/` are the only hand-written agent docs. `AGENTS.md`, `llms.txt`, everything in `integrations/` and the Lab's option notes (`examples/lab-help.js`, from `references/parameters.md`) are generated: edit the sources, then run `npm run build:integrations` (`-- --check` fails on drift). The install sentence and the author's byline in the READMEs, the gallery and the Lab are written by the same script: change them there, not in the pages.
- **No build step and no runtime dependencies besides three.js.** Every source file stays under 800 lines and opens with a comment that says what it is and why.
- **[CHANGELOG.md](CHANGELOG.md)** gets a line for anything a user of the library would notice.

To run the gallery and the Lab locally, serve the repository root and open `/examples/`:

```bash
npx serve .            # or: python3 -m http.server
```

## Releasing

1. On the release commit, set `version` in `package.json` and run `npm run build:integrations`: it moves SKILL.md, the marketplace entry, every CDN URL, `examples/cdn.html` and every clone line to the new tag (`--check` names any it cannot).
2. Point what follows `main` between releases at the tag (a CDN URL `@main`, a README line that calls something "new on main"), then run `node scripts/build-integrations.mjs --release`: `--check` plus a gate that fails on any of them. `--check` alone lets them pass, so `main` can carry them between releases.
3. `node scripts/shoot.mjs`, `--posters` (then `git status` is clean), `--browsers` and `scripts/frameworks.mjs` pass on that commit; then tag it. `--check` also fails on a tracked file at the root that is not in its list, and on a tracked log or debugging leftover anywhere, so neither reaches a tag.

## Repository

```
SKILL.md            the Agent Skill: get the code (copy src/, or the CDN), cut-out → puff → material and feel → render → verify
references/         parameters, performance, troubleshooting: the detail SKILL.md points to; how-it-works, for people
CHANGELOG.md        what changed in each release, and what a version tag promises (pin a commit when integrity matters)
src/silk.js         the entry point: tiers, Worker / main-thread / still-frame fallback, pointer forwarding
src/core.js         the renderer of one scene, DOM-free (peer dependency: three ≥ 0.152.2)
src/serve.js        the renderer's message endpoint: loading, messages kept until the scene is up, a lost context, a rebuilt dome
src/shaders.js      the GLSL: wave solver and object shader (one source, two shapes)
src/worker.js       the Web Worker entry
src/presets.js      material and feel presets: plain option fragments
src/tier.js         device tiers and on-screen grid sizing
src/shape.js        silhouette → Poisson dome, plain arrays (no three.js)
src/pool.js         pool(): many objects on a page (poster first, live on touch, at most N live, prewarmed)
src/live.js         live HTML, the page side: feature detection, the element's stand-in, the place it keeps in the page, snapshots, hit geometry, the plain-HTML fallback
src/events.js       what an object tells the page: onPress / onRelease / onStroke from the shared pointer, haptics, callbacks that cannot throw into the renderer
scripts/cutout.py   Pillow + numpy background keying, shadow-aware, edge un-mixing
scripts/shoot.mjs   headless Chrome: verify (live in a worker + ripples, the Lab, test/edge.html, live HTML), --posters, --gif (ffmpeg), --lab, --cdn, --browsers; console check
scripts/verify-touch.mjs, scripts/verify-lab.mjs, scripts/verify-pages.mjs, scripts/verify-events.mjs, scripts/verify-options.mjs   parts of shoot.mjs's verify, in files of their own: the first touch and many objects; the Lab's words and Record; the pages (link-preview tags, posters, How it works, the use cases, text.html); the events and the silk button; the options the use-case pages asked for, and pool()
scripts/build-integrations.mjs   SKILL.md + references → integrations/, AGENTS.md, llms.txt; the install sentence and the byline in both READMEs, the gallery and the Lab (--check for drift and leftovers; --release on the release commit)
scripts/browsers.mjs             shoot.mjs --browsers: WebKit and Firefox, same origin and cross-origin (Playwright)
scripts/frameworks.mjs           the React component in Vite and Next.js, dev and build (Playwright; network)
scripts/harness.mjs              the static server and the Playwright loader the check scripts share
examples/           the gallery, the Lab, live.html (live HTML), button.html (the silk button), and cdn.html, the CDN way's test page (static; GitHub Pages), WebP pictures and posters, image credits
examples/react, examples/next    the smallest Vite and Next.js projects with the React components (Silk for a picture, SilkHtml for live HTML)
test/edge.html      the cases that once failed silently: SVG, an empty or missing picture, calls while loading
test/live-edge.html live HTML in the layouts people write: a card that holds its stage open, one larger than its canvas, SKILL.md's snippet at 375 px
test/events.html    the callbacks: press, release, stroke, a callback that throws, haptics, onReady / onFail, words and a live element's link
test/options.html   options the use-case pages asked for (corner: 0, fit: 'cover', a drawn poster, breezeIdle); it checks itself
test/pool.html      pool(): the cap, the least recently touched released, a pointer mounts, a scroll releases, dispose(); it checks itself
integrations/       generated: a Cursor rule and a path-scoped Copilot instruction
AGENTS.md, llms.txt generated: for agents that read AGENTS.md, and the llmstxt.org index
.claude-plugin/     the plugin marketplace manifest (the skill is SKILL.md at the root)
.github/            CI (build:integrations --check, shoot.mjs, --cdn, --browsers, frameworks.mjs) and the issue template
```
