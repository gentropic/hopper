# vendor/ — provenance

Hopper is a single-file PWA with a zero-dependency build, so its dependencies are
**vendored** here rather than installed from npm + bundled (the weir pattern).
This keeps the supply chain auditable and the build offline. Run
`node tools/sync-vendor.mjs` to (re)populate from the sibling working copies.

**The coupling tradeoff:** vendoring carries *snapshots* — when an upstream lib
changes, re-run the sync and review the diff. The alternative (npm deps + a
bundler) was rejected to preserve the single-file, zero-supply-chain ethos
(DECISIONS / CLAUDE.md "Build & layout").

## The intended vendor set

| vendor file    | upstream                          | what Hopper uses it for |
|----------------|-----------------------------------|-------------------------|
| `yaml.js`      | `../auditable/ext/yaml` (`@gcu/yaml`) | parse/emit the human source serialization |
| `sideact.js`   | `../auditable/ext/sideact` (`@gcu/sideact`) | the reactive signal graph for rules/relevance |
| `vfs.js`       | `../auditable/ext/vfs` (`@gcu/vfs`) | IDB/OPFS/comment storage backends |
| `capsule.js`   | `../capsule` (`@gcu/capsule`)     | transport + `bytesToB64Url`/base45 codecs |
| `switchboard/` | `../auditable/ext/switchboard`    | design tokens (CSS) |
| `ggwave.*`     | upstream `ggwave` (MIT, WASM)     | data-over-sound sync fallback (bundled, §5.5) |
| `sheetjs.*`    | SheetJS (community build)         | xlsx import/export for the converter |
| `noble-ed25519.js` | `@noble/ed25519` (MIT, paulmillr) | Ed25519 **fallback** when the browser lacks Web Crypto Ed25519 |

## Ed25519 fallback (noble) — bundled, not lazy

`records/crypto.js` prefers native Web Crypto Ed25519 and falls back to a vendored
**noble-ed25519** when unsupported. Like ggwave, it is **bundled, never
lazy-loaded** — a fallback can't depend on a network fetch that may not be there.

noble isn't in a sibling repo, so vendoring is a *reviewed* step (not an automatic
sibling copy): obtain a **pinned** `@noble/ed25519` release (single file, ~4 kB
gzip, zero runtime deps, audited lineage), read it, place it at
`vendor/noble-ed25519.js`, record its version + license here, then wire a small
adapter at startup:

```js
import * as nobleEd from '../../vendor/noble-ed25519.js';
import { setEd25519Backend } from './records/crypto.js';
// noble needs a SHA-512 — supply Web Crypto's (universally available):
nobleEd.etc.sha512Async = (m) => crypto.subtle.digest('SHA-512', m).then(b => new Uint8Array(b));
setEd25519Backend({
  generateStreamKey: async () => { /* seed → {publicKey, privateKey} b64url */ },
  sign:   (bytes, seedBytes) => nobleEd.signAsync(bytes, seedBytes),
  verify: (bytes, sigBytes, pubBytes) => nobleEd.verifyAsync(sigBytes, bytes, pubBytes),
});
```

Until then the collector runs on native Web Crypto Ed25519 (Node ≥ 20 and current
browsers); the fallback seam is in place and tested by the round-trip suite.

Each file added here gets a row in `vendor-licenses.json` (to be created) with
its license + source commit, mirroring `weir/vendor-licenses.json`.

*Nothing is vendored yet — modules pull deps in as they need them. `address.js`
is intentionally dependency-free (self-contained base64url) so the first build
and tests run with an empty `vendor/`.*
