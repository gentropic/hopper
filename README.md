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

**Status:** under active development. The offline collection loop works end to
end — load / scan / share a form → fill → capture → sign → persist → back up →
merge a peer's archive — in the built `collector.html`. Next: live sync carriers,
then the builder (jig) and analysis console (mill). The specs in `docs/` are the
design contract; the code in `src/` is the implementation.

## Layout

- `docs/` — the specs + `DECISIONS.md`. Start with `SPEC-hopper.md`.
- `src/` — the modular implementation (see `src/README.md`); built into
  `collector.html` at the repo root.
- `reference/` — the single-file prototypes the stack was grown from (the
  renderer, the XLSForm converter). Correct and tested, but not the shipped modules.
- `mocks/` — UX mocks (look and feel, not code).
- `examples/` — sample form definitions.

## The specs

- **SPEC-hopper** — architecture, topology, invariants, build order. The entry point.
- **SPEC-hopper-form** — the format contract: the canonical tree, its
  serializations (`@gcu/yaml` / JSON / XLSForm), field types, rules.
- **SPEC-hopper-rules** — the rule-expression language (a total calculus).
- **SPEC-hopper-collector** — the collector app: shell, records, storage, and
  the full sync carrier model.
- **SPEC-hopper-records** — the signed record object model and the conflict-free union.
- **SPEC-hopper-paper** — printable, machine-readable forms that scan back to records, offline (design / roadmap).
- **DECISIONS.md** — design resolutions that amend the specs where they differ.

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
