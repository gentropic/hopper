// Form sources — load a Hopper form tree (SPEC-hopper-form §8) from file text.
// Canonical source formats: `@gcu/yaml` (human source) and JSON (the tree is
// JSON). XLSForm (.xlsx via SheetJS) is a separate, heavier source — added later.
//
// Note: namespace-import `@gcu/yaml` and call `yaml.parse` — do NOT destructure
// `parse`, which collides with rules/eval.js's `parse` in the flat build.

import * as yaml from '../../../vendor/yaml.js';

// @gcu/yaml AST → plain data (scalars/maps/seqs).
function astToData(n) {
  if (n == null) return null;
  if (n.kind === 'scalar') return n.value;
  if (n.kind === 'map') { const o = {}; for (const e of n.entries) o[astToData(e.key)] = astToData(e.value); return o; }
  if (n.kind === 'seq') return n.items.map(astToData);
  return null;
}

function assertForm(tree) {
  if (!tree || tree.type !== 'form' || !Array.isArray(tree.fields)) {
    throw new Error('not a Hopper form (expected type: "form" with a fields array)');
  }
  return tree;
}

export function loadFormText(text, kind) {
  const tree = kind === 'json' ? JSON.parse(text) : astToData(yaml.parse(text));
  return assertForm(tree);
}

// Pick the parser from the filename extension (.json → JSON, else @gcu/yaml).
export function loadFormByName(name, text) {
  return loadFormText(text, /\.json$/i.test(name || '') ? 'json' : 'yaml');
}

// No filename to dispatch on (e.g. a resolved capsule's bytes): sniff the
// serialization. JSON is the wire/machine form (a tree is JSON), so a leading
// `{`/`[` → JSON; otherwise the human `@gcu/yaml` source. assertForm gives a
// clear error if neither yields a §8 form.
export function loadFormFromText(text) {
  const t = String(text).trim();
  return loadFormText(t, t[0] === '{' || t[0] === '[' ? 'json' : 'yaml');
}
