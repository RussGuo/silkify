# Changelog

## Versions and what a tag promises

- **Version numbers.** While silkify is 0.x, a minor release (0.3) may rename or remove options and handle members; it says so here. A patch release (0.2.1) fixes and adds, and never breaks a `silkify()` call that worked: the default look stays pixel for pixel the same (the gallery posters are re-rendered and compared byte for byte before a release).
- **Tags.** A release tag (`v0.2.1`) is pushed once, after every check has passed on that commit, and is never moved or deleted. That is this project's promise, not a property of git: a tag can be force-pushed. jsDelivr keeps the files it has served for a tag, so `@v0.2.1` does not change under a page in practice, but nothing cryptographic guarantees it.
- **When integrity matters, pin a commit.** `https://cdn.jsdelivr.net/gh/RussGuo/silkify@<40-character commit SHA>/src/silk.js` names exactly one tree of files. Or copy `src/` into the project and serve it yourself.
- **Subresource Integrity covers one file.** An `integrity` attribute (or an import map's `integrity` entry) checks only the module the page imports directly, silk.js. The modules silk.js imports, the worker it starts, and three.js loaded inside that worker are fetched without one. For the whole chain, pin a commit and self-host.

## Unreleased

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
