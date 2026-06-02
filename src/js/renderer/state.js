// The reactive form engine — SPEC-hopper-form §8 tree → live, reactive state.
// Pure (sideact signals, no DOM), so it's testable headlessly; the DOM layer
// (render.js) binds widgets to it via effects.
//
// Field values are signals. Rule results (relevance, validity, calc, show flags,
// aggregates) are evaluated on demand against a current-values snapshot —
// reading the signals, so any `effect`/`computed` that calls them auto-tracks
// the right dependencies (sideact does the dependency graph; deps() is for
// analysis, not needed here). Repeats hold an array of per-instance states;
// rules on repeat children evaluate per-instance (instance values over the flat
// top-level scope, §4.7).

// Namespace-import sideact so it works both as real ESM (node:test) and in the
// flat build (where it's namespace-wrapped to a `sideact` global). Destructure a
// name not used by any other flat-inlined module (build = one shared scope).
import * as sideact from '../../../vendor/sideact.js';
import { parse, evaluate } from '../rules/eval.js';
const { signal } = sideact;

const isEmptyVal = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);   // distinct name (flat build: one shared scope)
const MEDIA_TYPES = new Set(['photo', 'audio', 'video', 'file']);   // value is an attachment ref {blob,mime,bytes}, lives in `attachments` not `values` (§8)
const defaultOf = (node) => (node.props && 'default' in node.props ? node.props.default : null);
function tryParse(expr) { try { return parse(expr); } catch { return null; } }

export function createForm(tree) {
  const rules = (tree.rules || []).map((r) => ({ ...r, ast: tryParse(r.expr) })).filter((r) => r.ast);  // unparseable → degraded (skipped)
  const byTarget = (verb, target) => rules.filter((r) => r.verb === verb && r.target === target);
  const showRules = rules.filter((r) => r.verb === 'show');

  const flat = new Map();        // name -> { node, get, set }  (top-level + group fields)
  const repeats = new Map();     // name -> { node, items, setItems }
  const nodeByName = new Map();  // every field/container node by name

  function build(nodes, intoFlat) {
    const out = [];
    for (const node of nodes || []) {
      nodeByName.set(node.name, node);
      if (node.fieldType === 'group') {
        out.push({ kind: 'group', node, children: build(node.children, intoFlat) });
      } else if (node.fieldType === 'repeat') {
        const s = signal([]);
        const rs = { kind: 'repeat', node, items: s[0], setItems: s[1] };
        repeats.set(node.name, rs);
        for (const c of node.children || []) nodeByName.set(c.name, c);
        out.push(rs);
      } else {
        const s = signal(defaultOf(node));
        const fs = { kind: 'field', node, get: s[0], set: s[1] };
        if (intoFlat) flat.set(node.name, fs);
        out.push(fs);
      }
    }
    return out;
  }
  const roots = build(tree.fields, true);

  function makeInstance(repeatNode) {
    const children = new Map();
    for (const c of repeatNode.children || []) {
      const s = signal(defaultOf(c));
      children.set(c.name, { node: c, get: s[0], set: s[1] });
    }
    return { children };
  }

  // ---- value snapshots (read signals → tracked) ----
  function flatValues() {
    const o = {};
    for (const [name, fs] of flat) if (fs.node.fieldType !== 'calc' && !MEDIA_TYPES.has(fs.node.fieldType)) o[name] = fs.get();
    return o;
  }
  function repeatValues(name) {
    return repeats.get(name).items().map((inst) => {
      const o = {}; for (const [cn, cs] of inst.children) o[cn] = cs.get(); return o;
    });
  }
  function topSnapshot() {
    const o = flatValues();
    for (const name of repeats.keys()) o[name] = repeatValues(name);
    for (const [name, fs] of flat) if (fs.node.fieldType === 'calc') {   // single-level calc pass
      const r = byTarget('calculate', name)[0];
      o[name] = r ? evaluate(r.ast, o) : null;
    }
    return o;
  }
  function instScope(inst) {
    const o = flatValues();
    for (const [cn, cs] of inst.children) o[cn] = cs.get();
    return o;
  }
  const scopeFor = (inst) => (inst ? instScope(inst) : topSnapshot());

  // ---- reactive rule accessors (call inside an effect/computed to react) ----
  function isRelevant(name, inst) {
    const rs = byTarget('relevant', name);
    if (!rs.length) return true;
    const s = scopeFor(inst);
    return rs.every((r) => evaluate(r.ast, s) === true);
  }
  function validity(name, inst) {
    const node = nodeByName.get(name) || { props: {} };
    const s = scopeFor(inst);
    const blank = isEmptyVal(s[name]);
    const reqRule = byTarget('require', name)[0];
    const reqActive = node.props && (node.props.required === true || typeof node.props.required === 'string') || (reqRule && evaluate(reqRule.ast, s) === true);
    if (reqActive && blank) return { valid: false, message: (node.props && typeof node.props.required === 'string') ? node.props.required : 'Required' };
    const cRule = byTarget('constrain', name)[0];
    if (cRule && !blank && evaluate(cRule.ast, s) !== true) return { valid: false, message: cRule.message || 'Invalid value' };
    return { valid: true };
  }
  function calcValue(name, inst) {
    const r = byTarget('calculate', name)[0];
    return r ? evaluate(r.ast, scopeFor(inst)) : null;
  }
  function flags() {
    const s = topSnapshot();
    return showRules.map((r) => ({ label: r.label, on: evaluate(r.ast, s) === true }));
  }

  // ---- output: the §8/records values map (relevance-erased, §4.5) ----
  function values() {
    const o = topSnapshot();
    for (const [name] of flat) if (!isRelevant(name)) delete o[name];   // irrelevant ⇒ omitted
    return o;
  }
  // The §8 attachments map: relevant media fields with a captured blob, keyed by
  // field name → {blob, mime, bytes}. The blob bytes themselves are stored out of
  // band (store.saveBlob); a record only binds them by hash.
  function attachments() {
    const o = {};
    for (const [name, fs] of flat) {
      if (!MEDIA_TYPES.has(fs.node.fieldType) || !isRelevant(name)) continue;
      const v = fs.get();
      if (v && v.blob) o[name] = { blob: v.blob, mime: v.mime || null, bytes: v.bytes ?? null };
    }
    return o;
  }

  return {
    tree, roots, nodeByName,
    get: (name) => flat.get(name) && flat.get(name).get(),
    set: (name, v) => flat.get(name) && flat.get(name).set(v),
    repeat: (name) => {
      const rs = repeats.get(name);
      return {
        items: () => rs.items(),
        add: () => { const inst = makeInstance(rs.node); rs.setItems([...rs.items(), inst]); return inst; },
        remove: (i) => { const a = rs.items().slice(); a.splice(i, 1); rs.setItems(a); },
      };
    },
    repeatNames: () => [...repeats.keys()],
    isRelevant, validity, calcValue, flags, values, attachments,
  };
}
