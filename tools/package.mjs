// Packaging — assemble a deployable bundle from the built artifact (SPEC-hopper-collector
// §6). `npm run package` = `node build.js && node tools/package.mjs`: build emits
// collector.html at the repo root; this writes `dist/` (the served PWA: index.html +
// manifest + sw + icons + a BYO-infra README) and `hopper-collector.zip`. Zero-dependency
// (the weir ethos): node's zlib + a tiny self-contained zip writer, no npm deps.
//
// Bulletproofing the update story: the service worker's cache name is stamped with the
// artifact's **content hash**, so every distinct build is a distinct cache — a new release
// cleanly invalidates + re-caches, with no manual version bump to forget. And because the
// whole app is ONE self-contained index.html, there is no multi-asset mismatch to
// half-break an update (the single-file ethos, DECISIONS §13, pays off here).

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const r = (...p) => resolve(ROOT, ...p);

if (!existsSync(r('collector.html'))) { console.error('collector.html missing — run `node build.js` first'); process.exit(1); }

const dist = r('dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// 1. the app → index.html (hosts serve index.html at /; relative refs work at any subpath)
const html = readFileSync(r('collector.html'));
writeFileSync(resolve(dist, 'index.html'), html);

// 2. content hash → the SW cache name (automatic, clean update versioning)
const hash = createHash('sha256').update(html).digest('hex').slice(0, 12);

// 3. service worker: point it at index.html + stamp the content-hash cache name
const sw = readFileSync(r('sw.js'), 'utf8')
  .replace(/'\.\/collector\.html'/g, "'./index.html'")
  .replace(/const CACHE = '[^']*';/, `const CACHE = 'hopper-${hash}';`);
writeFileSync(resolve(dist, 'sw.js'), sw);

// 4. manifest + icons (already relative-path → works at "/" and at GH-Pages "/<repo>/")
for (const f of ['manifest.webmanifest', 'icon.svg', 'icon-maskable.svg']) copyFileSync(r(f), resolve(dist, f));

// 5. the BYO-infra deploy guide
writeFileSync(resolve(dist, 'README.md'), deployReadme(hash));

// 6. a zip of the bundle, for hand-over (the spec's "export a zip")
const names = ['index.html', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'icon-maskable.svg', 'README.md'];
const files = names.map((name) => ({ name, data: readFileSync(resolve(dist, name)) }));
writeFileSync(r('hopper-collector.zip'), zip(files));

console.log(`packaged dist/ (build ${hash}, ${(html.length / 1024).toFixed(0)} kB) + hopper-collector.zip — ${files.length} files`);

// ── a minimal, dependency-free ZIP writer (deflate via zlib + bit-by-bit CRC32) ──
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
  return (~c) >>> 0;
}
function zip(entries) {
  const out = []; const central = []; let offset = 0;
  for (const e of entries) {
    const data = Buffer.from(e.data);
    const comp = deflateRawSync(data);
    const crc = crc32(data);
    const name = Buffer.from(e.name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    out.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...out, cd, eocd]);
}

function deployReadme(buildHash) {
  return `# Hopper — deploy

The Hopper collector. Build \`${buildHash}\`. **Owned, not rented:** these are static
files — host them anywhere, on infra you control, with no server and no account.

## What's here
- \`index.html\` — the whole app (one self-contained file).
- \`manifest.webmanifest\`, \`sw.js\`, \`icon*.svg\` — the PWA shell (installable + offline).

All paths are **relative**, so it works served at \`/\` *and* at a subpath like
\`/<repo>/\` (GitHub Pages).

## Host it (pick whatever you have)
- **Any static host** — GitHub Pages · Netlify · Cloudflare Pages · Vercel · Surge ·
  an S3/static bucket. Drop this folder in; done.
- **Your own server** — nginx / Caddy / Apache, or just \`python3 -m http.server\` in
  this folder. **Termux** on an Android phone works too — host from your own device in
  the field.
- **A GitHub template** — fork a deploy repo, push, enable Pages. Copy-paste, not a project.
- **The bare file** — \`index.html\` on its own, emailed or on a USB stick, opened from
  disk. Data entry works; install / camera / geolocation do *not* (those need a served,
  secure context).
- **The zip** — \`hopper-collector.zip\` is this folder, for hand-over.

## One requirement
Camera, microphone, geolocation, and install need a **secure context** — HTTPS *or* an
installed PWA. GitHub Pages / Netlify / Cloudflare give you HTTPS for free; \`localhost\`
also counts. \`file://\` does not (so the bare-file mode is data-entry-only).

## Updates
\`sw.js\`'s cache is named for the build hash (\`hopper-${buildHash}\`), so re-deploying a
new build cleanly replaces the cached app — no manual cache-busting. Because the app is
one file, an update can't half-apply.

*Geoscientific Chaos Union · MIT · single-file · self-hostable*
`;
}
