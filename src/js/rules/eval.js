// The rule-expression language — SPEC-hopper-rules. A small, *total*, pure
// expression calculus over the fields of one record. Totality is the security
// boundary: no loops, recursion, I/O, or unbounded ops; every expression
// terminates and never throws at eval time (bad math → blank, not an exception).
//
// Pipeline: tokenize → parse to an AST → ev(). `deps()` extracts the free field
// references so the renderer can wire each rule into the reactive DAG
// (@gcu/sideact). Blank is represented as `null`.
//
// Syntax (XLSForm-anchored): symbolic comparisons & arithmetic
// (`< > <= >= = != + - * /`), word booleans (`and`/`or`/`not`), keyword sugar
// (`between … and …`, `contains` [membership or substring], `is blank`/`is filled`,
// `matches`), and pure total functions: `if(cond,a,b)`, `round(x[,n])`/`int`/`abs`,
// `year`/`month`/`day` (from an ISO date string). `if`/`round`/`int`/`abs` mirror
// XLSForm's own functions, so they also round-trip / evaluate on import. Parsing
// uses the standard precedence ladder (or < and < not < comparison < additive <
// multiplicative < unary < primary), which realizes the spec grammar and makes
// `(` unambiguous (a parenthesised group is a full expression — boolean or
// arithmetic alike).

const RESERVED = new Set(['and', 'or', 'not', 'between', 'contains', 'matches', 'is', 'blank', 'filled']);
const AGGFNS = new Set(['count', 'total', 'max', 'min', 'mean']);   // within-record repeat aggregates (§3.4)
// Pure total functions: arg-count [min,max]. Disjoint from AGGFNS (min/max stay repeat-aggs).
const CALLFNS = { if: [3, 3], round: [1, 2], int: [1, 1], abs: [1, 1], year: [1, 1], month: [1, 1], day: [1, 1] };

function fail(msg) { throw new Error('rule parse error: ' + msg); }

// ── lexer ──────────────────────────────────────────────────────────────────
// Bare field refs start with a letter/underscore; `${…}` references any field
// id (incl. digit-leading). Subtraction needs surrounding space (`a - 5`), since
// `-` is a valid identifier character and `a-5` lexes as one id (spec §3 ident).
function tokenize(src) {
  const re = /(\s+)|(\$\{[a-z0-9_-]+\})|("[^"]*")|(<=|>=|!=|<|>|=)|([-+*/().,])|(\d+(?:\.\d+)?)|([a-z_][a-z0-9_-]*)/y;
  const toks = [];
  let last = 0;
  while (last < src.length) {
    re.lastIndex = last;
    const m = re.exec(src);
    if (!m) fail(`unexpected character at ${last}: "${src.slice(last, last + 8)}"`);
    last = re.lastIndex;
    if (m[1] !== undefined) continue;                                   // whitespace
    else if (m[2] !== undefined) toks.push({ k: 'field', v: m[2].slice(2, -1) });
    else if (m[3] !== undefined) toks.push({ k: 'str', v: m[3].slice(1, -1) });
    else if (m[4] !== undefined) toks.push({ k: 'op', v: m[4] });
    else if (m[5] !== undefined) toks.push({ k: 'op', v: m[5] });
    else if (m[6] !== undefined) toks.push({ k: 'num', v: parseFloat(m[6]) });
    else toks.push({ k: 'word', v: m[7] });
  }
  return toks;
}

// ── parser ───────────────────────────────────────────────────────────────────
export function parse(src) {
  const toks = tokenize(src);
  let i = 0;
  const op = (v) => toks[i] && toks[i].k === 'op' && toks[i].v === v;
  const word = (v) => toks[i] && toks[i].k === 'word' && toks[i].v === v;
  const eatOp = (v) => { if (!op(v)) fail(`expected '${v}'`); i++; };

  function primary() {
    const t = toks[i];
    if (!t) fail('unexpected end of expression');
    if (t.k === 'op' && t.v === '(') { i++; const e = expr(); eatOp(')'); return e; }
    if (t.k === 'num') { i++; return { t: 'num', v: t.v }; }
    if (t.k === 'str') { i++; return { t: 'str', v: t.v }; }
    if (t.k === 'field') { i++; return { t: 'field', name: t.v }; }
    if (t.k === 'word') {
      // aggregate over a repeat's instances: aggfn ( path ) — §3.4
      if (AGGFNS.has(t.v) && toks[i + 1] && toks[i + 1].k === 'op' && toks[i + 1].v === '(') {
        const fn = t.v; i += 2;                          // consume aggfn and '('
        if (!toks[i] || toks[i].k !== 'word') fail(`${fn}() expects a field path`);
        const path = [toks[i].v]; i++;
        while (op('.')) { i++; if (!toks[i] || toks[i].k !== 'word') fail("expected a name after '.'"); path.push(toks[i].v); i++; }
        eatOp(')');
        return { t: 'agg', fn, path };
      }
      // pure function call: fn ( expr [, expr]* ) — args are full expressions
      if (CALLFNS[t.v] && toks[i + 1] && toks[i + 1].k === 'op' && toks[i + 1].v === '(') {
        const fn = t.v; i += 2;
        const args = [];
        if (!op(')')) { args.push(expr()); while (op(',')) { i++; args.push(expr()); } }
        eatOp(')');
        const [lo, hi] = CALLFNS[fn];
        if (args.length < lo || args.length > hi) fail(`${fn}() expects ${lo === hi ? lo : `${lo}–${hi}`} argument(s), got ${args.length}`);
        return { t: 'call', fn, args };
      }
      i++;
      if (t.v === 'true') return { t: 'bool', v: true };
      if (t.v === 'false') return { t: 'bool', v: false };
      if (RESERVED.has(t.v)) fail(`unexpected keyword '${t.v}'`);
      return { t: 'field', name: t.v };
    }
    fail(`unexpected '${t.v}'`);
  }
  function unary() {
    if (op('-') || op('+')) { const neg = op('-'); i++; const e = unary(); return neg ? { t: 'neg', e } : e; }
    return primary();
  }
  function mul() {
    let l = unary();
    while (op('*') || op('/')) { const o = toks[i].v; i++; l = { t: o, l, r: unary() }; }
    return l;
  }
  function add() {
    let l = mul();
    while (op('+') || op('-')) { const o = toks[i].v; i++; l = { t: o, l, r: mul() }; }
    return l;
  }
  function comparison() {
    const l = add();
    if (op('<') || op('>') || op('<=') || op('>=') || op('=') || op('!=')) {
      const o = toks[i].v; i++; return { t: 'cmp', op: o, l, r: add() };
    }
    if (word('between')) { i++; const lo = add(); if (!word('and')) fail("expected 'and' in between"); i++; return { t: 'between', e: l, lo, hi: add() }; }
    if (word('contains')) { i++; return { t: 'contains', l, r: add() }; }
    if (word('matches')) { i++; if (!toks[i] || toks[i].k !== 'str') fail("'matches' needs a string literal"); const re = toks[i].v; i++; return { t: 'matches', e: l, re }; }
    if (word('is')) { i++; if (word('blank')) { i++; return { t: 'isblank', e: l }; } if (word('filled')) { i++; return { t: 'isfilled', e: l }; } fail("'is' must be followed by 'blank' or 'filled'"); }
    return l;
  }
  function notE() { if (word('not')) { i++; return { t: 'not', e: comparison() }; } return comparison(); }
  function andE() { let l = notE(); while (word('and')) { i++; l = { t: 'and', l, r: notE() }; } return l; }
  function orE() { let l = andE(); while (word('or')) { i++; l = { t: 'or', l, r: andE() }; } return l; }
  function expr() { return orE(); }

  const ast = expr();
  if (i < toks.length) fail(`trailing input near '${toks[i].v}'`);
  return ast;
}

// ── value helpers ────────────────────────────────────────────────────────────
function isBlank(v) { return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0); }
function num(v) {
  if (isBlank(v) || typeof v === 'boolean' || Array.isArray(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function ord(a, b, o) { return o === '<' ? a < b : o === '>' ? a > b : o === '<=' ? a <= b : a >= b; }
function eq(a, b) {
  if (isBlank(a) && isBlank(b)) return true;       // §4.1: blank = blank → true
  if (isBlank(a) || isBlank(b)) return false;      //       x = blank → false
  const na = num(a), nb = num(b);
  return (na !== null && nb !== null) ? na === nb : String(a) === String(b);
}
function compare(a, b, o) {
  if (o === '=') return eq(a, b);
  if (o === '!=') return !eq(a, b);
  if (isBlank(a) || isBlank(b)) return null;       // §4.1: ordering on blank → blank
  const na = num(a), nb = num(b);
  return (na !== null && nb !== null) ? ord(na, nb, o) : ord(String(a), String(b), o);
}

// ── evaluator ────────────────────────────────────────────────────────────────
function ev(n, V) {
  switch (n.t) {
    case 'num': case 'str': case 'bool': return n.v;
    case 'field': { const x = V[n.name]; return x === undefined ? null : x; }
    case 'agg': {                                        // §3.4 — over a repeat's instances
      const list = Array.isArray(V[n.path[0]]) ? V[n.path[0]] : [];
      if (n.fn === 'count') return list.length;
      const nums = list.map((inst) => num(inst && inst[n.path[1]])).filter((x) => x !== null);
      if (n.fn === 'total') return nums.reduce((a, b) => a + b, 0);   // empty → 0
      if (nums.length === 0) return null;                             // max/min/mean of empty → blank
      if (n.fn === 'max') return Math.max(...nums);
      if (n.fn === 'min') return Math.min(...nums);
      return nums.reduce((a, b) => a + b, 0) / nums.length;           // mean
    }
    case 'neg': { const a = num(ev(n.e, V)); return a === null ? null : -a; }
    case '+': case '-': case '*': case '/': {
      const a = num(ev(n.l, V)), b = num(ev(n.r, V));
      if (a === null || b === null) return null;
      if (n.t === '+') return a + b;
      if (n.t === '-') return a - b;
      if (n.t === '*') return a * b;
      return b === 0 ? null : a / b;               // §3.3: ÷0 → blank, never throws
    }
    case 'cmp': return compare(ev(n.l, V), ev(n.r, V), n.op);
    case 'between': {
      const ge = compare(ev(n.e, V), ev(n.lo, V), '>='), le = compare(ev(n.e, V), ev(n.hi, V), '<=');
      return (ge === null || le === null) ? null : (ge && le);
    }
    case 'contains': {
      const a = ev(n.l, V); if (isBlank(a)) return false;
      const b = String(ev(n.r, V));
      return Array.isArray(a) ? a.map(String).includes(b) : String(a).includes(b);
    }
    case 'matches': {
      const a = ev(n.e, V); if (isBlank(a)) return false;
      try { return new RegExp(n.re).test(String(a)); } catch { return false; }
    }
    case 'call': {                                       // pure total functions — bad input → blank
      if (n.fn === 'if') return ev(n.args[0], V) === true ? ev(n.args[1], V) : ev(n.args[2], V);
      const x = num(ev(n.args[0], V));
      if (n.fn === 'round') { if (x === null) return null; const f = Math.pow(10, Math.trunc(n.args.length > 1 ? (num(ev(n.args[1], V)) || 0) : 0)); return Math.round(x * f) / f; }
      if (n.fn === 'int') return x === null ? null : Math.trunc(x);
      if (n.fn === 'abs') return x === null ? null : Math.abs(x);
      // date parts: read YYYY-MM-DD off an ISO date/datetime string (regex, no Date dep)
      const s = ev(n.args[0], V);
      const m = isBlank(s) ? null : /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
      if (!m) return null;
      if (n.fn === 'year') return Number(m[1]);
      if (n.fn === 'month') return Number(m[2]);
      if (n.fn === 'day') return Number(m[3]);
      return null;
    }
    case 'isblank': return isBlank(ev(n.e, V));
    case 'isfilled': return !isBlank(ev(n.e, V));
    case 'not': return ev(n.e, V) !== true;
    case 'and': return ev(n.l, V) === true && ev(n.r, V) === true;
    case 'or': return ev(n.l, V) === true || ev(n.r, V) === true;
  }
  return null;
}

const asAst = (x) => (typeof x === 'string' ? parse(x) : x);

// Raw value: boolean, number, string, set, or `null` (blank). For `calculate`.
export function evaluate(exprOrAst, values) {
  const r = ev(asAst(exprOrAst), values || {});
  return r === undefined ? null : r;
}

// Boolean reading (blank → false): for relevant / require / show / constrain body.
export function evalBool(exprOrAst, values) { return evaluate(exprOrAst, values) === true; }

// §4.3/§4.4 — a field is constraint-valid iff it is blank OR the constraint holds.
export function constraintValid(exprOrAst, values, target) {
  if (isBlank((values || {})[target])) return true;
  return evaluate(exprOrAst, values) === true;
}

// Free field references — the rule's dependencies for the reactive DAG (§5).
export function deps(exprOrAst) {
  const out = new Set();
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.t === 'field') { out.add(n.name); return; }
    if (n.t === 'agg') { out.add(n.path[0]); return; }   // depends on the whole repeat
    if (Array.isArray(n.args)) for (const a of n.args) walk(a);   // function-call args
    for (const k of ['e', 'l', 'r', 'lo', 'hi']) if (n[k]) walk(n[k]);
  })(asAst(exprOrAst));
  return [...out];
}
