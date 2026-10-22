#!/usr/bin/env node
/**
 * build-integrations.mjs — one source of truth, many hosts. SKILL.md and references/ are written by hand; every
 * other agent-facing file is derived from them here, so no host ever reads a stale copy.
 *
 *   node scripts/build-integrations.mjs            # write the files below
 *   node scripts/build-integrations.mjs --check    # write nothing; exit 1 if any file differs from what it would write
 *
 *   integrations/cursor/silkify.mdc               a Cursor rule (description + globs + the SKILL.md body)
 *   integrations/copilot/silkify.instructions.md  a path-scoped Copilot instruction for .github/instructions/: it
 *                                                  applies only to page and component files, and not to code review
 *   AGENTS.md, llms.txt                           at the repository root
 *
 * It also owns the install sentence: one instruction, in English and in Chinese, that any agent can follow to install
 * the skill (clone the release tag into the folder it loads skills from, read SKILL.md, say it is ready). Tested by
 * hand in Claude Code and in Codex with an empty HOME. It is written into AGENTS.md and llms.txt, and into a slot in
 * each page a person copies it from: the code block under `<!-- install -->` in README.md and README.zh-CN.md, and
 * the `data-install` attribute of the "Install in your agent" button in examples/index.html and examples/lab.html.
 * --check fails when any of them differs from the sentence below by one character.
 *
 * There is no ChatGPT custom GPT any more: OpenAI retires custom GPTs on 2026-12-11, and the ChatGPT desktop app
 * reads skills like Codex does (the same clone of this repository).
 *
 * Links are made absolute and pinned to the release tag (v + package.json's version), because a derived file is
 * read far from this repository. It also checks SKILL.md against the Agent Skills spec (agentskills.io/specification):
 * frontmatter fields and lengths, a name that matches the folder, a body under 500 lines; and one version
 * everywhere: package.json, SKILL.md's metadata, the plugin marketplace entry, and every CDN URL (the Lab's
 * Download HTML included) on the tag v + that version. No dependencies.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const check = process.argv.includes('--check');
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
if (/\bClaude\b/.test(body)) errors.push('SKILL.md: the body names a host ("Claude"); say "the agent"');
for (const [lang, text] of Object.entries(INSTALL)) if (/["&<>\n]/.test(text)) errors.push(`INSTALL.${lang}: one line, without quotes, & or angle brackets`);
const pages = {};
for (const [f, lang, slot] of SLOTS) {
  pages[f] ??= await read(f);
  if (!slot.test(pages[f])) errors.push(`${f}: no slot for the install sentence (${slot.source.slice(1, 24)}…)`);
  else pages[f] = pages[f].replace(slot, (_, a, __, b) => a + INSTALL[lang] + b);
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

When the user asks to "silkify" a picture, or wants a silk, satin or fabric ripple-on-hover effect, or an interactive WebGL object made from a PNG, follow the skill below. The library is ${REPO}; import it from the CDN URL below or copy its \`src/\` folder into the project.

${portable(body).replace(/^# silkify\n+/, '')}`;

files['AGENTS.md'] = `${GENERATED}

# silkify

${oneLine}

## Using silkify in another project

This repository is an Agent Skill. Read [SKILL.md](SKILL.md) and follow its steps; open the files in [references/](references/) only when a step points there. Nothing has to be copied: silk.js can be imported from \`${CDN}src/silk.js\`.

To install it as a skill, do what this sentence says (it is the one the README gives people to paste):

\`\`\`text
${INSTALL.en}
\`\`\`

## Working on this repository

- \`SKILL.md\` and \`references/\` are the only hand-written agent docs. \`AGENTS.md\`, \`llms.txt\` and everything in \`integrations/\` are generated: edit the sources, then run \`npm run build:integrations\` (\`-- --check\` fails on drift). The install sentence in the READMEs, the gallery and the Lab is written by the same script: change it there, not in the pages.
- \`node scripts/shoot.mjs\` must pass before every commit (headless Chrome, Python with Pillow; about two minutes); it writes nothing into the repository (\`--shots\` rewrites \`docs/shots/*-rest.jpg\` when the look changed). CI also runs \`--browsers\` (WebKit and Firefox) and \`scripts/frameworks.mjs\` (React in Vite and Next.js); both need Playwright, which is never a dependency.
- The default look is pixel-for-pixel fixed: every new option defaults to off, and the gallery posters in \`examples/posters/\` are not re-rendered unless their card changed.
- No build step and no runtime dependencies besides three.js; every source file stays under 800 lines and opens with a comment that says what it is and why.
`;

files['llms.txt'] = `# silkify

> ${oneLine}

silkify is a WebGL library (one ES module on three.js) plus an Agent Skill. Import it with no install from ${CDN}src/silk.js (pinned to ${TAG}) and an import map for three.js 0.152.2.

An agent installs the skill by following this instruction: ${INSTALL.en}

## Skill

- [SKILL.md](${RAW}SKILL.md): the steps an agent follows: get the code, cut out the subject, choose puff, material and feel, render in HTML or React, verify
${REFERENCES.map(([f, name, what]) => `- [${name}](${RAW}${f}): ${what}`).join('\n')}

## Use

- [silk.js on jsDelivr](${CDN}src/silk.js): the entry point, pinned to the release tag; the rest of src/ loads from beside it
- [Minimal CDN page](${RAW}examples/cdn.html): the smallest page that uses the CDN build
- [Lab](${SITE}examples/lab.html): every option as a live control; prints the options to copy
- [Gallery](${SITE}examples/): ten objects with the options that make each look right

## Integrations

- [Cursor rule](${RAW}integrations/cursor/silkify.mdc): for .cursor/rules/
- [Copilot instructions](${RAW}integrations/copilot/silkify.instructions.md): for .github/instructions/ (applies to page and component files only)

## Optional

- [README](${RAW}README.md): overview, gallery, how it works, performance
- [README (简体中文)](${RAW}README.zh-CN.md)
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
if (drift.length) {
  console.error(`\n${drift.length} generated file(s) out of date: run npm run build:integrations`);
  process.exit(1);
}
