/*
 * lab-export.js — the page the Lab's "Download HTML" writes: one file that opens with a double-click (file:// is
 * fine) and runs exactly the call the Lab prints.
 *
 * The Lab (lab.html) decides what goes in: the printed option lines, the picture (and the moon's relief) as data:
 * URLs, or, for words, a Google Font's stylesheet; and which silk.js to import (the release tag, pinned in lab.html
 * where build-integrations.mjs checks it). This file only lays the page around them: the credit, the background,
 * a canvas, the import map for three.js. silk.js and three.js come from jsDelivr, so the file needs the network but
 * no server; the comment at its top says so, and points to copying src/ for a page that is published.
 */

import { quote } from './lab-text.js';   // a literal nothing can break out of: the option lines use it too

const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.152.2/build/three.module.js';
export const BACKGROUND = { stage: '#ebe6dc', paper: '#f3efe7', white: '#ffffff', black: '#000000', checker: '#f3efe7' };

/**
 * { title, lines, picture, bump, sheet, silk, background, credit: { name, href }, mark } → the page, as a string.
 * `lines` refer to PICTURE and BUMP by name; `sheet` is waited for (3 s at most) before silkify() is called.
 */
export function pageHtml({ title, lines, picture, bump, sheet, silk, background, credit, mark }) {
  const consts = [
    ...(sheet ? [`const font = document.getElementById('font');      // the font's stylesheet first: silkify waits for the font itself`,
      `if (!font.sheet) await new Promise((r) => { font.onload = font.onerror = r; setTimeout(r, 3000); });`] : []),
    ...(picture ? [`const PICTURE = ${quote(picture)};`] : []),
    ...(bump ? [`const BUMP = ${quote(bump)};`] : []),
  ];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}, silkified</title>
<!-- silkify by ${credit.name} (${credit.href}): https://github.com/RussGuo/silkify -->
<!-- Made in the silkify Lab (https://russguo.github.io/silkify/examples/lab.html). Open it with a double-click:
     everything it shows is inside this file. It depends on jsDelivr: silk.js and three.js load from there${sheet ? ', and the font from Google Fonts' : ''}, so it needs the
     network. For a page you publish, copy src/ from https://github.com/RussGuo/silkify into your project and serve
     it yourself, as its SKILL.md says. -->${mark ? '\n<!-- The picture is the FateTell mark, © FateTell, all rights reserved: for your own experiments only. -->' : ''}
<style>
  html, body { margin: 0; height: 100%; background: ${BACKGROUND[background] || BACKGROUND.paper}; }
  canvas { display: block; width: min(92vw, 92vh); aspect-ratio: 1; margin: 4vh auto; touch-action: pan-y; }
  .silkify { position: fixed; right: 12px; bottom: 10px; font: 11px/1 system-ui, sans-serif; color: #8888; text-decoration: none; }
</style>
${sheet ? `<link id="font" rel="stylesheet" href="${sheet}">\n` : ''}<script type="importmap">
  { "imports": { "three": "${THREE_CDN}" } }
</script>
</head>
<body>
<canvas id="silk" aria-hidden="true"></canvas>
<a class="silkify" href="https://github.com/RussGuo/silkify">silkify</a>
<script type="module">
  import { silkify } from '${silk}';
${consts.map((l) => `  ${l}\n`).join('')}  window.silk = silkify(document.getElementById('silk'), {
    ${lines.join(',\n    ')},
  });
</script>
</body>
</html>
`;
}
