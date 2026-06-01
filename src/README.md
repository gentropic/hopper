# src/

Where the modular implementation lands. Empty until the build starts — this
file is the map.

Per SPEC-hopper §3, the components and their intended packages:

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
