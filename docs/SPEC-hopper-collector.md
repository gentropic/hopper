# SPEC-hopper-collector

**System:** part of Hopper — see **SPEC-hopper** for the architecture overview, **SPEC-hopper-form** for the format
**Component:** the collector — the ODK-Collect-shaped field app
**Status:** Draft v0.1
**Editor:** Arthur Endlein Correia
**Last revised:** 2026-06-01
**License:** spec CC0 · reference implementation MIT
**Amended by:** `SPEC-hopper-records` (the object model, §4–5) + `DECISIONS.md` (durability §1, git-shaped sync §2–4, private-by-default §5, surfaces-not-apps §7). Newer where they differ; §2, §4, §5, §6 are updated inline.

## Abstract

The collector is the most-touched Hopper surface: the offline app a field worker opens to fill forms and send records. It wraps the renderer (SPEC-hopper-form → live form) in a shell that manages *which* forms exist, *where* records are kept, and *how* they leave the device. This document specifies that shell and records the reasoning behind its shape, so the build inherits the *why*, not only the *what*.

**Why a dedicated collector at all.** ODK splits the field role across three deployments (Build, Collect, Central) run by different people. Hopper collapses them into one serverless experience, but the *act of collecting* is still distinct from authoring and analysis — it happens on a phone, often offline, under time pressure, by someone who did not design the form. The collector is that surface, and it is named Hopper because it is the part everyone sees (SPEC-hopper §3).

---

## 1. One shell, forms as data

The collector is **one boring PWA**. Forms are added to it as *data*, not shipped as separate apps.

**Why not a PWA per form.** Pwa-per-form multiplies installs, update surfaces, and storage scopes for no benefit to a collector whose job is reliability. ODK Collect is one app that pulls many blank forms; Hopper follows that proven shape. A form is a §8 tree (SPEC-hopper-form) — small data the shell loads, renders, and collects against.

Forms reach the shell four ways, all resolving to the tree:

| source | use |
|--------|-----|
| **project registry** | a `dd`-style index the shell subscribes to; the operator publishes/updates the form set |
| **URL** | `gh:` / `gist:` / a published Sheet — paste or scan a link |
| **capsule** | a shareable link/QR carrying the tree (deflated) |
| **uploaded `.xlsx`** | an existing XLSForm, imported via `@gcu/hopper-xlsform` |

The renderer never cares which; it receives a tree.

---

## 2. The shell

Three destinations, nothing more: **Forms · Outbox · Settings**.

**The collector is the lean, single-author field surface** (DECISIONS §7). Its job is *get **your** records safe off this device* — fill, queue, send, and see your own durability. Assembling and querying *everyone's* records (the union) is the **mill**, a sibling surface of the same system sharing one repo format (SPEC-hopper-records) — runnable in Works or as a mode of the same deploy, never a second app, and never bloating the reliability-critical collector with whole-project storage. v1's collector may browse **your own** submitted records; the full union is the mill's.

**Why three.** The frequent actions are *fill* and *send*; adding a form is rare and operator-ish. The mock learned this the hard way — an earlier build put a large persistent "Add form" button as a co-equal nav slot, which over-weighted an infrequent action and shouted an accent permanently (against Switchboard's "accents are events, not ambience"). Add is therefore a restrained row at the top of the **Forms** list (the + glyph is the only accent), and the nav carries only real destinations.

- **Forms** — the loaded forms, each showing pending-record count; a quiet "+ add form" row opens the source sheet (§1).
- **Fill** — the rendered form (the engine). Validate on save; on success, append to the outbox.
- **Outbox** — pending and sent records; a "send" action routes to sync (§5).
- **Settings** — the *trust* controls, not decoration: collector identity (rides into every record and P2P session), the subscribed project/registry, a **storage durability readout** (§4), sync defaults, dark/light theme (light "equipment gray" reads under field glare), and About.

No persistent six-accent ident band on working screens; it lives in About as a labelled legend, where it is a signature rather than ambient color.

---

## 3. Identity

Each collector has a **name** (human, e.g. the surveyor) and a **device id** (stable, generated). Both are stamped onto every record and are the peer identity in sync (§5). Identity is set in Settings and is load-bearing: it is how a central tells two field phones' records apart, and it is part of each record's stable id (§4).

---

## 4. Records and storage

### 4.1 Append-only records

Collection is `mode: "append"` (SPEC-hopper-form §5). A saved record is an **immutable, Ed25519-signed envelope** in a **per-stream append-only log** — stable id `<stream-id>/<counter>` (stream-id = hash of pubkey + device-id + install-epoch), naming the **form-version hash** it was collected against, its `values`, attachment references, and a best-effort timestamp (ordering is the per-stream counter, never the clock — DECISIONS §9). The full object model — envelope, content-addressing, corrections/tombstones, the conflict-free union — is **SPEC-hopper-records**.

**Why append-only.** Immutability makes sync a conflict-free union (§5) and aggregation trivial (no merge, no last-writer arbitration, no central authority needed for correctness). It also matches field reality: a sample logged is a fact, not a mutable cell. (An *editable* data-app mode — mutable records, field-level merge — is a separate, later problem; SPEC-hopper §6/§7.)

### 4.2 Storage tiers

Two tiers, declared in the form's `meta.tiers`:

- **hot — IndexedDB.** The working store: drafts, the record queue, the loaded form set. Survives reloads and offline.
- **durable — comment-backed.** A gzip-JSON snapshot embedded in the artifact's HTML comments, so a saved/exported copy of the app *is* a copy of its data.

**The durability footgun, and the rule.** Durable lags hot — a snapshot is only as fresh as its last write. The invariant is therefore **never single-copy**: sync early, and on first use prompt **install + `persist()`**. An installed PWA with persistent storage granted reaches app-tier durability on Android; the only remaining loss path is the user explicitly clearing data. This is also the honest seam: Hopper collection is *at least as fine as ODK* once installed+persisted, and *less guaranteed than ODK before that* — which is exactly what the Settings readout exists to make visible.

**The durability mechanism** (the headline concern — DECISIONS §1). No browser storage is a hard guarantee, so the real floor is an **automatic off-device copy**: auto-export / auto-push the repo objects every N records or every save, so the user never has to *remember*. On-device, `persist()` **+ install** is the eviction lever (it covers IndexedDB and OPFS alike); **OPFS** additionally holds MB-scale attachment blobs and gives flushed, predictable writes (`createSyncAccessHandle`). The readout (§4.3) carries a loud, un-dismissable indicator when records exist in only one place — *values* single-copy is the loudest alarm, since the measurement is irreplaceable where a photo is more recoverable (DECISIONS §8).

### 4.3 The storage readout

Settings surfaces, plainly: whether persistent storage is **granted** (green) or best-effort (amber), bytes used, record count, and actions to **export all** and **clear sent**. This is a trust instrument — a field worker should be able to see, at a glance, that today's records are safe.

---

## 5. Sync

Records leave the device opt-in and append-only, by whatever channel is available — from a file handed over later to a live peer link. Every path shares one merge rule and one principle.

**Union merge.** Because records are immutable with stable ids (§4.1), merging two peers is set-union keyed by id: push what they lack, pull what you lack, no conflicts possible. A central holds **copies** for cross-app query (SPEC-hopper §2) — the aggregation point by convention, never the system-of-record, so a collector is complete and correct alone. **Flow is opt-in**: a collector replicates when asked, the central pushes form/registry updates back (§1), nothing syncs silently.

**The union is a grow-only set of signed, content-addressed objects** (SPEC-hopper-records §6): merge is set-union *by address*, conflict-free over every carrier — git, WebRTC, **and** naïve folder-sync (Dropbox/iCloud/Syncthing) alike, since no two writers ever touch the same file. A "central" is just a peer pushed-to by convention; git is an optional *host*, never a runtime dependency (DECISIONS §3). Sync runs in **two lanes, values-first** (DECISIONS §8): tiny record values sync over any carrier (down to chirp — §5.4); MB attachment blobs wait for fat pipes and bind by hash, so a record renders "📷 pending" until its photo catches up. Sync state is therefore *compound* per record (values × attachments) and surfaced plainly — "send all values now" completes independent of the photo backlog.

### 5.1 Why a live link needs an out-of-band carrier

The only browser-to-browser pipe is WebRTC — a browser cannot open a listening socket, so nothing else can bootstrap a peer connection. Before WebRTC connects, each side must hand the other its DTLS fingerprint, ICE credentials, and candidates: the **offer** from the initiator and the **answer** from the responder. That exchange is inherently **two-way** — the responder cannot skip sending its own fingerprint and candidates, or the initiator can neither encrypt to it nor route to it. So any serverless live link needs *some* channel to carry an offer one way and an answer back.

**Why it cannot be typed.** The handshake has an entropy floor of ~512 bits per side, dominated by the 256-bit DTLS fingerprint (a hash, incompressible) plus the ~130-bit ICE password — both browser-generated and unshrinkable; the candidates are the small part. Strip the SDP boilerplate (rebuilt from a template both sides hold) and deflate, and one side lands at ~65 bytes. That is a trivial QR but ~40 dictionary words — untypeable. The conservation law: a short human code only ever works as a *pointer to a server that holds the bits*. No server ⟹ the ~65 bytes must physically travel by a dense channel, never a keyboard.

**The carriers** are all serverless and differ only in ergonomics:

- **QR** — two scans (offer, then answer). Line-of-sight, and authenticated by physically seeing the other screen, so no man-in-the-middle. The default.
- **NFC** — an Android tap (Web NFC); ~65 bytes fits an NDEF record, so it carries a leg without aiming a camera — good for the awkward return leg.
- **chirp** — data-over-sound (§5.4); ~8–16 B/s, so a ~65-byte side is ~4–8 s, ~8–16 s round trip. No line-of-sight, no camera, just proximity and relative quiet — the answer to "a desktop with no webcam."

### 5.2 NAT, and where infrastructure creeps back

On a shared **LAN or hotspot**, peers connect on **host candidates** (local IP:port): tiny, and nothing expires, so the QR/chirp handshake is leisurely and the link is rock-solid — the field-team and desk cases. **Across networks** a peer needs STUN to learn its reflexive address (a lightweight public address-lookup, *not* a broker or relay), and the NAT binding behind that candidate then **expires** in tens of seconds to minutes — a tight window for a manual exchange, mitigated by moving promptly or re-generating. Only **symmetric NATs** that defeat a direct path need a TURN **relay**, which is real infrastructure — and there the rule is to fall back to the archive file, not to stand up a relay.

### 5.3 The tiers, in order

1. **Archive file** — bundle records into one file, hand it over by any means later. No connection of any kind, any size. The floor.
2. **Chirp transport** — send the records' *values* directly over sound (§5.4), fully air-gapped, no network at all. Small batches only; attachments excluded. The "bad room, two phones, nothing else" escape hatch.
3. **Direct link** — bootstrap WebRTC via a serverless carrier (QR / NFC / chirp, §5.1) and sync over the LAN. No rendezvous service; works on local wifi with no internet.
4. **Trystero** — automatic peer discovery over a public tracker; convenient, but needs internet to reach the rendezvous.
5. **PeerJS-by-id** *(optional, off by default)* — a short, typeable id, at the cost of a broker holding the handshake (public cloud, or a self-hosted PeerServer). The ergonomic tier for an org willing to run one piece of infrastructure; it spends the no-server principle, so it is opt-in.

### 5.4 Chirp's two roles, and what makes transport viable

Sound is a *carrier*, so it can play either part. As **signaling** it carries the ~65-byte handshake (§5.1) and the data then flows over WebRTC/LAN. As **transport** it carries the records themselves — viable for non-attachment data *only because the receiver already holds the form definition* (the §8 tree). A record is sent as a positional tuple of **values** against that known schema: a `select` becomes a one-byte choice index, numbers and dates pack tight, field keys vanish because position implies them. A QF sample record drops from ~250 bytes of JSON to ~20–25 bytes, deflated further across a batch — so at ~16 B/s that is ~1–2 s per record, and a day's tens of records cross in a minute or two. Binary attachments (photo/audio/file, KB–MB) are hopeless at this rate and never take this path; they wait for the file or LAN paths. This positional-against-the-schema codec is the same compaction the capsule wire form and the denormalized export want — one mechanism, not a special case.

Implementation: `ggwave` (FSK + Reed-Solomon, audible or ultrasound), range ~1 m, tolerant of moderate background noise on the higher-frequency protocols.

### 5.5 Bundling

The chirp codec (`ggwave`, MIT, ~163 kB WASM + glue) is **bundled into the app, not lazy-loaded.** A fallback for the no-network case cannot depend on a network fetch to arrive — you never know when it will be needed. The fixed ~200 kB is the price of an escape hatch that works when nothing else does; it ships in the app and is cached on install, always present.

### 5.6 Experimental: the browser↔device family *(out of v1 scope)*

Two PWAs cannot connect over Bluetooth — Web Bluetooth makes a browser a GATT *central* only (it connects out to a peripheral, never advertises as one), and it is Chrome-only besides. But the central/host direction *is* open: a browser can reach a non-browser device over Web Bluetooth (BLE), Web Serial (USB on desktop), or WebUSB (USB on Android). A small device sitting in that gap can bridge or carry for two PWAs that cannot see each other. Two members, by range:

**Local relay — a flashed bridge.** A Pico W, ESP32, or ESP32-C3 acts as a BLE peripheral to the phone and a USB-serial device to the computer, piping bytes between the two (Web Bluetooth on one side, Web Serial on the other); or, where the computer has a BLE radio, it serves both at once as a multi-connection peripheral. The BLE leg runs at tens of KB/s and USB far faster — enough for real record sets and modest attachments, so under awful local constraints (no internet, no usable wifi) a $5 board you flash yourself becomes a plausible *primary* offline sync, not merely a fallback.

**Long-range mesh — LoRa.** A Meshtastic node is itself a BLE peripheral / serial device, so a PWA pushes record *values* to it over Web Bluetooth or Web Serial and the mesh relays them across kilometres with no cell, wifi, or internet — the values-only, schema-compacted story of §5.4 stretched to a valley instead of a room. Needs a framing of records over the mesh's messaging.

Both are hardware — a gadget to build and carry, Android for the phone leg — so they stay accessories, never the zero-dependency core. They are the neo-dadaist tail of the carrier spectrum, and that is the point: with the software paths above and a $5 board below them, Hopper degrades all the way down to two devices in a dead zone and still moves the data. The system makes it work when the network doesn't, rather than failing with it. Worth speccing, and worth building for the fun of it.

---

## 6. Deploy and distribution

The collector ships as a **boring served PWA**: one HTML file, a web manifest, and a small service worker for offline caching. That is the whole deployment.

**Why boring, not `dd`.** The `dd` container runtime (the 404-PWA-factory lineage) is clever — multi-app images, scoped service workers — and it is the right tool for a genuine multi-app factory. For a *reliability-critical collector*, that cleverness is fragility we do not want; one plain installed PWA is the most robust substrate, and the collector is the wrong place to spend novelty. `dd` stays reserved for the factory case.

**BYO-infra is first-class.** Export a zip, host it on GitHub Pages, Cloudflare, Netlify, or a phone's Termux — the app is complete with no hidden server. GCU may run a hosting *mirror* as a convenience, transparently someone else's static host; it withholds nothing. A repo template and instructions ship with the app so self-hosting is a copy-paste, not a project.

**Private by default** (DECISIONS §5). The standard deployment uses infra the user already has: a local folder, any file-sync they trust (Dropbox/iCloud/Syncthing — conflict-free because each device writes only its own immutable files), or peer-to-peer. **Public hosting is an explicit opt-in** for open data, never a precondition. A `gentropic.org` GitHub-Pages deploy is a *static host* that satisfies the secure-context and (future) OAuth-redirect-origin requirements with **no server**; a future Dropbox/Drive *API* integration is feasible client-side as a `@gcu/vfs` backend — no server, no client secret (PKCE) — a regret-free opt-in, never a dependency.

**Secure context required.** Camera, microphone, and geolocation need HTTPS or an installed PWA; `file://` blocks exactly the device-dependent questions. So real deployments are served or installed, never loose files — which also aligns with the install+persist durability path (§4.2).

---

## 7. Coverage

The collector renders essentially the whole XLSForm palette on an Android PWA, including in-page `barcode` (a win over Collect's external scanner). The named seams (SPEC-hopper §5) are `background-audio` and unattended background GPS tracking — marked unsupported or degraded to foreground capture, never silently broken.

---

## 8. Scope (v1)

**In:** the one-shell / forms-as-data model; add-from registry / URL / capsule / xlsx; the fill → validate → append loop over the renderer; append-only records with stable ids and an outbox; IDB hot + comment-backed durable storage; install + `persist()` onboarding and the storage readout; the sync tiers — archive file, chirp transport, serverless direct link (QR / NFC / chirp → WebRTC over LAN), and Trystero — with union merge; the bundled `ggwave` codec; boring served-PWA deploy with a BYO-infra zip + repo template.

**Out / deferred:** mutable record editing and its merge model; the central's aggregation console (a mill-era concern, SPEC-hopper §6); encryption at rest; background/passive capture; the experimental hardware carriers (§5.6); the `dd` factory substrate.

---

## 9. Worked flow

A surveyor in the Quadrilátero Ferrífero opens the installed collector (persistent storage granted, shown green in Settings). The **QF Sample Log** form is already present from the project registry. They fill it at an outcrop — Site ID, a GPS point, lithology, Fe % — the renderer flags "high-grade" past 60 and blocks an out-of-range assay; on save the record is appended to the outbox, immutable, stamped with their identity and a stable id. Offline all morning, the outbox grows. Back in signal, they tap send: Trystero finds the central, the two record sets union, no conflicts, pending turns to sent. Had there been no signal at all, an archive export to a file would have done the same job by hand. The record was never single-copy from the moment it was saved.

---

*Geoscientific Chaos Union · spec CC0 · 2026 · single-file*
