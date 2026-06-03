import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeValues, decodeValues } from '../src/js/records/positional.js';

// a QF-shaped tree exercising every codec path: text, geo (generic obj), select,
// relevant text, a group, a repeat of {select, number}, multiselect, calc, note, photo
const TREE = {
  type: 'form', meta: { id: 'qf' },
  fields: [
    { name: 'site_id', fieldType: 'text', label: 'Site', props: {} },
    { name: 'coords', fieldType: 'geo', label: 'Coords', props: {} },
    { name: 'traverse', fieldType: 'geotrace', label: 'Traverse', props: {} },
    { name: 'resample', fieldType: 'select', label: 'Resample?', props: { list: 'yesno' } },
    { name: 'hazards', fieldType: 'multiselect', label: 'Hazards', props: { list: 'haz' } },
    { name: 'meta', fieldType: 'group', label: 'Meta', props: {}, children: [
      { name: 'crew', fieldType: 'number', label: 'Crew', props: { int: true } },
    ] },
    { name: 'samples', fieldType: 'repeat', label: 'Samples', props: {}, children: [
      { name: 'lithology', fieldType: 'select', label: 'Lithology', props: { list: 'litho' } },
      { name: 'fe_pct', fieldType: 'number', label: 'Fe %', props: {} },
    ] },
    { name: 'n_samples', fieldType: 'calc', label: '', props: {} },
    { name: 'photo', fieldType: 'photo', label: 'Photo', props: {} },
    { name: 'thanks', fieldType: 'note', label: 'Obrigado', props: {} },
  ],
  choices: {
    yesno: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
    haz: [{ value: 'rockfall', label: 'Rockfall' }, { value: 'water', label: 'Water' }, { value: 'gas', label: 'Gas' }],
    litho: [{ value: 'itabirite', label: 'itabirite' }, { value: 'hematitite', label: 'hematitite' }, { value: 'canga', label: 'canga' }],
  },
};

test('positional: full round-trip against the schema', () => {
  const values = {
    site_id: 'QF-118',
    coords: { lat: -20.123, lng: -43.456, acc: 5 },
    traverse: [{ lat: -20.1, lng: -43.4, acc: 5 }, { lat: -20.2, lng: -43.5, acc: 8 }],
    resample: 'yes',
    hazards: ['rockfall', 'gas'],
    crew: 3,
    samples: [
      { lithology: 'itabirite', fe_pct: 64.2 },
      { lithology: 'canga', fe_pct: 31.7 },
    ],
    n_samples: 2,
  };
  const bytes = encodeValues(TREE, values);
  assert.ok(bytes instanceof Uint8Array);
  const back = decodeValues(TREE, bytes);
  assert.deepEqual(back, values, 'decodes back to exactly the values');
});

test('positional: compaction — far smaller than JSON', () => {
  const values = { site_id: 'QF-118', resample: 'yes', samples: [{ lithology: 'itabirite', fe_pct: 64.2 }] };
  const bytes = encodeValues(TREE, values);
  const json = new TextEncoder().encode(JSON.stringify(values)).length;
  assert.ok(bytes.length < json / 2, `positional ${bytes.length}B << JSON ${json}B`);
  // a select packs to a 2-byte index, not its string
  assert.ok(bytes.length < 40, `tuple is tiny (${bytes.length}B)`);
});

test('positional: blanks/absent → null; empty repeat → []', () => {
  const bytes = encodeValues(TREE, { site_id: 'X' });   // everything else absent
  const back = decodeValues(TREE, bytes);
  assert.equal(back.site_id, 'X');
  assert.equal(back.resample, null);
  assert.equal(back.coords, null);
  assert.equal(back.crew, null);                         // group child, absent
  assert.deepEqual(back.samples, []);                    // empty repeat
  assert.equal(back.n_samples, null);
  assert.equal('photo' in back, false);                  // media/note skipped — no slot
  assert.equal('thanks' in back, false);
});

test('positional: select index maps via the choice list; off-list falls back to literal', () => {
  const r1 = decodeValues(TREE, encodeValues(TREE, { resample: 'no' }));
  assert.equal(r1.resample, 'no');
  // an off-list value (shouldn't happen from the renderer, but must not corrupt the stream)
  const r2 = decodeValues(TREE, encodeValues(TREE, { resample: 'maybe', site_id: 'after' }));
  assert.equal(r2.resample, 'maybe');
  assert.equal(r2.site_id, 'after', 'stream stays aligned after a literal fallback');
});

test('positional: numbers — int via zigzag (negatives), float exact', () => {
  const t = { type: 'form', meta: {}, fields: [
    { name: 'i', fieldType: 'number', label: '', props: { int: true } },
    { name: 'f', fieldType: 'number', label: '', props: {} },
  ], choices: {} };
  for (const i of [0, 1, -1, 7, -2048, 1000000]) {
    assert.equal(decodeValues(t, encodeValues(t, { i, f: 0.5 })).i, i);
  }
  for (const f of [64.2, -0.000123, 3.141592653589793]) {
    assert.equal(decodeValues(t, encodeValues(t, { i: 0, f })).f, f, 'float64 round-trips exactly');
  }
});

test('positional: multiselect order preserved; empty multiselect', () => {
  assert.deepEqual(decodeValues(TREE, encodeValues(TREE, { hazards: ['gas', 'rockfall', 'water'] })).hazards, ['gas', 'rockfall', 'water']);
  assert.deepEqual(decodeValues(TREE, encodeValues(TREE, { hazards: [] })).hazards, []);
});
