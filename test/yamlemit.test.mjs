// Round-trip conformance for treeToYaml — the gate that makes YAML emit safe.
// For each tree: emit YAML, parse it back through the REAL load path
// (loadFormText → @gcu/yaml parse → astToData), and assert deep equality. The
// danger isn't difficulty, it's *silent* corruption — a value re-typed on the way
// out (e.g. "no" → false, "2026-06-01" → a date, "007" → 7) would change the
// canonical tree. These vectors lean hard on exactly those cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treeToYaml } from '../src/js/formsource/yamlemit.js';
import { loadFormText } from '../src/js/formsource/load.js';

const roundTrip = (tree) => loadFormText(treeToYaml(tree), 'yaml');

// A form tree exercising the strictness landmines + structure.
const QF = {
  type: 'form',
  meta: {
    id: 'qfsamp', title: 'QF Sample Log', version: '2026-06-01',   // version is a STRING, not a date
    lang: 'en', mode: 'append', tiers: { store: 'idb', durable: 'comment' },
  },
  fields: [
    { name: 'site_id', fieldType: 'text', label: 'Site ID', props: { required: true } },
    { name: 'plot_code', fieldType: 'text', label: 'Plot Code', props: {} },        // "007" lives in records, but a default could be a code
    { name: 'fe_pct', fieldType: 'number', label: 'Fe %', props: { int: false, min: 0, max: 100 } },
    { name: 'count', fieldType: 'number', label: 'Count', props: { int: true } },
    { name: 'wet', fieldType: 'select', label: 'Wet?', props: { list: 'yesno' } },
    { name: 'dry', fieldType: 'select', label: 'Dry?', props: { list: 'yesno' } },  // shared list
    { name: 'coords', fieldType: 'geo', label: 'Coordinates', props: { 'capture-accuracy': 10 } },  // dash key
    { name: 'samples', fieldType: 'repeat', label: 'Samples', props: {}, children: [
      { name: 'lith', fieldType: 'select', label: 'Lithology', props: { list: 'litho' } },
      { name: 'note', fieldType: 'text', label: 'Note: free text; says "hi"', props: {} },   // colon + quotes in a label
    ] },
  ],
  choices: {
    yesno: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],          // value "no" must stay the string "no"
    litho: [{ value: 'itabirite', label: 'Itabirite' }, { value: 'quartzite', label: 'Quartzite' }],
  },
  rules: [
    { verb: 'relevant', target: 'dry', expr: '${wet} = "no"' },                     // expr with quotes + ${}
    { verb: 'constrain', target: 'fe_pct', expr: 'fe_pct >= 0 and fe_pct <= 100', message: 'must be 0–100' },
  ],
  views: [],
};

test('round-trip — full QF form (strictness landmines + nesting) is lossless', () => {
  assert.deepEqual(roundTrip(QF), QF);
});

test('round-trip — scalars that must NOT be coerced survive as strings', () => {
  const tree = {
    type: 'form', meta: { id: 'edge', title: 'Edge', mode: 'append' },
    fields: [
      { name: 'a', fieldType: 'text', label: 'A', props: { default: 'no' } },        // not boolean false
      { name: 'b', fieldType: 'text', label: 'B', props: { default: '007' } },        // not the int 7
      { name: 'c', fieldType: 'text', label: 'C', props: { default: '2026-06-01' } }, // not a date
      { name: 'd', fieldType: 'text', label: 'D', props: { default: 'true' } },       // not boolean true
      { name: 'e', fieldType: 'text', label: 'E', props: { default: '1.50' } },       // not the float 1.5
    ],
    choices: {}, rules: [], views: [],
  };
  const back = roundTrip(tree);
  assert.deepEqual(back, tree);
  for (const f of back.fields) assert.equal(typeof f.props.default, 'string', `${f.name} default stays a string`);
});

test('round-trip — real numbers/booleans/empties keep their types', () => {
  const tree = {
    type: 'form', meta: { id: 'types', title: 'Types', mode: 'append' },
    fields: [{ name: 'n', fieldType: 'number', label: 'N', props: { int: true, min: -5, max: 12, step: 0.5 } }],
    choices: {}, rules: [], views: [],
  };
  const back = roundTrip(tree);
  assert.deepEqual(back, tree);
  const p = back.fields[0].props;
  assert.equal(p.int, true);
  assert.equal(p.min, -5);
  assert.equal(p.step, 0.5);
  assert.deepEqual(back.rules, []);
  assert.deepEqual(back.choices, {});
});

test('treeToYaml — house style: bare keys, quoted string values', () => {
  const y = treeToYaml(QF);
  assert.match(y, /^type: "form"/m, 'bare key, quoted value');
  assert.match(y, /version: "2026-06-01"/, 'version emitted quoted (string)');
  assert.match(y, /capture-accuracy: 10/, 'dash key stays bare; number stays bare');
  assert.match(y, /required: true/, 'real boolean stays bare');
});
