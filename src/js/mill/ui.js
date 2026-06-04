// mountMill(store, root) — the analysis console (DECISIONS §6/§7). Host-agnostic:
// reads the **resolved union** (exportBundle + resolve — all streams, corrections/
// tombstones applied), groups records by form, and drives a query builder whose
// output is the shareable `query` data shape. Results render in a virtualized loom
// grid + a plot chart. Plain DOM + `.mill-*`/`.co-*`; structure first.
//
// Vendored namespaces (`loom`/`plot`) MUST match the manifest bindings — the flat
// build resolves the bare names to the wrapped globals.

import { recordsToRows } from './table.js';
import { runQuery } from './query.js';
import { resolve } from '../records/envelope.js';
import * as loom from '../../../vendor/loom.js';
import * as plot from '../../../vendor/plot.js';

const mel = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const AGG_OPS = ['count', 'sum', 'mean', 'min', 'max'];

// Filter aid: `` `Label or name` `` → the stable field NAME (resolved on commit, so the
// stored/shareable expression stays name-only). Unknown → strip backticks, leave text
// (parse will flag it). The query language never sees labels.
function resolveBacktickRefs(text, cols) {
  return String(text).replace(/`([^`]+)`/g, (_m, inner) => {
    const key = inner.trim();
    const byName = cols.find((c) => c.name === key);
    if (byName) return byName.name;
    const byLabel = cols.find((c) => String(c.label || '').toLowerCase() === key.toLowerCase());
    return byLabel ? byLabel.name : key;
  });
}
function insertAtCursor(input, text) {
  const s = input.selectionStart ?? input.value.length, e = input.selectionEnd ?? s;
  const before = input.value.slice(0, s), after = input.value.slice(e);
  const ins = (before && !before.endsWith(' ') ? ' ' : '') + text + ' ';
  input.value = before + ins + after;
  const pos = (before + ins).length;
  input.focus(); input.setSelectionRange(pos, pos);
}

export async function mountMill(store, root) {
  const forms = await store.listForms();
  const bundle = await store.exportBundle();
  const union = resolve(bundle.records || []);                 // all streams, resolved
  const byForm = new Map();
  for (const r of union) { if (!byForm.has(r.form)) byForm.set(r.form, []); byForm.get(r.form).push(r); }
  const withRecs = forms.filter((f) => (byForm.get(f.hash) || []).length);

  root.replaceChildren();
  const wrap = mel('div', 'mill-wrap');
  const head = mel('header', 'mill-head');
  head.append(mel('div', 'mill-brand', 'Hopper · mill'));
  const formSel = mel('select', 'mill-formsel');
  if (!withRecs.length) formSel.append(new Option('— no records in this archive —', ''));
  for (const f of withRecs) formSel.append(new Option(`${f.title} · ${byForm.get(f.hash).length} rec`, f.hash));
  head.append(mel('span', 'mill-formlabel', 'Form'), formSel);
  wrap.append(head);

  const body = mel('div', 'mill-body');
  const builder = mel('div', 'mill-pane mill-builder');
  const results = mel('div', 'mill-pane mill-results');
  const resultsH = mel('div', 'mill-pane-h', 'Results');
  const gridHost = mel('div', 'mill-grid');
  const chartHost = mel('div', 'mill-chart');
  results.append(resultsH, gridHost, chartHost);
  body.append(builder, results);
  wrap.append(body);
  root.append(wrap);

  let current = null;          // { form, table }
  let query = {};
  let grid = null;             // current loom grid (destroy before recreate)
  let filterErr = null;

  formSel.addEventListener('change', () => selectForm(formSel.value));

  function selectForm(hash) {
    const f = withRecs.find((x) => x.hash === hash);
    current = f ? { form: f, table: recordsToRows(byForm.get(hash), f.tree) } : null;
    query = { aggregates: [] };
    renderBuilder();
    run();
  }

  function renderBuilder() {
    builder.replaceChildren(mel('div', 'mill-pane-h', 'Query'));
    if (!current) return;
    const cols = current.table.columns;

    // filter — a total-calculus predicate (blank = all rows)
    const frow = mel('div', 'mill-row');
    frow.append(mel('label', 'mill-lbl', 'Keep where'));
    const fin = mel('input', 'mill-filter');
    fin.placeholder = 'e.g. fe_pct >= 50   (blank = all)';
    fin.value = query.filter || '';
    fin.addEventListener('change', () => {
      const resolved = resolveBacktickRefs(fin.value, cols);     // `Label` → stable name, resolved on commit
      if (resolved !== fin.value) fin.value = resolved;
      query.filter = fin.value.trim() || undefined;
      run();
    });
    frow.append(fin);
    filterErr = mel('div', 'mill-filter-err');

    // field chips: click to insert the stable name (the chip shows the friendly label)
    const chips = mel('div', 'mill-fields');
    chips.append(mel('span', 'mill-fields-lbl', 'fields:'));
    for (const c of cols) {
      const chip = mel('button', 'mill-fieldchip', c.label || c.name);
      chip.title = `insert "${c.name}"`;
      chip.addEventListener('click', () => insertAtCursor(fin, c.name));
      chips.append(chip);
    }
    builder.append(frow, filterErr, chips, mel('div', 'mill-hint', 'tip: type `Label` (backticks) to reference a field by its label'));

    // group by
    const grow = mel('div', 'mill-row');
    grow.append(mel('label', 'mill-lbl', 'Group by'));
    const gsel = mel('select', 'mill-groupby');
    gsel.append(new Option('— none —', ''));
    for (const c of cols) gsel.append(new Option(c.label || c.name, c.name));
    gsel.value = query.groupBy || '';
    gsel.addEventListener('change', () => { query.groupBy = gsel.value || undefined; run(); });
    grow.append(gsel);
    builder.append(grow);

    // aggregates
    const aggs = mel('div', 'mill-aggs');
    aggs.append(mel('label', 'mill-lbl', 'Aggregates'));
    (query.aggregates || []).forEach((a, i) => aggs.append(aggRow(a, i, cols)));
    const add = mel('button', 'co-btn co-ghost mill-addagg', '+ aggregate');
    add.addEventListener('click', () => {
      query.aggregates = (query.aggregates || []).concat({ op: 'count', as: `count_${(query.aggregates || []).length + 1}` });
      renderBuilder(); run();
    });
    aggs.append(add);
    builder.append(aggs);
  }

  function aggRow(a, i, cols) {
    const row = mel('div', 'mill-row mill-aggrow');
    const opSel = mel('select', 'mill-aggop');
    for (const op of AGG_OPS) opSel.append(new Option(op, op));
    opSel.value = a.op;
    const fldSel = mel('select', 'mill-aggfield');
    fldSel.append(new Option('(rows)', ''));
    for (const c of cols) fldSel.append(new Option(c.label || c.name, c.name));
    fldSel.value = a.field || '';
    const sync = () => { a.op = opSel.value; a.field = fldSel.value || undefined; a.as = `${a.op}_${a.field || 'rows'}`; run(); };
    opSel.addEventListener('change', sync);
    fldSel.addEventListener('change', sync);
    const del = mel('button', 'co-btn co-ghost mill-mini', '✕');
    del.addEventListener('click', () => { query.aggregates.splice(i, 1); renderBuilder(); run(); });
    row.append(opSel, fldSel, del);
    return row;
  }

  function run() {
    if (!current) { gridHost.replaceChildren(); chartHost.replaceChildren(); return; }
    let res;
    try { res = runQuery(query, current.table); if (filterErr) filterErr.textContent = ''; }
    catch (e) { if (filterErr) filterErr.textContent = e.message; return; }
    resultsH.textContent = `Results · ${res.rows.length} row${res.rows.length === 1 ? '' : 's'}`;
    renderGrid(res);
    renderChart(res);
  }

  function renderGrid(res) {
    if (grid && grid.destroy) { try { grid.destroy(); } catch {} }
    gridHost.replaceChildren();
    const provider = loom.createMemoryProvider({
      columns: res.columns.map((c) => ({ name: c.label || c.name })),
      rows: res.rows.map((r) => res.columns.map((c) => r[c.name])),
    });
    grid = loom.createGrid(gridHost, provider, { theme: 'dark' });
  }

  function renderChart(res) {
    chartHost.replaceChildren();
    if (!query.groupBy) return;                                // chart = aggregate-by-group bar
    const numCol = res.columns.find((c) => c.fieldType === 'number');
    if (!numCol) return;
    try {
      const { fig, ax } = plot.subplots(1, 1);
      ax.bar(res.rows.map((r) => String(r[query.groupBy])), res.rows.map((r) => Number(r[numCol.name]) || 0));
      chartHost.append(fig.show());                            // show() renders + returns the canvas
    } catch { /* charting is best-effort */ }
  }

  if (withRecs.length) { formSel.value = withRecs[0].hash; selectForm(withRecs[0].hash); }
}
