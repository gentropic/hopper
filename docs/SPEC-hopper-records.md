# SPEC-hopper-records

**System:** part of Hopper — see **SPEC-hopper** (architecture), **SPEC-hopper-collector** (the app)
**Component:** the record object model — how a collected record is shaped, named, signed, stored, and merged
**Status:** Draft v0.1
**Editor:** Arthur Endlein Correia (with Claude)
**Last revised:** 2026-06-01
**License:** spec CC0 · reference implementation MIT
**Folds into:** SPEC-hopper-collector §4–5; realizes DECISIONS §1–4, §8, §9.

## Abstract

A Hopper repo is **a folder of immutable, signed objects** — records, forms,
and attachment blobs — written into **per-stream append-only logs**. This document
specifies that object model: the record envelope, how objects are named and
verified, the directory layout, append-only correction, and the conflict-free
union that *is* sync.

One discipline carries the whole design and earns everything else:
**content-addressed / id-addressed, one-immutable-file-per-object,
append-only, never rewritten, exactly one writer per stream.** From it:

- **Merge is set-union by address.** Two writers never touch the same file, so the
  union of any two repos is conflict-free over *every* transport — git, WebRTC,
  and naïve folder-sync (Dropbox/iCloud/Syncthing) all converge on the identical
  result with no "conflicted copy" (DECISIONS §3, §5).
- **Integrity and provenance are intrinsic.** Every record is **Ed25519-signed**
  by its stream key; forms and blobs are **content-addressed** (the name *is* the
  hash), so tampering is detectable and identical content dedupes for free.
- **Schema-versioning dissolves.** A record names the **form-version hash** it was
  collected against; a later device renders an older record by following the
  pointer (DECISIONS §2, §4).

It is git-*shaped*, not git-*dependent*: the collector reads and writes the folder
over any transport, and a Hopper repo *can* be a git/GitHub repo (free hosting,
diffs, history) without the collector ever linking a git library (DECISIONS §3).

---

## 1. The stream — the atomic unit

Everything is written by a **stream**: one collector keypair on one device
install. A stream is the only writer of its own files, ever — the property that
makes the union conflict-free.

**Stream identity** (DECISIONS §4):

- **keypair** — Ed25519. The public key is the stream's cryptographic identity;
  the private key signs its records and is backed up as carefully as the records
  (DECISIONS §1, §9).
- **device-id** — a stable per-device value.
- **install-epoch** — a random nonce minted at first run and persisted with the
  key. This is the load-bearing "+something": it prevents a wiped-and-reused
  device (whose counter restarts at 0) from colliding ids with its prior life,
  and it survives key rotation.

**Stream-id** is the self-verifying short handle derived from the triple:

```
stream-id = base64url( SHA-256( join(pubkey, device-id, install-epoch) ) )[0:22]
```

(~128 bits — collision-safe at any realistic scale.) The `join` is **length-
prefixed** — each field encoded as `<len>:<value>` and concatenated — so no
field's content can be confused for another's (`("a","bc",…)` and `("ab","c",…)`
must not collide). Realized in `src/js/records/address.js`. Each stream registers itself
once, write-once, in `streams/<stream-id>.json`:

```json
{ "v": 1, "pubkey": "<b64url Ed25519 pub>", "device": "<device-id>",
  "epoch": "<install-epoch>", "name": "Arthur (field phone)" }
```

The registration is **self-verifying**: recomputing the stream-id from its own
`pubkey`/`device`/`epoch` must equal its filename. `name` is a **soft human
label** — "which streams are the same person" is display metadata, not an account
system; correctness is always per-stream (DECISIONS §4).

**Record id = `<stream-id>/<counter>`**, where `counter` is a per-stream monotonic
integer from 0. The id is *also the record's storage path* (§3) — one string is
both identity and address.

---

## 2. The record envelope

A saved record is an immutable JSON object:

```json
{
  "v": 1,
  "id": "Af3kZ…q/0",                       // <stream-id>/<counter>
  "kind": "record",                        // record | correction | tombstone
  "form": "sha256-<b64url>",               // the form-version this was collected against
  "at": "2026-06-01T14:22:07Z",            // best-effort device time (§7; never an ordering primitive)
  "values": {                              // field name → answer (per the form schema)
    "site_id": "QF-118",
    "coords": { "lat": -20.123, "lng": -43.456, "acc": 8 },
    "lithology": "itabirite",
    "fe_pct": 64.2,
    "sampled": "2026-06-01"
  },
  "attachments": {                         // field name → blob reference (§8)
    "photo": { "blob": "sha256-<b64url>", "mime": "image/jpeg", "bytes": 184320 }
  },
  "supersedes": null,                      // or a record id (§5)
  "sig": "<b64url Ed25519 signature>"
}
```

Rules:

- **`values`** holds the answers, typed per the §2/§4 value model of
  SPEC-hopper-rules. A field erased by non-relevance (rules §4.5) is **omitted or
  null** — irrelevant ⇒ empty, and the engine never stores a value the rules
  blanked. With the hierarchical tree (SPEC-hopper-form §8), `values` may
  **nest**: a `repeat` is `values.<name>: [{…instance…}, …]`. This is ordinary
  JSON — JCS canonicalization (§3) and signing handle it unchanged.
- **`form`** is the content hash (§3) of the canonical form tree this record was
  filled against — the schema-version pointer. It is required and immutable.
- **`at`** is captured device time. It is metadata for analysts only; the
  ordering primitive is the per-stream `counter`, never the clock (§7, DECISIONS
  §9).
- **`kind`** distinguishes a normal record from a `correction`/`tombstone` (§5).
- **`sig`** is the Ed25519 signature over the **canonical serialization of the
  envelope with `sig` omitted** (§3). The verifying key is the stream's `pubkey`
  (resolved from the record's stream-id via `streams/`).
- The verifying pubkey is *not* duplicated in the envelope (it is the stream's,
  reachable from `id`); only the soft `name` lives in the stream registration.

---

## 3. Addressing & integrity

**Records are id-addressed; forms and blobs are content-addressed.**

| object | address / path                          | why this key |
|--------|------------------------------------------|--------------|
| record | `records/<stream-id>/<counter>.json` — the id *is* the path | a record has a natural unique, ordered, immutable id (stream+counter); readable, no hashing to name it, and the chirp positional codec keys on it (§10) |
| form   | `forms/<form-hash>.json`                 | forms dedupe across records and across the project; content hash gives one copy + integrity |
| blob   | `blobs/<blob-hash>`                       | attachments dedupe (same photo, two records) and **bind by hash** for the values-first split (§8) |
| stream | `streams/<stream-id>.json`               | self-verifying handle (§1) |

**Hash:** `sha256-` + base64url of the SHA-256 digest (Web Crypto
`crypto.subtle.digest('SHA-256', …)`). The `sha256-` prefix keeps the scheme
agile.

**Canonical serialization** (the *signing* form): **RFC 8785 (JSON
Canonicalization Scheme)** — lexicographically sorted keys (UTF-16 code-unit
order), minimal RFC 8259 escaping, ECMAScript shortest-round-trip numbers, UTF-8,
no whitespace; non-finite numbers rejected. JCS is chosen over a bespoke form
*because* it is a reviewed standard with official test vectors — the right
property for bytes that independent implementations (a Python mill, a future
port) must reproduce exactly. In JS it is **small and low-risk to hand-roll**:
`JSON.stringify` already emits JCS-compliant numbers and string escaping by the
ECMAScript spec, so the canonicalizer is just "recursively sort keys, then
`JSON.stringify` the scalars" — pinned to the RFC's own vectors
(`records/jcs.js`). No third-party library or hand-rolled number logic needed.

**Storage layout ≠ signing form.** The signature is over `canonicalize(data)`,
*not* over the stored file's bytes — so records are **stored as plain pretty
JSON** (readable `git diff`s in the repo) while signing/verifying re-derives the
JCS bytes from the parsed data. Whitespace and key order in the file never affect
verification. This decouples a layout concern (which may evolve) from a
cryptographic invariant (which must never change).

**Signature:** Ed25519 — native Web Crypto preferred (`crypto.subtle`,
auditable's notebook-signing approach), with a **bundled** noble-ed25519 fallback
for browsers lacking it (never lazy-loaded — same rule as ggwave; `records/crypto.js`,
vendor/PROVENANCE.md). Keys are raw 32-byte values (base64url), matching the
stack's `keygen`. Sign the JCS bytes of the envelope-without-`sig`; verify by
recomputation.

**Integrity, layered:** content-addressing makes forms/blobs tamper-evident by
address; the signature makes records tamper-evident *and* attributable. A
consumer can verify "I have object X" by address without fetching, and verify
*authenticity* by checking the signature against the stream pubkey.

---

## 4. Repo layout

```
<repo>/
  project.json                       # operator-owned, signed: project meta + active form(s) by hash (optional)
  streams/
    <stream-id>.json                 # write-once stream registration (§1)
  forms/
    sha256-<b64url>.json             # content-addressed form-version trees (SPEC-hopper-form §8)
  records/
    <stream-id>/
      000000.json                    # per-stream append-only log; counter, zero-padded for lexical order
      000001.json
      …
  blobs/
    sha256-<b64url>                  # content-addressed attachment bytes (§8)
```

- **One writer per file, always.** A stream writes only under `records/<its-id>/`
  and its own `streams/<its-id>.json`. Forms and blobs are content-addressed, so
  two writers producing identical bytes produce the *same* file (idempotent
  union), never a conflict. **No shared mutable file exists** — the property that
  keeps git/folder-sync conflict-free (DECISIONS §3).
- **Enumerable over static HTTP.** A static host (GitHub raw / jsDelivr / a plain
  bucket) can't list a directory — but a consumer lists `streams/` (small,
  slowly growing), and each stream's record range is discoverable by its
  registration + a high-water counter (or a per-stream `streams/<id>.json`
  `count`/`head` field updated write-append by that one writer). Forms/blobs are
  fetched by the hashes records name. No global mutable index is required.
- **`project.json`** is the one near-mutable file; it is **operator-owned and
  signed** (the "+1" by convention) and **read-only to collectors**, naming the
  active form-version hash(es) and project metadata. Collectors that have no
  operator simply carry forms locally. (A multi-operator project is out of scope;
  by convention one operator publishes the form set — DECISIONS §2, §7.)

---

## 5. Corrections & tombstones — append-only mutation

You cannot delete in an immutable union, and field data always has errors
(DECISIONS §9). Logical mutation is **event-sourced — you append, never erase**:

- A **`correction`** is a normal record in the author's stream whose
  `supersedes` names the id of the record it replaces, carrying the full
  corrected `values`.
- A **`tombstone`** is a record with `kind: "tombstone"` and `supersedes` naming
  the retracted id (no `values`).

**Resolution on read.** For a logical record, follow its supersede chain to the
**head**:

1. Group records by their supersede chain (a record, plus everything that
   `supersedes` it, transitively).
2. The **effective** record is the most recent live link — the head of the chain
   that is not itself superseded.
3. If the head is a `tombstone`, the record is **retracted** (hidden from views
   and excluded from aggregation, but never physically removed — its bytes stay
   in the union).

A correction/tombstone is **valid only if signed by an authorized key** — v1: the
original record's stream key (you correct your own records). A later authoritative
central may admit moderator keys (DECISIONS §2, deferred). "Most recent" within a
single stream is the higher counter; across the (rare) case of cross-stream
supersession, ties resolve by `(counter, stream-id)` lexical order — append-only
never needs a global clock (§7).

> Tombstones hide a record in *your* rendering; they cannot un-publish bytes that
> already replicated (the privacy seam, DECISIONS §5/§9). Retraction is a logical
> act, not erasure.

---

## 6. The union & sync

**Merge = set-union of objects by address.** Because every object is immutable and
single-writer-addressed, merging two repos is: take the union of record ids,
form hashes, blob hashes, and stream registrations. No object ever differs at the
same address ⇒ **no conflict is representable.** This is a grow-only-set CRDT
(DECISIONS §2); correctness needs no coordination and no central authority.

**The protocol is transport-agnostic** (DECISIONS §3): each side advertises the
set of addresses it holds; each transfers what the other lacks. It runs the same
over a File System Access folder, an HTTP fetch of a static repo, a WebRTC peer
exchange, or an archive zip — the carriers and their ordering are SPEC-hopper-collector
§5.

**Two lanes, values-first** (DECISIONS §8). Record objects are tiny and sync over
*any* carrier; blob objects are large and sync only over fat pipes. A record
references its photo by `blob` hash, so it travels and renders ("📷 pending")
before the blob arrives, and the blob binds by hash whenever it does, over any
carrier — no dangling pointer. Sync state is therefore **compound** per record
(values {local·synced} × attachments {none·on-device·partial·synced}) and surfaced
plainly; "send all values now" completes independent of the photo backlog.

---

## 7. Validation on read — conflict-free ≠ correct

The union accepts anything addressable; **trust is established on read**, not at
merge (DECISIONS §2):

1. **Signature.** Verify each record's `sig` against its stream pubkey. Unsigned
   or bad-signature records are flagged, not trusted.
2. **Trust.** Filter by accepted stream pubkeys — an **allowed-signers** set
   (a config file / web of trust), never an auth server. A central admits only
   keys it trusts.
3. **Schema re-validation.** Re-check each record's `values` against the form it
   names (rules §4 — required, constraints, types). A record collected under an
   old/buggy/forged form may violate the current schema; surface the invalid ones
   rather than trusting the union blindly.
4. **Time is data, not order.** `at` is best-effort device wall-clock and may be
   wrong (timezone, drift, reset). Ordering is the per-stream `counter`;
   cross-stream global order is unavailable without coordination and append-only
   never needs it. Build nothing correctness-critical on `at` (DECISIONS §9).

---

## 8. Attachments — content-addressed blobs

Media (`photo`/`audio`/`video`/`file`) are **content-addressed blobs** in
`blobs/<hash>`, referenced from a record's `attachments` by `{blob, mime, bytes}`.
This is "git-LFS for outcrop photos":

- **Dedup** — the same photo attached twice is one blob.
- **Bind-by-hash** — the record names the blob it expects; the blob can arrive
  later, over a different carrier, and bind when its content hashes to the named
  address. The hash is a *promise*, not a path.
- **Stored hot in OPFS** — MB-scale blobs belong in OPFS, not IndexedDB, and
  OPFS's `createSyncAccessHandle` gives flushed, predictable writes (DECISIONS
  §1). The structured record envelope lives in the IDB/working tier; the blob
  body lives in OPFS; both export into the repo's `blobs/`.
- **Values-first** — blobs never take the chirp/QR path (§10); they wait for
  LAN/file/internet (§6).

---

## 9. Storage tiers & drafts

Mapping to the collector's tiers (SPEC-hopper-collector §4.2, DECISIONS §1):

- **Hot (IndexedDB + OPFS).** The working set: in-progress **drafts**, the record
  queue, the loaded form set, blob bodies (OPFS). Drafts are **mutable** — you are
  editing fields — and are *not* records.
- **The save boundary.** On save, the engine validates (rules §4), assigns the
  next stream counter, serializes the canonical envelope, **signs it**, and
  appends the now-**immutable** record to the stream. Only then does it become a
  record in the object model. A draft never enters the union; a record never
  leaves it.
- **Durable / export.** Writing the repo objects to OPFS, a chosen local folder,
  or a remote is the §6 sync — and the durability floor is making that *automatic*
  (DECISIONS §1). The repo format is byte-identical wherever it lives (device,
  folder-sync, git host), which is what lets one layout serve every transport.

---

## 10. The positional codec (compact / chirp)

For the smallest carriers (chirp transport, dense QR), a record's `values`
serialize as a **positional tuple against the form schema** the receiver already
holds (by `form` hash): a `select` becomes a one-byte choice index, numbers/dates
pack tight, and field keys vanish because position implies them — a ~250-byte JSON
record drops to ~20–25 bytes (SPEC-hopper-collector §5.4). The id (`stream-id` +
`counter`) and `form` hash travel as a compact header (a per-batch stream index
keeps the stream-id from repeating). Attachments are excluded — they take the fat
paths (§8). This positional-against-the-schema codec is the same compaction the
capsule wire form and the denormalized export want — one mechanism, not a special
case.

---

## 11. Conformance

Fixture suites, in the stack's tradition (`@gcu/capsule` `vectors.json`, `@gcu/yaml`
fixtures):

- **canonicalization** — `envelope → JCS bytes → sha256-address`, pinned vectors
  (the fiddly number/escaping cases of RFC 8785).
- **signatures** — `(envelope, key) → sig` and verify/reject vectors.
- **resolution** — supersede-chain → effective record, incl. tombstone retraction
  and the cross-stream `(counter, stream-id)` tiebreak.
- **union** — merge two object sets → the expected union; idempotence (re-merging
  changes nothing); the "no two objects at one address" invariant.
- **stream-id** — `(pubkey, device, epoch) → stream-id` self-verification.

---

## 12. Scope

**In (v1):** the stream model (§1); the signed record envelope (§2); id/content
addressing + JCS canonicalization + Ed25519 (§3); the repo layout with
one-writer-per-stream (§4); append-only corrections/tombstones with read-time
resolution (§5); the conflict-free union and the transport-agnostic, two-lane,
values-first protocol (§6); validation-on-read with allowed-signers (§7);
content-addressed attachment blobs (§8); the hot/durable tier mapping and the save
boundary (§9); the positional codec hook (§10).

**Out / deferred:** **encryption-at-rest** — object-level AES-256-GCM for the
untrusted-cloud-folder case (DECISIONS §5/§9; the stack's crypto ext); the
**authoritative central** policy layer — moderator keys, retention, dedup policy
(DECISIONS §2); the **mill** query/aggregation over the union (SPEC-hopper-form
§11); multi-operator projects; mutable (non-append) data-app records and their
merge model (field-level LWW / CRDT — SPEC-hopper §6).

---

## 13. Worked example — a QF sample record

A record in stream `Af3kZ…q` (Arthur's field phone), counter 0:

```json
{ "v": 1, "id": "Af3kZ…q/0", "kind": "record",
  "form": "sha256-9tQ…",
  "at": "2026-06-01T14:22:07Z",
  "values": { "site_id": "QF-118", "lithology": "itabirite", "fe_pct": 64.2,
              "sampled": "2026-06-01" },
  "attachments": { "photo": { "blob": "sha256-7bV…", "mime": "image/jpeg", "bytes": 184320 } },
  "supersedes": null,
  "sig": "<b64url Ed25519 over the JCS of all fields except sig>" }
```

A later correction (Fe % was misread) — counter 4 in the same stream, superseding
`/0`:

```json
{ "v": 1, "id": "Af3kZ…q/4", "kind": "correction",
  "form": "sha256-9tQ…", "at": "2026-06-01T18:03:11Z",
  "values": { "site_id": "QF-118", "lithology": "itabirite", "fe_pct": 46.2,
              "sampled": "2026-06-01" },
  "attachments": { "photo": { "blob": "sha256-7bV…", "mime": "image/jpeg", "bytes": 184320 } },
  "supersedes": "Af3kZ…q/0",
  "sig": "<…>" }
```

The repo, after a second surveyor's phone (stream `Bk9p…`) has synced in:

```
streams/ Af3kZ…q.json  Bk9p…r.json
forms/   sha256-9tQ….json
records/ Af3kZ…q/000000.json  Af3kZ…q/000004.json  Bk9p…r/000000.json  …
blobs/   sha256-7bV…  …
project.json
```

On read: `Af3kZ…q/0` resolves to its head `…/4` (Fe % = 46.2); both surveyors'
streams union with no conflict; every record is signature- and schema-checked;
the photo blob, named by both the original and the correction, is stored once.
The same folder serves identically whether it lives on the laptop, in a synced
Dropbox folder, or as a GitHub repo.

---

*Geoscientific Chaos Union · spec CC0 · 2026 · single-file*
