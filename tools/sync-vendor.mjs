// Vendor sync — copies the GCU dependencies into vendor/ from the sibling
// repos, so the build stays single-file and zero-supply-chain (weir pattern).
// Run `node tools/sync-vendor.mjs` whenever an upstream lib changes.
// The provenance + coupling note lives in vendor/PROVENANCE.md.
//
// Sources are the sibling working copies under ../ (the auditable monorepo's
// ext/* and the standalone capsule repo). Map entries are added as each module
// starts needing a dep; confirm the upstream bundle entry before uncommenting.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SIB = resolve(ROOT, '..');               // ../  (sibling GitHub checkouts)

// [ source (absolute under ../), dest (under vendor/) ]
// NOTE: noble-ed25519.js is NOT here — it's an npm package, not a sibling repo.
// It's vendored as a pinned, reviewed step (see vendor/PROVENANCE.md):
//   npm pack @noble/ed25519@<ver> → copy package/index.js → vendor/noble-ed25519.js
const MAP = [
  [resolve(SIB, 'auditable/ext/yaml/index.js'), 'yaml.js'],
  // [resolve(SIB, 'auditable/ext/sideact/...'), 'sideact.js'],  // TODO: confirm bundle entry
  // [resolve(SIB, 'auditable/ext/vfs/...'),     'vfs.js'],      // TODO
  // [resolve(SIB, 'capsule/...'),               'capsule.js'],  // TODO (standalone repo)
];

mkdirSync(resolve(ROOT, 'vendor'), { recursive: true });
let n = 0;
for (const [src, rel] of MAP) {
  if (!existsSync(src)) { console.warn(`skip (missing upstream): ${src}`); continue; }
  const dst = resolve(ROOT, 'vendor', rel);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  console.log(`vendored ${rel}  ←  ${src}`);
  n++;
}
console.log(`${n} vendored. Update vendor/PROVENANCE.md if the map changed.`);
