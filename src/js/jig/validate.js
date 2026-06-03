// validateTree — the jig guardrail (SPEC-hopper-form §8, invariant §4.1). jig may
// only ever emit a contract-valid canonical tree, so every edit/inference result
// is checked here before it leaves the builder. Pure + DOM-free.
//
//   validateTree(tree) -> { ok, errors, warnings }
//
// errors block emission; warnings are advisory (orphan lists, refs that don't
// resolve to a field). Rule expressions are checked against the REAL parser
// (rules/eval.js parse/deps) — not a re-implementation — so a tree that validates
// here is one the engine can actually evaluate.

import { parse, deps } from '../rules/eval.js';

export const IDENT_RE = /^[a-z0-9_-]+$/;

const FIELD_TYPES = new Set([
  'text', 'number', 'range', 'select', 'multiselect', 'rank',
  'date', 'time', 'datetime', 'geo', 'geotrace', 'geoshape',
  'photo', 'audio', 'video', 'file', 'barcode', 'note', 'calc', 'hidden', 'ref',
  'group', 'repeat',
]);
const CONTAINER_TYPES = new Set(['group', 'repeat']);
const SELECT_TYPES = new Set(['select', 'multiselect', 'rank']);
const RULE_VERBS = new Set(['show', 'relevant', 'constrain', 'require', 'calculate', 'filter']);

// Walk fields (and container children), calling fn(field, parentName).
function walkFields(fields, fn, parent = null) {
  for (const f of fields || []) {
    fn(f, parent);
    if (Array.isArray(f.children)) walkFields(f.children, fn, f.name);
  }
}

export function validateTree(tree) {
  const errors = [], warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  if (!tree || typeof tree !== 'object' || tree.type !== 'form') {
    return { ok: false, errors: ['not a form tree (type !== "form")'], warnings };
  }
  if (!tree.meta || typeof tree.meta !== 'object') err('meta missing');
  else if (tree.meta.id != null && !IDENT_RE.test(tree.meta.id)) err(`meta.id "${tree.meta.id}" is not a valid identifier`);

  const choices = tree.choices || {};
  const names = new Set();
  const seen = new Set();
  const usedLists = new Set();

  walkFields(tree.fields, (f) => {
    if (typeof f.name !== 'string' || !IDENT_RE.test(f.name)) { err(`field name "${f.name}" is not [a-z0-9_-]+`); return; }
    if (seen.has(f.name)) err(`duplicate field name "${f.name}"`);
    seen.add(f.name);
    names.add(f.name);

    if (!FIELD_TYPES.has(f.fieldType)) err(`field "${f.name}" has unknown fieldType "${f.fieldType}"`);

    if (CONTAINER_TYPES.has(f.fieldType)) {
      if (!Array.isArray(f.children)) err(`container "${f.name}" must have a children array`);
    } else if (Array.isArray(f.children) && f.children.length) {
      err(`non-container "${f.name}" (${f.fieldType}) must not have children`);
    }

    if (SELECT_TYPES.has(f.fieldType)) {
      const list = f.props && f.props.list;
      if (!list) err(`${f.fieldType} "${f.name}" has no props.list`);
      else if (!choices[list]) err(`${f.fieldType} "${f.name}" references missing choices list "${list}"`);
      else usedLists.add(list);
    }
  });

  // choices structure + value charset
  for (const [list, opts] of Object.entries(choices)) {
    if (!Array.isArray(opts) || !opts.length) { err(`choices list "${list}" is empty`); continue; }
    for (const o of opts) {
      if (o == null || typeof o !== 'object' || o.value == null) err(`choices list "${list}" has an option without a value`);
      else if (!IDENT_RE.test(String(o.value))) err(`choice value "${o.value}" in "${list}" is not [a-z0-9_-]+`);
    }
    if (!usedLists.has(list)) warn(`choices list "${list}" is defined but unused`);
  }

  // rules: verb, target, parseable expr, resolvable refs
  for (const r of tree.rules || []) {
    if (!RULE_VERBS.has(r.verb)) { err(`rule has unknown verb "${r.verb}"`); continue; }
    if (r.verb === 'show') { if (r.label == null) warn('show rule has no label'); }
    else if (!r.target) err(`${r.verb} rule has no target`);
    else if (!names.has(r.target)) err(`${r.verb} rule targets unknown field "${r.target}"`);

    if (r.expr != null && r.expr !== '') {
      let ast;
      try { ast = parse(r.expr); }
      catch (e) { err(`${r.verb} ${r.target || r.label || ''}: expr does not parse — ${e.message}`); }
      if (ast) for (const d of deps(ast)) if (!names.has(d)) warn(`${r.verb} ${r.target || ''}: refs unknown field "${d}"`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}
