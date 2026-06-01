// RFC 8785 — JSON Canonicalization Scheme (JCS). SPEC-hopper-records §3.
//
// The one agreed byte form for *signing*: independent implementations must
// serialize the same data to the same bytes or signatures won't verify. JCS
// pins this with an IETF standard + official test vectors.
//
// We lean on the host `JSON.stringify`, which is already JCS-compliant for the
// hard parts: numbers use ECMAScript's shortest-round-trip algorithm (exactly
// what JCS mandates) and strings use minimal RFC 8259 escaping (raw non-ASCII,
// unescaped `/`). All we add is recursive key sorting by UTF-16 code unit —
// which is JS's default string sort. Non-finite numbers are rejected (JCS, like
// JSON, has no NaN/Infinity).
//
// NOTE (SPEC-hopper-records §3): this is the *signing* form only. Records are
// *stored* as plain pretty JSON (readable git diffs); the signature is computed
// over canonicalize(data), independent of the stored file's whitespace.

export function canonicalize(value) {
  return ser(value);
}

function ser(v) {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isFinite(v)) throw new Error('JCS: non-finite number not serializable');
    return JSON.stringify(v);             // ECMAScript Number serialization == JCS
  }
  if (t === 'string') return JSON.stringify(v);   // minimal RFC 8259 escaping == JCS
  if (Array.isArray(v)) return '[' + v.map(ser).join(',') + ']';
  if (t === 'object') {
    const parts = [];
    for (const k of Object.keys(v).sort()) {       // UTF-16 code-unit order
      const val = v[k];
      if (val === undefined) continue;             // JSON drops undefined members
      parts.push(JSON.stringify(k) + ':' + ser(val));
    }
    return '{' + parts.join(',') + '}';
  }
  throw new Error(`JCS: unsupported value type (${t})`);
}
