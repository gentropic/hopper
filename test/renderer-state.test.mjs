import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createForm } from '../src/js/renderer/state.js';

const TREE = {
  type: 'form',
  meta: { id: 'qf', title: 'QF', mode: 'append' },
  fields: [
    { name: 'site_id', fieldType: 'text', label: 'Site ID', props: { required: true } },
    { name: 'resample', fieldType: 'select', label: 'Resample?', props: { list: 'yesno' } },
    { name: 'why', fieldType: 'text', label: 'Why?', props: {} },
    { name: 'samples', fieldType: 'repeat', label: 'Samples', props: {}, children: [
      { name: 'fe_pct', fieldType: 'number', label: 'Fe %', props: {} },
    ] },
    { name: 'n_samples', fieldType: 'calc', label: '', props: {} },
    { name: 'photo', fieldType: 'photo', label: 'Photo', props: {} },
  ],
  choices: { yesno: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] },
  rules: [
    { verb: 'relevant', target: 'why', expr: 'resample = "yes"' },
    { verb: 'constrain', target: 'fe_pct', expr: 'fe_pct between 0 and 100', message: '0–100' },
    { verb: 'calculate', target: 'n_samples', expr: 'count(samples)' },
    { verb: 'show', label: 'high-grade', expr: 'mean(samples.fe_pct) > 60' },
  ],
};

test('relevance reacts to a controlling field', () => {
  const f = createForm(TREE);
  assert.equal(f.isRelevant('why'), false);            // resample blank → false
  f.set('resample', 'yes');
  assert.equal(f.isRelevant('why'), true);
  f.set('resample', 'no');
  assert.equal(f.isRelevant('why'), false);
});

test('required + constraint validity', () => {
  const f = createForm(TREE);
  assert.equal(f.validity('site_id').valid, false);    // required, blank
  f.set('site_id', 'QF-118');
  assert.equal(f.validity('site_id').valid, true);
});

test('repeats: add/remove instances, aggregate calc + show flag react', () => {
  const f = createForm(TREE);
  assert.equal(f.calcValue('n_samples'), 0);           // count() of empty
  const rep = f.repeat('samples');
  const a = rep.add(), b = rep.add();
  assert.equal(rep.items().length, 2);
  assert.equal(f.calcValue('n_samples'), 2);           // count reacts

  a.children.get('fe_pct').set(64);
  b.children.get('fe_pct').set(46);
  assert.equal(f.flags().find((x) => x.label === 'high-grade').on, false);  // mean 55 ≤ 60
  b.children.get('fe_pct').set(80);
  assert.equal(f.flags().find((x) => x.label === 'high-grade').on, true);   // mean 72 > 60

  rep.remove(0);
  assert.equal(f.calcValue('n_samples'), 1);
});

test('per-instance constraint on a repeat child', () => {
  const f = createForm(TREE);
  const inst = f.repeat('samples').add();
  inst.children.get('fe_pct').set(140);
  assert.equal(f.validity('fe_pct', inst).valid, false);   // 140 ∉ [0,100]
  inst.children.get('fe_pct').set(64);
  assert.equal(f.validity('fe_pct', inst).valid, true);
});

test('values() snapshot: nested repeat array, irrelevant field omitted', () => {
  const f = createForm(TREE);
  f.set('site_id', 'QF-118');
  f.set('resample', 'no');                              // why becomes irrelevant
  const inst = f.repeat('samples').add();
  inst.children.get('fe_pct').set(64);

  const v = f.values();
  assert.equal(v.site_id, 'QF-118');
  assert.equal('why' in v, false);                     // irrelevant ⇒ omitted (§4.5)
  assert.deepEqual(v.samples, [{ fe_pct: 64 }]);
  assert.equal(v.n_samples, 1);                         // calc included
  assert.equal('photo' in v, false);                    // media lives in attachments, not values (§8)
});

test('attachments(): media ref collected, keyed by field; excluded from values', () => {
  const f = createForm(TREE);
  assert.deepEqual(f.attachments(), {});                // nothing captured yet
  f.set('photo', { blob: 'sha256-abc', mime: 'image/jpeg', bytes: 184320 });
  assert.deepEqual(f.attachments(), { photo: { blob: 'sha256-abc', mime: 'image/jpeg', bytes: 184320 } });
  assert.equal('photo' in f.values(), false);           // never leaks into values
});
