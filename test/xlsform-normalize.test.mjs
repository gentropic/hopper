import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xlsformToTree } from '../src/js/xlsform/index.js';
import { parse } from '../src/js/rules/eval.js';

// XLSForm allows case-sensitive XML names (uppercase, dots) that the rule calculus
// can't tokenize. Import must normalize them AND rewrite refs, so imported rules
// actually evaluate instead of silently degrading to inert.
test('import normalizes non-conforming names + rewrites refs so rules parse', () => {
  const survey = [
    { type: 'text', name: 'SiteID', label: 'Site ID' },
    { type: 'integer', name: 'Fe.Pct', label: 'Fe %' },
    { type: 'text', name: 'why_low', label: 'Why low?', relevant: '${Fe.Pct} < 30 and ${SiteID} != ""' },
    { type: 'integer', name: 'grade', label: 'Grade', constraint: '. >= 0 and . <= 100' },
  ];
  const { tree, warnings } = xlsformToTree({ survey });

  assert.deepEqual(tree.fields.map((f) => f.name), ['siteid', 'fe_pct', 'why_low', 'grade'], 'names → [a-z0-9_-], letter-start');

  const rel = tree.rules.find((r) => r.target === 'why_low');
  assert.ok(rel, 'relevant retargeted to a slugged name');
  assert.match(rel.expr, /fe_pct/);
  assert.match(rel.expr, /siteid/);
  assert.ok(!/Fe\.Pct|SiteID/.test(rel.expr), 'no original (un-tokenizable) names remain');
  assert.doesNotThrow(() => parse(rel.expr), 'normalized relevant tokenizes in the calculus (the whole point)');

  const con = tree.rules.find((r) => r.target === 'grade');
  assert.doesNotThrow(() => parse(con.expr), 'normalized constraint tokenizes');

  assert.ok(warnings.some((w) => /SiteID/.test(w) && /siteid/.test(w)), 'normalization is reported, never silent');
});

test('import leaves already-conforming names untouched (no needless rewrite)', () => {
  const survey = [
    { type: 'text', name: 'site_id', label: 'Site' },
    { type: 'integer', name: 'fe_pct', label: 'Fe', relevant: '${site_id} != ""' },
  ];
  const { tree } = xlsformToTree({ survey });
  assert.deepEqual(tree.fields.map((f) => f.name), ['site_id', 'fe_pct']);
  assert.doesNotThrow(() => parse(tree.rules.find((r) => r.target === 'fe_pct').expr));
});
