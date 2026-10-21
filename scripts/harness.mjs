/**
 * harness.mjs — the two things every check script needs, with no dependencies of its own:
 *
 *   serve(root, { cors })   a static file server on 127.0.0.1 (a random port) → { base, close() }
 *   playwright()            Playwright, for the scripts that drive WebKit and Firefox (browsers.mjs, frameworks.mjs).
 *                           It is never a dependency of this repository: install it next to the scripts with
 *                           `npm i --no-save playwright` (CI does), or point PLAYWRIGHT at an installed copy.
 *
 * shoot.mjs drives Chrome over the DevTools protocol and needs only serve().
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const TYPES = {
  '.webp': 'image/webp', '.gif': 'image/gif', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css', '.md': 'text/plain', '.svg': 'image/svg+xml', '.json': 'application/json',
};

/** `cors` sends Access-Control-Allow-Origin: *, so a page on another origin can import silk.js from here (a stand-in CDN). */
export async function serve(root, { cors = false } = {}) {
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, p);
    if (!file.startsWith(root)) return res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', ...(cors ? { 'access-control-allow-origin': '*' } : {}) }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, port: server.address().port, close: () => server.close() };
}

export async function playwright() {
  const where = process.env.PLAYWRIGHT;
  try {
    return await import(where ? pathToFileURL(path.resolve(where)).href : 'playwright');
  } catch {
    console.error('This check needs Playwright, which is not a dependency of silkify:\n'
      + '  npm i --no-save playwright && npx playwright install webkit firefox\n'
      + 'or set PLAYWRIGHT to an installed copy (for example PLAYWRIGHT=~/tools/node_modules/playwright/index.mjs).');
    process.exit(2);
  }
}
