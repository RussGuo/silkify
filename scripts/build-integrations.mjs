#!/usr/bin/env node
/**
 * build-integrations.mjs — one source of truth, many hosts. SKILL.md and references/ are written by hand; every
 * other agent-facing file is derived from them here, so no host ever reads a stale copy.
 *
 *   node scripts/build-integrations.mjs            # write the files below
 *   node scripts/build-integrations.mjs --check    # write nothing; exit 1 if any file differs from what it would write
 *   node scripts/build-integrations.mjs --release  # --check, and the release gate below (run it on the release commit)
 *
 *   integrations/cursor/silkify.mdc               a Cursor rule (description + globs + the SKILL.md body)
 *   integrations/copilot/silkify.instructions.md  a path-scoped Copilot instruction for .github/instructions/: it
 *                                                  applies only to page and component files, and not to code review
 *   AGENTS.md, llms.txt                           at the repository root
 *   examples/lab-help.js                          the Lab's one line under each control, from references/parameters.md
 *
 * It also owns the install sentence: one instruction, in English and in Chinese, that any agent can follow to install
 * the skill (clone the release tag into the folder it loads skills from, read SKILL.md, say it is ready). Tested by
 * hand in Claude Code and in Codex with an empty HOME. It is written into AGENTS.md and llms.txt, and into a slot in
 * each page a person copies it from: the code block under `<!-- install -->` in README.md and README.zh-CN.md, and
 * the `data-install` attribute of the "Install in your agent" button in examples/index.html and examples/lab.html.
 * --check fails when any of them differs from the sentence below by one character.
 *
 * The author's byline is kept the same way: AUTHOR below is written between `<!-- byline -->` and `<!-- /byline -->`
 * under the README titles and the How it works page, in the gallery's footer and in the Lab (which copies it into the
 * HTML it downloads).
 *
 * There is no ChatGPT custom GPT any more: OpenAI retires custom GPTs on 2026-12-11, and the ChatGPT desktop app
 * reads skills like Codex does (the same clone of this repository).
 *
 * Links are made absolute and pinned to the release tag (v + package.json's version), because a derived file is
 * read far from this repository. It also checks SKILL.md against the Agent Skills spec (agentskills.io/specification):
 * frontmatter fields and lengths, a name that matches the folder, a body under 500 lines; and one version
 * everywhere: package.json, SKILL.md's metadata, the plugin marketplace entry, every CDN URL (the Lab's Download
 * HTML included), cdn.html's default ref and every `--branch` in a clone line, all on the tag v + that version.
 *
 * The derived files keep SKILL.md's order: copying src/ into the project is the way, the CDN the alternative for
 * a page with nowhere to put files. No dependencies.
 *
 * What a release tag carries is also kept clean here, because the tag is what `git clone --branch` installs. Always:
 * the tracked files at the repository's root are the ROOT_FILES below and nothing else, and no tracked file anywhere is a
 * log or is named like a debugging leftover (dbg, debug, _try). With --release, the gate for the release commit itself:
 * no CDN URL is pinned to @main (between releases a page may follow main for what no tag has yet, e.g. the Lab's words),
 * and the READMEs do not call anything new on main. A prerelease version (0.4.0-rc.1) skips that gate.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const release = process.argv.includes('--release');
const check = release || process.argv.includes('--check');
const read = (f) => readFile(path.join(ROOT, f), 'utf8');

/* ============================================
 * Sources
 * ============================================ */
const pkg = JSON.parse(await read('package.json'));
const TAG = `v${pkg.version}`;
const REPO = 'https://github.com/RussGuo/silkify';
const BLOB = `${REPO}/blob/${TAG}/`;
const RAW = `https://raw.githubusercontent.com/RussGuo/silkify/${TAG}/`;
const CDN = `https://cdn.jsdelivr.net/gh/RussGuo/silkify@${TAG}/`;
const SITE = 'https://russguo.github.io/silkify/';
/** What a person pastes into their agent. One line (it ends up in a chat box and an HTML attribute): no quotes, &, < or >. */
const INSTALL = {
  en: `Install the silkify agent skill: git clone --depth 1 --branch ${TAG} ${REPO} into a folder named silkify in the directory you load skills from (~/.claude/skills for Claude Code; ~/.agents/skills for Codex, Cursor, GitHub Copilot, Gemini CLI and most other agents), then read its SKILL.md and tell me whether silkify is ready.`,
  zh: `安装 silkify 这个 Agent Skill：用 git clone --depth 1 --branch ${TAG} ${REPO} 把它克隆到你读取 skill 的目录里，文件夹就叫 silkify（Claude Code 是 ~/.claude/skills，Codex、Cursor、GitHub Copilot、Gemini CLI 和大多数其他 Agent 是 ~/.agents/skills），然后读一遍它的 SKILL.md，告诉我装好没有。`,
};
/** Where the sentence sits in hand-written pages: a pattern with three groups (before, the sentence, after). */
const SLOTS = [
  ['README.md', 'en', /(<!-- install[^\n]*-->\n```text\n)([^\n]*)(\n```)/],
  ['README.zh-CN.md', 'zh', /(<!-- install[^\n]*-->\n```text\n)([^\n]*)(\n```)/],
  ['examples/index.html', 'en', /(<button id="install"[^>]*? data-install=")([^"]*)(")/],
  ['examples/lab.html', 'en', /(<button id="install"[^>]*? data-install=")([^"]*)(")/],
];
/** Who made silkify: the name and the links, in this one place. Written into every page the work travels with (a
 *  line under the README titles and How it works, the gallery's footer, the Lab, which copies it into the files it
 *  downloads); add a
 *  second link (X, a site) here and every page follows. Links after the first are listed after the name. */
const AUTHOR = { name: 'Russ Guo', links: [['GitHub', 'https://github.com/RussGuo']] };
const byline = (lead) => `${lead}<a href="${AUTHOR.links[0][1]}">${AUTHOR.name}</a>`
  + AUTHOR.links.slice(1).map(([label, href]) => ` · <a href="${href}">${label}</a>`).join('');
const BYLINE = { en: byline('Made by '), zh: byline('作者：') };
/** Where the byline sits: between `<!-- byline -->` and `<!-- /byline -->` on one line. */
const BYLINE_SLOT = /(<!-- byline -->)([^\n]*?)(<!-- \/byline -->)/;
const BYLINES = [
  ['README.md', 'en'], ['README.zh-CN.md', 'zh'], ['examples/index.html', 'en'], ['examples/lab.html', 'en'],
  ['references/how-it-works.md', 'en'], ['references/how-it-works.zh-CN.md', 'zh'],
];
const REFERENCES = [
  ['references/parameters.md', 'Parameters', 'every option with its default and tuning range, the material and feel presets, recipes from the gallery'],
  ['references/performance.md', 'Performance', 'device tiers, when the loop sleeps, many objects on one page, what breeze and autoplay cost, measurements'],
  ['references/troubleshooting.md', 'Troubleshooting', 'symptom, cause and fix: halos, creases, black squares, no ripple, the worker falling back'],
];

const skill = await read('SKILL.md');
const [, front, body] = skill.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) || [];
const meta = frontmatter(front || '');
const refs = await Promise.all(REFERENCES.map(([f]) => read(f)));

/** The few YAML shapes SKILL.md uses: `key: value` and one nested map (metadata). */
function frontmatter(text) {
  const out = {};
  let map = null;
  for (const line of text.split('\n')) {
    const nested = line.match(/^ {2}([\w-]+):\s*(.*)$/);
    if (nested && map) { map[nested[1]] = unquote(nested[2]); continue; }
    const top = line.match(/^([\w-]+):\s*(.*)$/);
    if (!top) continue;
    if (top[2] === '') out[top[1]] = map = {};
    else { out[top[1]] = unquote(top[2]); map = null; }
  }
  return out;
}
function unquote(v) { return /^".*"$/.test(v) ? JSON.parse(v) : v; }

/* ============================================
 * Validation: the Agent Skills spec, plus this repository's own rules
 * ============================================ */
const errors = [];
const allowed = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
for (const k of Object.keys(meta)) if (!allowed.has(k)) errors.push(`SKILL.md: frontmatter field '${k}' is not in the Agent Skills spec`);
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(meta.name || '') || meta.name.length > 64) errors.push('SKILL.md: name must be 1-64 of a-z, 0-9 and single hyphens');
if (meta.name !== path.basename(ROOT) && meta.name !== 'silkify') errors.push(`SKILL.md: name '${meta.name}' does not match the folder`);
if (!meta.description || meta.description.length > 1024) errors.push(`SKILL.md: description must be 1-1024 characters (${meta.description?.length})`);
if (meta.compatibility && meta.compatibility.length > 500) errors.push(`SKILL.md: compatibility is over 500 characters (${meta.compatibility.length})`);
if (meta.metadata && Object.values(meta.metadata).some((v) => typeof v !== 'string')) errors.push('SKILL.md: metadata values must be strings');
if (meta.metadata?.version !== pkg.version) errors.push(`SKILL.md: metadata.version ${meta.metadata?.version} ≠ package.json ${pkg.version}`);
for (const plugin of JSON.parse(await read('.claude-plugin/marketplace.json')).plugins || []) {
  if (plugin.version !== pkg.version) errors.push(`.claude-plugin/marketplace.json: ${plugin.name} ${plugin.version} ≠ package.json ${pkg.version}`);
}
const lines = skill.split('\n').length;
if (lines > 500) errors.push(`SKILL.md: ${lines} lines (the spec asks for under 500; move detail to references/)`);
for (const f of ['SKILL.md', ...REFERENCES.map(([f]) => f), 'README.md', 'README.zh-CN.md', 'examples/cdn.html', 'examples/lab.html', 'CHANGELOG.md']) {
  for (const [, ref] of (await read(f).catch(() => '')).matchAll(/RussGuo\/silkify@([\w.-]+)/g)) {
    if (ref !== TAG && ref !== 'main' && !/^\$\{/.test(ref)) errors.push(`${f}: CDN pinned to @${ref}, but the release is ${TAG}`);
  }
}

/* ---- what the tag carries: the root's files, no leftovers; with --release, nothing pinned to or announced on main ---- */
const ROOT_FILES = ['.gitignore', 'AGENTS.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'CONTRIBUTING.zh-CN.md', 'LICENSE', 'README.md', 'README.zh-CN.md', 'SKILL.md', 'index.html', 'llms.txt', 'package.json'];
const LEFTOVER = /\.log$|dbg|debug|_try/i;
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
for (const f of tracked) {
  if (!f.includes('/') && !ROOT_FILES.includes(f)) errors.push(`${f}: a tracked file at the root that is not one of ROOT_FILES (a leftover? else add it there)`);
  if (LEFTOVER.test(path.posix.basename(f))) errors.push(`${f}: a tracked log or debugging leftover (named like ${LEFTOVER.source})`);
}
const prerelease = pkg.version.includes('-');
if (release && !prerelease) {
  // every text file that could carry a CDN URL, not only the ones checked above: a page added later is covered too
  for (const f of tracked.filter((f) => /\.(md|txt|html|js|mjs|jsx|json)$/.test(f))) {
    const text = await read(f).catch(() => '');
    for (const m of text.matchAll(/RussGuo\/silkify@main\b/g)) errors.push(`${f}:${text.slice(0, m.index).split('\n').length}: CDN pinned to @main in a release (pin ${TAG})`);
  }
  for (const f of ['README.md', 'README.zh-CN.md']) {
    const text = await read(f);
    for (const m of text.matchAll(/\bnew on `?main`?|\bonly on `?main`?|`?main`? ?上(?:有|才|新)/gi)) errors.push(`${f}:${text.slice(0, m.index).split('\n').length}: "${m[0]}" in a release (say what ${TAG} has)`);
  }
}
const cdnRef = (await read('examples/cdn.html')).match(/qs\.get\('ref'\) \|\| '([^']+)'/)?.[1];
if (cdnRef !== TAG) errors.push(`examples/cdn.html: default ref ${cdnRef}, but the release is ${TAG}`);
if (/\bClaude\b/.test(body)) errors.push('SKILL.md: the body names a host ("Claude"); say "the agent"');
for (const [lang, text] of Object.entries(INSTALL)) if (/["&<>\n]/.test(text)) errors.push(`INSTALL.${lang}: one line, without quotes, & or angle brackets`);
const pages = {};
for (const [f, lang, slot] of SLOTS) {
  pages[f] ??= await read(f);
  if (!slot.test(pages[f])) errors.push(`${f}: no slot for the install sentence (${slot.source.slice(1, 24)}…)`);
  else pages[f] = pages[f].replace(slot, (_, a, __, b) => a + INSTALL[lang] + b);
}
if (/["<>&]/.test(AUTHOR.name) || AUTHOR.links.some(([l, h]) => /["<>&]/.test(l + h))) errors.push('AUTHOR: no quotes, & or angle brackets');
for (const [f, lang] of BYLINES) {
  pages[f] ??= await read(f);
  if (!BYLINE_SLOT.test(pages[f])) errors.push(`${f}: no slot for the byline (<!-- byline --><!-- /byline -->)`);
  else pages[f] = pages[f].replace(BYLINE_SLOT, (_, a, __, b) => a + BYLINE[lang] + b);
}
// after the install sentence is filled in, so a release bump only needs package.json
for (const f of ['SKILL.md', ...REFERENCES.map(([f]) => f), 'README.md', 'README.zh-CN.md']) {
  for (const [, ref] of (pages[f] ?? await read(f)).matchAll(/--branch (v[\w.-]+)/g)) if (ref !== TAG) errors.push(`${f}: clones --branch ${ref}, but the release is ${TAG}`);
}

/* ============================================
 * Transforms
 * ============================================ */
/** Relative Markdown links → absolute links pinned to the tag; HTML comments removed. */
const portable = (md, base = '') => md
  .replace(/<!--[\s\S]*?-->\n?/g, '')
  .replace(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g, (_, p) => `](${BLOB}${path.posix.normalize(base + p)})`)
  .replace(/\n{3,}/g, '\n\n')
  .trim() + '\n';
const GENERATED = '<!-- Generated by scripts/build-integrations.mjs from SKILL.md and references/. Edit those, then run `npm run build:integrations`. -->';
const oneLine = meta.description.replace(/\s+/g, ' ');

/* ============================================
 * Outputs
 * ============================================ */
const files = {};

files['integrations/cursor/silkify.mdc'] = `---
description: ${oneLine}
globs:
alwaysApply: false
---
${GENERATED}

${portable(body)}`;

files['integrations/copilot/silkify.instructions.md'] = `---
applyTo: "**/*.html,**/*.jsx,**/*.tsx,**/*.vue,**/*.svelte,**/*.astro"
excludeAgent: "code-review"
---
${GENERATED}

# silkify

When the user asks to "silkify" a picture, or wants a silk, satin or fabric ripple-on-hover effect, or an interactive WebGL object made from a PNG, follow the skill below. The library is the \`src/\` folder of ${REPO}: copy it into the project and serve it with the page. Import it from the CDN only when the page has nowhere to put files.

${portable(body).replace(/^# silkify\n+/, '')}`;

files['AGENTS.md'] = `${GENERATED}

# silkify

${oneLine}

## Using silkify in another project

This repository is an Agent Skill. Read [SKILL.md](SKILL.md) and follow its steps; open the files in [references/](references/) only when a step points there. The library is [src/](src/): copy that folder into the project and serve it with the page, so the page depends on no outside service. Only a page with nowhere to put files imports it from the CDN instead (\`${CDN}src/silk.js\`).

To install it as a skill, do what this sentence says (it is the one the README gives people to paste):

\`\`\`text
${INSTALL.en}
\`\`\`

## Working on this repository

- \`SKILL.md\` and \`references/\` are the only hand-written agent docs. \`AGENTS.md\`, \`llms.txt\`, everything in \`integrations/\` and \`examples/lab-help.js\` are generated: edit the sources, then run \`npm run build:integrations\` (\`-- --check\` fails on drift). The install sentence and the author's byline in the READMEs, the gallery and the Lab are written by the same script: change them there, not in the pages.
- \`node scripts/shoot.mjs\` must pass before every commit (headless Chrome, Python with Pillow; about five minutes); it writes nothing into the repository (\`--shots\` rewrites \`docs/shots/*-rest.jpg\` when the look changed). CI also runs \`--browsers\` (WebKit and Firefox) and \`scripts/frameworks.mjs\` (React in Vite and Next.js); both need Playwright, which is never a dependency.
- The default look is pixel-for-pixel fixed: every new option defaults to off, and the gallery posters in \`examples/posters/\` are not re-rendered unless their card changed.
- No build step and no runtime dependencies besides three.js; every source file stays under 800 lines and opens with a comment that says what it is and why.
`;

/* The Lab's line under each control: the "What it does" column of references/parameters.md, first sentence, so the
 * Lab never explains an option in other words than the reference does. The first row naming a key wins (the main
 * table comes before the element-mode one); a row that names several keys gives each the same line. A pointer into
 * the docs, "(see step 2)", means nothing in the Lab and is dropped. */
const HELP = {};
for (const [, keys, what] of refs[0].matchAll(/^\| ((?:`\w+`(?:, )?)+) \| [^|\n]* \| ([^|\n]*) \|/gm)) {
  const line = what.trim().split(/(?<=\.) (?=[A-Z])/)[0].replace(/ \(see [^)]*\)/g, '');
  if (line) for (const [, k] of keys.matchAll(/`(\w+)`/g)) HELP[k] ??= line;
}
for (const k of ['pressDepth', 'material', 'feel', 'bumpStrength', 'spinSpeed', 'tier']) if (!HELP[k]) errors.push(`references/parameters.md: no "What it does" for ${k} (the Lab shows it)`);
files['examples/lab-help.js'] = `// Generated by scripts/build-integrations.mjs from the "What it does" column of references/parameters.md: edit
// that table, then run \`npm run build:integrations\`. examples/lab.html shows each line under its control.
export const HELP = ${JSON.stringify(HELP, null, 2)};
`;

files['llms.txt'] = `# silkify

> ${oneLine}

silkify is a WebGL library (one ES module on three.js) plus an Agent Skill. To use it, copy its src/ folder into the project, install three.js there, and import silk.js by its path (an import map names three for a plain page; a bundler needs nothing). The CDN is the alternative for a page with nowhere to put files.

An agent installs the skill by following this instruction: ${INSTALL.en}

## Skill

- [SKILL.md](${RAW}SKILL.md): the steps an agent follows: get the code, cut out the subject, choose puff, material and feel, render in HTML or React, verify
${REFERENCES.map(([f, name, what]) => `- [${name}](${RAW}${f}): ${what}`).join('\n')}

## Use

- [src/](${REPO}/tree/${TAG}/src): the library, the folder to copy into the project (silk.js is the entry point)
- [Lab](${SITE}examples/lab.html): every option as a live control; prints the options to copy
- [Gallery](${SITE}examples/): pictures, a word, the moon and a live-HTML card, each with the options that make it look right
- What a page can do with it: a word or a headline as the object (\`text\`), the object filling a whole section (\`fit: 'cover'\`), callbacks for a press, a release and a stroke with where it landed on the object (\`onPress\`, \`uv\`), a real \`<button>\` whose face is silk, and many objects on one page, posters first (\`pool()\` in src/pool.js); SKILL.md has each one

## Alternative: the CDN, for a page with nowhere to put files

- [silk.js on jsDelivr](${CDN}src/silk.js): the entry point, pinned to the release tag; the rest of src/ loads from beside it, and the page then depends on jsDelivr
- [Minimal CDN page](${RAW}examples/cdn.html): the smallest page that uses the CDN way

## Integrations

- [Cursor rule](${RAW}integrations/cursor/silkify.mdc): for .cursor/rules/
- [Copilot instructions](${RAW}integrations/copilot/silkify.instructions.md): for .github/instructions/ (applies to page and component files only)

## Optional

- [README](${RAW}README.md): overview, install, the 30-second start, materials and feels, gallery, browsers and fallbacks
- [README (简体中文)](${RAW}README.zh-CN.md)
- [How it works](${RAW}references/how-it-works.md): from a picture to silk (Poisson dome, waves, lighting), and what it costs
- [Contributing](${RAW}CONTRIBUTING.md): the rules for a change, and the repository's layout
- [Changelog](${RAW}CHANGELOG.md): what changed in each release, and what a version tag promises
- [Image credits](${RAW}examples/CREDITS.md)
`;

/* ============================================
 * Limits, then write or check
 * ============================================ */
if (errors.length) {
  console.error(errors.map((e) => `error  ${e}`).join('\n'));
  process.exit(1);
}

const drift = [];
Object.assign(files, pages);   // the pages with the sentence filled in: rewritten only when the sentence changed
for (const [f, text] of Object.entries(files)) {
  const at = path.join(ROOT, f);
  const now = await readFile(at, 'utf8').catch(() => null);
  if (check) { if (now !== text) drift.push(f); }
  else if (now !== text) { await mkdir(path.dirname(at), { recursive: true }); await writeFile(at, text); }
  console.log(`${check ? (now === text ? 'ok    ' : 'DRIFT ') : now === text ? 'same  ' : 'wrote '}${f.padEnd(52)} ${String(text.length).padStart(6)} chars`);
}
console.log(`SKILL.md: ${lines} lines, name '${meta.name}', description ${meta.description.length} chars, frontmatter ${Object.keys(meta).join(', ')}`);
console.log(`tracked: ${tracked.length} files, the root's ${ROOT_FILES.length} as listed, no leftovers${release ? (prerelease ? `; --release: ${pkg.version} is a prerelease, the release gate does not apply` : `; --release: nothing pinned to or announced on main`) : ''}`);
if (drift.length) {
  console.error(`\n${drift.length} generated file(s) out of date: run npm run build:integrations`);
  process.exit(1);
}
