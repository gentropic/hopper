import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { inferTree } from '../src/js/jig/infer.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const { cases } = JSON.parse(readFileSync(resolve(HERE, 'fixtures/jig-infer.json'), 'utf8'));

for (const c of cases) {
  test(`infer — ${c.name}`, () => {
    const { tree, warnings, seams } = inferTree(c.rows);
    const byName = Object.fromEntries(tree.fields.map((f) => [f.name, f]));
    const seamTypes = seams.map((s) => s.type);

    // field order + type
    assert.deepEqual(tree.fields.map((f) => f.name), c.expectFields.map((f) => f.name), 'field names/order');
    for (const ef of c.expectFields) {
      const f = byName[ef.name];
      assert.ok(f, `field ${ef.name} present`);
      assert.equal(f.fieldType, ef.fieldType, `${ef.name} fieldType`);
      if (ef.label) assert.equal(f.label, ef.label, `${ef.name} label`);
      if (ef.list) assert.equal(f.props.list, ef.list, `${ef.name} props.list`);
      if (ef.int) assert.equal(f.props.int, true, `${ef.name} props.int`);
    }

    if (c.expectChoices) for (const [list, vals] of Object.entries(c.expectChoices)) {
      assert.ok(tree.choices[list], `choices[${list}] present`);
      assert.deepEqual(tree.choices[list].map((o) => o.label), vals, `choices[${list}] labels`);
    }

    for (const t of c.expectSeams || []) assert.ok(seamTypes.includes(t), `seam "${t}" surfaced`);
    for (const t of c.expectNoSeams || []) assert.ok(!seamTypes.includes(t), `seam "${t}" NOT surfaced`);

    if (c.expectIdentity) {
      const id = seams.find((s) => s.type === 'identity');
      assert.ok(id, 'identity seam present');
      assert.equal(id.recommend, c.expectIdentity, 'identity recommendation');
    }
    if (c.expectSeamRecommend) for (const [t, rec] of Object.entries(c.expectSeamRecommend)) {
      const s = seams.find((x) => x.type === t);
      assert.ok(s, `seam ${t} present`);
      assert.equal(s.recommend, rec, `seam ${t} recommend`);
    }
    if (c.expectRepeat) {
      const r = seams.find((s) => s.type === 'repeat');
      assert.ok(r, 'repeat seam present');
      assert.equal(r.field, c.expectRepeat.name, 'repeat name');
      assert.deepEqual(r.members.slice().sort(), c.expectRepeat.members.slice().sort(), 'repeat members');
      if (c.expectRepeat.childTypes) {
        const types = Object.fromEntries(r.spec.children.map((ch) => [ch.name, ch.fieldType]));
        for (const [n, t] of Object.entries(c.expectRepeat.childTypes)) assert.equal(types[n], t, `child ${n} type`);
      }
    }
    if (c.expectWarningMatch) assert.ok(warnings.some((w) => w.includes(c.expectWarningMatch)),
      `warning matching "${c.expectWarningMatch}"`);
  });
}

test('infer — meta shape and id slugging', () => {
  const { tree } = inferTree([{ A: '1' }], { title: 'QF Sample Log' });
  assert.equal(tree.type, 'form');
  assert.equal(tree.meta.title, 'QF Sample Log');
  assert.equal(tree.meta.id, 'qf_sample_log');
  assert.equal(tree.meta.mode, 'append');
  assert.deepEqual(tree.rules, []);
});
