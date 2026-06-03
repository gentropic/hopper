# SPEC-hopper-form

**System:** part of Hopper — see **SPEC-hopper** for the architecture overview and build plan
**Format:** `hopper` — the Hopper form / data-app definition: a canonical tree (§8) with three serializations
**Serializations:** `@gcu/yaml` (human source) · JSON (machine / capsule wire) · XLSForm (spreadsheet interop, §9)
**Engine:** the Hopper renderer (tree → live form, reactive, persistent). Standalone or as a Works surface.
**Status:** Draft v0.1
**Editor:** Arthur Endlein Correia
**Last revised:** 2026-06-01
**License:** spec CC0 · reference implementation MIT
**Amended by:** `SPEC-hopper-rules` (the rule layer — supersedes §6's "restricted `soft`" framing) + `DECISIONS.md`. Newer where they differ.

## Abstract

`hopper` is a declarative form / data-app definition. One definition describes **what fields exist, what they accept, and what happens** — fields, choices, views, and event→rule logic — as a **canonical tree** (§8). The engine owns everything hard: widget rendering, the editable grid, reactive recompute, validation display, persistence, sync. The author (a person, the smart builder, or a model) writes only the declaration, in whichever serialization suits — `@gcu/yaml` to read and hand-edit, JSON to transport, XLSForm to exchange with ODK.

It shares three load-bearing properties with the rest of the GCU stack:

1. **Authored by people *or* machines, tuned for both.** A model emits the tree as JSON; a human reads and edits it as `@gcu/yaml` (comments, quoted scalars, clean diffs). The parser is strict with line-numbered errors; *semantic* tolerance — an unknown field type or rule verb degrades to a fallback widget or a skipped rule with a warning — lives in the engine, not the syntax.
2. **The definition is the security boundary.** A definition is *data*, interpreted by one curated engine. No third-party code runs. The only imperative surface — rule expressions — is a **total expression calculus** (pure, within-record; no loops, recursion, I/O, DOM, or events — SPEC-hopper-rules). Totality is the boundary: a stranger's definition resolves as safely as a menu.
3. **Disposition: small, owned, durable.** A definition is a small text document; the records it collects belong to the device until sent.

Where `arcr` (SPEC-arcr) describes a game as objects + event→action, `hopper` describes a data app as fields + event→rule — the same declarative-tree philosophy, swapped nouns.

---

## 1. Where it sits

- **capsule** (SPEC-capsule) can carry a definition inline (QR/URL) or by reference (`gh:`/`gist:`/`url:` to a published Sheet). Definitions deflate well with a keyword dictionary.
- **Hopper** (the system) renders a definition, collects records into IndexedDB, and syncs them over tiered carriers (SPEC-hopper-collector §5). It also imports/exports **XLSForm** (§9), so a definition round-trips with the ODK ecosystem.
- **soft** (ext/soft) supplies the rule expression layer, in a restricted profile (§6).
- **XLSForm** is an interchange format, not the internal model. The canonical model is the tree in §8; XLSForm is one serializer/deserializer over it.

A definition reaches Hopper three ways, all lowering to the same tree (§8): a **public Sheet** (live, editable in Sheets, public def), a **capsule** (shareable link/QR), or an **uploaded .xlsx** (private, offline). The renderer never cares which.

---

## 2. Identity and meta

A definition's identity and form-level settings live in the `meta` block of the tree (§8), not in any magic line:

| key       | meaning                                  | default            |
|-----------|------------------------------------------|--------------------|
| `id`      | stable form id (reverse-DNS ok)          | hash of the tree   |
| `title`   | human title                              | `id`               |
| `version` | author version string (a string, never coerced to a date) | none |
| `lang`    | default BCP-47 language                  | `"en"`             |
| `mode`    | `"append"` for collection (immutable records) | `"append"`    |
| `tiers`   | declared storage/sync adapters (§5)      | `{store:"idb", durable:"comment"}` |

---

## 3. Serializations

The canonical model is the **tree** (§8). It has three serializations; the engine targets the tree, never a specific syntax.

**`@gcu/yaml` — the human source.** A definition is read and hand-edited as the strict, auditable YAML 1.2 subset (`@gcu/yaml`, SPEC-yaml). Its properties earn it the job:

- **No implicit typing.** Every scalar is quoted, so a choice value `"no"`, a version `"2026-06-01"`, or a zero-padded code stays a string — exactly the values vanilla YAML would mangle. `true`/`false` and bare numbers are the only typed literals.
- **Comments and block scalars.** A field or rule can be annotated inline; a long `hint` or expression reads as written.
- **Strict, with line-numbered errors.** The parser rejects anything outside the subset with `{rule, line, column}`, surfaced into the authoring pipeline. (Syntactic strictness only; *semantic* degradation — unknown field type or verb — is the engine's job.)
- **Canonical emitter.** `tree → yaml` round-trips, so any source (builder, JSON, XLSForm import) can be shown as clean YAML.
- **Cross-parser invariant.** Tag-free documents read identically under vanilla `js-yaml`/`yaml.v3`/`ruamel`; the def is not locked to one parser.

**JSON — the machine / wire form.** The tree *is* JSON: what a model emits, what a capsule carries (deflated), what crosses process boundaries. No conversion — it is the tree.

**XLSForm — the spreadsheet interchange** (§9), for Excel authoring and ODK round-trip.

There is no bespoke line grammar. (An earlier draft proposed an `arcr`-style line format; `@gcu/yaml` does that job — readable hand-authored source — for free, safely, and as the stack's sanctioned manifest format, so the line grammar is dropped.)

Identifiers (`name`, `list`, choice `value`) are `[a-z0-9_-]+`, lowercased; they become stored data keys. A field `name` MUST be unique within the definition.

---

## 4. Field types (v0)

Each field is an entry in the tree's `fields` array — `{name, fieldType, label, props}`. A `select`/`multiselect`/`rank` names its option list via `props.list` into `choices` (§7).

| type            | input / meaning                                        | XLSForm (§9)            |
|-----------------|--------------------------------------------------------|-------------------------|
| `text`          | free text                                              | `text`                  |
| `number`        | numeric; `int: true` for integer-only                  | `decimal` / `integer`   |
| `range`         | bounded slider; `min=` `max=` `step=`                  | `range`                 |
| `select(list)`  | one choice from `list`                                 | `select_one list`       |
| `multiselect(list)` | many choices from `list`                           | `select_multiple list`  |
| `rank(list)`    | order a list                                           | `rank list`             |
| `date` `time` `datetime` | temporal inputs                               | `date` / `time` / `dateTime` |
| `geo`           | single GPS point                                       | `geopoint`              |
| `geotrace` `geoshape` | line / polygon of points (foreground capture)    | `geotrace` / `geoshape` |
| `photo`         | camera / image file                                    | `image`                 |
| `audio` `video` | foreground recording / upload                          | `audio` / `video`       |
| `file`          | generic file                                           | `file`                  |
| `barcode`       | in-page scan (BarcodeDetector, polyfill fallback)      | `barcode`               |
| `note`          | display-only text, no input                            | `note`                  |
| `calc`          | computed value, no UI (paired with a `calculate` rule) | `calculate`             |
| `hidden`        | stored constant, no UI                                 | `hidden`                |
| `ref(entity)`   | reference to a record of another entity (v0: simple)   | *(extension)*           |

**Containers (v1).** A node in `fields` is either a leaf field (above) or a **container** carrying a `children` array — the tree is hierarchical (§8):

| type     | input / meaning                                                  | XLSForm (§9)                |
|----------|-----------------------------------------------------------------|-----------------------------|
| `group`  | presentational section; **may nest**; renders **collapsible**; no value of its own (children keep flat, form-unique names) | `begin_group` / `end_group` |
| `repeat` | a repeating block; `children` collect an **array of instances** into `values.<name>` | `begin_repeat` / `end_repeat` |

Nested `group`s add no data-model cost (names stay form-unique, values stay flat). A `repeat`'s children form per-instance sub-records; rules inside it evaluate per-instance, and `count`/`total`/`max`/`min` aggregate over its instances (SPEC-hopper-rules; DECISIONS §12).

Common props (in `props`): `required` (bool, or a message string), `default`, `hint`, `appearance`, `readonly`, and `label::<lang>` for translations. Type-specific params ride in `props` too (e.g. `"capture-accuracy": 10` on `geo`; `int: true` on `number` for integer-only). The `geo`/`geotrace`/`geoshape` value contract is an ordered set of `{lat,lng,acc}` points; the *capture quality* layer on top of it — live-converging fixes, accuracy surfacing + the `capture-accuracy` threshold, occupy-and-average, honest metadata + datum — is **SPEC-hopper-geo** (design / roadmap; the shipped widget is its snapshot floor).

Metadata auto-fields are declared like any field with reserved types: `now`, `deviceid`, `username`, `start`, `end` (captured by the engine, no UI).

---

## 5. Meta keys and storage tiers

Form-level settings and the **declared storage/sync tiers** live in `meta` (composable adapters; a def names only the tiers it needs):

| meta key                   | effect                                                            |
|----------------------------|-------------------------------------------------------------------|
| `mode: "append"`           | **collection mode**: records are immutable; enables conflict-free sync + trivial aggregation |
| `tiers.store: "idb"`       | hot working store (default)                                       |
| `tiers.durable: "comment"` | durable snapshot tier: HTML-comment-backed gzip JSON in the file  |
| `tiers.sync: "trystero"`   | P2P replication, no signalling server                             |
| `config: "sheet:<url>"`    | pull reference/choice tables from a published Sheet (cached; degrades to embedded defaults offline) |

Absent tiers default to `store: "idb"` + `durable: "comment"`. `mode: "append"` is the default for forms (collection); set it otherwise for an editable data app (mutable; the merge model is deferred — §12). UI grouping is a `group` **container** in the hierarchical tree (§4, §8) — it may nest and renders collapsible.

---

## 6. Rules — the logic layer

Each rule is an entry in the tree's `rules` array — `{verb, target, expr}`, or `{verb, label, expr}` for `show` (a `constrain` rule may add `message`). The `expr` is written in the **rule-expression language — a small, *total*, pure expression calculus over the fields of the same record**, specified normatively in **SPEC-hopper-rules**. Totality (no loops, recursion, I/O, DOM, events, or cross-record queries) *is* the security boundary; `${field}` or a bare field name reads another field of the record.

> This supersedes the earlier "restricted `soft` profile" framing. The rule layer is **not** `soft` and performs **no** cross-record data-queries — those belong to the later mill (§11). `soft`/AIR are the mill's, not the collector's (DECISIONS §6).

| verb        | target   | expr is…                | XLSForm column        |
|-------------|----------|-------------------------|-----------------------|
| `show`      | "label"  | boolean — render a flag when true | *(extension)* |
| `relevant`  | field    | boolean — show field only when true | `relevant`        |
| `constrain` | field    | boolean — answer is valid when true | `constraint`      |
| `require`   | field    | boolean — field required when true  | `required` (dynamic) |
| `calculate` | field    | value — compute into a `calc` field | `calculation`     |
| `filter`    | field    | choice-filter expr (cascading selects; v0: simple) | `choice_filter` |

**Syntax (XLSForm-anchored, not `soft`).** Symbolic comparisons and arithmetic (`< > <= >= = != + - * /`), word booleans (`and`/`or`/`not`), and keyword sugar where no clean symbol exists (`between … and …`, `contains`, `is blank`/`is filled`, `matches`). This makes the XLSForm bridge (§9) near-identity. The full grammar, the blank/relevance/validity semantics, and the reactive-DAG implementation (`relevant`/`calculate` *are* a dependency graph, so they ride the engine — no separate interpreter) are all in **SPEC-hopper-rules**.

**Madlib ⇄ line.** Each rule is a fill-in-the-blank the builder renders as pickers (field ▾ / operator ▾ / value); the hand-typed line is the same artifact, lowering to the same node. A picker's human label ("is greater than") is UI; the serialized form is the symbol (`>`).

---

## 7. Choices and views

**Choices** are reusable option sets under the tree's `choices` map, keyed by list name; each entry is `{value, label}`:

```yaml
choices:
  litho:
    - value: "itabirite"
      label: "itabirite"
  yesno:
    - value: "no"        # quoted — bare 'no' is a parse error, by design
      label: "No"
```

`config: "sheet:<url>"` may supply choices externally for long or maintained lists.

**Views** are optional. With none declared, the engine renders the **auto-form** (fields in declaration order, default widgets) and a default list view — the floor; most definitions need nothing more. A `views` entry customizes via sparse annotations only (order, hide, group, widget hint, span). v0 view kinds: `form`, `list`, `card`. *No free-canvas layout* — structured annotations keep the def round-trippable and machine-authorable. Conditional show/hide is a `relevant` rule, never a view concern.

---

## 8. Canonical tree

The serializations (§3) are surfaces over this normalized **hierarchical** tree — the contract the renderer, the builder, and the XLSForm serializer all target. A `fields` entry is a leaf field or a **container** (`group`/`repeat`) carrying its own `children`:

```json
{
  "type": "form",
  "meta": { "id": "qfsamp", "title": "QF Sample Log", "version": "2026-06-01",
            "lang": "en", "mode": "append",
            "tiers": { "store": "idb", "durable": "comment", "sync": "trystero" } },
  "fields": [
    { "name": "site_id", "fieldType": "text", "label": "Site ID", "props": { "required": true } },
    { "name": "samples", "fieldType": "repeat", "label": "Samples", "props": {}, "children": [
      { "name": "lithology", "fieldType": "select", "label": "Lithology", "props": { "list": "litho" } },
      { "name": "fe_pct",    "fieldType": "number", "label": "Fe %", "props": {} }
    ] }
  ],
  "choices": { "litho": [ { "value": "itabirite", "label": "itabirite" } ] },
  "rules": [
    { "verb": "constrain", "target": "fe_pct", "expr": "fe_pct between 0 and 100" },
    { "verb": "show", "label": "high-grade", "expr": "fe_pct > 60" },
    { "verb": "calculate", "target": "n_samples", "expr": "count(samples)" }
  ],
  "views": []
}
```

A leaf field's value is `values.<name>`; a `repeat`'s value is `values.<name>` =
an array of per-instance objects (`values.samples[i].fe_pct`); a `group` is
transparent to data (its children stay in the flat, form-unique namespace). Rules
inside a `repeat` evaluate per-instance; `count`/`total`/`max`/`min` aggregate
over its instances (SPEC-hopper-rules).

Any author (line text, the builder canvas, a model, or an XLSForm import) produces this tree; any consumer reads it. There is one source of truth.

---

## 9. XLSForm interoperability

Two-way. **Import**: parse an `.xlsx` (SheetJS) — `survey`/`choices`/`settings` sheets → the tree, using the type map in §4 and the rule-column map in §6. **Export**: emit the tree as a conforming XLSForm so it runs in real ODK Collect/Central. This makes Hopper an on-ramp to and complement of ODK, not a competitor.

**Supported subset (v1):** the §4 type families; **containers** — `begin_group`/`end_group` (**nested**) and `begin_repeat`/`end_repeat` (→ hierarchical tree §8); `relevant`/`constraint`/`constraint_message`/`calculation`/`required` (static **or** dynamic)/`default`/`hint`/`appearance`; the common aggregate XPath (`count()`, `sum(node/field)` ↔ `count`/`total`); single-level `choices`; `settings` (`form_title`/`form_id`/`version`/`default_language`).

**Deferred (round-trips opaquely or warns):** `select_*_from_file` / database-backed external itemsets; cascading `choice_filter` beyond one level; exotic repeat XPath (`indexed-repeat`, `position(..)`, cross-instance node-sets); `public_key` encryption (different model — §12); data preloading; grid/pages styling. A definition using only the supported subset is "XLSForm-compatible for common forms" — not a conformant Collect replacement, by design.

**Expression bridge:** XLSForm restricted XPath ↔ the symbolic rule language (SPEC-hopper-rules), **syntactic and near-identity** for relational/arithmetic operators (only `${f}`↔`f` and `.`↔self differ); `between`/`selected`/`regex`/presence/`count`/`sum` are the non-identity mappings; the rest passes through verbatim and is flagged. Ported, symbolic, and round-trip-tested at **`src/js/xlsform/index.js`** (`xpathToSoft`/`softToXpath`).

---

## 10. Authoring: the smart builder (schema-from-example)

The primary on-ramp is **data-first**, not schema-first. The builder ("jig", an internal Hopper surface) generates a definition from an example table — paste a CSV or type into a grid — by deterministic inference, then runs a short **seam interview** to resolve the genuinely ambiguous calls. No model required; an optional LLM lane only accelerates it.

**Deterministic inference (per column):** sniff values → `number` (all numeric), `date`/`datetime` (all parse), `geo` (all `lat, lng`), `photo`/`file` (filename + ext or name hint), `select` (small repeated value set), else `text`. Column header → field `name` (slugified) and `label` (titled).

**Seams requiring user input** (the builder asks only these, as taps):

- *Which column is the record identity / primary label?* (for outbox display, dedup).
- *Ambiguous select vs text* — a column with some repetition: list or free text?
- *Ambiguous number vs text* — codes like `QF-118` are text, not numbers.
- *Required?* — which fields must not be blank.
- *A `geo` split across two columns* (lat, lng) vs one — offer to merge.
- *Reference* — a column whose values match another table's ids → make it a `ref`?

Each answer writes a sparse override onto the inferred tree; re-importing a changed table preserves prior answers (overrides are sparse, new columns append to the auto-form). The output is a `hopper` definition (as `@gcu/yaml` or JSON, §3) plus, on request, its XLSForm (§9).

---

## 11. Analysis (the "mill") — sketch, deferred

Out of scope for v1 beyond this sketch. Because collection is `mode: "append"`, analysis operates on the **union of immutable records** (the device's own plus any synced/aggregated copies), so it needs no conflict resolution. The intended surface is a **`soft` data-query layer** (where `soft` belongs — the mill, *not* the rule layer; SPEC-hopper-rules, DECISIONS §6) — `take from <form> keep where … group by … total/count … sort …` — producing tables, summaries, and simple charts, with the QF/Quadrilátero example yielding e.g. grade distributions by lithology. Full design (cross-form joins, the cross-app aggregation-by-convention console, report export) is a later spec. v1 ships collection; the mill follows.

---

## 12. Scope (v1)

**In:** the field types (§4) including **containers** — nested collapsible `group`s and `repeat`s (hierarchical tree §8; per-instance rules + minimal `count`/`total`/`max`/`min` aggregates — DECISIONS §12); rules via the total expression calculus (§6, SPEC-hopper-rules); inline + Sheet choices (§7); auto-form + sparse view annotations; the declared storage/sync tiers (§5); `mode: "append"` collection with immutable records (stable id, union merge — conflict-free); XLSForm import/export of the supported subset (§9); schema-from-example authoring with the seam interview (§10); deployment as a boring served PWA (definitions added by URL / xlsx / capsule / project registry).

**Out / deferred — two buckets** (DECISIONS §12). *Deferred-but-wanted* (on the roadmap): grid/pages styling; data preloading / `pulldata`; external/file-backed itemsets; multi-level cascading filters; richer/filtered repeat aggregates beyond the minimal set; a relational query engine and cross-entity joins (v1 is flat + simple `ref`). *Out by design / different model*: the mutable (non-append) data-app merge model (field-level LWW or CRDT — when the editable data-app is built); `public_key` submission encryption (we have signed records + optional object-level encryption-at-rest — §5; warn on import); the analysis mill (§11); the dd multi-app factory (boring served PWA is the default substrate).

**The bounded new component** is the §6 rule calculus — now specified as a *total expression language* (SPEC-hopper-rules): a parser + AST evaluated on the reactive DAG, **not** a `soft` transpiler. Everything else is parse, map, render, and persist over machinery that already exists in the stack.

---

## 13. Worked example — QF Sample Log

Quadrilátero Ferrífero field collection. Definition (as `@gcu/yaml`):

```yaml
type: "form"
meta:
  id: "qfsamp"
  title: "QF Sample Log"
  version: "2026-06-01"        # a version string, not a date
  lang: "en"
  mode: "append"
  tiers:
    store: "idb"
    durable: "comment"
    sync: "trystero"
fields:
  - name: "site_id"
    fieldType: "text"
    label: "Site ID"
    props:
      required: true
  - name: "coords"
    fieldType: "geo"
    label: "Coordinates"
    props:
      "capture-accuracy": 10
  - name: "lithology"
    fieldType: "select"
    label: "Lithology"
    props:
      list: "litho"
  - name: "fe_pct"
    fieldType: "number"
    label: "Fe %"
    props: {}
  - name: "sampled"
    fieldType: "date"
    label: "Sampled"
    props: {}
  - name: "photo"
    fieldType: "photo"
    label: "Outcrop photo"
    props: {}
choices:
  litho:
    - value: "itabirite"
      label: "itabirite"
    - value: "hematitite"
      label: "hematitite"
    - value: "canga"
      label: "canga"
    - value: "quartzite"
      label: "quartzite"
rules:
  - verb: "constrain"
    target: "fe_pct"
    expr: "fe_pct between 0 and 100"   # clamp to assay range
  - verb: "show"
    label: "high-grade"
    expr: "fe_pct is above 60"
```

Lowers to the §8 tree. Exported as XLSForm:

**survey**

| type | name | label | required | constraint | parameters |
|------|------|-------|----------|------------|------------|
| text | site_id | Site ID | yes | | |
| geopoint | coords | Coordinates | | | capture-accuracy=10 |
| select_one litho | lithology | Lithology | | | |
| decimal | fe_pct | Fe % | | `. >= 0 and . <= 100` | |
| date | sampled | Sampled | | | |
| image | photo | Outcrop photo | | | |

**choices**

| list_name | name | label |
|-----------|------|-------|
| litho | itabirite | itabirite |
| litho | hematitite | hematitite |
| litho | canga | canga |
| litho | quartzite | quartzite |

**settings**

| form_title | form_id | version | default_language |
|------------|---------|---------|------------------|
| QF Sample Log | qfsamp | 2026-06-01 | en |

(The `show "high-grade"` flag is a Hopper extension with no XLSForm column; on export it round-trips opaquely or is dropped with a warning, since ODK has no flag concept.)

---

*Geoscientific Chaos Union · spec CC0 · 2026 · single-file*
