# Changelog

## Versions and what a tag promises

- **Version numbers.** While silkify is 0.x, a minor release (0.4) may rename or remove options and handle members; it says so here. A patch release (0.3.1) fixes and adds, and never breaks a `silkify()` call that worked: the default look stays pixel for pixel the same (the gallery posters are re-rendered and compared byte for byte before a release).
- **Tags.** A release tag (`v0.3.0`) is pushed once, after every check has passed on that commit, and is never moved or deleted. That is this project's promise, not a property of git: a tag can be force-pushed.
- **Copying `src/` is the default, and the safest.** A page that serves its own copy changes only when you copy a new release in, and depends on no outside service.
- **If you import from the CDN instead,** jsDelivr keeps the files it has served for a tag, so `@v0.3.0` does not change under a page in practice, but nothing cryptographic guarantees it. When integrity matters, pin a commit: `https://cdn.jsdelivr.net/gh/RussGuo/silkify@<40-character commit SHA>/src/silk.js` names exactly one tree of files.
- **Subresource Integrity covers one file.** On the CDN, an `integrity` attribute (or an import map's `integrity` entry) checks only the module the page imports directly, silk.js. The modules silk.js imports, the worker it starts, and three.js loaded inside that worker are fetched without one. For the whole chain, copy `src/` and serve it yourself.

## Unreleased

**Added**
- **Words as the object.** `silkify(canvas, { text: 'silk', font: '800 200px Georgia, serif', color, lineHeight })` makes a word, a headline, a letter or an emoji the object, with no picture and no cut-out. The text is set in a canvas once its font has loaded (up to 3 s) and is then a picture like any other: it inflates, dents and ripples in every material and feel, and the static tier draws it flat. Lines split on `\n`; colour emoji keep their colours; CJK falls back glyph by glyph. By default the words take the canvas's CSS `color` and a heavy weight of its `font-family`. A font none of whose named families renders draws the fallback with one `console.warn`; mistakes in the call (text with `image` or `element`, an empty text, an unreadable font or colour) throw a `TypeError`. New file `src/text.js`; `examples/text.html`; `test/text.html`, run by `scripts/shoot.mjs`. See references/parameters.md, "Text".

**Changed**
- **The gallery and the READMEs open with the Mona Lisa and the pomegranate**, then the moon; the FateTell ink drop moves to the end of the objects (its notice is unchanged). The Lab's object list follows. Only the order changed: the posters are the same files.
- **Who made it, wherever it travels.** A line under both README titles, the gallery's footer and the Lab now say "Made by Russ Guo" with a link; a file downloaded from the Lab carries the same credit in a comment and a small "silkify" link in its corner. The name and links live in one place, `scripts/build-integrations.mjs`, which writes them into every page and fails `--check` when one drifts.
- **The READMEs lead with what silkify is and how to try it:** install, the 30-second start (now with the React component), materials and feels, the gallery, live HTML, then browsers and fallbacks in three bullets (where "What it is not" went). Material moved, none removed: How it works and the performance overview are in `references/how-it-works.md` (and `.zh-CN.md`), the Lighthouse history in `references/performance.md`, the repository layout and the rules for a change in `CONTRIBUTING.md` (and `.zh-CN.md`); the option table and the live-HTML details are folded under the sections they belong to.
- **Every control in the Lab says what it does.** Each row shows a plain name with the API name beside it ("Press depth · `pressDepth`") and, under it, one line from `references/parameters.md` (generated into `examples/lab-help.js` by `build-integrations.mjs`, so the two never disagree), readable on touch screens. Every input now has an accessible name: the label is tied to the row's main control and describes it, the number boxes and the other inputs have their own; an axe-core audit of the Lab reports no unlabelled form controls and no contrast failures at 1280 and 375 px. `references/parameters.md` gained the missing line for `bumpStrength`.
- **The Lab opens on the look.** Object, material and feel sit at the top of the panel, with your own picture and the background just below; every other option is under **Advanced**, closed unless the link already carries values beyond the object's own. The renderer's readout (tier, thread, grid, fps, loop state) shows only with `lab.html?debug`; a still frame or a failure still says why. The stage's hint and its buttons share one row that wraps instead of overlapping, and at 375 px the object has its own box between the title and the buttons.

Pictures look the same: the posters re-render byte for byte.

## 0.3.0 (2026-11-19)

**Added**
- **Live HTML.** `silkify(canvas, { element })` prints a real element on the silk instead of a picture, through HTML-in-Canvas (Chrome 157 and later). The element stays HTML: its words can be selected, copied and found, links and buttons work, editable text takes typing and input methods, it scrolls, screen readers read it, and the silk still dents and ripples. It is drawn 1:1 by default, at the place the page laid it out, and an invisible box of its size keeps that place in the page, so nothing moves when it comes alive; an element larger than the canvas is shrunk to fit, with one warning (`fit` scales it like a picture, without one). Its own background and `border-radius` are the outline. It is printed again only when its rendering changes, so a resting card draws nothing; while prints keep coming, `stats().mode` is `'html'`. The focus and the selection inside the element survive the move into the canvas and back. Without the feature, in the static tier, or without WebGL2 the element stays where it is as plain HTML (`mode: 'static'`, no warning); a browser that has the feature but gives no picture within 4 s gets the same fallback with one warning. `handle.element`; `snapshots` in `stats()`. New file `src/live.js`; `examples/live.html`; a live-HTML card in the gallery; `SilkHtml` for React and Next.js in `examples/react` and `examples/next`. Ignored in element mode: `matte`, `threshold`, `corner`, `albedo`, `grain`, `poster`. See SKILL.md step 5.
- `scripts/shoot.mjs` checks live HTML in Chrome (selection and copy, double-click, link, button, typing and an input method, scrolling, the caret, resizing, ripples, sleeping, the fallbacks, `dispose()`); `--browsers` checks the plain-HTML fallback in WebKit and Firefox; `scripts/frameworks.mjs` checks `SilkHtml` under StrictMode.

**Changed**
- **Code that cannot be loaded says so.** A three.js that cannot be resolved (a missing import map), a worker that does not start, or a `core.js` that cannot be imported now logs one `console.warn` naming the cause and the fix, for a picture and an element alike. Before, the mount ended in a still frame or plain HTML with a `reason` and a silent console, and with live HTML the fallback looked exactly right, so the mistake went unseen. Missing features (no WebGL2, the static tier, reduced motion, no HTML-in-Canvas) stay quiet.

**Fixed**
- **`dispose()` while the renderer is starting settles `ready`.** Called in the first moments after `silkify()` (React StrictMode's first mount does exactly that), `ready` never settled; it now resolves with `mode: 'disposed'`, as the handle table always said. This was in 0.2.x too, for pictures.
- `examples/next` is pinned to Next.js 16.4.6: 16.4.2 has a known vulnerability, and its own CLI refuses to build with it.

Pictures look the same: the posters re-render byte for byte.

## 0.2.3 (2026-10-22)

- **Self-hosting is the default; the CDN is the alternative.** SKILL.md now has the agent copy `src/` from the skill's folder into the project and install three.js there too, so the page depends on no outside service. Importing from jsDelivr stays, for a page with nowhere to put files (a CodePen, one HTML file); the READMEs, references/troubleshooting.md (now with a Content-Security-Policy line for the default way, and its table no longer broken in two), AGENTS.md, llms.txt and the Cursor and Copilot files follow. The Lab's Download HTML still loads silk.js and three.js from jsDelivr, and now says so on its button and in the file it writes. Checked by an agent that had never seen the repository, following the new SKILL.md in an empty project: `'webgl'` on `'worker'`, ripples, no request to another origin, also under the Content-Security-Policy line. No code changes.

## 0.2.2 (2026-10-22)

- **One-line install.** The README's per-agent install table gives way to one sentence to paste into any coding agent: it clones the release tag into the folder that agent loads skills from (`~/.claude/skills` for Claude Code, `~/.agents/skills` for Codex, Cursor, Copilot, Gemini CLI and most others), reads SKILL.md and says it is ready. Checked in Claude Code, and in Codex with an empty home directory, in English and in Chinese: each installed it and a new session listed the skill. The gallery and the Lab copy the same sentence from an "Install in your agent" button. It is defined once, in `scripts/build-integrations.mjs`, which writes it into both READMEs, both pages, AGENTS.md and llms.txt, and `--check` fails if any copy differs. The per-agent table is still in the README, folded.
- The FateTell mark (the ink drop) is now stated the same way everywhere: © FateTell, all rights reserved, not covered by the MIT license, to be removed from forks and redistributions. The exception is spelled out at the end of LICENSE and in CREDITS, README, the gallery footer, the Lab and the files the Lab exports. Nothing else changes.

## 0.2.1 (2026-10-21)

Fixes from an adversarial review of 0.2.0. Every change below is checked by `scripts/shoot.mjs`, `--browsers` or `scripts/frameworks.mjs`, which CI now runs on every push.

**Fixed**
- An SVG picture rendered a blank canvas reported as `'static'`, with no message. SVG is now rasterised on the page (1024 px on its long side) and goes live like any picture.
- A picture that could not be loaded or decoded, or had nothing opaque in it, also ended silently. It is now `mode: 'failed'` with `handle.reason` and one `console.warn`, the library's only console output.
- From the CDN, Safari and Firefox rendered on the main thread instead of in the worker (and Firefox logged a Security Error). Checked in Safari 26.5, the iOS 26.4 Simulator, Firefox 157, WebKit 27.2 and Chrome 156.
- `setTheme()`, `setPhase()` and `ripple()` called before `ready` were dropped.
- `ready` never settled for a canvas in `display: none` that was disposed, nor did `stats()` after `dispose()`; both now settle with `mode: 'disposed'`.
- The React component in SKILL.md broke on its second `src` and blanked the page on unmount; the Vite `threeUrl` line no longer resolved; Next.js 16 with Turbopack did not build. The new component creates its canvas in the effect, bundlers need no configuration, and `examples/react` and `examples/next` are checked in Vite 8 and Next 16, dev and build.
- Moving or holding the pointer anywhere on the page woke every visible object at 60 fps. Only the pointer over the canvas counts now.
- Ripples ran twice as fast on a 120 Hz display. The wave solver steps at a fixed 60 Hz.
- WebGL2 was probed with a throwaway context on the main thread: 2.5 s per page on a software GPU (Lighthouse 69, TBT 9.7 s). It is probed on the canvas itself, in the worker (99, 0 ms).
- Firefox logged two warnings on every mount (a lost context, a deprecated extension).
- `handle.tier` said `'high'` or `'low'` after a fallback to a still frame; it says `'static'`.
- The README's 30-second snippet threw on paste (it mounted a canvas it never declared).
- `cutout.py`: EXIF orientation applied; a note when a wordmark's counters stay opaque (`--no-flood`); one-sentence errors for SVG, HEIC and unreadable files; `--keep-largest` stops instead of doing nothing without scipy.
- Gallery and README descriptions follow their sources (the *Bird figure*, not an "enamel parrot").

**Added**
- `handle.reason`; `mode: 'disposed'`; `steps` in `stats()`; `image` may be a `Blob` or `File`; `stepPerFrame` for frame-exact recordings.
- The Lab's **Download HTML**: the object and its options as one file that opens with a double-click. And a notice, with "Play anyway", when the system asks for reduced motion.
- SKILL.md: SVG input, logos and `--no-flood`, `touch-action` on phones, a Content-Security-Policy line that works, the failure modes.
- CI (`.github/workflows/verify.yml`), `scripts/shoot.mjs --browsers` (WebKit and Firefox), `scripts/frameworks.mjs`, `test/edge.html`, an issue template. `shoot.mjs` no longer rewrites tracked files unless `--shots` is given.

**Removed**
- The ChatGPT custom GPT files (`integrations/chatgpt/`). OpenAI no longer lets personal accounts create GPTs and retires custom GPTs on 2026-12-11 ([help center](https://help.openai.com/en/articles/20001519)). The ChatGPT desktop app reads skills like Codex does, from the same clone.
- The Copilot file is now path-scoped (`integrations/copilot/silkify.instructions.md`, for `.github/instructions/`), instead of a repository-wide `copilot-instructions.md`.
- `hasWebGL2()` in `src/tier.js` (internal; the renderer probes WebGL2 itself).

## 0.2.0 (2026-10-21)

The first tagged release: rendering in a Web Worker with high, low and static tiers; posters; material and feel presets; the Lab; one SKILL.md for every agent, importable from the CDN.
