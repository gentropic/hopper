// tree → `@gcu/yaml` source — the inverse of load.js's astToData. The library emits
// from a typed AST, not plain data, so we build the AST: `dataToAst` tags each JS
// value by its RUNTIME type. Strings become `string` scalars, which emit
// double-quoted by default — so the strict no-implicit-typing contract holds:
// `"no"`, `"2026-06-01"`, `"007"` round-trip as strings, never coerced. Identifier
// keys emit bare (isBareKey), so output matches the §8 house style (bare keys,
// quoted values). Gated by emit→parse round-trip vectors (test/yamlemit.test.mjs).
//
// Namespace-import @gcu/yaml — the flat build binds the `yaml` global from the
// target manifest (do NOT destructure; `parse` collides with rules/eval.js).

import * as yaml from '../../../vendor/yaml.js';

// JS value → @gcu/yaml AST node. Type tags must match the emitter's vocabulary
// ('null' | 'bool' | 'int' | 'float' | 'string').
function dataToAst(v) {
  if (v === null || v === undefined) return yaml.scalar('null', null);
  const t = typeof v;
  if (t === 'boolean') return yaml.scalar('bool', v);
  if (t === 'number') return yaml.scalar(Number.isInteger(v) ? 'int' : 'float', v);
  if (t === 'string') return yaml.scalar('string', v);
  if (Array.isArray(v)) return yaml.seqNode(v.map(dataToAst));
  if (t === 'object') {
    const entries = [];
    for (const [k, val] of Object.entries(v)) {
      if (val === undefined) continue;                 // parity with JSON.stringify
      entries.push({ key: yaml.scalar('string', String(k)), value: dataToAst(val) });
    }
    return yaml.mapNode(entries);
  }
  return yaml.scalar('string', String(v));
}

// A §8 tree (or any JSON-shaped value that's a map/seq at the top) → YAML text.
export function treeToYaml(tree) {
  return yaml.emit(dataToAst(tree));
}
