import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xlsformToTree, treeToXlsform, xpathToSoft, softToXpath } from '../src/js/xlsform/index.js';

test('bridge — symbolic comparisons round-trip near-identity', () => {
  // ordering: self → `.`
  assert.equal(softToXpath('fe_pct > 60', 'fe_pct').xpath, '. > 60');
  assert.equal(xpathToSoft('. > 60', 'fe_pct').soft, 'fe_pct > 60');
  // between sugar ↔ two-sided
  assert.equal(softToXpath('fe_pct between 0 and 100', 'fe_pct').xpath, '. >= 0 and . <= 100');
  assert.equal(xpathToSoft('. >= 0 and . <= 100', 'fe_pct').soft, 'fe_pct between 0 and 100');
  // equality on another field, quote style flips
  assert.equal(softToXpath('lithology = "itabirite"', 'fe_pct').xpath, "${lithology} = 'itabirite'");
  assert.equal(xpathToSoft("${lithology} = 'itabirite'", 'fe_pct').soft, 'lithology = "itabirite"');
  // membership, presence, aggregates
  assert.equal(softToXpath('tags contains "qf"', 'tags').xpath, "selected(${tags}, 'qf')");
  assert.equal(xpathToSoft("selected(${tags}, 'qf')", 'tags').soft, 'tags contains "qf"');
  assert.equal(softToXpath('count(samples)', 'n').xpath, 'count(${samples})');
  assert.equal(xpathToSoft('count(${samples})', 'n').soft, 'count(samples)');
  assert.equal(softToXpath('total(samples.fe_pct)', 'n').xpath, 'sum(${samples}/fe_pct)');
  assert.equal(xpathToSoft('sum(${samples}/fe_pct)', 'n').soft, 'total(samples.fe_pct)');
});

test('bridge — unrecognized XPath passes through, flagged', () => {
  const r = xpathToSoft('jr:choice-name(${x}, true())', 'x');
  assert.equal(r.ok, false);
  assert.equal(r.soft, 'jr:choice-name(${x}, true())');
});

const TREE = {
  type: 'form',
  meta: { id: 'qfsamp', title: 'QF Sample Log', version: '2026-06-01', lang: 'en', mode: 'append', tiers: { store: 'idb', durable: 'comment' } },
  fields: [
    { name: 'site_id', fieldType: 'text', label: 'Site ID', props: { required: true } },
    { name: 'meta_grp', fieldType: 'group', label: 'Metadata', props: {}, children: [
      { name: 'sampled', fieldType: 'date', label: 'Date sampled', props: {} },
    ] },
    { name: 'samples', fieldType: 'repeat', label: 'Samples', props: {}, children: [
      { name: 'lithology', fieldType: 'select', label: 'Lithology', props: { list: 'litho' } },
      { name: 'fe_pct', fieldType: 'number', label: 'Fe %', props: {} },
    ] },
    { name: 'n_samples', fieldType: 'calc', label: '', props: {} },
  ],
  choices: { litho: [{ value: 'itabirite', label: 'itabirite' }, { value: 'canga', label: 'canga' }] },
  rules: [
    { verb: 'constrain', target: 'fe_pct', expr: 'fe_pct between 0 and 100', message: '0–100' },
    { verb: 'relevant', target: 'fe_pct', expr: 'lithology = "itabirite"' },
    { verb: 'calculate', target: 'n_samples', expr: 'count(samples)' },
    { verb: 'show', label: 'high-grade', expr: 'fe_pct > 60' },
  ],
  views: [],
};

test('round-trip — hierarchical tree → XLSForm → tree (supported subset)', () => {
  const xls = treeToXlsform(TREE);
  // show has no XLSForm column — dropped with a warning, not silently
  assert.ok(xls.dropped.some((d) => d.includes('high-grade')));

  const { tree, warnings } = xlsformToTree(xls);
  assert.deepEqual(warnings, []);                                   // nothing degraded

  // structure: nesting preserved
  const top = tree.fields.map((f) => [f.name, f.fieldType]);
  assert.deepEqual(top, [['site_id', 'text'], ['meta_grp', 'group'], ['samples', 'repeat'], ['n_samples', 'calc']]);
  assert.deepEqual(tree.fields[1].children.map((f) => f.name), ['sampled']);
  assert.deepEqual(tree.fields[2].children.map((f) => [f.name, f.fieldType]), [['lithology', 'select'], ['fe_pct', 'number']]);
  assert.equal(tree.fields[2].children[0].props.list, 'litho');
  assert.equal(tree.fields[0].props.required, true);

  // rules round-trip (show is gone — expected)
  const rule = (v, t) => tree.rules.find((r) => r.verb === v && r.target === t);
  assert.equal(rule('constrain', 'fe_pct').expr, 'fe_pct between 0 and 100');
  assert.equal(rule('constrain', 'fe_pct').message, '0–100');
  assert.equal(rule('relevant', 'fe_pct').expr, 'lithology = "itabirite"');
  assert.equal(rule('calculate', 'n_samples').expr, 'count(samples)');
  assert.equal(tree.rules.some((r) => r.verb === 'show'), false);

  // choices preserved
  assert.deepEqual(tree.choices.litho.map((c) => c.value), ['itabirite', 'canga']);
});

test('import — unknown type and dynamic required', () => {
  const { tree, warnings } = xlsformToTree({
    survey: [
      { type: 'rating', name: 'stars', label: 'Stars' },                       // unknown → skipped+warn
      { type: 'text', name: 'why', label: 'Why', required: '${stars} > 3' },    // dynamic required → require rule
    ],
    settings: [{ form_id: 'f', form_title: 'F' }],
  });
  assert.ok(warnings.some((w) => w.includes('unknown type "rating"')));
  assert.equal(tree.fields.length, 1);
  assert.equal(tree.rules.find((r) => r.verb === 'require' && r.target === 'why').expr, 'stars > 3');
});
