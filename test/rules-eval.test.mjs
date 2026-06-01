import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fx = JSON.parse(readFileSync(new URL('./fixtures/rules-eval.json', import.meta.url), 'utf8'));

// The fixtures are the executable definition of SPEC-hopper-rules §3/§4. This
// guards their shape now; the eval assertions land with the evaluator port.
test('rules-eval fixtures are well-formed', () => {
  assert.ok(Array.isArray(fx.vectors) && fx.vectors.length > 0);
  for (const v of fx.vectors) {
    assert.equal(typeof v.expr, 'string', 'each vector has an expr');
    assert.ok(v.values && typeof v.values === 'object', `${v.expr}: has a values map`);
    assert.ok('expected' in v || 'expectedConstraintValid' in v, `${v.expr}: has an expectation`);
  }
});

// Pending: import src/js/rules/eval.js and assert each vector evaluates to its
// expectation (boolean expr → expected; constrain → expectedConstraintValid;
// calculate → expected value).
test.todo('evaluate fixtures against the rule evaluator (src/js/rules/eval.js)');
