# SPEC-hopper-rules

**System:** part of Hopper — see **SPEC-hopper** (architecture), **SPEC-hopper-form** (the format)
**Component:** the rule-expression language — the logic layer of a `hopper` definition
**Status:** Draft v0.1
**Editor:** Arthur Endlein Correia (with Claude)
**Last revised:** 2026-06-01
**License:** spec CC0 · reference implementation MIT
**Supersedes:** SPEC-hopper-form §6 (the "restricted `soft` profile" framing); see DECISIONS §6.

## Abstract

A `hopper` definition's only imperative surface is its **rules** — `relevant`,
`constrain`, `require`, `calculate`, `filter`, `show`. This document specifies the
**expression language** those rules are written in: a small, **total**, pure
expression calculus over the fields of the record being filled.

Three properties define it, and the first is load-bearing:

1. **Totality is the security boundary.** The language has no loops, no
   recursion, no user-defined functions, no I/O, no DOM, no events, and no
   unbounded operations. Every expression terminates and is a pure function of
   the current record's values. This is *why* a stranger's definition is as safe
   to open as a menu — not because we "restricted" a general language, but
   because the language is total by construction. (Earlier drafts called this a
   "restricted `soft` profile." It is not `soft`; `soft` is a full language and
   belongs to the later mill/query layer — SPEC-hopper-form §11, DECISIONS §6.
   The rule language is its own bounded calculus.)
2. **Within-record only.** An expression reads other fields *of the same record*
   plus literals and the definition's `choices`. It performs **no cross-*record*
   queries** — those are the mill's job. Within one record it *may* aggregate over
   a `repeat`'s instances (`count`/`total`/`max`/`min`, §3.4) and is evaluated
   **per-instance** inside a repeat (§4.7) — both still total, since a `repeat`
   is a finite in-record collection. A rule is a pure function `record → value`.
3. **One canonical form, two faces.** Each operation has exactly one written
   form, so the builder renders it as pickers (field ▾ / operator ▾ / value) and
   the hand-typed line is the *same artifact* lowering to the *same* node.
   **Comparisons and arithmetic use symbols** (`< > <= >= = != + - * /`);
   booleans and the symbol-less operations — membership, presence, range — read
   as words (`and`, `contains`, `is filled`, `between`). A picker's human label
   (e.g. "is greater than") is a UI concern, distinct from the canonical
   serialized form (`>`).

**In one line:** Hopper's rule language is *XLSForm's expression sublanguage,
cleaned of its XPath warts (`.`, node-sets, raw node references) and given one
ergonomic sugar (`between`), kept total by construction.* It is not `soft` and
not a new language — a tidied, safe dialect of the standard this domain already
speaks. (This is why we anchor on XLSForm, not `soft`: it is the domain's lingua
franca, our interop target, and a language our authors may already know.)

The reference seed is the evaluator in `reference/hopper-renderer.html`
(`tokenize` / `makeEval` / `evalBool`); this spec formalizes and completes it.
The implementation parses an expression to a small AST and wires it into the
reactive graph (`@gcu/sideact` signals): a rule's field references are its
dependencies, and the engine recomputes on change. No separate interpreter.

---

## 1. The verbs

Each rule is an entry in the tree's `rules` array. Shape: `{verb, target, expr}`
(or `{verb, label, expr}` for `show`); a `constrain` rule may carry `message`.

| verb        | target  | `expr` yields | fires / effect | XLSForm column |
|-------------|---------|---------------|----------------|----------------|
| `relevant`  | field   | **boolean**   | field shows only when true; when false the field is hidden **and reads as blank** to other rules | `relevant` |
| `constrain` | field   | **boolean**   | a *filled* answer is valid only when true (empty answers always pass — see §4) | `constraint` (+ `constraint_message`) |
| `require`   | field   | **boolean**   | field is required only when true | `required` (dynamic) |
| `calculate` | field   | **value**     | computes into a `calc` field (no UI) | `calculation` |
| `filter`    | field   | **choice-filter** | restricts which `choices` options show (cascading selects; v0 simple — §6) | `choice_filter` |
| `show`      | *label* | **boolean**   | renders a named flag when true (Hopper extension; no XLSForm column — round-trips opaquely or drops with a warning) | *(none)* |

`relevant`/`constrain`/`require`/`show` take a **boolean** expression;
`calculate` takes a **value** expression; `filter` takes a choice-filter
expression (§6). All are *within-record* pure functions.

---

## 2. Value model

Five value kinds flow through expressions:

| kind        | from                                        | notes |
|-------------|---------------------------------------------|-------|
| **number**  | `number`/`range` fields, numeric literals   | IEEE double; `int` fields still compare as numbers |
| **string**  | `text`/`select`/`barcode`/… , `"…"` literals | choice `value`s are strings; identifiers `[a-z0-9_-]+` |
| **boolean** | `true` / `false` literals, comparison results | |
| **blank**   | an unanswered field, a non-relevant field, or a failed coercion | the empty value; distinct from `0` and `""` |
| **set**     | `multiselect`/`rank` fields                 | an ordered/unordered set of choice `value`s; used by `contains` |

`date`/`time`/`datetime` are compared as their ISO string / ordinal; they order
correctly under the comparison operators. `geo` and capture fields (`photo`,
`audio`, …) are **opaque** — only `is blank` / `is filled` apply.

**Coercion.** Comparison operators that need a number coerce via numeric parse;
a value that does not parse becomes **blank** (and see §4 for how blank
propagates). String comparison (`=`, `contains`, `matches`) coerces operands
to strings. No implicit truthiness games beyond §4.

---

## 3. Grammar

Canonical surface grammar (EBNF; `|` alternation, `{ }` repetition, `[ ]`
optional). Whitespace separates tokens; it is otherwise insignificant.

```
expr        = or_expr ;

or_expr     = and_expr  { "or"  and_expr } ;
and_expr    = not_expr  { "and" not_expr } ;
not_expr    = [ "not" ] comparison ;

comparison  = "(" expr ")"
            | value rel_op value
            | value "between" value "and" value
            | value "contains" value
            | value "matches" string
            | value "is" ( "blank" | "filled" )
            | value ;                         (* bare value → "is filled" *)

rel_op      = "<" | ">" | "<=" | ">=" | "=" | "!=" ;   (* single = , XPath style *)

value       = arith ;
arith       = term     { ("+" | "-") term } ;     (* calculate only; §3.3 *)
term        = factor   { ("*" | "/") factor } ;
factor      = "(" arith ")" | aggregate | number | string | bool | field ;

aggregate   = aggfn "(" path ")" ;                (* over a repeat's instances; §3.4 *)
aggfn       = "count" | "total" | "max" | "min" | "mean" ;
path        = ident { "." ident } ;               (* repeat | repeat.field *)

field       = "${" ident "}" | ident ;            (* bare ident reads a field *)
ident       = /[a-z0-9_-]+/ ;
number      = /-?[0-9]+(\.[0-9]+)?/ ;
string      = /"[^"]*"/ ;
bool        = "true" | "false" ;
```

### 3.1 Comparison operators (boolean expressions)

Symbols for the relational operators (matching XLSForm/XPath); words only where
there is no clean keyboard symbol. One canonical form each.

| canonical           | meaning                                  | operands     |
|---------------------|------------------------------------------|--------------|
| `a < b` `a > b`     | less / greater than                      | numeric/date |
| `a <= b` `a >= b`   | at most / at least                       | numeric/date |
| `a = b`             | equality (string or numeric; single `=`) | any          |
| `a != b`            | inequality                               | any          |
| `a between b and c` | `b <= a <= c` (inclusive)                | numeric/date |
| `a contains b`      | `b` is an element of set `a`, or substring of string `a` | set/string |
| `a matches "re"`    | `a` matches the regex literal            | string       |
| `a is blank`        | `a` is the blank value                   | any          |
| `a is filled`       | `a` is not blank                         | any          |
| *(bare)* `a`        | shorthand for `a is filled`              | any          |

No English aliases for the relational operators (no `is above` / `equals`) — one
canonical form, and symbols round-trip to XLSForm as identity (§7). The builder's
operator dropdown may *display* human labels ("is greater than") while serializing
`>`; the label is UI, the symbol is the artifact.

### 3.2 Boolean combination

`and`, `or`, `not`, and parentheses. Precedence, tightest first:
**`not` → comparison → `and` → `or`**. `and`/`or` are short-circuit. (This is
the prototype's `orE → andE → notE → cmp` descent, made normative.)

### 3.3 Arithmetic (value expressions, `calculate` only)

`+ - * /` with parentheses, standard precedence (`* /` before `+ -`),
left-associative. Operands coerce to number; a blank or non-numeric operand makes
the result **blank** (§4). Division by zero yields blank (never throws —
totality). Arithmetic appearing in a boolean position is a definition error
surfaced by the engine (degraded to a skipped rule with a warning, per
SPEC-hopper-form §1).

> Arithmetic and comparison are both symbolic — unambiguous, fast to type, and
> (for comparison) identity against XLSForm. Only `and`/`or`/`not` and the
> symbol-less predicates (`between`, `contains`, `is blank`/`filled`, `matches`)
> stay as words.

### 3.4 Aggregates over a `repeat` (within-record)

A `repeat` field (SPEC-hopper-form §4/§8) holds an array of per-instance objects.
Five aggregate functions reduce over those instances — the minimal v1 set
(richer/filtered aggregates are a fast-follow, DECISIONS §12). They are
**within-record** (a repeat is a finite in-record collection), so they stay
total — distinct from the mill's cross-*record* queries (§9).

| form                 | meaning                                              | empty / absent repeat |
|----------------------|------------------------------------------------------|-----------------------|
| `count(rep)`         | number of instances                                  | `0`                   |
| `total(rep.field)`   | sum of the numeric `field` across instances          | `0`                   |
| `max(rep.field)`     | maximum numeric `field`                              | blank                 |
| `min(rep.field)`     | minimum numeric `field`                              | blank                 |
| `mean(rep.field)`    | arithmetic mean of the numeric `field`              | blank                 |

`total`/`max`/`min`/`mean` skip instances whose `field` is blank or non-numeric;
`count` counts instances regardless. `count` takes the repeat alone; the others
take a `repeat.field` path. An aggregate depends on the whole repeat (for the
reactive DAG, §5).

---

## 4. Evaluation semantics — blank, relevance, and validity

These rules are normative and match ODK/XLSForm intuitions; they are the subtle
part.

1. **Blank propagation.** Any arithmetic or ordering comparison with a blank
   operand yields **blank**. `=`/`!=` against blank are defined:
   `blank = blank` → true; `x = blank` (x filled) → false.
2. **Blank as boolean.** When a rule needs a boolean and the expression evaluates
   to blank, it is treated as **false** for `relevant`, `require`, and `show`.
3. **Constraints pass when empty.** `constrain` is enforced **only on a filled
   answer**: an empty field is never "invalid" — emptiness is `require`'s
   concern, not `constrain`'s. Formally, a field is constraint-valid iff
   `(field is blank) or (constraintExpr is true)`.
4. **Required.** A field is required-valid iff `(not requiredActive) or (field is
   filled)`, where `requiredActive` is the static `props.required` OR a true
   `require` rule. A field's overall validity is *constraint-valid AND
   required-valid*.
5. **Non-relevance erases.** When a field's `relevant` is false, the field is
   hidden, **its stored value is treated as blank** for every other rule and for
   the saved record, and its own `constrain`/`require` do not apply. (Standard
   ODK semantics: irrelevant ⇒ empty.)
6. **Calc fields** receive their `calculate` value and then participate as
   ordinary field references; a `calculate` over blanks yields blank.
7. **Per-instance scope (repeats).** A rule attached to a node *inside* a
   `repeat` evaluates **once per instance**: its field references resolve to that
   instance's values plus visible ancestor-scope fields. The engine supplies the
   per-instance values map; the evaluator stays scope-agnostic (it evaluates
   against whatever map it is given). Aggregates (§3.4) are evaluated where the
   repeat is in scope — typically *outside* it — reading the instance array.

---

## 5. Reactive model

A definition is a **pure function of the record's values**. The engine builds a
dependency graph once: each rule's expression is parsed, its **free field
references are its dependencies**, and the rule becomes a node downstream of those
fields (`@gcu/sideact` signals). On any field change the engine recomputes the
affected nodes in topological order — relevance, calculations, constraint and
required validity, choice filters, and `show` flags all ride this one graph.
`relevant` and `calculate` *are* a dependency graph, so there is no separate
evaluation pass and no interpreter loop.

**Cycles** (a field whose calculation depends, transitively, on itself) are a
definition error, detected at graph-build time and surfaced with the offending
field names; the cyclic rules are skipped with a warning rather than executed.

---

## 6. Choice filters (`filter`) — v0 simple

A `filter` rule on a `select`/`multiselect` field restricts which `choices`
options are offered, based on another field — the cascading-select pattern. v0
supports a **single-level** equality filter: choices carry an extra tag column
and the filter keeps options whose tag equals a controlling field's value
(e.g. keep `city` options where `choice.state = ${state}`). Expression form reuses
§3 comparison over a special `choice.<tag>` reference resolving to the option's
tag. Multi-level cascades and database-backed itemsets are deferred
(SPEC-hopper-form §9, §12).

---

## 7. XLSForm bridge

Native rules and XLSForm's restricted XPath transpile to each other over the
**common subset**, syntactically (string↔string). Because the relational and
arithmetic operators are now symbolic, the bridge is **identity** for them —
only the self-reference substitution (the attached field becomes `.`) and `${}`
wrapping of other fields differ; `between`, `contains`, presence, and `matches`
are the only non-identity mappings. The mapping:

| rule form (canonical)             | XLSForm XPath                        |
|-----------------------------------|--------------------------------------|
| `a < b` `a > b` `a <= b` `a >= b` | identical (`.` when self, else `${a}`) |
| `a = b` / `a != b`                | identical (`${a} = 'v'` / `${a} != 'v'`) |
| `a between b and c`               | `${a} >= b and ${a} <= c` (`.` when self) |
| `a contains "v"`                  | `selected(${a}, 'v')`               |
| `a matches "re"`                  | `regex(${a}, 're')`                 |
| `a is blank` / `a is filled`      | `${a} = ''` / `${a} != ''`          |
| `a and b`, `a or b`, `not a`      | `and` / `or` / `not(a)`             |
| arithmetic `+ - * /`              | identical                            |

When the attached field is the comparison's subject, XLSForm uses `.`; otherwise
`${field}`. **Anything outside the common subset passes through verbatim and is
flagged** with a warning (never silently dropped) — both on import (an XPath the
bridge does not recognize lands as an opaque `expr` with a warning) and on export
(a native form with no XLSForm column — e.g. `show` — is reported in `dropped`).
This honors SPEC-hopper invariant #5 (XLSForm round-trips; the tail warns).

> Implementation: the symbolic bridge ships at **`src/js/xlsform/index.js`**
> (`xpathToSoft` / `softToXpath`), round-trip-tested (`test/xlsform.test.mjs`),
> incl. `group`/`repeat` structure and `count`/`sum` aggregates. (The original
> `reference/hopper-xlsform.js` used the earlier keyword forms; the port replaces
> them with the identity mappings above.)

---

## 8. Conformance

Two fixture suites, in the stack's tradition (cf. `@gcu/capsule` `vectors.json`,
`@gcu/yaml` fixtures):

- **eval vectors** — `{ expr, values } → expected` over each value kind and the
  §4 blank/relevance/validity rules (incl. constraint-passes-when-empty,
  non-relevance-erases, division-by-zero→blank, cycle detection).
- **bridge vectors** — `soft ↔ xpath` for the §7 common subset, both directions,
  plus the passthrough-with-warning cases.

The renderer port and the converter both run these; they are the executable
definition of this spec.

---

## 9. Scope

**In (v1):** the §3 grammar (symbolic comparisons & arithmetic, word booleans,
keyword sugar for `between`/`contains`/presence/`matches`); the six verbs (§1);
**within-record `repeat` aggregates** (`count`/`total`/`max`/`min`/`mean`, §3.4)
and **per-instance scoping** (§4.7); the §4 blank/relevance/validity semantics; the
reactive DAG (§5); single-level choice filters (§6); the §7 XLSForm common-subset
bridge with explicit warn-on-tail.

**Out / deferred:** cross-*record* queries (`take from … keep where … group by`
— the **mill** query layer, where `soft`/AIR live; distinct from the within-record
repeat aggregates above); richer/filtered repeat aggregates beyond the §3.4 set;
multi-level cascading filters and external itemsets; user-defined functions of any kind; date
arithmetic beyond comparison; full regex dialects (v1 `matches` is a simple
anchored test); any I/O, DOM, or event surface (excluded *by construction* — the
totality boundary).

---

## 10. Worked example — QF Sample Log

From the canonical example (SPEC-hopper-form §13):

```yaml
rules:
  - verb: "constrain"
    target: "fe_pct"
    expr: "fe_pct between 0 and 100"     # boolean; passes when fe_pct is blank (§4.3)
    message: "Must be between 0 and 100"
  - verb: "relevant"
    target: "resample_reason"
    expr: "resample = \"yes\""             # boolean; false (hides + erases) when blank (§4.2/§4.5)
  - verb: "show"
    label: "high-grade"
    expr: "fe_pct > 60"                    # Hopper flag; no XLSForm column (§7)
```

Dependency graph (§5): `fe_pct` → {`constrain fe_pct`, `show high-grade`};
`resample` → {`relevant resample_reason`}. Editing `fe_pct` recomputes its
constraint validity and the high-grade flag; nothing else. Exported to XLSForm,
the constraint becomes `. >= 0 and . <= 100`, the relevant becomes
`${resample} = 'yes'`, and the `show` flag is reported in `dropped` (§7).

---

*Geoscientific Chaos Union · spec CC0 · 2026 · single-file*
