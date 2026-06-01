# Hopper

A serverless, offline-first, single-file form / data-app system.

Hopper collects field data, builds the forms that collect it, and aggregates the
results — with no central server, no per-seat rent, and no vendor able to revoke
or gate it. It has Airtable's *shape* with the topology and ownership inverted:
instead of one cloud system-of-record renting access to many editors, Hopper is
n+1 autonomous peers, each a single owned artifact that holds its own data
offline and outlives the tooling that made it. A distributed, subversive
Airtable; an ODK that collapses Build / Collect / Central into one
mostly-one-person experience.

XLSForm is a first-class interchange format, so Hopper is an on-ramp to and
complement of the ODK ecosystem, not a rival to it.

**Status:** design complete, implementation starting. The specs and reference
implementations here are the handoff; production code lands in `src/`.

## Layout

- `docs/` — the three specs. Start with `SPEC-hopper.md`.
- `reference/` — working reference implementations to port into the stack
  (the renderer, the XLSForm converter). Correct and tested, but single-file
  prototypes — not the shipped modules.
- `mocks/` — UX mocks (look and feel, not code).
- `examples/` — sample form definitions.
- `src/` — where the modular implementation goes (see `src/README.md`).

## The specs

- **SPEC-hopper** — architecture, topology, invariants, build order. The entry point.
- **SPEC-hopper-form** — the format contract: the canonical tree, its
  serializations (`@gcu/yaml` / JSON / XLSForm), field types, rules.
- **SPEC-hopper-collector** — the collector app: shell, records, storage, and
  the full sync carrier model.

## Build order

Collection loop first — closest to real, and append-only is the easy correct
model: renderer → XLSForm import → collector shell → storage → served-PWA
deploy. Then P2P sync → jig (builder) → mill (analysis / central). Full detail
in SPEC-hopper §6.

## Rides on

`@gcu/yaml` (source serialization), `sideact` (reactivity), `vfs` (persistence),
`capsule` (transport), `switchboard` (design system), SheetJS (xlsx I/O),
`ggwave` (data-over-sound sync fallback).

## License

- Implementation — code under `reference/` and `src/`: **MIT** (see `LICENSE`).
- Specifications — everything under `docs/`: **CC0**, as marked in each document.

---

*Geoscientific Chaos Union · single-file · browser-as-runtime*
