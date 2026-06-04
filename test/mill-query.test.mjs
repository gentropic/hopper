import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordsToRows } from '../src/js/mill/table.js';
import { runQuery } from '../src/js/mill/query.js';

const FORM = {
  type: 'form', meta: { id: 'qf' },
  fields: [
    { name: 'site_id', fieldType: 'text', label: 'Site' },
    { name: 'region', fieldType: 'group', label: 'Region', children: [
      { name: 'lithology', fieldType: 'select', label: 'Lithology', props: { list: 'litho' } },
    ] },
    { name: 'fe_pct', fieldType: 'number', label: 'Fe %' },
    { name: 'samples', fieldType: 'repeat', label: 'Samples', children: [
      { name: 'lith', fieldType: 'select' }, { name: 'g', fieldType: 'number' },
    ] },
  ], choices: {}, rules: [], views: [],
};

const RECS = [
  { values: { site_id: 'QF-1', lithology: 'itabirite', fe_pct: 58, samples: [{ lith: 'x', g: 1 }, { lith: 'y', g: 2 }] } },
  { values: { site_id: 'QF-2', lithology: 'quartzite', fe_pct: 41, samples: [{ lith: 'z', g: 3 }] } },
  { values: { site_id: 'QF-3', lithology: 'itabirite', fe_pct: 60, samples: [] } },
  { values: { site_id: 'QF-4', lithology: 'itabirite', fe_pct: 55, samples: [{ lith: 'a', g: 9 }] } },
];

test('recordsToRows — flat columns (groups flatten, repeat is one column) + rows', () => {
  const { columns, rows } = recordsToRows(RECS, FORM);
  assert.deepEqual(columns.map((c) => c.name), ['site_id', 'lithology', 'fe_pct', 'samples'], 'group child flattened, repeat kept as one column');
  assert.equal(columns.find((c) => c.name === 'samples').fieldType, 'repeat');
  assert.equal(rows.length, 4);
  assert.equal(rows[0].site_id, 'QF-1');
});

test('runQuery — filter via the total calculus', () => {
  const r = runQuery({ filter: 'fe_pct >= 50' }, recordsToRows(RECS, FORM));
  assert.deepEqual(r.rows.map((x) => x.site_id), ['QF-1', 'QF-3', 'QF-4']);
});

test('runQuery — group by + aggregates (mean, count) + sort', () => {
  const r = runQuery({
    groupBy: 'lithology',
    aggregates: [{ op: 'mean', field: 'fe_pct', as: 'avg_fe' }, { op: 'count', as: 'n' }],
    sort: { by: 'avg_fe', dir: 'desc' },
  }, recordsToRows(RECS, FORM));
  const itab = r.rows.find((x) => x.lithology === 'itabirite');
  assert.equal(itab.n, 3);
  assert.ok(Math.abs(itab.avg_fe - 57.6667) < 0.01, 'mean of 58,60,55');
  assert.equal(r.rows[0].lithology, 'itabirite', 'sorted desc by avg_fe (57.7 > 41)');
  assert.deepEqual(r.columns.map((c) => c.name), ['lithology', 'avg_fe', 'n']);
});

test('runQuery — computed column via calculus, incl. per-row repeat count', () => {
  const r = runQuery({ computed: [{ name: 'n_samples', expr: 'count(samples)' }] }, recordsToRows(RECS, FORM));
  assert.equal(r.rows.find((x) => x.site_id === 'QF-1').n_samples, 2);
  assert.equal(r.rows.find((x) => x.site_id === 'QF-3').n_samples, 0);
  assert.ok(r.columns.some((c) => c.name === 'n_samples'));
});

test('runQuery — summary (aggregates, no groupBy) → single row', () => {
  const r = runQuery({
    filter: 'fe_pct >= 50',
    aggregates: [{ op: 'mean', field: 'fe_pct', as: 'avg' }, { op: 'max', field: 'fe_pct', as: 'hi' }],
  }, recordsToRows(RECS, FORM));
  assert.equal(r.rows.length, 1);
  assert.ok(Math.abs(r.rows[0].avg - 57.6667) < 0.01);
  assert.equal(r.rows[0].hi, 60);
});

test('runQuery — a computed column can feed group-by + aggregate (composition)', () => {
  const r = runQuery({
    computed: [{ name: 'total_g', expr: 'total(samples.g)' }],
    groupBy: 'lithology',
    aggregates: [{ op: 'sum', field: 'total_g', as: 'g_sum' }],
  }, recordsToRows(RECS, FORM));
  // itabirite rows: QF-1 (1+2=3), QF-3 (0), QF-4 (9) → 12 ; quartzite: QF-2 (3) → 3
  assert.equal(r.rows.find((x) => x.lithology === 'itabirite').g_sum, 12);
  assert.equal(r.rows.find((x) => x.lithology === 'quartzite').g_sum, 3);
});

test('runQuery — input table is not mutated (purity)', () => {
  const t = recordsToRows(RECS, FORM);
  runQuery({ computed: [{ name: 'x', expr: 'fe_pct + 1' }], filter: 'fe_pct >= 50' }, t);
  assert.equal(t.rows.length, 4, 'filter did not shrink the source');
  assert.ok(!('x' in t.rows[0]), 'computed column did not leak onto the source rows');
});
