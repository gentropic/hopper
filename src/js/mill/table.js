// mill/table.js — records → a flat analysis table (columns + rows). The
// Hopper-specific glue between the append-only record union and the query engine:
// each record's `values` becomes a row; the form gives the column schema. Group
// children flatten (groups are presentational, §8); a `repeat` stays ONE column
// (its instance array) — the total calculus's `count(...)`/`total(...)` aggregate
// it per-row, so we don't explode instances in v1. Pure + node-testable.

function flattenColumns(fields, out) {
  for (const f of fields || []) {
    if (f.fieldType === 'group') { flattenColumns(f.children, out); continue; }   // flat, no prefix
    out.push({ name: f.name, label: f.label || f.name, fieldType: f.fieldType });  // leaf, or a repeat (one column)
  }
  return out;
}

// records: array of record-like objects (`{ values, … }`, or a bare values map).
// Returns { columns: [{name,label,fieldType}], rows: [valuesMap] }.
export function recordsToRows(records, form) {
  const columns = flattenColumns((form && form.fields) || [], []);
  const rows = (records || []).map((rec) => ({ ...((rec && rec.values) || rec || {}) }));
  return { columns, rows };
}
