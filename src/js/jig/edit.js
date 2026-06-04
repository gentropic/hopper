// jig tree edits — pure `tree -> tree` mutations the builder UI calls. There is
// NO separate "builder state": jig edits the canonical tree directly, so what you
// see is always the §8 contract (invariant §4.1). Every function returns a fresh
// tree (structuredClone); the input is never mutated.
//
// Plus `applyOverrides` — the §10 mechanism that makes seam answers (and manual
// tweaks) sparse and re-importable: infer a fresh tree from a changed table, then
// replay saved overrides; new columns append to the auto-form, removed columns'
// overrides are no-ops.

import { IDENT_RE } from './validate.js';

function cloneTree(tree) { return structuredClone(tree); }
function escRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\-]/g, '\\$&'); }

// Rewrite field references `from -> to` in a rule expression, touching `${from}`,
// bare-word `from`, and the leading segment of an aggregate path — but never
// inside string literals. Single tokenizing pass (mirrors rules/eval.js's lexer).
function rewriteRefs(expr, from, to) {
  if (typeof expr !== 'string' || !expr) return expr;
  let out = expr.replace(new RegExp('\\$\\{' + escRe(from) + '\\}', 'g'), '${' + to + '}');
  return out.replace(/("[^"]*")|(\$\{[^}]*\})|([A-Za-z_][A-Za-z0-9_-]*)/g,
    (m, str, tmpl, word) => (word === from ? to : m));
}

// Locate a field by name anywhere in the tree (incl. container children).
// Returns { field, siblings, index, parent } or null.
export function findField(tree, name) {
  let hit = null;
  (function walk(arr, parent) {
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      if (f.name === name) { hit = { field: f, siblings: arr, index: i, parent }; return; }
      if (Array.isArray(f.children)) { walk(f.children, f); if (hit) return; }
    }
  })(tree.fields || [], null);
  return hit;
}

function allNames(tree) {
  const out = new Set();
  (function walk(arr) { for (const f of arr) { out.add(f.name); if (Array.isArray(f.children)) walk(f.children); } })(tree.fields || []);
  return out;
}

function listInUse(tree, list) {
  let used = false;
  (function walk(arr) { for (const f of arr) { if (f.props && f.props.list === list) used = true; if (Array.isArray(f.children)) walk(f.children); } })(tree.fields || []);
  return used;
}

// Append a field. opts.parent = container name (else top level); opts.index = position.
export function addField(tree, field, opts = {}) {
  const t = cloneTree(tree);
  if (allNames(t).has(field.name)) throw new Error(`field "${field.name}" already exists`);
  if (!IDENT_RE.test(field.name)) throw new Error(`"${field.name}" is not a valid identifier`);
  const f = { props: {}, ...field };
  let arr = t.fields;
  if (opts.parent) {
    const p = findField(t, opts.parent);
    if (!p || !Array.isArray(p.field.children)) throw new Error(`no container "${opts.parent}"`);
    arr = p.field.children;
  }
  if (opts.index == null || opts.index >= arr.length) arr.push(f); else arr.splice(Math.max(0, opts.index), 0, f);
  return t;
}

// Remove a field (and, if a container, its subtree). Rules targeting it are dropped.
export function removeField(tree, name) {
  const t = cloneTree(tree);
  const loc = findField(t, name);
  if (!loc) return t;
  loc.siblings.splice(loc.index, 1);
  t.rules = (t.rules || []).filter((r) => r.target !== name);
  return t;
}

// Reorder a field within its current parent array.
export function moveField(tree, name, toIndex) {
  const t = cloneTree(tree);
  const loc = findField(t, name);
  if (!loc) return t;
  const [f] = loc.siblings.splice(loc.index, 1);
  const at = Math.max(0, Math.min(toIndex, loc.siblings.length));
  loc.siblings.splice(at, 0, f);
  return t;
}

// Shallow-merge props; a null/undefined value deletes that key.
export function setProps(tree, name, props) {
  const t = cloneTree(tree);
  const loc = findField(t, name);
  if (!loc) return t;
  loc.field.props = loc.field.props || {};
  for (const [k, v] of Object.entries(props)) { if (v == null) delete loc.field.props[k]; else loc.field.props[k] = v; }
  return t;
}

export function setLabel(tree, name, label) {
  const t = cloneTree(tree);
  const loc = findField(t, name);
  if (loc) loc.field.label = label;
  return t;
}

// Set a select-family field's choice list (the inline choices editor). Ensures
// props.list (defaults to the field name); empty choices delete the list.
export function setChoices(tree, name, choices) {
  const t = cloneTree(tree);
  const loc = findField(t, name);
  if (!loc) return t;
  loc.field.props = loc.field.props || {};
  const list = loc.field.props.list || name;
  loc.field.props.list = list;
  t.choices = t.choices || {};
  if (choices && choices.length) t.choices[list] = choices.map((o) => ({ ...o }));
  else delete t.choices[list];
  return t;
}

// Point a select-family field at a choice list (shared lists, XLSForm-style — many
// fields → one `choices` entry). A new list is seeded from the field's current
// options (so "new list" forks a private copy); the previous list is GC'd if no
// other field still uses it.
export function setFieldList(tree, name, listName) {
  if (!IDENT_RE.test(listName)) throw new Error(`"${listName}" is not a valid list name`);
  const t = cloneTree(tree);
  const loc = findField(t, name);
  if (!loc) return t;
  loc.field.props = loc.field.props || {};
  const old = loc.field.props.list;
  loc.field.props.list = listName;
  t.choices = t.choices || {};
  if (!t.choices[listName]) t.choices[listName] = (old && t.choices[old]) ? t.choices[old].map((o) => ({ ...o })) : [];
  if (old && old !== listName && !listInUse(t, old)) delete t.choices[old];
  return t;
}

// Upsert a rule. relevant/require/constrain/calculate/filter are 1-per-target
// (replaced in place); `show` is keyed by {verb,label}; otherwise appended.
export function setRule(tree, rule) {
  const t = cloneTree(tree);
  t.rules = t.rules || [];
  const i = t.rules.findIndex((r) => r.verb === rule.verb
    && (rule.verb === 'show' ? r.label === rule.label : r.target === rule.target));
  if (i >= 0) t.rules[i] = { ...rule }; else t.rules.push({ ...rule });
  return t;
}

export function removeRule(tree, verb, key) {
  const t = cloneTree(tree);
  t.rules = (t.rules || []).filter((r) => !(r.verb === verb && (verb === 'show' ? r.label === key : r.target === key)));
  return t;
}

// Rename a field and cascade the change through rule targets and rule-expr refs.
// Choices lists are NOT renamed (a list id is its own identifier).
export function renameField(tree, from, to) {
  if (!IDENT_RE.test(to)) throw new Error(`"${to}" is not a valid identifier`);
  const names = allNames(tree);
  if (!names.has(from)) throw new Error(`no field "${from}"`);
  if (from !== to && names.has(to)) throw new Error(`field "${to}" already exists`);
  const t = cloneTree(tree);
  const loc = findField(t, from);
  loc.field.name = to;
  for (const r of t.rules || []) {
    if (r.target === from) r.target = to;
    if (r.expr) r.expr = rewriteRefs(r.expr, from, to);
  }
  return t;
}

// Replay sparse overrides onto an (re-)inferred tree — the §10 "prior answers
// preserved across re-import". Recognized keys (all keyed by field name, all
// no-ops if the field is gone):
//   setType   {name: fieldType}   — e.g. seam select→text / number→text
//   labels    {name: label}
//   props     {name: {…}}          — sparse props merge (null deletes a key)
//   required  [name, …]            — props.required = true on each
//   identity  name                 — meta.identity (outbox display / dedup)
//   geoMerge  {lat, lng, into?, label?} — fuse two numeric columns into one geo
export function applyOverrides(tree, overrides = {}) {
  let t = cloneTree(tree);
  const has = (n) => !!findField(t, n);

  for (const [name, ft] of Object.entries(overrides.setType || {})) {
    if (!has(name)) continue;
    const loc = findField(t, name);
    const wasSelect = ['select', 'multiselect', 'rank'].includes(loc.field.fieldType);
    loc.field.fieldType = ft;
    if (wasSelect && !['select', 'multiselect', 'rank'].includes(ft)) {           // shed the now-orphan list
      const list = loc.field.props && loc.field.props.list;
      if (loc.field.props) delete loc.field.props.list;
      if (list && t.choices && t.choices[list]) delete t.choices[list];
    }
  }
  for (const [name, label] of Object.entries(overrides.labels || {})) if (has(name)) t = setLabel(t, name, label);
  for (const [name, p] of Object.entries(overrides.props || {})) if (has(name)) t = setProps(t, name, p);
  for (const name of overrides.required || []) if (has(name)) t = setProps(t, name, { required: true });

  if (overrides.identity && has(overrides.identity)) t.meta = { ...t.meta, identity: overrides.identity };

  if (overrides.geoMerge && has(overrides.geoMerge.lat) && has(overrides.geoMerge.lng)) {
    const { lat, lng, into = 'location', label = 'Location' } = overrides.geoMerge;
    const ll = findField(t, lat);
    ll.field.name = into; ll.field.fieldType = 'geo'; ll.field.label = label; ll.field.props = ll.field.props || {};
    t = removeField(t, lng);
  }

  // share-list: point several select fields at one shared choice list (XLSForm-style)
  for (const sl of overrides.shareList || []) {
    if (!sl || !sl.list) continue;
    for (const fname of sl.fields || []) if (findField(t, fname)) t = setFieldList(t, fname, sl.list);
  }

  // wide-format repeats: fold each spec's source columns into a repeat (applied
  // last so identity/required on the surviving top-level fields still resolve).
  for (const spec of overrides.repeats || []) {
    if (spec && (spec.sources || []).every((n) => findField(t, n))) t = groupIntoRepeat(t, spec);
  }
  return t;
}

// Fold a set of top-level fields into a new `repeat` container — jig's wide-format
// repeat seam (SPEC-hopper-jig §5). spec = { name, label, children:[fieldDef],
// childChoices:{list:opts}, sources:[name] }. Idempotent: a no-op if the sources
// are already gone (e.g. folded once). The records are not touched — this shapes
// the form definition only.
export function groupIntoRepeat(tree, spec) {
  const t = cloneTree(tree);
  const removed = new Set(spec.sources || []);
  const positions = [];
  t.fields.forEach((f, i) => { if (removed.has(f.name)) positions.push(i); });
  if (!positions.length) return t;
  const at = Math.min(...positions);
  for (const f of t.fields) if (removed.has(f.name) && f.props && f.props.list && t.choices) delete t.choices[f.props.list];
  t.fields = t.fields.filter((f) => !removed.has(f.name));
  t.choices = t.choices || {};
  for (const [list, opts] of Object.entries(spec.childChoices || {})) t.choices[list] = opts.map((o) => ({ ...o }));
  const node = { name: spec.name, fieldType: 'repeat', label: spec.label || spec.name, props: {},
    children: (spec.children || []).map((c) => ({ ...c, props: { ...(c.props || {}) } })) };
  t.fields.splice(Math.min(at, t.fields.length), 0, node);
  return t;
}
