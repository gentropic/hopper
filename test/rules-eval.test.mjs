import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse, evaluate, evalBool, constraintValid, deps } from '../src/js/rules/eval.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/rules-eval.json', import.meta.url), 'utf8'));

// The fixtures are the executable definition of SPEC-hopper-rules §3/§4.
test('rules-eval vectors evaluate as specified', () => {
  for (const v of fx.vectors) {
    if (v.verb === 'constrain') {
      assert.equal(constraintValid(v.expr, v.values, v.target), v.expectedConstraintValid, v.expr);
    } else if (v.verb === 'calculate') {
      assert.equal(evaluate(v.expr, v.values), v.expected, v.expr);          // null = blank
    } else {
      assert.equal(evalBool(v.expr, v.values), v.expected, v.expr);          // relevant/show/default
    }
  }
});

test('totality — bad syntax throws at parse, bad math never throws at eval', () => {
  assert.throws(() => parse('fe_pct >'), /parse error/);
  assert.throws(() => parse('fe_pct between 0 100'), /expected 'and'/);
  assert.throws(() => parse('a and and b'), /parse error/);
  // eval is total: a divide-by-zero / blank operand yields blank, never throws
  assert.equal(evaluate('1 / 0', {}), null);
  assert.equal(evaluate('missing + 1', {}), null);
  assert.equal(evalBool('missing > 5', {}), false);
});

test('deps — free field references for the reactive DAG', () => {
  assert.deepEqual(deps('fe_pct between 0 and 100').sort(), ['fe_pct']);
  assert.deepEqual(deps('fe_pct > 60 and lithology = "itabirite"').sort(), ['fe_pct', 'lithology']);
  assert.deepEqual(deps('(a + b) * 2').sort(), ['a', 'b']);
  assert.deepEqual(deps('site_id is filled').sort(), ['site_id']);
  assert.deepEqual(deps('total(samples.fe_pct)').sort(), ['samples']);    // agg depends on the repeat
  assert.deepEqual(deps('count(samples) > min_n').sort(), ['min_n', 'samples']);
});
