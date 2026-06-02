// Positional value codec — SPEC-hopper-records §10. A record's `values` serialize as
// a *positional tuple against the form schema* both sides already hold (by form hash):
// field keys vanish (position implies them), a `select` becomes a small choice index,
// ints/floats pack tight. The compact lane for the smallest carriers — chirp transport,
// dense QR, the batch wire — and the same compaction paper Tier-1 reading wants. Values
// only; attachment blobs take the fat paths (§8). Pure + dependency-free, so `records/`
// stays import-clean and lifts into the published package.
//
// Schema-driven: encoder and decoder walk `tree.fields` identically, so each value's
// *position* and *type* come from the schema. Each leaf value carries a one-byte tag
// (its presence + kind); structural nodes (group/repeat) need no tag — the schema says
// what they are. v1 is deliberately simple (a tag per leaf, dates as strings); a v2
// could drop tags for schema-typed fields + a presence bitmap for tighter packing.
//
// Contract: decode yields a value for *every* schema leaf — `null` where blank/absent,
// `[]` for an empty repeat. (Positional slots are fixed by the schema; "absent" can't
// round-trip as "omitted", it comes back as null. The envelope's relevance-erasure is a
// separate concern.)

const TAG = { NULL: 0, FALSE: 1, TRUE: 2, INT: 3, FLT: 4, STR: 5, ARR: 6, OBJ: 7, IDX: 8, IDXS: 9 };
const SKIP = new Set(['note', 'photo', 'audio', 'video', 'file']);   // no value slot (media → attachments)
const utf8e = new TextEncoder();
const utf8d = new TextDecoder();

class Writer {
  constructor() { this.b = []; }
  byte(n) { this.b.push(n & 0xff); }
  varint(n) { let x = Math.floor(n); while (x > 0x7f) { this.b.push((x & 0x7f) | 0x80); x = Math.floor(x / 128); } this.b.push(x & 0x7f); }
  zigzag(n) { this.varint(n >= 0 ? n * 2 : -n * 2 - 1); }
  f64(x) { const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, x, true); for (let i = 0; i < 8; i++) this.b.push(dv.getUint8(i)); }
  str(s) { const u = utf8e.encode(s); this.varint(u.length); for (const c of u) this.b.push(c); }
  take() { return Uint8Array.from(this.b); }
}

class Reader {
  constructor(u8) { this.u = u8 instanceof Uint8Array ? u8 : Uint8Array.from(u8); this.p = 0; }
  byte() { return this.u[this.p++]; }
  varint() { let shift = 1, n = 0, b; do { b = this.u[this.p++]; n += (b & 0x7f) * shift; shift *= 128; } while (b & 0x80); return n; }
  zigzag() { const u = this.varint(); return (u % 2 === 0) ? u / 2 : -(u + 1) / 2; }
  f64() { const dv = new DataView(this.u.buffer, this.u.byteOffset + this.p, 8); this.p += 8; return dv.getFloat64(0, true); }
  str() { const len = this.varint(); const s = utf8d.decode(this.u.subarray(this.p, this.p + len)); this.p += len; return s; }
}

const listFor = (node, choices) => (node.props && node.props.list && choices && choices[node.props.list]) || null;

// ---- generic (self-describing) value codec — for calc/hidden/ref/geo/geoshape/… ----
function writeGeneric(w, v) {
  if (v === null || v === undefined) return w.byte(TAG.NULL);
  if (v === false) return w.byte(TAG.FALSE);
  if (v === true) return w.byte(TAG.TRUE);
  if (typeof v === 'number') { if (Number.isInteger(v)) { w.byte(TAG.INT); w.zigzag(v); } else { w.byte(TAG.FLT); w.f64(v); } return; }
  if (typeof v === 'string') { w.byte(TAG.STR); w.str(v); return; }
  if (Array.isArray(v)) { w.byte(TAG.ARR); w.varint(v.length); for (const e of v) writeGeneric(w, e); return; }
  if (typeof v === 'object') { const ks = Object.keys(v); w.byte(TAG.OBJ); w.varint(ks.length); for (const k of ks) { w.str(k); writeGeneric(w, v[k]); } return; }
  w.byte(TAG.NULL);
}
function readGenericTag(r, t) {
  switch (t) {
    case TAG.NULL: return null;
    case TAG.FALSE: return false;
    case TAG.TRUE: return true;
    case TAG.INT: return r.zigzag();
    case TAG.FLT: return r.f64();
    case TAG.STR: return r.str();
    case TAG.ARR: { const n = r.varint(); const a = []; for (let i = 0; i < n; i++) a.push(readGenericTag(r, r.byte())); return a; }
    case TAG.OBJ: { const n = r.varint(); const o = {}; for (let i = 0; i < n; i++) { const k = r.str(); o[k] = readGenericTag(r, r.byte()); } return o; }
    default: throw new Error('positional: bad tag ' + t);
  }
}

// ---- per-leaf value, schema-optimized where it pays (selects, ints) ----
function writeLeaf(w, node, value, choices) {
  if (value === null || value === undefined) return w.byte(TAG.NULL);
  const ft = node.fieldType;
  if (ft === 'select') {
    const list = listFor(node, choices);
    const i = list ? list.findIndex((c) => c.value === value) : -1;
    if (i >= 0) { w.byte(TAG.IDX); w.varint(i); return; }
    return writeGeneric(w, value);                                  // off-list → literal
  }
  if (ft === 'multiselect' || ft === 'rank') {
    const list = listFor(node, choices);
    if (Array.isArray(value) && list) {
      const idxs = value.map((v) => list.findIndex((c) => c.value === v));
      if (idxs.every((i) => i >= 0)) { w.byte(TAG.IDXS); w.varint(idxs.length); for (const i of idxs) w.varint(i); return; }
    }
    return writeGeneric(w, value);
  }
  if ((ft === 'number' || ft === 'range') && typeof value === 'number') {
    if ((node.props && node.props.int) || Number.isInteger(value)) { w.byte(TAG.INT); w.zigzag(value); return; }
    w.byte(TAG.FLT); w.f64(value); return;
  }
  return writeGeneric(w, value);                                    // text/date/barcode/geo/calc/…
}
function readLeaf(r, node, choices) {
  const t = r.byte();
  if (t === TAG.IDX) { const list = listFor(node, choices) || []; const e = list[r.varint()]; return e ? e.value : null; }
  if (t === TAG.IDXS) { const list = listFor(node, choices) || []; const n = r.varint(); const a = []; for (let k = 0; k < n; k++) { const e = list[r.varint()]; a.push(e ? e.value : null); } return a; }
  return readGenericTag(r, t);
}

// ---- the schema walk (identical both ends) ----
function walkEncode(w, nodes, scope, choices) {
  for (const node of nodes || []) {
    const ft = node.fieldType;
    if (ft === 'group') { walkEncode(w, node.children, scope, choices); continue; }   // presentational, flat values
    if (SKIP.has(ft)) continue;
    if (ft === 'repeat') {
      const arr = Array.isArray(scope[node.name]) ? scope[node.name] : [];
      w.varint(arr.length);
      for (const inst of arr) walkEncode(w, node.children, inst || {}, choices);
      continue;
    }
    writeLeaf(w, node, scope[node.name], choices);
  }
}
function walkDecode(r, nodes, out, choices) {
  for (const node of nodes || []) {
    const ft = node.fieldType;
    if (ft === 'group') { walkDecode(r, node.children, out, choices); continue; }
    if (SKIP.has(ft)) continue;
    if (ft === 'repeat') {
      const n = r.varint(); const arr = [];
      for (let i = 0; i < n; i++) { const inst = {}; walkDecode(r, node.children, inst, choices); arr.push(inst); }
      out[node.name] = arr;
      continue;
    }
    out[node.name] = readLeaf(r, node, choices);
  }
}

// Encode a values map to the positional byte tuple for `tree`. Decode is its inverse
// (against the same tree). The form hash / record id travel separately as a header (§10).
export function encodeValues(tree, values) {
  const w = new Writer();
  walkEncode(w, (tree && tree.fields) || [], values || {}, (tree && tree.choices) || {});
  return w.take();
}
export function decodeValues(tree, bytes) {
  const r = new Reader(bytes);
  const out = {};
  walkDecode(r, (tree && tree.fields) || [], out, (tree && tree.choices) || {});
  return out;
}
