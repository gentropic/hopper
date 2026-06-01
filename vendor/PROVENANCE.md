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

## Ed25519 fallback (noble) — vendored ✓

`records/crypto.js` prefers native Web Crypto Ed25519 and falls back to vendored
**noble-ed25519** when the browser lacks it. Like ggwave, it is **bundled, never
lazy-loaded** — a fallback can't depend on a network fetch that may not be there.

| field | value |
|-------|-------|
| package | `@noble/ed25519` (paulmillr), MIT |
| version | **3.1.0** (pinned) |
| source | `npm pack @noble/ed25519@3.1.0` → `package/index.js` (single file, zero runtime deps) |
| npm integrity | `sha512-pfcObRY3CtvwfaG9Mt5XqZdKmAQppl37tHUeuBhDUbiwJBCVY4/A4lbMvb1xKhMDx96AqAqZpMWuBX1HulhX4g==` |
| local sha256 | `sha256-_ok7-5KGxniSpFwYU3A16rMyW8cjuyhV3cuenLV9-ao` (`vendor/noble-ed25519.js`, byte-identical) |
| license file | `vendor/noble-ed25519.LICENSE` |

The file is kept byte-identical to the npm release (so the hash re-verifies on
re-download). The build **namespace-wraps** it (`import * as nobleEd …` →
isolated IIFE) so its internals don't pollute the flat global scope. noble v3's
async API (`keygenAsync`/`signAsync`/`verifyAsync`) draws its SHA-512 from Web
Crypto by default (universal, even where Ed25519 isn't). The adapter that
registers it is `src/js/records/ed25519-fallback.js`; interop with the native
path (shared raw-key encoding, cross-verified signatures) is pinned by
`test/records-noble.test.mjs`.

**Re-pinning** is a deliberate, reviewed act: re-`npm pack` the new version, read
the diff, replace the file, and update version + both hashes above.

Each file added here gets a row in `vendor-licenses.json` (to be created) with
its license + source commit, mirroring `weir/vendor-licenses.json`.

*Nothing is vendored yet — modules pull deps in as they need them. `address.js`
is intentionally dependency-free (self-contained base64url) so the first build
and tests run with an empty `vendor/`.*
