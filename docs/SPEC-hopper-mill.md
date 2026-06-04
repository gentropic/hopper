# SPEC-hopper-mill — the analysis console

*CC0. Status: **built** (engine + standalone surface shipped). Descriptive — where it
and the code disagree, trust the code and fix this doc. Promotes the SPEC-hopper §11
sketch + DECISIONS §6/§7 to a component spec.*

## 1. What the mill is

The **mill** is Hopper's analysis / aggregation / off-ramp surface — the third of the
three interior surfaces (renderer → **jig** builds a form → **mill** analyzes the
records). It turns the append-only union of signed records into *answers*: filter,
group, aggregate, chart, export. Like jig it's *a surface, not a separate app*
(DECISIONS §7) and reuses the machinery that already exists; the only genuinely new code
is small Hopper-specific glue.

## 2. Two hosts, one mount

`mountMill(store, root)` is host-agnostic — it needs only a store exposing
`exportBundle()` + `listForms()`.

- **Standalone** — `mill.html` (`--target=mill`, ~300 kB; no sideact/renderer/sheetjs).
  A landing offers **Open archive…**; the chosen archive (a collector "Export archive"
  bundle) is parsed → `importBundle`d into an in-memory store (`MemoryBackend`, which
  also **verifies signatures**) → `mountMill`. An ephemeral analysis session over a
  bundle you point it at — keeps the collector lean (loom/plot weight lives only here).
- **Embedded** — a collector "Mill" tab could mount the same `mountMill` over the live
  store. Not wired yet; the seam is ready.

## 3. The engine (`src/js/mill/`) — pure, node-tested

### 3.1 `table.js` — `recordsToRows(records, form) → { columns, rows }`
The Hopper-specific glue: the **resolved union** → a flat analysis table. Group children
flatten (presentational, §8); a `repeat` stays **one column** (its instance array), so
the calculus's `count(…)`/`total(…)` aggregate it per-row. Each record's `values` is a
row.

The mill reads the union as `resolve(exportBundle().records)` — **all streams,
corrections/tombstones applied** (§9). (Note: `recordsView()` is the *local* stream only,
for the Outbox; the mill wants the whole union, hence `exportBundle` + `resolve`.)

### 3.2 `query.js` — `runQuery(query, table) → { columns, rows }`
The **primary, shareable** query layer (DECISIONS §6). `query` is plain DATA:
```
{ filter?, computed?: [{name,expr,label?}], groupBy?, aggregates?: [{op,field,as,label?}],
  sort?: {by,dir}, limit? }
```
- **filter** + **computed columns** are the **same total expression calculus as the rule
  layer** (`rules/eval.js`) — total ⇒ safe to open (the shareable-analysis guarantee).
- **group / aggregate / sort** are plain reductions (`count`/`sum`/`mean`/`min`/`max`;
  the op-names mirror the calculus's for consistency). No `groupBy` + aggregates → a
  single summary row; `groupBy` + none → an implicit count.
- **Pure** — the input table is never mutated.

This `query` shape **is** the shareable-analysis artifact (§5).

### 3.3 The query language
The total calculus (SPEC-hopper-rules), reused: symbolic comparisons/arithmetic, word
booleans, `between`/`contains`/`matches`/`is blank·filled`, repeat aggregates, and the
pure total functions `if(c,a,b)` · `round`/`int`/`abs` · `year`/`month`/`day` (the last
extract from an ISO date string — so `group by month(sampled)` works; ISO-date *ordering*
already works via `<`/`>` on the string). `contains` is overloaded — multiselect
membership *or* string substring — so no separate substring op is needed. **XLSForm-
anchored**: filters round-trip to ODK XPath, and `if`/`round`/`int`/`abs` mirror XLSForm's
own functions (so they evaluate on import too).

A **non-total power lane** (`soft` / `adder` / JS over AIR) is reserved for local,
trusted authoring only — *not* the primary, *not* shareable (DECISIONS §6). Not wired.

## 4. The surface (`mill/ui.js`)
Plain `.mill-*`/`.co-*`; structure first. A **form picker** (forms with ≥1 record), then
a **query builder**:
- **Keep where** — a total-calculus filter, with **field chips** that insert the stable
  field *name* (showing the label) and **`` `Label` ``** backtick refs that resolve to the
  name *on commit* (so the stored expression stays name-only and stable — labels never
  enter it; the aid is UI-only).
- **Group by** — a field dropdown.
- **Aggregates** — add rows of `op` × `field`.
- Results render live in a **virtualized loom grid** + a **plot bar chart** (aggregate by
  group), with a row-count caption.

## 5. Shareable analyses (the boundary)
Because the `query` is plain data **and** its expressions are *total*, a saved analysis is
a `{ source, filter, groupBy, aggregates, … }` description that can travel in a capsule
like a form does and be **safe to open** — totality is the boundary, same guarantee as
forms (DECISIONS §6). This is why the primary layer is the total calculus, not `soft`:
shareability is gated on totality, not on language. (Save/share-as-capsule UI is deferred,
§6 — the *shape* is ready.)

## 6. Scope
**In (v1, built):** standalone surface; open-archive → resolved union; the query builder
(filter · group · aggregates) over the total calculus + functions; the filter aid (chips +
backtick-by-label); loom grid + plot bar chart; the records→table + query engine, node-
tested.

**Deferred (named, not hidden):**
- **Save / share an analysis** as a capsule (the data shape is ready; no UI/transport yet).
- **A textual query syntax** for the pipeline (today the *expressions* are textual, the
  *pipeline* is GUI-built). If added, an XLSForm-anchored total extension keeps it
  shareable; `soft` is the alternative power lane.
- **Computed-column UI** (the engine supports `computed`; the builder doesn't expose it yet),
  **sort UI** (engine supports `sort`), richer charts (histogram/scatter — only bar now),
  `yearmonth()` / date arithmetic, the local **power lane** (soft/AIR), `strata` overlay
  edits (the mill feeds loom directly, so strata is skipped), and a **collector → mill**
  in-app handoff / "Mill tab."

## 7. Vendored display
`loom` (virtualized canvas grid — `createGrid` + `createMemoryProvider`) and `plot`
(matplotlib-style — `subplots`, `bar`; **render via `fig.show()`**, not `fig.canvas`).
Zero-dep ESM, browser-spike-verified (`tools/spike-mill.mjs`); see vendor/PROVENANCE.md.

## 8. Tests
`test/mill-query.test.mjs` — the engine vectors (filter/computed via the calculus,
group/aggregate/sort, composition, purity, per-row repeat aggregates). `tools/spike-mill.mjs`
proved the display libs in a browser. `tools/smoke-mill.mjs` (in `test:all`) generates a
real signed bundle, opens `mill.html`, and drives open → filter (incl. chip + backtick) →
group → aggregate → loom grid + plot chart, verifying row counts. A signed sample to try:
`examples/qf-sample-archive.json`.
