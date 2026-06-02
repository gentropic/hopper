// Tiny static dev server. `node tools/serve.mjs` → http://localhost:8000/
// Serves the repo root; `/` resolves to the built collector.html. Also exported
// as startServer() so the smoke harness can serve over http://localhost (a
// secure context — geolocation/camera capture only work there, not file://).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

// Start a static server rooted at `root`. port 0 → an ephemeral port; resolves to
// { server, port, url, close } once listening.
export function startServer({ root = process.cwd(), port = 0 } = {}) {
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/collector.html';
    const file = join(root, normalize(p).replace(/^(\.\.[/\\])+/, ''));   // contain within root
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  return new Promise((resolve) => {
    server.listen(port, () => {
      const actual = server.address().port;
      resolve({ server, port: actual, url: `http://localhost:${actual}/`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

// CLI: only when run directly (not when imported by the smoke harness).
if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/serve.mjs')) {
  const { url } = await startServer({ root: process.cwd(), port: Number(process.env.PORT) || 8000 });
  console.log(`serving ${process.cwd()}\n→ ${url}`);
}
