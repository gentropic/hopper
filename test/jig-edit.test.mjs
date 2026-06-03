import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferTree } from '../src/js/jig/infer.js';
import {
  addField, removeField, moveField, setProps, setLabel,
  setRule, removeRule, renameField, applyOverrides, findField,
} from '../src/js/jig/edit.js';
import { validateTree } from '../src/js/jig/validate.js';
import { treeToXlsform, xlsformToTree } from '../src/js/xlsform/index.js';

// A small hand tree for edit tests.
function base() {
  return {
    type: 'form',
    meta: { id: 'f', title: 'F', version: '', lang: 'en', mode: 'append', tiers: { store: 'idb' } },
    fields: [
      { name: 'a', fieldType: 'number', label: 'A', props: {} },
      { name: 'b', fieldType: 'text', label: 'B', props: {} },
      { name: 'items', fieldType: 'repeat', label: 'Items', props: {}, children: [
        { name: 'qty', fieldType: 'number', label: 'Qty', props: {} },
      ] },
    ],
    choices: {}, rules: [], views: [],
  };
}

test('addField — top level, into container, and guards', () => {
  let t = addField(base(), { name: 'c', fieldType: 'text', label: 'C' });
  assert.equal(t.fields.at(-1).name, 'c');
  assert.deepEqual(t.fields.at(-1).props, {}, 'props defaulted');

  t = addField(base(), { name: 'price', fieldType: 'number', label: 'Price' }, { parent: 'items' });
  assert.equal(findField(t, 'price').parent.name, 'items', 'nested under the repeat');

  assert.throws(() => addField(base(), { name: 'a', fieldType: 'text' }), /already exists/);
  assert.throws(() => addField(base(), { name: 'Bad Name', fieldType: 'text' }), /valid identifier/);
  // input is not mutated
  const orig = base(); addField(orig, { name: 'z', fieldType: 'text' });
  assert.equal(orig.fields.length, 3, 'original tree untouched');
});

test('removeField — drops the field and rules targeting it', () => {
  let t = setRule(base(), { verb: 'relevant', target: 'b', expr: 'a > 1' });
  t = removeField(t, 'b');
  assert.equal(findField(t, 'b'), null);
  assert.equal(t.rules.length, 0, 'rule targeting b dropped');
});

test('moveField — reorder within parent', () => {
  const t = moveField(base(), 'items', 0);
  assert.deepEqual(t.fields.map((f) => f.name), ['items', 'a', 'b']);
});

test('setProps — merge and null-delete', () => {
  let t = setProps(base(), 'a', { required: true, min: 0 });
  assert.deepEqual(findField(t, 'a').field.props, { required: true, min: 0 });
  t = setProps(t, 'a', { min: null });
  assert.deepEqual(findField(t, 'a').field.props, { required: true });
});

test('setLabel', () => {
  assert.equal(findField(setLabel(base(), 'a', 'Alpha'), 'a').field.label, 'Alpha');
});

test('setRule — upsert semantics', () => {
  let t = setRule(base(), { verb: 'relevant', target: 'b', expr: 'a > 1' });
  t = setRule(t, { verb: 'relevant', target: 'b', expr: 'a > 5' });
  assert.equal(t.rules.length, 1, 'relevant replaced in place');
  assert.equal(t.rules[0].expr, 'a > 5');
  t = setRule(t, { verb: 'show', label: 'Lite', expr: 'a > 0' });
  t = setRule(t, { verb: 'show', label: 'Full', expr: 'a > 0' });
  assert.equal(t.rules.filter((r) => r.verb === 'show').length, 2, 'show keyed by label → both kept');
  t = removeRule(t, 'show', 'Lite');
  assert.equal(t.rules.filter((r) => r.verb === 'show').length, 1);
});

test('renameField — cascades target, ${ref}, bare ref; spares strings', () => {
  let t = base();
  t = setRule(t, { verb: 'relevant', target: 'b', expr: '${a} > 1' });
  t = setRule(t, { verb: 'constrain', target: 'a', expr: 'a < 10 and b != "a"' });
  t = renameField(t, 'a', 'alpha');

  assert.ok(findField(t, 'alpha') && !findField(t, 'a'), 'field renamed');
  const rel = t.rules.find((r) => r.verb === 'relevant');
  const con = t.rules.find((r) => r.verb === 'constrain');
  assert.equal(rel.expr, '${alpha} > 1', '${ref} cascaded');
  assert.equal(con.target, 'alpha', 'target cascaded');
  assert.equal(con.expr, 'alpha < 10 and b != "a"', 'bare ref cascaded, string literal "a" untouched');

  assert.throws(() => renameField(base(), 'a', 'b'), /already exists/);
  assert.throws(() => renameField(base(), 'a', 'Nope!'), /valid identifier/);
});

test('renameField — rewrites the leading segment of an aggregate path', () => {
  let t = setRule(base(), { verb: 'calculate', target: 'a', expr: 'total(items.qty)' });
  t = renameField(t, 'items', 'rows');
  assert.equal(t.rules[0].expr, 'total(rows.qty)');
});

test('applyOverrides — setType select→text sheds the orphan list', () => {
  const { tree } = inferTree([
    { Lithology: 'itabirite' }, { Lithology: 'quartzite' }, { Lithology: 'itabirite' },
  ]);
  assert.equal(findField(tree, 'lithology').field.fieldType, 'select');
  const t = applyOverrides(tree, { setType: { lithology: 'text' } });
  assert.equal(findField(t, 'lithology').field.fieldType, 'text');
  assert.equal(findField(t, 'lithology').field.props.list, undefined, 'list prop shed');
  assert.equal(t.choices.lithology, undefined, 'orphan choices list removed');
});

test('applyOverrides — required, identity, geoMerge', () => {
  const t0 = {
    type: 'form', meta: { id: 'f', mode: 'append' },
    fields: [
      { name: 'site', fieldType: 'text', label: 'Site', props: {} },
      { name: 'lat', fieldType: 'number', label: 'Lat', props: {} },
      { name: 'lon', fieldType: 'number', label: 'Lon', props: {} },
    ], choices: {}, rules: [], views: [],
  };
  const t = applyOverrides(t0, {
    required: ['site'], identity: 'site',
    geoMerge: { lat: 'lat', lng: 'lon', into: 'coords', label: 'Coordinates' },
  });
  assert.equal(findField(t, 'site').field.props.required, true);
  assert.equal(t.meta.identity, 'site');
  assert.equal(findField(t, 'lon'), null, 'lng column removed');
  const geo = findField(t, 'coords');
  assert.ok(geo && geo.field.fieldType === 'geo', 'lat column became the geo point');
});

// ---- validateTree -----------------------------------------------------------

test('validateTree — a clean tree passes', () => {
  const v = validateTree(base());
  assert.equal(v.ok, true, JSON.stringify(v.errors));
});

test('validateTree — catches the structural violations', () => {
  const bad = {
    type: 'form', meta: { id: 'f' },
    fields: [
      { name: 'Dup', fieldType: 'text', props: {} },                       // bad charset
      { name: 'a', fieldType: 'text', props: {} },
      { name: 'a', fieldType: 'wat', props: {} },                          // duplicate + unknown type
      { name: 'pick', fieldType: 'select', props: {} },                    // no list
      { name: 'pick2', fieldType: 'select', props: { list: 'ghost' } },    // missing list
    ],
    choices: {}, rules: [
      { verb: 'glow', target: 'a', expr: '' },                            // bad verb
      { verb: 'relevant', target: 'nope', expr: 'a > 1' },                // unknown target
      { verb: 'constrain', target: 'a', expr: 'a > (' },                  // unparseable
    ], views: [],
  };
  const v = validateTree(bad);
  assert.equal(v.ok, false);
  const blob = v.errors.join(' | ');
  assert.match(blob, /not \[a-z0-9_-\]\+/, 'bad charset');
  assert.match(blob, /duplicate field name "a"/);
  assert.match(blob, /unknown fieldType "wat"/);
  assert.match(blob, /"pick" has no props.list/);
  assert.match(blob, /missing choices list "ghost"/);
  assert.match(blob, /unknown verb "glow"/);
  assert.match(blob, /targets unknown field "nope"/);
  assert.match(blob, /does not parse/);
});

test('validateTree — warns on orphan list and unresolved ref', () => {
  const t = base();
  t.choices = { extra: [{ value: 'x', label: 'X' }] };
  t.rules = [{ verb: 'relevant', target: 'b', expr: 'ghost > 1' }];
  const v = validateTree(t);
  assert.equal(v.ok, true, 'warnings do not block');
  assert.ok(v.warnings.some((w) => /unused/.test(w)), 'orphan list warned');
  assert.ok(v.warnings.some((w) => /unknown field "ghost"/.test(w)), 'unresolved ref warned');
});

// ---- confidence: inference output is genuinely well-formed -------------------

test('infer → validateTree passes, and survives an XLSForm round-trip', () => {
  const rows = [
    { 'Site ID': 'QF-118', Lithology: 'itabirite', 'Fe pct': '58.2', Sampled: '2026-06-01', Coords: '-20.1, -43.5' },
    { 'Site ID': 'QF-119', Lithology: 'quartzite', 'Fe pct': '41.0', Sampled: '2026-06-02', Coords: '-20.2, -43.6' },
    { 'Site ID': 'QF-120', Lithology: 'itabirite', 'Fe pct': '60.1', Sampled: '2026-06-03', Coords: '-20.0, -43.4' },
  ];
  const { tree } = inferTree(rows, { title: 'QF Sample Log' });
  assert.equal(validateTree(tree).ok, true, 'inferred tree is contract-valid');

  const xls = treeToXlsform(tree);
  const back = xlsformToTree({ survey: xls.survey, choices: xls.choices, settings: xls.settings });
  assert.equal(validateTree(back.tree).ok, true, 'round-tripped tree is still contract-valid');
  assert.deepEqual(back.tree.fields.map((f) => f.fieldType),
    ['text', 'select', 'number', 'date', 'geo'], 'field types survive the round trip');
});
