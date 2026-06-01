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

Each file added here gets a row in `vendor-licenses.json` (to be created) with
its license + source commit, mirroring `weir/vendor-licenses.json`.

*Nothing is vendored yet — modules pull deps in as they need them. `address.js`
is intentionally dependency-free (self-contained base64url) so the first build
and tests run with an empty `vendor/`.*
