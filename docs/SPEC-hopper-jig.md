# SPEC-hopper-jig — the builder (schema-from-example)

*CC0. Status: **built** (engine + surface shipped). This spec is descriptive — where
it and the code disagree, trust the code and fix this doc (CLAUDE.md convention). It
promotes the forward-reference in SPEC-hopper §3 and the design in SPEC-hopper-form §10
to a component spec.*

## 1. What jig is

**jig** is Hopper's authoring surface: it turns an **example table into a §8 form
definition**. It is not a separate product — "an internal Hopper surface" (form §10),
a *surface, not an app* (DECISIONS §7). It emits the one canonical tree the renderer,
collector, and XLSForm bridge already target; it adds **no new format and no new
runtime** — only converters *into* the tree and small, pure edits *over* it.

The data-first on-ramp is deliberate: most people have a spreadsheet of what they want
to collect, not a schema. jig meets them there — paste a CSV / JSON rows, get a working
form, refine it with a few taps, ship it.

## 2. Two hosts, one surface

jig is built host-agnostic: `mountJig(root, { onEmit, initialTree, embedded })`.

- **Standalone** — `jig.html`, its own `--target=jig` build (a leaner artifact: no
  record store, no service worker — a stateless authoring page). Output leaves via
  download / capsule-share, i.e. the same intake the collector already accepts.
- **Embedded** — the collector's **Build** tab. `onEmit(tree)` routes the built form
  into `store.putForm` and jumps straight to Fill: build → collect, no file handoff.
  `embedded: true` drops jig's own brand header so the shell chrome isn't doubled.

Both are the *same* `src/js/jig/` code. The surface-vs-tab choice is a mounting detail,
not an architecture fork (the point of `onEmit`).

## 3. The engine (`src/js/jig/`) — pure, node-tested, extraction-ready

DOM-free and import-clean, like `records/` `rules/` `xlsform/`; lifts into
`@gcu/hopper-jig` when stable. Conformance vectors are the executable spec
(`test/fixtures/jig-infer.json`).

### 3.1 `infer.js` — `inferTree(rows, opts) → { tree, warnings, seams }`

Deterministic **per-column** inference over a table of row objects (a single object is
a one-row table). The output auto-form is **flat by default**; the one structural
exception is **wide-format `repeat` detection** (below) — offered as a seam, never forced.
Nested `group`s and long-format/relational repeats still come from editing or the
deferred relational pass (§5).

Sniff order (form §10): `number` → `date`/`datetime`/`time` → `geo` (`lat, lng`) →
`photo`/`file` (extension or header hint) → `select` (a small repeated value set) →
`text`. Integers get `props.int`. A column header becomes a slugged `name`
(`[a-z0-9_-]+`) + a titled `label`; duplicates are deduped deterministically.

Choice inference needs **multiple rows**: a low-cardinality text column (≥2 distinct,
≤ `selectMax`, with repetition) becomes a `select` with the observed values as
`choices`. Every lossy or ambiguous guess is recorded in `warnings` — never silent
(invariant §4.6).

### 3.2 Seams — the interview, as data

The genuinely ambiguous calls are returned as structured `seams`, so the UI renders one
control per *type* (it does not hand-code per field):

- `identity` — which column is the record's primary label (outbox display / dedup).
- `required` — which columns must not be blank (recommends the fully-filled ones).
- `select-or-text` — a repeating column: choice list or free text?
- `number-or-text` — an all-numeric column that is really a code (leading zero, or an
  id/code/zip/phone header → recommends `text`; e.g. `QF-118`, `02139`).
- `geo-merge` — a lat-ish + lng-ish numeric pair → offer to fuse into one `geo`.
- `repeat` — **wide-format** indexed column groups → offer to fold into a `repeat`.
  Two header shapes, detected structurally (header-only, deterministic): *embedded*
  `stem<i>_sub` (e.g. `sample1_lith, sample1_fe, sample2_lith…` → repeat `sample` with
  children `lith, fe`) and *trailing* `base<i>` (e.g. `lith_1, fe_1, lith_2…`, grouped by
  index-set). Indices must be ≥2 and contiguous from 0/1 (cuts coincidental numbers).
  Child types are sniffed over the **union** of all instances; the seam carries a ready
  `spec`, and `applyOverrides({ repeats: [spec] })` → `groupIntoRepeat` folds it (records
  are *not* reshaped — jig builds the form, not data). The fold resolves in place like
  `geo-merge`. Long-format (repeated parent-key rows) stays deferred (§5).

The *seam interview is UI*; the engine only surfaces the questions. Answers are applied
as **sparse overrides** (§3.4), so re-importing a changed table preserves prior answers
(new columns append; removed columns' answers are no-ops) — form §10.

### 3.3 `validate.js` — `validateTree(tree) → { ok, errors, warnings }`

The guardrail that lets jig emit **only** a contract-valid tree (invariant §4.1 — One
Contract): identifier charset, unique names (across container children), known field
types, `select`/`multiselect`/`rank` resolve to a `choices` list, containers have a
`children` array, rule verbs are valid and target existing fields. Rule **expressions
are checked against the real `rules/eval.js` parser** (`parse` + `deps`), not a
re-implementation — so a tree that validates is one the engine can actually evaluate.
`errors` block emission; `warnings` (orphan lists, unresolved refs) are advisory.

### 3.4 `edit.js` — pure `tree → tree`

`addField` · `removeField` · `moveField` · `setProps` · `setLabel` · `setRule` /
`removeRule` · `renameField` · `setChoices` · `groupIntoRepeat` · `applyOverrides` · `findField`. All immutable
(`structuredClone`); the input is never mutated. `renameField` cascades the change
through rule targets, `${refs}`, bare refs, and the leading segment of an aggregate
path — while leaving string literals untouched (a single tokenizing pass mirroring the
real lexer). `applyOverrides` replays the sparse seam answers (`setType`, `labels`,
`props`, `required`, `identity`, `geoMerge`, `repeats`).

This is why jig does not cruft: there is **no separate builder state**. The UI holds one
value — the draft tree — and every action is `draft = <pure edit>(draft, …); rerender()`.

## 4. The surface (`src/js/jig/ui.js`)

Plain `.co-*` + a little `.jig-*` layout; structure first, Switchboard polish later.

- **Intake** — paste a CSV / JSON, or pick a `.csv`/`.json`/`.xlsx` file (CSV & XLSX via
  the bundled SheetJS; read with `raw:true` so an ISO date column is not coerced to an
  Excel serial). A *data-table* xlsx, not an XLSForm definition (that is the collector's
  import path); date cells stored as serials read as numbers — the type dropdown is the
  fallback.
- **Schema** — the seam interview (rendered from `seams`), an editable field list
  (rename / type / label / required / reorder / delete / add, plus an inline
  comma-separated **choices editor** for select-family fields), and an identity picker.
- **Preview** — `renderForm(createForm(draft))`: the live WYSIWYG is the real renderer,
  for free.
- **Source** — a **GUI ⇄ Source toggle** shows the §8 tree as editable **JSON**; *Apply*
  re-parses (`JSON.parse`) and `validateTree`-gates before replacing the draft (no live
  two-way sync). JSON-only for now so the standalone surface stays dep-light; pasted-YAML
  parse + a YAML *render* arrive with `treeToYaml` (§5). "The definition is data" made
  literal — see and edit the tree directly.
- **Export bar** — live `validateTree` status, plus **JSON**, **XLSForm `.xlsx`**
  (`treeToXlsform` + SheetJS write — the ODK off-ramp), and **Share** (a `q:` capsule QR
  + link the collector ingests). When hosted with `onEmit`, a **Use this form →** action.

## 5. Scope

**In (v1, built):** deterministic per-column inference + the seam interview; **wide-format
`repeat` detection** (embedded + trailing indexed column groups → a foldable repeat, §3.2);
an editable auto-form (incl. an inline comma-separated **choices editor** for
select-family fields); live preview; export to JSON, XLSForm, and capsule share; the
standalone surface and the embedded Build tab.

**Deferred (named, not hidden):**
- **`treeToYaml` (YAML emit)** — the editable **JSON** source view ships (§4); a YAML
  *render* and YAML *export* both wait on a `data→AST` builder over the vendored
  `scalar`/`mapNode`/`seqNode` + `emit` (strict no-implicit-typing, with emit→parse
  round-trip tests). JSON already satisfies the §8 serialization contract, so a fragile
  hand-rolled emitter wasn't shipped; this is the next slice (it also bundles `@gcu/yaml`
  + `loadFormFromText` into the standalone surface so the source editor accepts pasted
  YAML, not just JSON).
- A **richer choices editor** — the inline comma-separated editor ships (add/edit/clear
  options, value = slugged label); deferred is the polish: per-option value vs. label,
  reordering, and choice_filter / cascading selects.
- **Rule-editing UI** (relevant / constrain / calculate) — inference emits no rules.
- UI **container creation by hand** (nest a `group`, build a `repeat` manually) — wide
  repeats are *inferred* (§3.2), but there's no manual container-building UI yet; and a
  folded repeat is reversible only by re-import (like `geo-merge`).
- **Draft persistence**; an optional **LLM-accelerated** inference lane (form §10 — the
  deterministic path is the contract; a model only speeds it, never required).
- xlsx **date-cell** reading (serials); CSV is exact.
- **Long-format & relational / multi-table inference** *(deferred-but-wanted; cross-project)*
  — wide-format repeats are done (§3.2), but two harder shapes remain. *Long-format*
  (single table, repeated parent-key rows — each row a child instance) needs a per-dataset
  grouping pass and raises a records-reshaping question jig sidesteps today (it builds the
  form, not data). *Relational* would take *several* tables and infer the relations between
  them: a column whose values match another table's identity → a
  `ref` (the `ref` seam form §10 names — AppSheet already does this same-name detection,
  §7); repeating groups → `repeat`s; a star/normalized layout → nested containers. This is
  genuinely a **shared capability**, not jig-specific — a `@gcu/schema-infer` that other
  GCU projects (the mill, importers, `dd`) could reuse, with jig as its first consumer.
  Keep it out of v1: it changes inference from per-column to per-*dataset* and wants its
  own conformance corpus.

## 6. Tests

`test/jig-infer.test.mjs` (the §10 inference vectors, incl. wide-repeat detection — embed,
trailing-multi, trailing-single, and a no-false-positive guard) + `test/jig-edit.test.mjs`
(edits, validate, `groupIntoRepeat`, and a **confidence round-trip**: an inferred tree —
including a folded `repeat` — validates *and* survives `treeToXlsform → xlsformToTree`
still contract-valid). Browser: `tools/smoke-jig.mjs` drives `jig.html` (infer → preview →
JSON + `.xlsx` exports parsed back → edit the JSON **source** view and Apply → fold a wide
repeat and see it in the preview), and the
collector smoke exercises the **Build** tab (paste → infer → Use this form → fillable).

## 7. Prior art & positioning

Be honest about what is and isn't new — jig's *inference technique* is well-trodden; its
*combination* is what's unoccupied.

**The technique is mature and shipped elsewhere.** Generic "schema from example data" is
everywhere: [`schema-infer`](https://github.com/triggerdotdev/schema-infer) (JSON Schema
from samples, with date/time/uri/email format detection),
[Frictionless `tableschema-py`'s `schema.infer`](https://github.com/frictionlessdata/tableschema-py)
(types + constraints from a CSV — the closest formal cousin to §3.1's per-column pass),
and data-pipeline tools like [Palantir Foundry](https://www.palantir.com/docs/foundry/building-pipelines/infer-schema).
The strongest *direct* analogue is **Google AppSheet**, whose
[column-type inference](https://support.google.com/appsheet/answer/10106435) reads both
header names and row content — "Web Site" → URL, a `?`-suffixed header → Yes/No, a
date-looking column → Date, **and a column whose name matches another table → a Ref**.
That is nearly jig's exact playbook (header hints + value sniff), and it already does the
cross-table ref-detection that is jig's deferred direction (§5) — useful confirmation the
seam list points at the real ambiguities. [Glide](https://www.glideapps.com/data-sources/google-sheets)
and Adalo are in the same "sheet → app" family.

**The survey/ODK world is schema-first**, and that's the gap. "Create a form from data"
tools there are *schema*-derived, not value-sniffed:
[QRealTime](https://shivareddyiirs.github.io/QRealTime/) builds an ODK form from a QGIS
layer's schema (like Survey123 from a feature service); XLSForm's data feature,
[`select_one_from_file`](https://xlsform.org/en/), goes the other way (attach a CSV *as a
choice source*). None infer a form from example *values*.

**jig's niche is the combination, not the parts.** Data values → an **offline,
XLSForm-compatible** survey form (an *on-ramp* to ODK/Kobo/Survey123, not a rival), with
an **interactive seam interview** for the ambiguous calls, **serverless / single-file /
owned** — no account, no cloud project, runs from disk. The AppSheet/Glide analogues are
hosted SaaS that don't emit XLSForm or run offline; the ODK tools are schema-first. The
framing line: *"the AppSheet idea, for the ODK ecosystem, without the cloud."*
