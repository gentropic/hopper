// XLSForm ↔ §8 hierarchical tree converter (SPEC-hopper-form §9).
//
// Pure functions over SheetJS-shaped row objects (one object per row, keyed by
// header). Lib-agnostic — the collector feeds it SheetJS rows; a test feeds the
// same. No I/O here.
//
//   xlsformToTree({survey, choices, settings}) -> { tree, warnings }
//   treeToXlsform(tree)                         -> { survey, choices, settings, dropped }
//
// The expression bridge maps the COMMON subset of XLSForm restricted-XPath ↔ the
// symbolic rule language (SPEC-hopper-rules), syntactically. Because comparisons
// are now symbolic it is near-identity for relational operators (only `${F}`↔`F`
// and `.`↔self differ); `between`/`selected`/`regex`/presence/`count`/`sum` are
// the non-identity mappings. Recognized patterns convert; the rest pass through
// verbatim and are flagged. Ported from reference/hopper-xlsform.js.

const TYPE_IN = {
  text: { ft: 'text' }, integer: { ft: 'number', int: true }, decimal: { ft: 'number' }, range: { ft: 'range' },
  geopoint: { ft: 'geo' }, geotrace: { ft: 'geotrace' }, geoshape: { ft: 'geoshape' },
  image: { ft: 'photo' }, audio: { ft: 'audio' }, video: { ft: 'video' }, file: { ft: 'file' }, barcode: { ft: 'barcode' },
  date: { ft: 'date' }, time: { ft: 'time' }, dateTime: { ft: 'datetime' },
  note: { ft: 'note' }, calculate: { ft: 'calc' }, hidden: { ft: 'hidden' },
  select_one: { ft: 'select', sel: true }, select_multiple: { ft: 'multiselect', sel: true }, rank: { ft: 'rank', sel: true },
};
const TYPE_OUT = {
  text: 'text', range: 'range', geo: 'geopoint', geotrace: 'geotrace', geoshape: 'geoshape',
  photo: 'image', audio: 'audio', video: 'video', file: 'file', barcode: 'barcode',
  date: 'date', time: 'time', datetime: 'dateTime', note: 'note', calc: 'calculate', hidden: 'hidden',
  number: (f) => (f.props && f.props.int) ? 'integer' : 'decimal',
};
const SEL_OUT = { select: 'select_one', multiselect: 'select_multiple', rank: 'rank' };

// ---- expression bridge (symbolic) --------------------------------------------

// XLSForm operand → rule operand: 'V'/"V" → "V"; ${G} → G; number stays.
function operandIn(v) {
  v = String(v).trim();
  const q = v.match(/^'([^']*)'$/) || v.match(/^"([^"]*)"$/);
  if (q) return `"${q[1]}"`;
  const f = v.match(/^\$\{(\w+)\}$/);
  if (f) return f[1];
  return v;
}
// rule operand → XLSForm operand: "V" → 'V'; field ident → ${ident}; number stays.
function operandOut(v) {
  v = String(v).trim();
  const q = v.match(/^"([^"]*)"$/);
  if (q) return `'${q[1]}'`;
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  if (/^[a-z_]\w*$/.test(v)) return `\${${v}}`;
  return v;
}

// XLSForm XPath → rule expr. `self` is the field the expr is attached to (for `.`).
export function xpathToSoft(x, self) {
  x = String(x).trim();
  let m;
  if ((m = x.match(/^\.\s*>=\s*(\S+)\s+and\s+\.\s*<=\s*(\S+)$/)))
    return { soft: `${self} between ${operandIn(m[1])} and ${operandIn(m[2])}`, ok: true };
  if ((m = x.match(/^\$\{(\w+)\}\s*>=\s*(\S+)\s+and\s+\$\{\1\}\s*<=\s*(\S+)$/)))
    return { soft: `${m[1]} between ${operandIn(m[2])} and ${operandIn(m[3])}`, ok: true };
  if ((m = x.match(/^selected\(\s*\$\{(\w+)\}\s*,\s*['"]([^'"]*)['"]\s*\)$/)))
    return { soft: `${m[1]} contains "${m[2]}"`, ok: true };
  if ((m = x.match(/^regex\(\s*\$\{(\w+)\}\s*,\s*['"]([^'"]*)['"]\s*\)$/)))
    return { soft: `${m[1]} matches "${m[2]}"`, ok: true };
  if ((m = x.match(/^\$\{(\w+)\}\s*!=\s*['"]['"]$/))) return { soft: `${m[1]} is filled`, ok: true };
  if ((m = x.match(/^\$\{(\w+)\}\s*=\s*['"]['"]$/))) return { soft: `${m[1]} is blank`, ok: true };
  if ((m = x.match(/^count\(\s*\$\{(\w+)\}\s*\)$/))) return { soft: `count(${m[1]})`, ok: true };
  if ((m = x.match(/^sum\(\s*\$\{(\w+)\}\/(\w+)\s*\)$/))) return { soft: `total(${m[1]}.${m[2]})`, ok: true };
  if ((m = x.match(/^(\$\{(\w+)\}|\.)\s*(>=|<=|!=|=|>|<)\s*('[^']*'|"[^"]*"|\S+)$/))) {
    const ref = m[1] === '.' ? self : m[2];
    return { soft: `${ref} ${m[3]} ${operandIn(m[4])}`, ok: true };
  }
  return { soft: x, ok: false };   // passthrough, flagged
}

// rule expr → XLSForm XPath. `self` becomes `.` when the ref is the attached field.
export function softToXpath(s, self) {
  s = String(s).trim();
  let m;
  if ((m = s.match(/^(\w+)\s+between\s+(\S+)\s+and\s+(\S+)$/))) {
    const ref = m[1] === self ? '.' : `\${${m[1]}}`;
    return { xpath: `${ref} >= ${operandOut(m[2])} and ${ref} <= ${operandOut(m[3])}`, ok: true };
  }
  if ((m = s.match(/^(\w+)\s+contains\s+("[^"]*"|\S+)$/)))
    return { xpath: `selected(\${${m[1]}}, ${operandOut(m[2])})`, ok: true };
  if ((m = s.match(/^(\w+)\s+matches\s+("[^"]*")$/)))
    return { xpath: `regex(\${${m[1]}}, ${operandOut(m[2])})`, ok: true };
  if ((m = s.match(/^(\w+)\s+is\s+filled$/))) return { xpath: `\${${m[1]}} != ''`, ok: true };
  if ((m = s.match(/^(\w+)\s+is\s+blank$/))) return { xpath: `\${${m[1]}} = ''`, ok: true };
  if ((m = s.match(/^count\((\w+)\)$/))) return { xpath: `count(\${${m[1]}})`, ok: true };
  if ((m = s.match(/^total\((\w+)\.(\w+)\)$/))) return { xpath: `sum(\${${m[1]}}/${m[2]})`, ok: true };
  if ((m = s.match(/^(\w+)\s*(>=|<=|!=|=|>|<)\s*("[^"]*"|\S+)$/))) {
    const ref = m[1] === self ? '.' : `\${${m[1]}}`;
    return { xpath: `${ref} ${m[2]} ${operandOut(m[3])}`, ok: true };
  }
  return { xpath: s, ok: false };
}

// ---- XLSForm → tree ----------------------------------------------------------

export function xlsformToTree({ survey = [], choices = [], settings = [] } = {}) {
  const warnings = [];
  const set = settings[0] || {};
  const meta = {
    id: set.form_id || 'form',
    title: set.form_title || set.form_id || 'Form',
    version: set.version != null ? String(set.version) : '',
    lang: set.default_language || 'en',
    mode: 'append',
    tiers: { store: 'idb', durable: 'comment' },
  };
  const fields = [], rules = [];
  const stack = [];                                   // open group/repeat containers
  const cur = () => (stack.length ? stack[stack.length - 1].children : fields);

  const bridgeInto = (verb, name, raw, extra) => {
    const b = xpathToSoft(raw, name);
    rules.push({ verb, target: name, expr: b.soft, ...extra });
    if (!b.ok) warnings.push(`${verb} passthrough @ ${name}: ${raw}`);
  };

  for (const r of survey) {
    const t = String(r.type || '').trim();
    if (!t) continue;
    const norm = t.toLowerCase().replace(/\s+/g, '_');

    if (norm === 'begin_group' || norm === 'begin_repeat') {
      const node = {
        name: r.name || `_${norm}`, fieldType: norm === 'begin_group' ? 'group' : 'repeat',
        label: r.label || r.name || '', props: {}, children: [],
      };
      if (r.appearance) node.props.appearance = r.appearance;
      if (r.relevant) bridgeInto('relevant', node.name, r.relevant);
      cur().push(node);
      stack.push(node);
      continue;
    }
    if (norm === 'end_group' || norm === 'end_repeat') { stack.pop(); continue; }

    const sp = t.split(/\s+/), base = sp[0], list = sp[1];
    const map = TYPE_IN[base];
    if (!map) { warnings.push(`unknown type "${t}" @ ${r.name || '?'} — skipped`); continue; }

    const f = { name: r.name, fieldType: map.ft, label: r.label || r.name, props: {} };
    if (map.int) f.props.int = true;
    if (map.sel && list) f.props.list = list;
    const reqStr = String(r.required == null ? '' : r.required).trim().toLowerCase();
    if (reqStr === 'yes' || r.required === true) f.props.required = true;
    else if (reqStr && reqStr !== 'no' && reqStr !== 'false') bridgeInto('require', r.name, r.required);  // dynamic
    if (r.appearance) f.props.appearance = r.appearance;
    if (r.parameters) for (const kv of String(r.parameters).split(/\s+/)) {
      const i = kv.indexOf('='); if (i < 0) continue;
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      f.props[k] = (v !== '' && isFinite(+v)) ? +v : v;
    }
    cur().push(f);

    if (r.relevant) bridgeInto('relevant', r.name, r.relevant);
    if (r.constraint) bridgeInto('constrain', r.name, r.constraint, r.constraint_message ? { message: r.constraint_message } : undefined);
    if (r.calculation) bridgeInto('calculate', r.name, r.calculation);
  }
  if (stack.length) warnings.push(`${stack.length} unclosed group/repeat — auto-closed`);

  const ch = {};
  for (const r of choices) {
    const ln = r.list_name; if (!ln) continue;
    (ch[ln] = ch[ln] || []).push({ value: String(r.name), label: String(r.label != null ? r.label : r.name) });
  }
  return { tree: { type: 'form', meta, fields, choices: ch, rules, views: [] }, warnings };
}

// ---- tree → XLSForm ----------------------------------------------------------

export function treeToXlsform(tree) {
  const m = tree.meta || {};
  const settings = [{ form_title: m.title, form_id: m.id, version: m.version, default_language: m.lang }];
  const relevant = {}, constraint = {}, cmsg = {}, calc = {}, required = {}, dropped = [];
  for (const r of tree.rules || []) {
    if (r.verb === 'relevant') relevant[r.target] = softToXpath(r.expr, r.target).xpath;
    else if (r.verb === 'constrain') { constraint[r.target] = softToXpath(r.expr, r.target).xpath; if (r.message) cmsg[r.target] = r.message; }
    else if (r.verb === 'calculate') calc[r.target] = softToXpath(r.expr, r.target).xpath;
    else if (r.verb === 'require') required[r.target] = softToXpath(r.expr, r.target).xpath;
    else if (r.verb === 'show') dropped.push(`show "${r.label}" — no XLSForm column (Hopper-only flag; hopper:: carry deferred)`);
    else if (r.verb === 'filter') dropped.push(`filter @ ${r.target} — choice_filter not emitted in v1`);
  }

  const survey = [];
  const emit = (nodes) => {
    for (const f of nodes || []) {
      if (f.fieldType === 'group' || f.fieldType === 'repeat') {
        const kw = f.fieldType === 'group' ? 'group' : 'repeat';
        survey.push({ type: `begin_${kw}`, name: f.name, label: f.label || f.name, relevant: relevant[f.name] || '' });
        emit(f.children);
        survey.push({ type: `end_${kw}`, name: f.name });
        continue;
      }
      const p = f.props || {};
      let type;
      if (SEL_OUT[f.fieldType]) type = `${SEL_OUT[f.fieldType]} ${p.list || ''}`.trim();
      else { const o = TYPE_OUT[f.fieldType]; type = (typeof o === 'function') ? o(f) : (o || 'text'); }
      const params = [];
      if (p['capture-accuracy'] != null) params.push(`capture-accuracy=${p['capture-accuracy']}`);
      survey.push({
        type, name: f.name, label: f.label || f.name,
        required: required[f.name] || (p.required ? 'yes' : ''),
        relevant: relevant[f.name] || '',
        constraint: constraint[f.name] || '',
        constraint_message: cmsg[f.name] || '',
        calculation: calc[f.name] || '',
        appearance: p.appearance || '',
        parameters: params.join(' '),
      });
    }
  };
  emit(tree.fields);

  const choices = [];
  for (const [ln, opts] of Object.entries(tree.choices || {})) for (const o of opts) choices.push({ list_name: ln, name: o.value, label: o.label });
  return { survey, choices, settings, dropped };
}
