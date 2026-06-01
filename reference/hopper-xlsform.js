// @gcu/hopper-xlsform — XLSForm <-> §8 tree converter (SPEC-hopper §9).
//
// Pure functions over row-objects shaped like SheetJS's sheet_to_json output
// (one object per row, keyed by header). Lib-agnostic: the browser feeds it
// SheetJS rows, a test feeds it the same. No I/O here.
//
//   xlsformToTree({survey, choices, settings}) -> { tree, warnings }
//   treeToXlsform(tree)                         -> { survey, choices, settings, dropped }
//
// The expression bridge maps the COMMON subset of XLSForm restricted-XPath
// <-> restricted-soft, syntactically. It is independent of the soft-vs-AIR
// runtime decision: this is string<->string, not evaluation. Unrecognized
// expressions pass through verbatim and are flagged.

const TYPE_IN = {
  text:{ft:'text'}, integer:{ft:'number',int:true}, decimal:{ft:'number'}, range:{ft:'range'},
  geopoint:{ft:'geo'}, geotrace:{ft:'geotrace'}, geoshape:{ft:'geoshape'},
  image:{ft:'photo'}, audio:{ft:'audio'}, video:{ft:'video'}, file:{ft:'file'}, barcode:{ft:'barcode'},
  date:{ft:'date'}, time:{ft:'time'}, dateTime:{ft:'datetime'},
  note:{ft:'note'}, calculate:{ft:'calc'}, hidden:{ft:'hidden'},
  select_one:{ft:'select',sel:true}, select_multiple:{ft:'multiselect',sel:true}, rank:{ft:'rank',sel:true},
};
const TYPE_OUT = {
  text:'text', range:'range', geo:'geopoint', geotrace:'geotrace', geoshape:'geoshape',
  photo:'image', audio:'audio', video:'video', file:'file', barcode:'barcode',
  date:'date', time:'time', datetime:'dateTime', note:'note', calc:'calculate', hidden:'hidden',
  number:(f)=> (f.props&&f.props.int) ? 'integer' : 'decimal',
};
const SEL_OUT = { select:'select_one', multiselect:'select_multiple', rank:'rank' };

// ---- expression bridge -------------------------------------------------

// XLSForm XPath -> soft. `self` is the field the expr is attached to (for `.`).
function xpathToSoft(x, self){
  x = String(x).trim();
  let m;
  // `. >= A and . <= B`  (self, inclusive)  -> `<self> between A and B`
  if ((m = x.match(/^\.\s*>=\s*(\S+)\s+and\s+\.\s*<=\s*(\S+)$/)))
    return { soft:`${self} between ${m[1]} and ${m[2]}`, ok:true };
  // `${F} >= A and ${F} <= B`
  if ((m = x.match(/^\$\{(\w+)\}\s*>=\s*(\S+)\s+and\s+\$\{\1\}\s*<=\s*(\S+)$/)))
    return { soft:`${m[1]} between ${m[2]} and ${m[3]}`, ok:true };
  // `${F} = 'V'`  /  `${F} = "V"`
  if ((m = x.match(/^\$\{(\w+)\}\s*=\s*['"]([^'"]*)['"]$/)))
    return { soft:`${m[1]} equals "${m[2]}"`, ok:true };
  // selected(${F}, 'V')
  if ((m = x.match(/^selected\(\s*\$\{(\w+)\}\s*,\s*['"]([^'"]*)['"]\s*\)$/)))
    return { soft:`${m[1]} contains "${m[2]}"`, ok:true };
  // `${F} > N` / `. > N`
  if ((m = x.match(/^\$\{(\w+)\}\s*>\s*(\S+)$/))) return { soft:`${m[1]} is above ${m[2]}`, ok:true };
  if ((m = x.match(/^\.\s*>\s*(\S+)$/)))          return { soft:`${self} is above ${m[1]}`, ok:true };
  if ((m = x.match(/^\$\{(\w+)\}\s*<\s*(\S+)$/))) return { soft:`${m[1]} is below ${m[2]}`, ok:true };
  if ((m = x.match(/^\.\s*<\s*(\S+)$/)))          return { soft:`${self} is below ${m[1]}`, ok:true };
  return { soft:x, ok:false };  // passthrough, flagged
}

// soft -> XLSForm XPath. `self` becomes `.` when the ref is the attached field.
function softToXpath(s, self){
  s = String(s).trim();
  let m;
  if ((m = s.match(/^(\w+)\s+between\s+(\S+)\s+and\s+(\S+)$/))){
    const ref = m[1]===self ? '.' : `\${${m[1]}}`;
    return { xpath:`${ref} >= ${m[2]} and ${ref} <= ${m[3]}`, ok:true };
  }
  if ((m = s.match(/^(\w+)\s+equals\s+"?([^"]*)"?$/)))
    return { xpath:`\${${m[1]}} = '${m[2]}'`, ok:true };
  if ((m = s.match(/^(\w+)\s+contains\s+"?([^"]*)"?$/)))
    return { xpath:`selected(\${${m[1]}}, '${m[2]}')`, ok:true };
  if ((m = s.match(/^(\w+)\s+is\s+above\s+(\S+)$/))){
    const ref = m[1]===self ? '.' : `\${${m[1]}}`; return { xpath:`${ref} > ${m[2]}`, ok:true };
  }
  if ((m = s.match(/^(\w+)\s+is\s+below\s+(\S+)$/))){
    const ref = m[1]===self ? '.' : `\${${m[1]}}`; return { xpath:`${ref} < ${m[2]}`, ok:true };
  }
  return { xpath:s, ok:false };
}

// ---- XLSForm -> tree ---------------------------------------------------

function xlsformToTree({ survey = [], choices = [], settings = [] }){
  const warnings = [];
  const set = settings[0] || {};
  const meta = {
    id: set.form_id || 'form',
    title: set.form_title || set.form_id || 'Form',
    version: set.version != null ? String(set.version) : '',
    lang: set.default_language || 'en',
    mode: 'append',
    tiers: { store:'idb', durable:'comment' },
  };
  const fields = [], rules = [];
  for (const r of survey){
    const t = String(r.type || '').trim();
    if (!t) continue;
    const sp = t.split(/\s+/), base = sp[0], list = sp[1];
    const map = TYPE_IN[base];
    if (!map){ warnings.push(`unknown type "${t}" @ ${r.name||'?'} — skipped`); continue; }
    if (/^(begin|end)(_group|_repeat|\s)/.test(t)){ warnings.push(`groups/repeats deferred @ ${r.name} — skipped`); continue; }
    const f = { name:r.name, fieldType:map.ft, label:r.label || r.name, props:{} };
    if (map.int) f.props.int = true;
    if (map.sel && list) f.props.list = list;
    if (String(r.required).toLowerCase() === 'yes' || r.required === true) f.props.required = true;
    if (r.appearance) f.props.appearance = r.appearance;
    if (r.parameters) for (const kv of String(r.parameters).split(/\s+/)){
      const i = kv.indexOf('='); if (i < 0) continue;
      const k = kv.slice(0,i), v = kv.slice(i+1);
      f.props[k] = (v !== '' && isFinite(+v)) ? +v : v;
    }
    fields.push(f);
    if (r.relevant){ const b = xpathToSoft(r.relevant, r.name); rules.push({ verb:'relevant', target:r.name, expr:b.soft }); if(!b.ok) warnings.push(`relevant passthrough @ ${r.name}: ${r.relevant}`); }
    if (r.constraint){ const b = xpathToSoft(r.constraint, r.name); const rule = { verb:'constrain', target:r.name, expr:b.soft }; if (r.constraint_message) rule.message = r.constraint_message; rules.push(rule); if(!b.ok) warnings.push(`constraint passthrough @ ${r.name}: ${r.constraint}`); }
    if (r.calculation){ const b = xpathToSoft(r.calculation, r.name); rules.push({ verb:'calculate', target:r.name, expr:b.soft }); if(!b.ok) warnings.push(`calculation passthrough @ ${r.name}`); }
  }
  const ch = {};
  for (const r of choices){
    const ln = r.list_name; if (!ln) continue;
    (ch[ln] = ch[ln] || []).push({ value:String(r.name), label:String(r.label != null ? r.label : r.name) });
  }
  return { tree:{ type:'form', meta, fields, choices:ch, rules, views:[] }, warnings };
}

// ---- tree -> XLSForm ---------------------------------------------------

function treeToXlsform(tree){
  const m = tree.meta || {};
  const settings = [{ form_title:m.title, form_id:m.id, version:m.version, default_language:m.lang }];
  const relevant = {}, constraint = {}, cmsg = {}, calc = {}, dropped = [];
  for (const r of tree.rules || []){
    if (r.verb === 'relevant')      relevant[r.target]   = softToXpath(r.expr, r.target).xpath;
    else if (r.verb === 'constrain'){ constraint[r.target] = softToXpath(r.expr, r.target).xpath; if (r.message) cmsg[r.target] = r.message; }
    else if (r.verb === 'calculate')  calc[r.target]     = softToXpath(r.expr, r.target).xpath;
    else if (r.verb === 'show')       dropped.push(`show "${r.label}" — no XLSForm column (Hopper-only flag)`);
    else if (r.verb === 'require')    dropped.push(`require @ ${r.target} — dynamic-required not emitted in v1`);
  }
  const survey = [];
  for (const f of tree.fields || []){
    const p = f.props || {};
    let type;
    if (SEL_OUT[f.fieldType]) type = `${SEL_OUT[f.fieldType]} ${p.list || ''}`.trim();
    else { const o = TYPE_OUT[f.fieldType]; type = (typeof o === 'function') ? o(f) : (o || 'text'); }
    const params = [];
    if (p['capture-accuracy'] != null) params.push(`capture-accuracy=${p['capture-accuracy']}`);
    survey.push({
      type, name:f.name, label:f.label || f.name,
      required: p.required ? 'yes' : '',
      relevant: relevant[f.name] || '',
      constraint: constraint[f.name] || '',
      constraint_message: cmsg[f.name] || '',
      calculation: calc[f.name] || '',
      appearance: p.appearance || '',
      parameters: params.join(' '),
    });
  }
  const choices = [];
  for (const [ln, opts] of Object.entries(tree.choices || {})) for (const o of opts) choices.push({ list_name:ln, name:o.value, label:o.label });
  return { survey, choices, settings, dropped };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { xlsformToTree, treeToXlsform, xpathToSoft, softToXpath };
if (typeof window !== 'undefined') window.HopperXLSForm = { xlsformToTree, treeToXlsform, xpathToSoft, softToXpath };
