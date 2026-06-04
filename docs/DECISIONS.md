# DECISIONS — Hopper design session

**Role of this doc:** a dated record of design resolutions reached after the
original specs (SPEC-hopper / -form / -collector) were drafted. It captures *what
was decided and why*, ahead of graduating the load-bearing items into the specs
proper. Where this doc and a spec disagree, **this doc is newer** — but the specs
remain the normative contract until an item is explicitly promoted (see §11).

**Status:** Draft · session 1
**Editor:** Arthur Endlein Correia (with Claude)
**Date:** 2026-06-01
**License:** CC0 (same as the specs)

---

## 0. Context

These resolutions tighten three things the original specs left soft: **durability**
(the existential risk for a field-data tool), the **central/sync model** (which
turned out to want a git-shaped object store, not a hub), and the **rule
expression layer** (which does *not* want `soft`). Several earlier "open /
parked" decisions (SPEC-hopper §7) close here, and one new top-line principle —
**private by default** — joins append-only and definition-is-data as a
load-bearing commitment.

The throughline: nearly every hard problem the original specs parked (provenance,
schema-versioning, merge, private hosting, naive cloud-sync conflicts) collapses
into **one mechanism — content-addressed, signed, immutable objects in
per-writer append-only logs.** Get that object model right and the rest falls
out.

---

## 1. Durability is the headline problem; the only real guarantee is an off-device copy

**Decision.** Treat durability as *the* central engineering concern of the
collector, not a footnote. No browser storage is ever a hard guarantee, so the
real durability floor is **getting a copy off the device** — and that floor is
made *automatic and loud*, never left to the user's memory.

**Why.** Records are immutable, append-only, and serverless; a lost morning of
samples is unrecoverable. ODK Collect writes to disk synchronously; Hopper must
earn at least that trust.

**Mechanism.**
- **On-device best-effort:** `navigator.storage.persist()` **plus** add-to-home-screen
  install is the real eviction lever — and it covers IndexedDB *and* OPFS
  together (they share one storage bucket and one eviction policy). On iOS,
  home-screen install is effectively mandatory (non-installed sites have
  script-writable storage capped at ~a week of inactivity).
- **OPFS earns its place** not for better eviction guarantees (it has none over
  IDB) but for (a) **attachments** — MB-scale blobs that must not bloat IDB —
  and (b) **predictable flushed writes** via `createSyncAccessHandle` (in a
  worker), which is closer to ODK's "on disk the instant you save."
- **The real floor — automatic off-device copy:** auto-snapshot to a
  user-chosen local folder (File System Access) or auto-push to the repo, every N
  records or every save. The user never has to *remember* to back up. **File
  System Access now works on Android Chrome** (not desktop-only) — so the
  folder-mirror is a real **mobile** durability floor on the primary field
  device, and pointing it at a phone's file-sync folder (Drive/Dropbox/Syncthing)
  makes it conflict-free off-device per §5. (Implemented: `store.setMirror` +
  the boot folder picker.)
- **A loud, un-dismissable single-copy indicator:** "⚠ X records exist only on
  this phone," quiet only once those records are replicated somewhere. Values
  single-copy is the loudest alarm (see §8).

**Net:** it is *both* OPFS/persist/install *and* backup discipline — but the
discipline is moved from the human to the app.

---

## 2. Sync is a git-shaped object store, not a hub

**Decision.** Model the whole sync/aggregation layer as a **grow-only set
(G-Set) of immutable, content-addressed, signed records**, replicated git-style
between peers. A "central" is just a peer everyone pushes to **by convention** —
never an architectural requirement.

**Why.** Append-only + stable ids *is* a G-Set, the canonical conflict-free
CRDT. Making each record **content-addressed and signed** (Ed25519 — the stack
already has the primitives) folds three parked problems into one object model:
- **Merge** = union of objects keyed by hash (`git fetch` semantics).
- **Provenance** = the signature. A peer can't forge another collector's
  records; trust is "whose public keys do I accept" (an allowed-signers file), a
  config concern, not an auth server.
- **Schema-versioning** = the form definition is *also* a content-addressed
  object; each record references the form-version-hash it was collected under.
  A v3 device renders a v1 record by following the hash. The drift bomb defuses
  itself.

These are **one mechanism, not three subsystems** — the central reason to adopt
the model.

**Correctness note.** Conflict-free ≠ correctness-free. Anyone can add to a
G-Set, including a record that violates the form's constraints. The mill/central
**re-validates records against their schema on read** and surfaces invalid ones;
validation is a read-time filter, not only a write-time gate.

**Phasing.** v1 = peers exchange signed records, "central" is a well-known
remote. Later = an optional **authoritative sink** (only these keys, only
valid-against-schema, dedup, retention) — a *policy layer on the same object
model*, not a new architecture.

---

## 3. Git-compatible, not git-dependent ("have the cake")

**Decision.** Design the object model to be git-*compatible* but never
git-*dependent*. The repo is a plain directory of files; the collector reads and
writes it over **any** transport (File System Access folder, HTTP `fetch` of a
published static repo, WebRTC peer exchange, archive zip). Git/GitHub is **one
optional host**, never a runtime dependency.

**Why — the disadvantages of coupling to literal git:** heavy in-browser git
(isomorphic-git ~1MB+ fights the single-file ethos); git's text/DAG/branch merge
model is *not* our union merge and leaks conflicts if storage is shaped wrong;
**push-auth (PAT/SSH/OAuth) is a footgun on field phones**; the commit DAG
duplicates the provenance the signatures already carry; git is bad at big
binaries; and on Windows you inherit CRLF/ref/gc ceremony.

**The discipline that makes both merges identical and conflict-free:**
**content-addressed, one-immutable-file-per-object, append-only,
never-rewritten.** No two writers ever touch the same file ⇒ every git merge is
a trivial non-overlapping fast-forward (git's scary merge never fires),
non-git transport is "diff the hash-sets, send what's missing," and integrity +
dedup are free. **Avoid any single mutable shared file** (no `records.jsonl`, no
shared index) — that is the only thing that would reintroduce conflicts.

**Push-auth routed around by topology:** field phones **never touch GitHub** —
they sync peer-to-peer or by file to the laptop. The laptop (the "+1") is the
only thing with git creds and the only thing that optionally pushes to a host.
Maps exactly onto *n autonomous phones + 1 assembling laptop*.

---

## 4. Object layout: per-author / per-device / per-epoch append-only logs

**Decision.** The unit of ownership is the **collector keypair on a specific
device install.** Each device writes **only its own** log; the repo is the union
of all logs.

- **Stream id = author-pubkey + device-id + installation-epoch.** The epoch is a
  random nonce minted at first run (persisted with the key). This is the
  "+something" that matters: it prevents a wiped-and-reused device (whose
  per-stream counter restarts at 0) from colliding ids with its prior life, and
  it survives key rotation.
- **Record id = (stream-id, per-stream monotonic counter)** — globally unique
  and safely append-only with zero coordination.
- **Records point to forms by content-hash** (carrying human `form_id` +
  `version` for legibility); the form is stored **once** as an immutable object.
  Point, don't copy — forms are bigger than records, and the pointer is what
  lets old records render faithfully.
- **The author registry is itself append-only:** each author drops
  `authors/<pubkey>.json`; nobody edits a shared roster. So even "who's in this
  project" is a conflict-free union.

**Why per-author (the denormalization).** It is what lets every device append
*blindly* and never collide — and it is the same discipline that makes git,
WebRTC, **and** naive folder-sync all conflict-free (§5). It also keeps the repo
**enumerable over static HTTP** (you can't list a directory on GitHub raw /
jsDelivr, but you *can* list a small, slowly-growing set of authors and fetch
each log) — which a pure directory-as-set could not do, and a shared manifest
could only do by reintroducing a conflict surface.

**Identity is per-stream for correctness; "which streams are the same person" is
a soft, mergeable label** — a display annotation, not an account system. Don't
build accounts.

---

## 5. Private by default · bring your own folder · public is opt-in

**Decision.** Promote this to a top-line principle alongside append-only and
definition-is-data. The standard deployment is **private**, using infra the user
already has; **public hosting is an explicit opt-in for genuine open data.**

**Why it's free.** We built sync on "exchange files over any transport," so
public GitHub was always just one host on a spectrum whose *floor* needs no host
at all. The ladder, none of it requiring a server you operate or an account you
lack:
1. **Local only** — repo on-device + auto-export to a local folder. One person,
   zero infra.
2. **Your own devices, any folder-sync** — drop the repo folder in Syncthing
   (P2P, no cloud), Dropbox / iCloud / OneDrive / a NAS. Every device with the
   folder has the union.
3. **Team, P2P-assembled** — the laptop pulls from phones over WebRTC / QR /
   chirp / archive; the repo lives on the laptop. Nothing is published.
4. **Optional private host** — private GitHub/GitLab repo, private Pages, a tiny
   org relay. Opt-in.
5. **Public host** — only if chosen.

**Why this beats ODK's Google-Drive mode.** ODK integrated a *specific vendor
API* (Google Sheets/Drive) — bespoke OAuth, quotas, single-vendor fragility. We
treat the repo as **plain files**, so we are automatically compatible with
**every file-sync tool ever made, with zero integration code.** "Bring your own
folder-sync" is universal where "we integrated with Google" is a per-vendor
maintenance burden.

**The convergence that makes it actually work.** The §4 per-author immutable
layout makes folder-sync conflict-free too: each device writes only its own
content-addressed files, never rewritten, so Dropbox/iCloud/Syncthing **never
produce a "conflicted copy."** One layout; git, WebRTC, *and* consumer cloud-sync
all converge on the identical clean union.

**Future opt-in — direct cloud API integration, no server.** The §5 ladder uses
cloud as a *synced folder* (desktop-only). A future convenience for phone-only
users is a **direct Dropbox / Google Drive API** path, and it is **feasible fully
client-side with no server**: PKCE (Dropbox) and the Google Identity Services
token model (Drive) do OAuth for *public clients* with **no client secret**, and
both APIs are CORS-callable from the browser. Because our repo is plain
content-addressed files and those providers expose file/folder APIs, the
integration is **just another `@gcu/vfs` backend** (`dropbox` / `gdrive`,
alongside `idb`/`opfs`/`fsaa`/`comment`/…) — nothing above the VFS changes, and
it's a strictly better fit than ODK's flatten-to-a-spreadsheet-row mode. The only
real costs are *per-provider maintenance* (bespoke OAuth+REST per provider — the
brittleness that bit ODK) and *Google's scope verification* (use the lighter
`drive.file` scope to avoid the heavy review; Dropbox is lighter still); plus a
registered redirect origin (reinforces served-not-`file://`) and the OAuth token
at rest (pairs with object-level encryption). Regret-free: build it later as an
opt-in plugin, depend on it never.

*The registered redirect origin is satisfied by a **`gentropic.org` GitHub Pages
deploy** — a static HTTPS host, no backend executes (the PKCE flow + token
exchange are all browser-side). GCU bakes its **public** Dropbox/Drive client IDs
into the hosted build, so users of the `gentropic.org` instance get the
integration for free, authenticating to **their own** cloud accounts — a courtesy
mirror that runs no server and holds no data. The origin-binding nuance, kept
consistent with BYO-infra (invariant #4): a **self-hoster on their own domain**
can't use GCU's registration (redirect origin won't match), so they either use
the hosted instance, register their own free public client ID, or skip API
integration and use folder-sync/P2P. The core depends on none of it.*

**Implication for the privacy seam (§9):** the "immutable + replicated =
can't un-publish" danger is a property of *choosing a public host*, not of
Hopper. In the default world the only reader is you. **Object-level
encryption-at-rest** (AES-256-GCM, already in the stack's crypto ext) is the
natural companion for the untrusted-cloud-folder case — encrypt each object
before it hits the synced folder; the service sees only ciphertext. Deferred for
v1, but now with a clear home (the object level) and a clear trigger (a
third-party host you don't fully trust).

---

## 6. The rule layer is a small *total* expression language — `soft` is exiled to the mill

**Decision.** Drop `soft` from the collector's rule layer. The logic layer
(`relevant` / `constrain` / `require` / `calculate` / `filter` / `show`) is a
**small, total, pure expression language** — comparisons, arithmetic, boolean,
`between`, `selected`/`contains`, `coalesce`, `if`, and (only if needed)
cross-record aggregates.

**Why.** The security boundary is not "we restricted a general language" — it is
**totality by construction**: no loops, no recursion, no I/O, no definitions ⇒
it cannot hang, side-effect, or escape. Unlike "a restricted profile of a
Turing-complete language," a total expression calculus is **specifiable as a
closed grammar and decidable now** — which turns the spec's one
bounded-new-component from a parked decision (SPEC-hopper §7) into a one-page
grammar. `soft` is a full language (it has `say`, control flow); using it for
`fe_pct between 0 and 100` is both overkill and a fuzzier boundary.

**Build over what exists.** `@gcu/yaml` stays as the carrier (solid). The
`{verb, target, expr}` shape with a readable-line `expr`, and the **madlib ⇄
readable-line duality** (picker form and typed line are the same artifact),
stay. The prototype's hand-evaluator (`tokenize` / `makeEval` in
`reference/hopper-renderer.html`) is already the right *shape* — parser →
expression AST → reactive graph (each rule's free variables are its
dependencies; recompute via **`@gcu/sideact` signals**). Harden and formalize it;
don't replace it. No `soft`, no AIR in the collector.

**Syntax anchors on XLSForm, not `soft`.** The first draft inherited `soft`'s
English-keyword aesthetic (`is above`, `equals`) — but `soft`'s no-symbols rule
exists for soft-keyboard input, which is *not* a Hopper constraint (rules are
authored by the builder's pickers, by YAML hand-editing, or by models). So the
canonical syntax is the **tidied XLSForm expression sublanguage**: **symbolic
comparisons & arithmetic** (`< > <= >= = != + - * /`), **word booleans**
(`and`/`or`/`not`), and keyword sugar only where no clean symbol exists
(`between`, `contains`, `is blank`/`filled`, `matches`). This makes the XLSForm
bridge near-**identity** for the relational/arithmetic operators (less converter
code), and a builder picker may *display* "is greater than" while serializing
`>`. The full grammar is **`SPEC-hopper-rules.md`** (the bounded-new-component
spec; closes the SPEC-hopper §7 "rule-expression runtime" parked decision).

**Where `soft` / AIR *do* belong:** the **mill query layer** (later) — `take
from <form> keep where … group by … total …` over the append-only union. There
the English-keyword ergonomics and real compilation earn their keep. Two
languages, two jobs: a tiny total **rule** calculus in the collector, a richer
**query** language in the mill.

---

## 7. Surfaces, not apps: a lean collector + a mill that runs anywhere

**Decision.** Avoid fragmentation by the GCU house pattern — **one system,
multiple surfaces sharing one repo format** (as Works hosts notebook / book /
terminal). Do *not* avoid fragmentation by cramming everything into the
collector, and do *not* ship a second "phone central" app.

- **The collector surface stays lean and single-author.** Its job is *get YOUR
  records safe off this device.* A minimal "review what **I** logged" read view:
  yes, v1. The **full assembled multi-author union: no** — that would put
  whole-project storage, cross-record query, and trust-blur into the
  reliability-critical field app.
- **The mill is a sibling surface** (assemble / browse / query / export the
  union). Because the repo is content-addressed files, the mill is "open this
  repo and read it." It can run as a Works surface on a laptop, or as a separate
  *mode* of the same Hopper deployment — same codebase, same format, different
  entry point. No second install.
- **"A phone as central" = a capability of the mill surface, opt-in** — a team
  lead's phone *can* run the mill and assemble the team's records when they
  choose; a surveyor's phone runs the collector and never auto-assembles.
  Flexibility without a fork, without bloating the collect path.

**Honest consequence:** v1's "central" experience is thin — peer value-sync,
browse-your-own, and **export-the-union-to-a-sheet** as the first cross-record
payoff (pull this into the collection era; it's small and high-value). The rich
query console matures as its own surface afterward.

---

## 8. Two-lane, values-first sync; chirp-signaling as v1+ε

**Decision.** Sync runs in **two explicit lanes**, and record sync state stops
being binary.

- **Compound per-record state:** **values** {local · synced} and **attachments**
  {none · on-device · partial · synced}. The outbox shows it per-record and in
  aggregate ("42 records sent · 18 photos pending · 240 MB waiting for wifi").
  Never the bare word "synced" — always "values synced" vs "fully synced (with
  media)."
- **Lane 1 (values)** — tiny, sync over anything, finishes fast. **Lane 2
  (attachments)** — big, fat-pipes only (LAN / file / internet). The user drives
  them independently: "send all values now" completes in seconds regardless of
  the photo backlog.
- **Content-addressing makes the split safe:** a record points at its photo by
  hash, so it travels without the blob; the central shows "📷 pending" instead of
  a broken image; the blob binds by hash when it arrives, over any carrier. No
  dangling pointer.

**Values-first is correct triage, not a compromise.** The measurement is
*irreplaceable* (you can't re-take that outcrop from the office); the photo is
heavy and more recoverable. Rescuing the irreplaceable structured data first is
the right durability priority — and the §1 single-copy alarm weights *values*
single-copy as the loudest.

**Be relentlessly clear** about what is and isn't synced, always. (User
requirement, and it's what makes values-first trustworthy rather than confusing.)

**Chirp at v1+ε — the signaling/transport split is what makes it cheap.**
Chirp-as-**signaling** carries only the ~65-byte WebRTC handshake (then data
flows over WebRTC/LAN) — and that is the *exact same ~65 bytes* the QR path
carries. Once QR-signaling exists, chirp-signaling is "same bytes, different
carrier," and `ggwave` is bundled anyway. So: **QR signaling in v1, chirp
signaling as the cheap ε that reuses the handshake codec.** Chirp-as-**transport**
(records over sound) is the bigger lift and waits for the joyful tail; the
hardware carriers (§5.6 of the collector spec) stay tail.

**Carriers are pluggable, by design — two stable seams (note).** Every carrier
rides one of two transport-free seams, so adding one is an *adapter*, never a
redesign: (a) the **`syncSession` channel** — `{ send, onMessage, onClose, close }`
over string messages, for live point-to-point transports; and (b) the **bundle
primitives** — `exportBundle`/`importBundle` (+ `missingBlobs`/`getBlob`/`saveBlob`),
transport-free, for "publish-then-pull" carriers (the archive-file carrier already
uses these directly). Trystero proved (a) is cheap (`trysteroChannel(room)` ≈ 30
lines + tests, zero protocol change; `src/js/sync/trystero.js`).

**Matrix is a wanted future carrier, and it fits *both* seams (note, not yet
built).** Two ways, no design change either way:
- **Room as a live channel** — `matrixChannel(client, roomId)`: `send` posts a room
  event, `onMessage` reads the peer's timeline, `onClose` on leave. Structurally
  identical to `trysteroChannel`; `syncSession` (values + blob lanes) runs unchanged.
- **Room as a persistent append-only log** — Matrix's real edge over WebRTC/Trystero:
  post your objects as events and go **offline**; a peer pulls them from the
  homeserver later. This maps onto the grow-only-set merge *better* than the
  synchronous handshake (`syncSession` assumes a live peer). It wants the thinner
  publish/import primitive — i.e. `exportBundle`/`importBundle` over the room (seam
  b), not `syncSession`. Still additive, because those primitives are already
  transport-independent.

Considerations to carry forward (none blocking, none requiring changes now):
- **Event size** (~64 KiB on most homeservers) — already respected by values-first +
  ~48 KB blob chunking; blobs could optionally use Matrix media (`mxc://`).
- **Identity stays orthogonal** — the trust anchor is the Ed25519 *record signature*,
  not the Matrix account (a transport credential only). Don't conflate them.
- **Weight** — `matrix-js-sdk` (esp. with E2EE / Rust-crypto WASM) is heavy; likely an
  **opt-in surface/build**, not baked into the base collector. (E2EE rooms are a *plus*
  — transport privacy complementing signed/optionally-encrypted records.)
- Same framing as Trystero: a **networked convenience carrier layered on the
  no-network floor** (archive + WebRTC stay).

---

## 9. Corrections via tombstones, and the named seams

**Corrections / retractions (new — append-only needs this).** Field data always
has errors, and you cannot delete in an immutable union. Use event-sourcing: you
**append, never erase.** A signed **tombstone** record (referencing the original
by id) logically retracts it; a **correction** record supersedes it. The
renderer and mill apply these **on read** — tombstoned shows struck/hidden,
corrected shows latest. Append-only stays intact (corrections are just more
records); it is far lighter than the deferred full-mutable-merge mode, and it
shapes the record schema (every record must be reference-able and
supersede-able), so it is decided **now**.

**Seams, named honestly (house style):**
- **Privacy ⊥ durability** — replicate-everywhere-immutable can't un-publish.
  Narrowed by §5 to *"applies when you opt into a public/third-party host"*;
  companion is object-level encryption-at-rest. Don't ship the encryption
  deferral without this warning attached.
- **Time is a data field, not an ordering primitive.** Device clocks in the
  field are unreliable. The **per-stream counter** is the ordering primitive
  (causal order within a stream); cross-stream global order is unavailable
  without coordination — and append-only never needs it. `now`/`start`/`end` are
  best-effort metadata for the analyst, never something correctness leans on.
- **Attachments-pending** — a record can be live and useful with its media still
  en route (§8); surface it, never silently.
- **~~Flat forms only (v1)~~ — REVERSED by §12.** Originally a seam (no repeats,
  no nested groups, on the "widgets-not-structure" honesty point). Repeats +
  nested groups were since **hoisted into v1** (hierarchical tree) — see §12.
- **Served/installed, not `file://`** — durability (install+persist) and capture
  (secure context for camera/GPS) both push serious use to a served PWA. The
  honest pitch is "a single artifact you can host trivially," not "double-click a
  file."

---

## 10. What's left is execution, not open design

These are decided-by-building, not by more discussion:
- **The renderer port** — wiring the rule-expression AST into `@gcu/sideact`'s
  signal graph (field widgets as signals; relevance/validation/calc cascade).
  This is the real code mountain.
- **The canonical at-rest record envelope** (the signed object shape).
- **The PWA / service-worker update flow** (app-version vs form-version vs
  record — form-version is solved by §4; app-version is standard SW).

---

## 11. What graduates where (promotion map)

**Promotion applied 2026-06-01.** The original specs now carry amendment banners
and inline updates for the items below; `SPEC-hopper-rules` and
`SPEC-hopper-records` are drafted. The map records where each landed:

| Decision | Lands in |
|---|---|
| §1 durability mechanism; §8 two-lane state; storage readout | **SPEC-hopper-collector** §4–5 |
| §2 git-shaped G-Set; §3 git-compatible-not-dependent; §4 per-author layout; §9 tombstones | **SPEC-hopper-records.md** (drafted ✓ — the object model) + folds into **SPEC-hopper-collector** §4–5 |
| §5 private-by-default principle | **SPEC-hopper** §1 (new commitment) + collector §6 (deploy) |
| §6 total-expression rule language; `soft`→mill | **SPEC-hopper-rules.md** (drafted ✓ — folds into **SPEC-hopper-form** §6); closes SPEC-hopper §7 "rule-expression runtime" |
| §7 surfaces-not-apps; collector lean / mill sibling | **SPEC-hopper** §3 (component map) + collector §2 |
| §9 seams (time, privacy, flat-forms, served-not-file) | scattered: collector §4/§6, form §12, hopper §5 |

The original specs and the two new specs are now mutually consistent; this doc
remains the **rationale-of-record** for *why* each call was made.

---

## 12. Repeats + nested groups → v1; the tree goes hierarchical

**Decision (reverses the "flat forms only" seam, §9).** Hoist **repeats**
(`begin_repeat`) and **nested groups** into v1. The §8 tree becomes genuinely
**hierarchical**: a `fields` node is a leaf field or a container (`group` /
`repeat`) carrying `children`.

**Why.** Repeats are bread-and-butter for the geoscience domain (log each sample
/ fracture / drill interval); a flat-only tool both misses that and weakens the
ODK on-ramp (many real ODK forms use repeats). Nested groups are cheap
(presentational). Deciding *before* the renderer is built makes it a
from-the-start design rather than a retrofit — the main reason to settle it now.

**What it costs — and doesn't.**
- **Storage / envelope: free.** A repeat is `values.<name> = [{…}, …]` — nested
  JSON the JCS canonicalizer and envelope already serialize. No records change.
- **Nested groups: presentational only.** Names stay form-unique, so grouped
  fields keep flat `values`; a group renders **collapsible**. No data-model cost.
- **Tree: hierarchical** (form §4/§8) — the foundational change.
- **Rule language: per-instance scoping + within-record aggregates.** A rule
  inside a repeat evaluates per-instance; `count`/`total`/`max`/`min`/`mean`
  aggregate over its instances. Over a finite in-record collection these stay
  **total** — they fit the security boundary; they add function-call grammar
  (SPEC-hopper-rules §3.4, §4.7).
- **Renderer: recursive walk, collapsible groups, add/remove instances, reactive
  aggregates.**
- **Bridge: structural `begin_group`/`begin_repeat` mapping + common aggregate
  XPath (`sum`/`count`); exotic node-set XPath (`indexed-repeat`, `position(..)`)
  warns** (the standard three-tier policy).

**Staging (so "repeats in v1" doesn't balloon).** The *structure* (hierarchical
tree, recursive renderer, per-instance scoping) is v1. **Aggregate sophistication
is minimal** — `count`/`total`/`max`/`min`/`mean` over a repeat — with
richer/filtered aggregates a fast-follow. Delivers the 90% case ("log N samples;
show the count; total the assays") without the hard tail.

**Roadmap hygiene (two honest buckets for what stays out).**
*Deferred-but-wanted:* grid/pages styling, data preloading / `pulldata`, external
file-backed itemsets, multi-level cascading filters, richer/filtered repeat
aggregates. *Different model (not a gap):* `public_key` submission encryption —
we have signed records + optional object-level encryption-at-rest; warn on
import, don't chase.

**Extensions confirmed.** Hopper-native features live in the tree and ride
through XLSForm in **Hopper-namespaced columns ODK ignores** (`hopper::…`) — so
they survive round-trips through Excel/ODK tooling untouched, additive and
gracefully degrading, never corrupting another consumer's form. `show` is the
precedent; v1 keeps extensions minimal (`show` + existing geo params).

---

## 13. Bundle everything (incl. SheetJS) — single-file deploy beats a lean PWA

**Decision.** Inline all code + deps into the one `collector.html` (SheetJS's
~896 kB included). **Do not** code-split or lazy-load.

**Why — and a standing guard against re-proposing lazy-loading.** Single-file
deploy is load-bearing for Hopper: the owned, emailable, host-anywhere artifact.
Lazy-loading trades that away (a chunk must ship alongside ⇒ no longer one file)
for benefits that are small and one-time:
- *Faster first load* — but the service worker caches the bundle after first
  load, so every repeat open is identical regardless of size. One-time only.
- *Cheaper updates* — a split chunk lets an app update re-ship only the changed
  core, not all ~1.1 MB. Real, but only bites if you're shipping frequent updates
  to deployed users (we aren't).

Neither outweighs the ethos at our scale. And the deploy model is **one artifact,
two contexts**, so there is no "PWA vs single-file" fork to maintain: *served*
(https + the `manifest`/`sw`/icons shell) = full PWA (SW, persist, install,
secure-context capture, OAuth); *opened from disk* (`file://`) = a degraded but
working preview (no SW/persist/secure-context — the §9 "served-not-file" seam).
Graceful degradation (guarded SW registration, capture stubs) is the only
discipline this requires. Bundling is therefore the *correct* choice, not debt —
it is what makes the single file genuinely self-contained.

**If a future you is tempted to add lazy-loading:** the honest triggers are
narrow — real field testing shows first-load on bad connections is a problem
*and* you're shipping frequent updates to deployed users. Even then, the cleaner
move is usually *"heavy authoring deps (SheetJS) live in the **jig** surface, not
the field collector"* — not code-splitting the collector. Don't lazy-load on
instinct; it undercuts the single-file artifact.

---

*Geoscientific Chaos Union · CC0 · 2026 · single-file*
