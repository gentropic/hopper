import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize } from '../src/js/records/jcs.js';

test('JCS — recursive key sorting (UTF-16 order), array order preserved', () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
  assert.equal(canonicalize({ z: { y: 1, x: 2 }, a: [3, 1, 2] }), '{"a":[3,1,2],"z":{"x":2,"y":1}}');
  assert.equal(canonicalize({}), '{}');
  assert.equal(canonicalize([]), '[]');
});

test('JCS — minimal string escaping; non-ASCII stays raw', () => {
  assert.equal(canonicalize('a"b\\c\n'), '"a\\"b\\\\c\\n"');
  assert.equal(canonicalize('café'), '"café"');        // not escaped
  assert.equal(canonicalize('a/b'), '"a/b"');          // solidus not escaped
});

test('JCS — ECMAScript number serialization (RFC 8785 number cases)', () => {
  assert.equal(canonicalize(64.2), '64.2');
  assert.equal(canonicalize(100), '100');
  assert.equal(canonicalize(0), '0');
  assert.equal(canonicalize(-0), '0');
  assert.equal(canonicalize(1e21), '1e+21');
  assert.equal(canonicalize(1e-7), '1e-7');
  assert.equal(canonicalize(0.002), '0.002');
  assert.equal(canonicalize(333333333.33333329), '333333333.3333333');
});

test('JCS — drops undefined members; rejects non-finite numbers', () => {
  assert.equal(canonicalize({ a: 1, b: undefined, c: 3 }), '{"a":1,"c":3}');
  assert.throws(() => canonicalize(NaN), /non-finite/);
  assert.throws(() => canonicalize(Infinity), /non-finite/);
});

test('JCS — whitespace-independence: same data, different layout, same bytes', () => {
  const a = JSON.parse('{"x":1,  "y":[2,3]}');
  const b = JSON.parse('{ "y" : [2,3] , "x" : 1 }');
  assert.equal(canonicalize(a), canonicalize(b));      // the property signing relies on
});
