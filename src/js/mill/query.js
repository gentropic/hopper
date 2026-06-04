// mill/query.js — runQuery(query, table) → result table. The mill's primary,
// SHAREABLE query layer (DECISIONS §6): `query` is plain data —
//   { filter?, computed?: [{name,expr,label?}], groupBy?, aggregates?: [{op,field,as,label?}],
//     sort?: {by,dir}, limit? }
// — so a saved analysis travels in a capsule like a form. Filter predicates and
// computed columns are the SAME total expression calculus as the rule layer
// (rules/eval.js) — total ⇒ safe to open. Grouping / aggregation / sort are plain
// reductions (the aggregate op-names mirror the calculus's for consistency).
// Pure: the input table is never mutated.

import { parse, evaluate, evalBool } from '../rules/eval.js';

const toNum = (v) => (v === '' || v == null ? NaN : Number(v));
const blankVal = (v) => v == null || v === '';

// op over a set of rows for one field. count(no field) = row count; count(field) =
// non-blank count; sum/min/max/mean over the field's numeric values (blanks skipped).
function aggregateOp(op, rows, field) {
  if (op === 'count') return field ? rows.filter((r) => !blankVal(r[field])).length : rows.length;
  const nums = rows.map((r) => toNum(r[field])).filter((n) => !Number.isNaN(n));
  if (op === 'sum' || op === 'total') return nums.reduce((a, b) => a + b, 0);
  if (!nums.length) return null;                                  // min/max/mean of empty → blank
  if (op === 'min') return Math.min(...nums);
  if (op === 'max') return Math.max(...nums);
  if (op === 'mean' || op === 'average') return nums.reduce((a, b) => a + b, 0) / nums.length;
  return null;
}

const aggName = (a) => a.as || `${a.op}_${a.field || 'rows'}`;
const colLabel = (cols, name) => { const c = cols.find((x) => x.name === name); return c ? c.label : name; };
function cmpVal(a, b) {
  const na = toNum(a), nb = toNum(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a == null ? '' : a).localeCompare(String(b == null ? '' : b));
}

export function runQuery(query, table) {
  const q = query || {};
  const inCols = (table && table.columns) || [];
  let rows = ((table && table.rows) || []).map((r) => ({ ...r }));   // clone — never mutate input

  // 1. filter — a total-calculus boolean predicate over each row
  if (q.filter) {
    let ast; try { ast = parse(q.filter); } catch (e) { throw new Error('filter does not parse: ' + e.message); }
    rows = rows.filter((r) => { try { return evalBool(ast, r); } catch { return false; } });
  }

  // 2. computed columns — total-calculus scalar expr per row (incl. repeat aggs like count(samples))
  const compCols = [];
  for (const c of q.computed || []) {
    let ast; try { ast = parse(c.expr); } catch (e) { throw new Error(`computed "${c.name}" does not parse: ` + e.message); }
    for (const r of rows) { try { r[c.name] = evaluate(ast, r); } catch { r[c.name] = null; } }
    compCols.push({ name: c.name, label: c.label || c.name, fieldType: 'calc' });
  }

  let columns, out;
  if (q.groupBy) {
    const aggs = (q.aggregates && q.aggregates.length) ? q.aggregates : [{ op: 'count', as: 'count' }];
    const groups = new Map();
    for (const r of rows) {
      const key = r[q.groupBy], k = key == null ? '' : String(key);
      if (!groups.has(k)) groups.set(k, { key, rows: [] });
      groups.get(k).rows.push(r);
    }
    out = [...groups.values()].map(({ key, rows: grp }) => {
      const row = { [q.groupBy]: key };
      for (const a of aggs) row[aggName(a)] = aggregateOp(a.op, grp, a.field);
      return row;
    });
    columns = [{ name: q.groupBy, label: colLabel(inCols.concat(compCols), q.groupBy), fieldType: 'group' }]
      .concat(aggs.map((a) => ({ name: aggName(a), label: a.label || aggName(a), fieldType: 'number' })));
  } else if (q.aggregates && q.aggregates.length) {
    const row = {};
    for (const a of q.aggregates) row[aggName(a)] = aggregateOp(a.op, rows, a.field);
    out = [row];
    columns = q.aggregates.map((a) => ({ name: aggName(a), label: a.label || aggName(a), fieldType: 'number' }));
  } else {
    out = rows;                                                   // projection: original + computed columns
    columns = inCols.concat(compCols);
  }

  // 5. sort · 6. limit
  if (q.sort && q.sort.by) {
    const dir = q.sort.dir === 'desc' ? -1 : 1;
    out = out.slice().sort((a, b) => cmpVal(a[q.sort.by], b[q.sort.by]) * dir);
  }
  if (q.limit != null) out = out.slice(0, q.limit);

  return { columns, rows: out };
}
