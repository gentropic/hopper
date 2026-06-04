import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, parse, deps } from '../src/js/rules/eval.js';

const E = (expr, v = {}) => evaluate(expr, v);

test('if() — conditional, total (blank cond → else)', () => {
  assert.equal(E('if(fe_pct >= 50, "high", "low")', { fe_pct: 58 }), 'high');
  assert.equal(E('if(fe_pct >= 50, "high", "low")', { fe_pct: 41 }), 'low');
  assert.equal(E('if(missing, 1, 2)', {}), 2);                 // blank/absent cond is not true → else
  assert.equal(E('if(a > 0, a * 10, 0)', { a: 3 }), 30);       // arithmetic branches
});

test('round / int / abs', () => {
  assert.equal(E('round(x, 1)', { x: 57.666 }), 57.7);
  assert.equal(E('round(x)', { x: 57.6 }), 58);
  assert.equal(E('round(x, -1)', { x: 53 }), 50);              // negative places → tens
  assert.equal(E('int(x)', { x: 57.9 }), 57);
  assert.equal(E('abs(x)', { x: -3.5 }), 3.5);
});

test('year / month / day — from an ISO date or datetime string', () => {
  assert.equal(E('year(d)', { d: '2026-06-04' }), 2026);
  assert.equal(E('month(d)', { d: '2026-06-04' }), 6);
  assert.equal(E('day(d)', { d: '2026-06-04T09:30:00' }), 4); // datetime tolerated
  assert.equal(E('month(d)', { d: '' }), null);                // blank → blank
  assert.equal(E('year(d)', { d: 'not a date' }), null);       // unparseable → blank
});

test('totality — bad input yields blank, never throws', () => {
  assert.equal(E('round(x)', { x: 'abc' }), null);
  assert.equal(E('int(x)', {}), null);
  assert.equal(E('abs(x)', { x: [] }), null);
  assert.doesNotThrow(() => E('if(a, round(b, day(c)), abs(d))', {}));
});

test('arity is checked at parse time', () => {
  assert.throws(() => parse('if(a, b)'), /if\(\) expects 3/);
  assert.throws(() => parse('round(a, b, c)'), /round/);
  assert.throws(() => parse('int()'), /int/);
});

test('functions compose with aggregates + the rest of the calculus', () => {
  assert.equal(E('round(mean(s.g), 1)', { s: [{ g: 1 }, { g: 2 }, { g: 4 }] }), 2.3);
  assert.equal(E('if(count(s) > 2, "many", "few")', { s: [{}, {}, {}] }), 'many');
});

test('deps sees field refs inside function args (reactive wiring)', () => {
  assert.deepEqual(deps('if(a > 0, round(b, 1), c)').sort(), ['a', 'b', 'c']);
  assert.deepEqual(deps('month(sampled)'), ['sampled']);
});
