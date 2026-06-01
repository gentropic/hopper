# SPEC-hopper

**System:** Hopper — a serverless, offline-first, single-file form / data-app system
**Role of this doc:** architecture overview and build plan. The entry point. Read this first.
**Contract:** the format is specified in **SPEC-hopper-form**; per-component specs follow as each part firms up.
**Status:** Draft v0.1
**Editor:** Arthur Endlein Correia
**Last revised:** 2026-06-01
**License:** spec CC0 · reference implementations MIT

## Abstract

Hopper collects field data, builds the forms that collect it, and aggregates the results — with no central server, no per-seat rent, and no vendor able to revoke or gate it. It has Airtable's *shape* (entities, fields, views, rules) with the *topology* and *ownership* inverted: instead of one cloud system-of-record renting access to many editors, Hopper is n+1 autonomous peers, each a single owned artifact that holds its own data offline and outlives the tooling that made it. It is, in one line, a distributed subversive Airtable; in another, an ODK that collapses Build / Collect / Central into one serverless, usually-one-person experience.

This document is the map. It does not re-specify the format (that is SPEC-hopper-form) or the parts not yet designed; it states what the pieces are, how they relate, what every piece must hold true, and the order to build them in.

---

## 1. What Hopper is

Three commitments distinguish it from both the ODK stack it descends from and the SaaS data tools it competes with:

- **Single-file, browser-as-runtime, zero-server.** A Hopper artifact is HTML you can host anywhere or run from disk. The browser is the runtime; IndexedDB is the store; there is no backend to operate, pay for, or trust.
- **The definition is data; the engine is the only code.** A form/data-app definition is the canonical tree (SPEC-hopper-form §8) — interpreted, never executed. The single imperative surface, rule expressions, is a restricted profile (pure expressions + data queries; no I/O, DOM, or events). A stranger's definition is as safe to open as a menu.
- **Owned, not rented.** Records belong to the device until sent. No record caps, no editor seats, no forced upgrades. GCU may offer a hosting *mirror* as a courtesy (transparently someone else's static host), but self-hosting is complete — export a zip, serve it yourself, nothing is withheld.

It descends from ODK and stays compatible with it: XLSForm is a first-class interchange format (SPEC-hopper-form §9), so Hopper is an on-ramp to and complement of the ODK ecosystem, not a rival to it.

---

## 2. Topology

Hopper is **n + 1 autonomous peers**, not a hub with clients.

- The **n** are collectors and apps — each a self-contained artifact that works fully offline and owns its data.
- The **+1** is a *central*: a workbench/console that aggregates **copies** for cross-app query and reporting. It is the system-of-record by *convention*, not by architecture — every app remains autonomous and could survive the central vanishing.
- Flow is **opt-in**: apps replicate to the central when asked; the central pushes config/reference data back via a registry and public Sheets.
- Sync uses **no infrastructure the user operates** — a direct link over serverless carriers (QR / NFC / chirp), a public tracker (Trystero) when online, or an archive file as the floor; the full tiering is in SPEC-hopper-collector §5. Collection is **append-only**, so replication is a conflict-free union: no merge logic, no central authority required for correctness.

---

## 3. Component map

| component | what it is | status |
|-----------|------------|--------|
| **the format** | the §8 canonical tree + serializations (`@gcu/yaml` human source · JSON machine/wire · XLSForm interop) | **SPEC-hopper-form** ✓ drafted |
| **engine / renderer** | tree → live form; reactive recompute; validation; rule evaluation; persistence | reference prototype built (`hopper-renderer`); spec folds into the collector |
| **Hopper (collector)** | the ODK-Collect-shaped app: forms list, fill, outbox, sync, settings | mock built (`hopper.html`); **SPEC-hopper-collector** ✓ drafted |
| **jig (builder)** | schema-from-example + the seam interview + sparse view edits → emits the tree | mock built (`works-dataapp-mock`); spec later |
| **mill (analysis / central)** | `soft`-query over the append-only union; denormalized analysis-ready exports; cross-app aggregation console | sketch (SPEC-hopper-form §11); spec later |
| **@gcu/hopper-xlsform** | XLSForm ↔ tree converter + bidirectional expression bridge | reference impl built & round-trip-tested |
| **storage / sync** | IDB (hot) + comment-backed (durable); append-only records; tiered carriers (archive · QR/NFC/chirp direct · Trystero) | ✓ specified (SPEC-hopper-collector §4–5) |

Shared dependencies it rides on: **@gcu/yaml** (source serialization), **sideact** (reactivity), **vfs** (persistence), **capsule** (transport), **switchboard** (design system), **SheetJS** (xlsx I/O), and **ggwave** (data-over-sound, the bundled sync fallback). The names *jig* and *mill* are interior signage, not separate products — the system is just Hopper (see naming note, §7).

---

## 4. Invariants

Every component must hold these, or it is not Hopper:

1. **One contract.** The §8 tree is the single source of truth. Every surface (builder, `@gcu/yaml`, JSON, XLSForm) is a converter into it; the engine targets only it.
2. **Data, not code.** Definitions are interpreted. The only imperative surface is the restricted rule-expression profile. No third-party code path exists.
3. **Append-only collection is conflict-free.** Immutable records with stable ids; sync is a union; aggregation is trivial. (A mutable, editable data-app mode is a later, separate merge problem — §6.)
4. **BYO-infra is complete.** Anything GCU hosts, the user can host identically. No hidden server, no required account.
5. **XLSForm round-trips.** The common subset imports and exports losslessly; the deferred tail degrades with an explicit warning, never silently.
6. **Honest reliability.** Hopper is *at least as fine as ODK* for the supported palette, and *less guaranteed at the extreme* — passive/background capture and worst-case durability are named seams, not hidden ones.

---

## 5. Device coverage

An Android PWA covers essentially the entire XLSForm question palette — text, numbers, selects, dates, `geopoint`, foreground `image`/`audio`/`video`/`file`, and `barcode` (in-page via BarcodeDetector, a *win* over Collect's separate scanner app). The genuinely native-only items are **`background-audio`** (passive recording while unfocused) and **unattended background GPS tracking** (the auto-traverse mode of `geotrace`/`geoshape`); both are marked unsupported or degraded to foreground capture. Camera/mic/geolocation need a secure context, which is one more reason real deployments are served (or installed), not loose `file://`.

---

## 6. v1 scope and build order

**Build the collection loop first** — it is closest to real, append-only is the easy correct model, and runtime precedes maker. Order:

1. **Renderer** — tree → live form, reactive, against SPEC-hopper-form. *(reference prototype exists)*
2. **XLSForm import** — `@gcu/hopper-xlsform` into the renderer so it eats real `.xlsx`. *(converter done; wire SheetJS in)*
3. **Collector shell** — forms list / fill / outbox / settings around the renderer. *(mock exists)*
4. **Storage** — IDB hot + comment-backed durable + `persist()`/install onboarding.
5. **Deploy** — boring served PWA (single HTML + manifest + tiny SW); BYO-infra zip + repo template.

Then, in order: **P2P sync** (Trystero) → **jig** (builder) → **mill** (analysis/central).

**In for v1:** flat field types + simple `ref`; rules via the restricted profile; inline + Sheet choices; auto-form + sparse view annotations; append-only collection; XLSForm import/export of the supported subset; schema-from-example authoring; served-PWA deploy.

**Out / deferred:** repeats and nested groups; external/file-backed itemsets; a relational query engine and cross-entity joins; the mutable data-app merge model; encryption; the mill; the `dd` multi-app factory (the boring served PWA is the default substrate).

---

## 7. Open and parked decisions

- **Rule-expression runtime (`soft` vs AIR vs purpose-built).** *Parked* — a build-time detail. The prototype's small hand evaluator suffices for now; the syntactic XLSForm bridge is already independent of this choice. Current lean: `soft` is most naturally the **query language for the mill**, and the rule layer may want something lighter. Decide at build time against the real `soft`/`AIR` APIs.
- **Mutable data-app merge.** When the editable (non-append) data-app is built, choose field-level LWW or a CRDT. Not needed for the collector.
- **Relational scope.** v1 is flat + simple `ref`. A query engine / joins are revisited only when a real need appears.
- **Central / aggregation console.** Aggregation-by-convention is decided; the console's concrete design is a mill-era question.
- **Naming.** The system is **Hopper**. `jig` (builder) and `mill` (analysis) are optional interior view names, not separate brands; the earlier multi-name family (Circuit/Lattice/etc.) is retired.

---

## 8. Build handoff

This environment produced the **design, the contract, and reference artifacts**; the production build happens in Claude Code, against the real GCU stack (sideact/vfs/cradle/capsule), properly modularized, tested, and published.

The handoff set:

- **SPEC-hopper** (this doc) — architecture, invariants, build order.
- **SPEC-hopper-form** — the format contract the renderer and converters target.
- **SPEC-hopper-collector** — the collector app contract: shell, records/storage, and the full sync carrier model.
- **Reference implementations** — `hopper-renderer` (tree → live form + reactive rules), `@gcu/hopper-xlsform` (tested XLSForm↔tree converter).
- **UX references** — `hopper.html` (collector shell), `works-dataapp-mock` (builder feel).
- **Forthcoming** — SPEC-hopper-jig, then SPEC-hopper-mill, written as each design firms up.

Claude Code reads the overview, builds against the format contract, and ports the prototypes into the stack.

---

*Geoscientific Chaos Union · spec CC0 · 2026 · single-file*
