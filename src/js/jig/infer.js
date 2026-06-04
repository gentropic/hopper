// Schema-from-example (SPEC-hopper-form §10) — the jig builder's data-first
// on-ramp. A table (rows of cells) → a §8 canonical tree by deterministic
// per-column inference, plus a structured list of "seams": the genuinely
// ambiguous calls the builder asks the user as taps (select-vs-text, codes that
// look numeric, which column is identity, required fields, a geo split across two
// columns). No model required.
//
//   inferTree(rows, opts) -> { tree, warnings, seams }
//
// Pure + DOM-free, like records/ rules/ xlsform/ — the seam *interview* is UI that
// consumes `seams`; this module only surfaces them. Lib-agnostic over row objects
// (CSV / grid / record-shaped, keyed by header), exactly as xlsform/ is over
// SheetJS rows; CSV→rows parsing belongs at the formsource/UI layer. A single
// object is treated as a one-row table.
//
// The inferred auto-form is FLAT — containers (group/repeat) come from editing or
// XLSForm import, never from a flat table (faithful to §10). Inference is
// deliberately dumb; the seams are the mechanism that fixes ambiguity.

// ---- cell / column helpers ---------------------------------------------------

function cellEmpty(v) { return v === null || v === undefined || String(v).trim() === ''; }

// Union of headers across rows, in first-seen order.
function columnHeaders(rows) {
  const seen = new Set(), out = [];
  for (const r of rows) for (const k of Object.keys(r || {})) if (!seen.has(k)) { seen.add(k); out.push(k); }
  return out;
}
// Non-empty cell values for one column, trimmed to strings.
function columnValues(rows, key) {
  const out = [];
  for (const r of rows) { const v = r ? r[key] : undefined; if (!cellEmpty(v)) out.push(String(v).trim()); }
  return out;
}
function distinctOf(vals) { return Array.from(new Set(vals)); }
function allMatch(vals, re) { return vals.length > 0 && vals.every((v) => re.test(v)); }

const RE_NUM = /^-?\d+(?:\.\d+)?$/;
const RE_INT = /^-?\d+$/;
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?/;
const RE_TIME = /^\d{2}:\d{2}(?::\d{2})?$/;
const RE_LATLNG = /^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/;
const RE_LEADZERO = /^0\d+$/;                                   // 02139 — a code, not a number
const EXT_PHOTO = /\.(jpe?g|png|gif|webp|bmp|heic|tiff?)$/i;
const EXT_FILE = /\.(pdf|docx?|xlsx?|csv|txt|zip|mp3|mp4|wav|mov|json)$/i;
const HINT_MEDIA = /(photo|image|picture|pic|file|attachment|url|filename|document|doc)/i;
const HINT_CODE = /(\bid\b|code|zip|postal|phone|ssn|\bno\b|number)/i;
const HINT_LAT = /\blat/i;
const HINT_LNG = /\b(lon|lng|long)/i;

// ---- identifier shaping ------------------------------------------------------

// Header → identifier ([a-z0-9_-]+, lowercased) and a titled label.
function slugifyHeader(h) {
  const s = String(h).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return s || 'field';
}
function titleizeHeader(h) {
  return String(h).trim().split(/[_\-\s]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || String(h);
}

// ---- per-column type sniff ---------------------------------------------------

// Returns { fieldType, props, choices?, seams[] } for one column's values.
// Sniff order per §10: number → date/datetime/time → geo → photo/file → select → text.
function sniffColumn(header, name, vals, selectMax) {
  const seams = [];
  if (vals.length === 0) return { fieldType: 'text', props: {}, seams, empty: true };

  if (allMatch(vals, RE_NUM)) {
    const props = allMatch(vals, RE_INT) ? { int: true } : {};
    // All-numeric, but a leading zero or an id/code/zip header says "really a code".
    const codey = vals.some((v) => RE_LEADZERO.test(v)) || HINT_CODE.test(header);
    if (codey) seams.push({ type: 'number-or-text', field: name, options: ['number', 'text'],
      recommend: vals.some((v) => RE_LEADZERO.test(v)) ? 'text' : 'number',
      question: `Is "${header}" a number, or a code stored as text?` });
    return { fieldType: 'number', props, seams };
  }
  if (allMatch(vals, RE_DATETIME)) return { fieldType: 'datetime', props: {}, seams };
  if (allMatch(vals, RE_DATE)) return { fieldType: 'date', props: {}, seams };
  if (allMatch(vals, RE_TIME)) return { fieldType: 'time', props: {}, seams };
  if (allMatch(vals, RE_LATLNG)) return { fieldType: 'geo', props: {}, seams };

  // Media: header hint or a recognised extension on every value.
  if (HINT_MEDIA.test(header) || allMatch(vals, EXT_PHOTO) || allMatch(vals, EXT_FILE)) {
    const photo = allMatch(vals, EXT_PHOTO) || /(photo|image|picture|pic)/i.test(header);
    return { fieldType: photo ? 'photo' : 'file', props: {}, seams };
  }

  // Select: a small, repeated value set (needs ≥2 rows and real repetition).
  const distinct = distinctOf(vals);
  if (distinct.length >= 2 && distinct.length <= selectMax && distinct.length < vals.length) {
    const choices = distinct.map((v) => ({ value: slugifyHeader(v), label: v }));
    seams.push({ type: 'select-or-text', field: name, options: ['select', 'text'], recommend: 'select',
      question: `"${header}" repeats ${distinct.length} values — a choice list, or free text?` });
    return { fieldType: 'select', props: { list: name }, choices, seams };
  }

  return { fieldType: 'text', props: {}, seams };
}

// ---- wide-format repeat detection -------------------------------------------
//
// A single denormalized table can encode a repeat as indexed column groups. Two
// shapes (header-only, deterministic):
//   embed: stem<i>_sub        e.g. sample1_lith, sample1_fe, sample2_lith, …
//   trail: base<i>            e.g. lith_1, fe_1, lith_2, fe_2  (grouped by index-set)
// → a `repeat` whose children are the sub-fields/bases. This is a *candidate* the
// builder offers as a seam (form §10 is flat by default); the records are NOT
// reshaped (jig builds the form, not records). Long-format (repeated parent-key
// rows) is deferred to the relational pass — SPEC-hopper-jig §5.

function parseIndexedHeader(h) {
  const s = String(h).trim();
  let m;
  if ((m = s.match(/^([A-Za-z][\w]*?)[ _.\-]?(\d{1,3})[ _.\-]([A-Za-z][\w]*)$/)))
    return { kind: 'embed', stem: m[1].toLowerCase(), idx: +m[2], sub: m[3].toLowerCase() };
  if ((m = s.match(/^([A-Za-z][\w]*?)[ _.\-]?(\d{1,3})$/)))
    return { kind: 'trail', base: m[1].toLowerCase(), idx: +m[2] };
  return null;
}

// indices must be ≥2 and contiguous from 0 or 1 — keeps coincidental numbers
// (covid19, q5) from masquerading as repeats. The seam still asks, so a stray
// false positive is declinable, but this cuts the noise.
function contiguousIndexSet(idxSet) {
  const a = [...idxSet].sort((x, y) => x - y);
  if (a.length < 2 || a[0] > 1) return false;
  for (let i = 1; i < a.length; i++) if (a[i] !== a[i - 1] + 1) return false;
  return true;
}

function commonPrefixToken(words) {
  if (!words.length) return '';
  let p = words[0];
  for (const w of words) { while (p && !w.startsWith(p)) p = p.slice(0, -1); }
  return p.replace(/[_.\- ]+$/, '');
}

// A name for a shared choice list: yes/no → "yesno"; else the common prefix of the
// member field names; else "shared_list". Deduped against existing lists.
function sharedListName(opts, names, choices) {
  const labels = opts.map((o) => String(o.label).toLowerCase()).sort();
  let base = (labels.length === 2 && labels.includes('yes') && labels.includes('no'))
    ? 'yesno' : (commonPrefixToken(names) || 'shared_list');
  base = slugifyHeader(base) || 'shared_list';
  if (!choices[base]) return base;
  let i = 2; while (choices[`${base}_${i}`]) i++;
  return `${base}_${i}`;
}

// Detect repeat groups over the inferred columns. Returns ready-to-fold specs:
// { name, label, children:[fieldDef], childChoices:{list:opts}, sources:[flatName], indices:[n] }.
function detectRepeatGroups(colMeta, selectMax) {
  const colByHeader = new Map(colMeta.map((c) => [c.header, c]));
  const nameByHeader = new Map(colMeta.map((c) => [c.header, c.name]));
  const groups = [], usedHeaders = new Set();

  const embed = new Map();   // stem -> { idx:Set, items:[{idx,sub,header}] }
  const trail = new Map();   // base -> { idx:Set, headers:[header] }
  for (const c of colMeta) {
    const p = parseIndexedHeader(c.header);
    if (!p) continue;
    if (p.kind === 'embed') {
      const g = embed.get(p.stem) || { idx: new Set(), items: [] };
      g.idx.add(p.idx); g.items.push({ idx: p.idx, sub: p.sub, header: c.header });
      embed.set(p.stem, g);
    } else {
      const g = trail.get(p.base) || { idx: new Set(), headers: [] };
      g.idx.add(p.idx); g.headers.push(c.header);
      trail.set(p.base, g);
    }
  }

  const buildChild = (childName, headers) => {
    const vals = [].concat(...headers.map((h) => (colByHeader.get(h) || {}).vals || []));
    const s = sniffColumn(childName, childName, vals, selectMax);
    const field = { name: childName, fieldType: s.fieldType, label: titleizeHeader(childName), props: s.props || {} };
    let choices = null;
    if (s.choices) { field.props.list = childName; choices = s.choices; }
    return { field, choices };
  };

  // embed: one repeat per stem
  for (const [stem, g] of embed) {
    if (!contiguousIndexSet(g.idx)) continue;
    const subs = [...new Set(g.items.map((it) => it.sub))];
    const children = [], childChoices = {};
    for (const sub of subs) {
      const { field, choices } = buildChild(slugifyHeader(sub), g.items.filter((it) => it.sub === sub).map((it) => it.header));
      children.push(field); if (choices) childChoices[field.name] = choices;
    }
    for (const it of g.items) usedHeaders.add(it.header);
    groups.push({ name: slugifyHeader(stem), label: titleizeHeader(stem), children, childChoices,
      sources: g.items.map((it) => nameByHeader.get(it.header)), indices: [...g.idx].sort((a, b) => a - b) });
  }

  // trail: partition bases by identical (qualifying) index-set → one repeat each
  const byIdxSet = new Map();
  for (const [base, g] of trail) {
    if (!contiguousIndexSet(g.idx)) continue;
    if (g.headers.some((h) => usedHeaders.has(h))) continue;          // already claimed by an embed group
    const k = [...g.idx].sort((a, b) => a - b).join(',');
    (byIdxSet.get(k) || byIdxSet.set(k, []).get(k)).push({ base, g });
  }
  for (const [k, bases] of byIdxSet) {
    const children = [], childChoices = {}, sources = [];
    for (const { base, g } of bases) {
      const { field, choices } = buildChild(slugifyHeader(base), g.headers);
      children.push(field); if (choices) childChoices[field.name] = choices;
      for (const h of g.headers) sources.push(nameByHeader.get(h));
    }
    const name = bases.length === 1 ? bases[0].base : (commonPrefixToken(bases.map((b) => b.base)) || 'item');
    groups.push({ name: slugifyHeader(name), label: titleizeHeader(name), children, childChoices, sources,
      indices: k.split(',').map(Number) });
  }
  return groups;
}

// ---- the inference ----------------------------------------------------------

export function inferTree(rows, opts = {}) {
  const table = Array.isArray(rows) ? rows : [rows];
  const selectMax = opts.selectMax ?? 8;
  const warnings = [], seams = [], fields = [], choices = {};
  const usedNames = new Set();

  const headers = columnHeaders(table);
  const colMeta = [];                                          // {header, name, fieldType, vals}

  for (const header of headers) {
    let name = slugifyHeader(header);
    if (usedNames.has(name)) {                                 // dedup collisions deterministically
      let i = 2; while (usedNames.has(`${name}_${i}`)) i++;
      warnings.push(`duplicate column "${header}" → name "${name}_${i}"`);
      name = `${name}_${i}`;
    }
    usedNames.add(name);

    const vals = columnValues(table, header);
    const s = sniffColumn(header, name, vals, selectMax);
    if (s.empty) warnings.push(`column "${header}" is all empty — defaulted to text`);

    const field = { name, fieldType: s.fieldType, label: titleizeHeader(header), props: s.props || {} };
    if (s.choices) choices[name] = s.choices;
    fields.push(field);
    for (const sm of s.seams) seams.push(sm);
    colMeta.push({ header, name, fieldType: s.fieldType, vals, total: vals.length });
  }

  // ---- table-level seams (§10) ----
  const rowCount = table.length;

  // Identity / primary label: prefer a fully-distinct text column.
  const idCandidates = colMeta.filter((c) => c.fieldType === 'text' && c.total === rowCount
    && distinctOf(c.vals).length === c.total && c.total > 0);
  if (fields.length) {
    seams.push({ type: 'identity', field: null, options: fields.map((f) => f.name),
      recommend: (idCandidates[0] || colMeta.find((c) => c.fieldType === 'text') || colMeta[0]).name,
      question: 'Which field is the record identity / primary label?' });
  }

  // Required?: recommend the columns with no empty cell across every row.
  const fullCols = colMeta.filter((c) => rowCount > 0 && c.total === rowCount).map((c) => c.name);
  if (fields.length) {
    seams.push({ type: 'required', field: null, options: fields.map((f) => f.name),
      recommend: fullCols, question: 'Which fields must not be blank?' });
  }

  // Geo split: a lat-ish + lng-ish pair of numeric columns → offer to merge into one geo.
  const lat = colMeta.find((c) => HINT_LAT.test(c.header) && c.fieldType === 'number');
  const lng = colMeta.find((c) => HINT_LNG.test(c.header) && c.fieldType === 'number');
  if (lat && lng) {
    seams.push({ type: 'geo-merge', field: [lat.name, lng.name], options: ['merge', 'keep'],
      recommend: 'merge', question: `Merge "${lat.header}" + "${lng.header}" into one geo point?` });
  }

  // Shared-list candidates: select fields with identical option sets → offer to point
  // them at one shared `choices` list (XLSForm-style reuse) — the detect-then-ask seam.
  const selFields = fields.filter((f) => f.fieldType === 'select' && f.props && f.props.list && choices[f.props.list]);
  const bySig = new Map();
  for (const f of selFields) {
    const sig = JSON.stringify(choices[f.props.list].map((o) => [o.value, o.label]).sort());   // order-independent
    (bySig.get(sig) || bySig.set(sig, []).get(sig)).push(f);
  }
  for (const fs of bySig.values()) {
    if (fs.length < 2) continue;
    const names = fs.map((f) => f.name);
    const list = sharedListName(choices[fs[0].props.list], names, choices);
    seams.push({ type: 'share-list', field: list, fields: names, list, recommend: 'share',
      question: `${names.join(', ')} have the same options — use one shared list "${list}"?`,
      spec: { fields: names, list } });
  }

  // Wide-format repeats: indexed column groups → a candidate `repeat` (offered as a
  // seam — the fold is the user's call; jig stays flat by default, form §10).
  for (const g of detectRepeatGroups(colMeta, selectMax)) {
    let gname = g.name;
    const nonSource = new Set(fields.map((f) => f.name).filter((n) => !g.sources.includes(n)));
    if (nonSource.has(gname)) { let i = 2; while (nonSource.has(`${gname}_${i}`)) i++; gname = `${gname}_${i}`; }
    const members = g.children.map((c) => c.name);
    seams.push({ type: 'repeat', field: gname, members, sources: g.sources, indices: g.indices, recommend: 'repeat',
      question: `These columns repeat — group ${members.join(', ')} into a repeat "${gname}" (${g.indices.length} instances)?`,
      spec: { name: gname, label: g.label, children: g.children, childChoices: g.childChoices, sources: g.sources } });
  }

  const meta = {
    id: slugifyHeader(opts.id || opts.title || 'form'),
    title: opts.title || 'Form',
    version: opts.version != null ? String(opts.version) : '',
    lang: opts.lang || 'en',
    mode: 'append',
    tiers: { store: 'idb', durable: 'comment' },
  };

  return { tree: { type: 'form', meta, fields, choices, rules: [], views: [] }, warnings, seams };
}
