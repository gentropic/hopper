# src/

The modular implementation. The offline collection loop is built and runs end to
end; see CLAUDE.md "Build, test & layout" for the full picture. In short:

- `src/js/main.js` — the ordered import manifest `build.js` inlines into `collector.html`.
- `src/js/boot.js` — thin entry: create the store, mount the shell, register the SW.
- `src/style.css`, `src/template.html` — inlined into the built `collector.html`.

`npm run build` → `collector.html`; `npm test` → `node --test`; `npm run smoke` →
Playwright over the built artifact; `npm run test:all` → both.

## What's here

- `records/` — the object model: `address` (content-addressing + stream id),
  `jcs` (RFC 8785 signing form), `crypto` (+ `ed25519-fallback`, noble),
  `envelope` (signed record + corrections/tombstones/resolve). *Import-clean —
  the lead extraction candidate.*
- `rules/eval.js` — the total expression calculus (parse → AST → evaluate);
  the logic layer of a definition (SPEC-hopper-rules).
- `renderer/` — `state` (headless reactive engine on `@gcu/sideact`), `render`
  (DOM widgets incl. geo / media / barcode capture), `scan` (camera QR/barcode).
- `xlsform/index.js` — XLSForm ↔ tree converter + the expression bridge.
- `storage/store.js` — the signed append-only record store over `@gcu/vfs`:
  the save boundary, durability (persist / readout / single-copy warning /
  folder mirror / key + archive export), attachment blobs, and the **sync merge**
  (`importBundle` set-union, sig-verified).
- `formsource/` — load a form tree from `load` (`@gcu/yaml` / JSON), `xlsx`
  (SheetJS), or `capsule` (a capsule string / share link, in + out).
- `collector/shell.js` — the Forms · Fill · Outbox · Settings shell around the
  renderer.

## Staged extraction (per SPEC-hopper §3)

`records/`, `rules/`, `xlsform/` are kept import-clean so they lift into published
`@gcu/hopper-*` packages once stable — *not* a day-one monorepo. Targets:

- **renderer** → `@gcu/hopper-renderer` · **xlsform** → `@gcu/hopper-xlsform`
- **collector** → `@gcu/hopper-collector`
- **jig** *(later)* — schema-from-example builder + the seam interview → `@gcu/hopper-jig`
- **mill** *(later)* — `soft`-query over the append-only union; the aggregation
  console → `@gcu/hopper-mill`

## Build order (SPEC-hopper §6), with progress

renderer ✅ → xlsform import ✅ → collector shell ✅ → storage + durability ✅ →
deploy (served PWA ✅ · BYO-infra zip pending) → **P2P sync** (merge ✅ via archive
import; live carriers next) → jig → mill.

Internal module boundaries aren't prescriptive beyond the spec's component map —
modularize as the build dictates.
