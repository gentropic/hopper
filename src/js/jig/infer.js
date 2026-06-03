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
