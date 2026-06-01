# src/

Where the modular implementation lands. **Scaffolded** (2026-06-01) — the build
runs and the first module + vectors are in. See CLAUDE.md "Build, test & layout"
for the full picture; in short:

- `src/js/main.js` — the ordered import manifest `build.js` inlines.
- `src/js/records/address.js` — first module (content-addressing + stream-id).
- `src/js/boot.js` — scaffold shell + service-worker registration.
- `src/style.css`, `src/template.html` — inlined into the built `collector.html`.
- planned dirs (created as ported): `rules/ renderer/ xlsform/ storage/ sync/
  collector/ui/`.

`npm run build` → `collector.html`; `npm test` → `node --test`.

The components and their *intended* packages (per SPEC-hopper §3) — these are the
**staged extraction** targets (lift into `@gcu/hopper-*` once stable, not a
day-one monorepo):

- **engine / renderer** — tree → live form; reactive recompute; validation;
  rule evaluation; persistence. Port from `reference/hopper-renderer.html`.
  → `@gcu/hopper-renderer`
- **xlsform** — XLSForm ↔ tree converter + expression bridge. Port from
  `reference/hopper-xlsform.js`. → `@gcu/hopper-xlsform`
- **collector** — the ODK-Collect-shaped PWA shell (Forms · Outbox · Settings)
  around the renderer. → `@gcu/hopper-collector`
- **jig** *(later)* — schema-from-example builder + the seam interview.
  → `@gcu/hopper-jig`
- **mill** *(later)* — `soft`-query over the append-only union; analysis-ready
  exports; the aggregation console. → `@gcu/hopper-mill`

Build order (SPEC-hopper §6): renderer → xlsform import → collector shell →
storage → deploy → P2P sync → jig → mill.

Nothing here is prescriptive about internal module boundaries beyond the spec's
component map — modularize as the build dictates.
