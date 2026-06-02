import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFormText, loadFormByName } from '../src/js/formsource/load.js';
import { createForm } from '../src/js/renderer/state.js';

test('load the real example YAML form → tree the engine accepts', () => {
  const text = readFileSync(new URL('../examples/qf-sample-log.yaml', import.meta.url), 'utf8');
  const tree = loadFormByName('qf-sample-log.yaml', text);
  assert.equal(tree.type, 'form');
  assert.equal(tree.meta.id, 'qfsamp');
  assert.ok(tree.fields.find((f) => f.name === 'site_id'));
  assert.ok(tree.choices.litho, 'choices parsed');
  assert.ok(tree.rules.find((r) => r.verb === 'constrain'), 'rules parsed');

  // the loaded tree drives the reactive engine (relevance from a parsed rule)
  const f = createForm(tree);
  assert.equal(f.isRelevant('resample_reason'), false);
  f.set('resample', 'yes');
  assert.equal(f.isRelevant('resample_reason'), true);
});

test('load JSON tree', () => {
  const tree = loadFormText(JSON.stringify({ type: 'form', meta: { id: 'x' }, fields: [{ name: 'a', fieldType: 'text', label: 'A', props: {} }], choices: {}, rules: [], views: [] }), 'json');
  assert.equal(tree.fields[0].name, 'a');
});

test('reject a non-form document', () => {
  assert.throws(() => loadFormText('type: "thing"', 'yaml'), /not a Hopper form/);
  assert.throws(() => loadFormText('{"type":"form"}', 'json'), /not a Hopper form/);   // no fields array
});
