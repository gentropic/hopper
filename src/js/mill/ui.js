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
import * as capsule from '../../../vendor/capsule.js';

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

// Render a string as a QR (Nayuki qrcodegen global). Throws past capacity → caller falls back to the link.
function millQrSvg(text) {
  const QR = globalThis.qrcodegen.QrCode;
  const qr = QR.encodeText(text, QR.Ecc.MEDIUM);
  const n = qr.size, b = 2, dim = n + b * 2; let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.getModule(x, y)) d += `M${x + b} ${y + b}h1v1h-1z`;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${dim} ${dim}`); svg.setAttribute('class', 'co-qr'); svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(NS, 'rect'); bg.setAttribute('width', String(dim)); bg.setAttribute('height', String(dim)); bg.setAttribute('fill', '#fff');
  const path = document.createElementNS(NS, 'path'); path.setAttribute('d', d); path.setAttribute('fill', '#000');
  svg.append(bg, path); return svg;
}

// A shared analysis capsule (`q:…`) or share link → the analysis object.
async function resolveAnalysis(input) {
  const s = String(input).trim();
  let cap = s;
  if (/^https?:\/\//i.test(s)) { const i = s.indexOf('#'); if (i >= 0 && i < s.length - 1) cap = capsule.fragmentDecode(s.slice(i + 1)); }
  const bytes = await capsule.resolve(cap);
  const obj = JSON.parse(new TextDecoder().decode(bytes));
  if (!obj || obj.kind !== 'hopper-analysis') throw new Error('not a Hopper analysis capsule');
  return obj;
}

export async function mountMill(store, root, opts = {}) {
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
  const tools = mel('div', 'mill-tools');
  const shareBtn = mel('button', 'co-btn', '⤴ Share analysis');
  shareBtn.addEventListener('click', () => { if (current) doShare(); });
  const openBtn = mel('button', 'co-btn co-ghost', '⧉ Open analysis');
  openBtn.addEventListener('click', doOpen);
  tools.append(shareBtn, openBtn);
  head.append(tools);
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

  function selectForm(hash, initialQuery) {
    const f = withRecs.find((x) => x.hash === hash);
    current = f ? { form: f, table: recordsToRows(byForm.get(hash), f.tree) } : null;
    query = initialQuery ? { ...initialQuery } : { aggregates: [] };
    if (!query.aggregates) query.aggregates = [];
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

  // ---- save / share an analysis (the query is plain, total data → travels like a form) ----
  // match by form hash (exact), else by form id (same form, possibly re-versioned).
  function applyAnalysis(a) {
    const match = withRecs.find((x) => x.hash === a.form)
      || withRecs.find((x) => x.tree && x.tree.meta && x.tree.meta.id === a.formId);
    if (!match) throw new Error(`this analysis targets a form not in the open archive (${a.formTitle || a.formId || a.form})`);
    formSel.value = match.hash;
    selectForm(match.hash, a.query);
  }

  async function doShare() {
    const a = { kind: 'hopper-analysis', v: 1, form: current.form.hash, formId: current.form.tree.meta && current.form.tree.meta.id, formTitle: current.form.title, query };
    const base = location.origin + location.pathname;
    let url, fit;
    try { const s = await capsule.makeShare(JSON.stringify(a), { form: 'q', baseUrl: base }); url = base + '#' + s.fragment; fit = `${s.urlBytes} B · ${s.tightestFit ? 'fits ' + s.tightestFit : 'link only'}`; }
    catch (e) { millToast('Could not build share: ' + e.message); return; }
    const scrim = mel('div', 'co-scrim'); const panel = mel('div', 'co-confirm co-share');
    panel.append(mel('h3', 'co-confirm-h', 'Share this analysis'));
    panel.append(mel('div', 'co-confirm-title', `${current.form.title} — ${query.groupBy ? 'by ' + query.groupBy : 'records'}`));
    try { const w = mel('div', 'co-qr-wrap'); w.append(millQrSvg(url)); panel.append(w); }
    catch { panel.append(mel('div', 'co-share-toobig', '⚠ Too large for a QR — use the link.')); }
    const linkRow = mel('div', 'co-share-link');
    const input = mel('input', 'co-share-url'); input.readOnly = true; input.value = url;
    const copy = mel('button', 'co-btn', 'Copy link');
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(url); copy.textContent = 'Copied ✓'; } catch { input.select(); } });
    linkRow.append(input, copy); panel.append(linkRow, mel('div', 'co-confirm-meta', fit));
    const close = mel('button', 'co-btn co-ghost', 'Close'); close.addEventListener('click', () => scrim.remove());
    panel.append(close); scrim.append(panel);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
    document.body.append(scrim);
  }

  function doOpen() {
    const scrim = mel('div', 'co-scrim'); const panel = mel('div', 'co-confirm');
    panel.append(mel('h3', 'co-confirm-h', 'Open an analysis'));
    const ta = mel('textarea', 'co-paste-input'); ta.rows = 3; ta.placeholder = 'paste an analysis capsule (q:…) or a share link';
    const err = mel('div', 'mill-err');
    const actions = mel('div', 'co-confirm-actions');
    const cancel = mel('button', 'co-btn co-ghost', 'Cancel'); cancel.addEventListener('click', () => scrim.remove());
    const apply = mel('button', 'co-btn', 'Apply');
    apply.addEventListener('click', async () => {
      err.textContent = ''; apply.disabled = true;
      try { applyAnalysis(await resolveAnalysis(ta.value)); scrim.remove(); }
      catch (e) { err.textContent = e.message; apply.disabled = false; }
    });
    actions.append(cancel, apply);
    panel.append(ta, err, actions); scrim.append(panel);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
    document.body.append(scrim);
  }

  function millToast(msg) { const t = mel('div', 'co-toast', msg); document.body.append(t); setTimeout(() => t.remove(), 3500); }

  if (opts.analysis) {
    try { applyAnalysis(opts.analysis); }
    catch (e) { millToast(e.message); if (withRecs.length) { formSel.value = withRecs[0].hash; selectForm(withRecs[0].hash); } }
  } else if (withRecs.length) { formSel.value = withRecs[0].hash; selectForm(withRecs[0].hash); }
}
