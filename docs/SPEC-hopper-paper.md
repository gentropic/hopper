# SPEC-hopper-paper

**System:** part of Hopper — see **SPEC-hopper** (architecture), **SPEC-hopper-form** (the format), **SPEC-hopper-collector** (the app)
**Component:** paper capture — printable, machine-readable forms that round-trip to signed records, offline, with a phone camera
**Status:** Draft v0.1 (design / roadmap)
**Editor:** Arthur Endlein Correia (with Claude)
**Last revised:** 2026-06-02
**License:** spec CC0 · reference implementation MIT
**Rides on:** SPEC-hopper-form §4/§8 (field types + canonical tree), SPEC-hopper-records §8/§10 (attachments + the positional codec), SPEC-hopper-rules (constraints, re-checked on ingest), SPEC-hopper-collector §6 (deploy / print).

## Abstract

A Hopper form is a **§8 tree**, and every surface is a *converter into that tree*
(SPEC-hopper invariant #1). This document adds **two more serializations**: a
**print view** (tree → a fixed-geometry, machine-readable sheet) and its inverse
(**scan → a record**). The loop is *print → fill by hand → photograph → ingest*,
and it runs **entirely offline, in the browser, on a phone camera** — no server,
no cloud OCR, no dedicated scanner.

The trick that makes this tractable: **because we hold the form definition, the
printed sheet is its own scanning schema.** Reading is *sampling known zones
against a known choice list*, not recognizing a generic document. That turns "OCR
a form" (hard, generic, ML, server) into "read a mark at a known coordinate"
(easy, deterministic, ours). Handwriting is handled by **how constrained the zone
is**, not overpromised: **boxed digits** (and block-capitals) are recognized by a
small bundled model — the segmentation a comb gives for free is exactly what makes
this the solved, MNIST-shaped case — while **freeform/cursive** is cropped to an
image attachment for later transcription, the way the rest of Hopper handles media.

## 1. Why paper, and why Hopper is the one to do it

**Why paper at all.** Field reality outruns devices: dead zones, dead batteries,
glare, gloves, regulatory wet-ink trails, enumerators who trust a clipboard over a
phone, and the plain fact that paper is the most robust storage medium most teams
already own. ODK and its kin went digital-first *precisely because paper's
bottleneck is transcription* — and that bottleneck is exactly what a self-reading
sheet attacks. Paper is Hopper's lowest carrier rung (SPEC-hopper-collector §5):
the system should degrade all the way down to ink and still move data.

**Why Hopper specifically.** "The definition is data" (SPEC-hopper §1) means the
same tree that drives the screen renderer can drive a *printer*, and — read back —
**the tree tells us where every field is and how to interpret a mark.** No other
serialization work is needed: paper is two more views of the one contract. Most
form / scanning systems must *infer* structure from the page; Hopper *prints the
structure it will later read.*

**Standing on prior art.** The lineage is well-trodden and we lean into it rather
than reinvent: **OMR / Scantron** (bubble sheets — sample darkness in a known
cell; brutally reliable, still used for exams and ballots); **Teleform / Cardiff**
(designed forms with corner registration marks + character combs that read
themselves); **SDAPS** (open-source LaTeX questionnaires with corner markers +
checkboxes, scanned back — the closest precedent to Tier 1 here). The modern ML
extraction stack (LayoutLM, Donut, cloud Document AI) is powerful but server-bound
and heavy — *against* the ethos — so we take the deterministic OMR/zonal path and
keep ML/OCR an explicit opt-in, never the default (§6).

## 2. The core idea — schema-relative reading

Hopper already has a family of **schema-relative carriers**: because the receiver
holds the §8 tree, the carrier can be *dumb and positional*. The same idea appears
in three media:

| carrier | medium | speed | needs |
|---------|--------|-------|-------|
| **capsule / QR** | light | instant | a camera or a link |
| **chirp** | sound | seconds | proximity + relative quiet |
| **paper** | ink | a scan later | a printer + a camera |

Paper is the slow, durable, no-live-device member. Its **reader is a codec into
the canonical record** — the *same* "interpret-against-the-schema" core as the
positional QR/chirp codec (SPEC-hopper-records §10). Build one and the others get
cheaper; they share the schema-relative engine and differ only in how marks are
carried. A scanned sheet therefore produces an ordinary §8 record, validated
against the form's rules (SPEC-hopper-rules) on ingest like any other.

## 3. Anatomy of a scannable sheet

A sheet is **fixed-geometry** — laid out at exact millimetre coordinates as
**SVG/PDF (or a canvas raster), not HTML + `@media print`**, which reflows
unpredictably across browsers and printers. Deterministic geometry is
load-bearing: the reader samples coordinates, so the print *is* the coordinate
system. Every sheet carries four standing elements:

1. **Header QR** — the form's **content-address** (which form + version), a
   **sheet-instance id**, and the **page index / count**. A scanned page therefore
   *self-identifies its schema and reassembles* multi-page sets. When the form is
   small enough, the QR may carry the **form capsule itself** (§8) so a blank sheet
   can bootstrap the form into a device with no network.
2. **Corner fiducials** — registration markers at the page corners so a phone photo
   can be **perspective-corrected** (4-point homography → a rectified grid); edge
   ticks aid long sheets. QR finder-patterns work, but for sub-pixel pose prefer a
   real **ArUco/ChArUco** target — a *planar fiducial + pose* detector that is a
   **shared GCU primitive** (the Portal viewing-mode spec wants the same one; build
   it once).
3. **A calibration strip** — a **grayscale step wedge** (e.g. 5–7 patches from
   paper-white to ink-black) printed in a fixed zone, so the reader sets
   **adaptive thresholds** from *this sheet under this light* rather than a global
   guess. **BW-first**: the wedge alone handles exposure/contrast for monochrome
   printing and lighting. Optional **color patches** add white-balance/de-shadow
   when a color printer is available — a bonus, never a requirement.
4. **Field zones** — one positioned block per visible field (§4), each at a known
   rectangle the reader samples.

### Layout is a sibling renderer backend — built once, not per-form

The sheet is **generated from the §8 tree**, not hand-typeset. Where `render.js`
draws the tree to the DOM, a **paper backend** draws the *same tree* to a
fixed-geometry sheet: same relevance / choices / repeats (already solved), a
different widget set. So this is not a second form engine — it's a second *drawing
surface* for the one we have. The work is **front-loaded into one engine + a widget
library with good defaults**, then forms inherit it the way they inherit the screen
renderer today (auto-form first, per SPEC-hopper-form's auto-layout intent).

- **Auto-layout + sparse hints.** Most forms should print correct-and-scannable with
  zero tuning; authors reach for **view annotations** (form §8 `views`) only to nudge
  — comb width, a 2-column bubble grid, "keep this group on one page." The hint layer
  is the pressure valve between fully-auto and hand-set; aim for ~80% needing none.
- **SVG fixed-geometry → snapshot-testable.** A generated SVG lands every zone at the
  same millimetre, so layout gets a **golden-layout test suite** ("this tree → this
  sheet") — verifiable, not vibes. This is the upside of *not* fighting reflowing CSS.
- **The craft concentrates in the widget library.** Each paper widget (bubble grid,
  digit comb, checkbox, write-in zone, map frame, exemplar strip) carries a real dual
  constraint — comfortably **hand-fillable** *and* cleanly **machine-readable** — that
  wants empirical tuning against real scans (bubble size, comb spacing, dropout/box
  geometry), plus **BW-first, photocopy-survivable** typography (forms get copied;
  toner is lost). This is the part that earns "apply as much good design as we can":
  the engine makes forms *correct*; care in the widgets makes them *good to fill in
  the rain*. Switchboard (Barlow / Space Mono, equipment-gray) is the starting palette,
  but print is its own medium — hairlines, ink spread, exact physical size.

### Per-page furniture budget

The machine-readable furniture (header QR, fiducials, calibration strip) plus its
**quiet zones** is space you're not writing in — a real budget, especially on a dense
field-notes page. The governing move: **amortize identity onto the edition** (§13), so
per-page furniture stays small.

- **Tiny id-only QR.** The *form capsule* lives on the edition's back cover (§13),
  printed once — so a per-page header QR carries only `edition · page · instance`, a
  handful of bytes → a small QR (~centimetre; Micro QR if the detector supports it —
  test, support is spotty). Use numeric/alphanumeric mode and modest ECC (geometry is
  the fiducials' job, not the QR's), and print a **short human-readable code** beside
  it as a smudge-proof backup (people can read a page id too).
- **Small but spread fiducials.** A good homography wants 4 corner points *spread*
  (clustered solves poorly) but each can be small. **ArUco** corners (self-identifying,
  recover from rotation / a missing corner) beat plain crop-marks for angled, partial
  notebook shots; one corner QR can double as an anchor. **Bound pages bow**, so a few
  **edge/midpoint ticks** buy mild non-planar correction a flat loose sheet wouldn't need.
- **Thin calibration strip.** Must be in-frame each photo (light varies per shot), but
  a few-millimetre **edge/footer strip**, not a block.
- **Right-size to the page's job.** A free-write notes page needs only reliable *id* +
  enough *dewarp* for the flag margin + a clean *text crop* — modest furniture, generous
  writing area; a dense-OMR page spends more. Exact sizes are an **empirical-tuning** job
  against real prints + phone scans, not an a-priori guess.

## 4. Field types on paper (§4 mapping)

| §4 type | printed as | read as |
|---------|-----------|---------|
| `select` / `yesno` | a row/column of **bubbles or boxes**, one per choice | OMR — darkest cell wins (constraint: exactly one) |
| `multiselect` | bubbles/boxes per choice | OMR — each cell independently on/off |
| `rank` | an **items × positions** bubble grid | OMR per row → the position chosen |
| `number` / `int` / `date` / `time` | a **comb** (one box per digit/char) with the mask printed | per-box: opt-in digit OCR, or crop-and-transcribe (§6) |
| `text` | a bounded **write-in zone** | **cropped as an image attachment** by default (§6); opt-in OCR if comb-constrained |
| `barcode` | print the value's barcode/QR; or a write-in zone | scanned directly (we already read barcodes) |
| `geo` (point) | a coordinate **comb**, or a marked point on a map (§7) | comb read, or map-pixel → coordinate |
| `geotrace` / `geoshape` | a **map sketch zone** (§7) | dewarped, georeferenced raster + optional vectorization |
| `note` | printed prose | — (not a field) |
| **free-write page** *(notes / sketch + flags)* | a ruled or blank **write/sketch area** beside a fenced margin of labelled **flag bubbles** (☐ sample · ☐ station · ☐ photo · …) | the area **cropped to an image attachment** (§6b); the margin flags read by **smear-robust OMR** (below), tied to text rows by printed rule-lines |
| `calc` / `hidden` | printed read-only, or omitted | — (recomputed on ingest from the read values) |
| `photo` / `audio` / `video` / `file` | a "**capture on device**" note + a per-sheet QR | paper can't hold media; the QR links the sheet to a digital attachment added later |
| `group` | a titled block | nested zones |
| `repeat` | **K pre-printed instances** (K a print option) + a **continuation sheet** (own header QR, same sheet-instance id) | bounded cardinality per sheet — an honest constraint (§10) |

### Free-write + margin flags

Geologists *sketch and write*; you can't bubble-ize a field notebook. So the
free-write page is a hybrid: a ruled/blank **write-or-sketch area** (cropped to an
image attachment on scan — §6b, no recognition promised) beside a **fenced margin of
labelled flag bubbles** you fill to *tag* a block — *sample · station · photo-taken ·
todo · important*. Faint printed rule-lines tie a margin mark to the rows beside it,
so a scan yields *"lines 5–8 → sample"* alongside the image. Free expression **and**
light machine-readable structure — the same honest seam as the rest of §6. (On screen
this is just a notes field with tags; paper is the other renderer backend drawing it.)

**The marks must not be smudge-able into false positives** (a pen-drag, a coffee ring,
a shadow across the margin must not read as "flagged"). Defenses, layered:

- **Deliberate ink, not mere darkness** — threshold on **fill *fraction* inside the
  printed cell**; a real mark is high-coverage and *contained*, a smudge is diffuse and
  bleeds past the box (subtract the printed box; ink must live inside it).
- **Spatial smear rejection** — print **tick-fences between cells**; a horizontal smear
  or ring crosses many cells ≈ equally (a *smear signature* → reject + flag), whereas
  one contained high-fill cell amid clean neighbours is a real mark.
- **Guard pips** — the mark counts only if small printed anchor pips around it stay
  *clean*; a smear that fakes the fill also dirties the guards, so it fails.
- **Calibration-relative threshold** — the §3 wedge defines "deliberate ink on *this*
  sheet under *this* light," so ambient grey never crosses the bar.
- **Doubt → review, never silent** — an ambiguous flag goes to the §5 review step, like
  every other low-confidence read.

## 5. The read pipeline (offline, in-browser)

A scan (live camera frame or an uploaded photo/scan) flows through:

1. **Locate + decode the header QR** → resolve the form's content-address to the
   §8 tree (already local, or fetched once). Now the schema + zone map are known.
2. **Detect the corner fiducials** → compute the homography → **rectify** the page
   to canonical coordinates on a canvas.
3. **Read the calibration wedge** → set per-sheet (and optionally per-region)
   **thresholds** for ink vs paper; apply white-balance if color patches are present.
4. **Sample each field zone** at its known rectangle: OMR cells → marks; combs →
   per-box crops; write-in/map zones → cropped image regions.
5. **Assemble a §8 record**, run the form's **constraints** (SPEC-hopper-rules) —
   surfacing low-confidence or constraint-failing fields for **human review before
   commit** — then sign and append it like any other record.

The pipeline is **mode-agnostic** — the same steps run whether a frame arrives from
a file or a live camera. Two ingest modes feed it:

### Static import
Upload a photo or a scan — a real **flatbed/feed scanner's** output, a gallery photo,
a desktop with no camera. One frame in, one record out. Always available; the
baseline, and the only option where there's no usable camera.

### Interactive capture — camera as scanner
Put the sheet under a phone or webcam and the app runs a **live guidance loop** — the
*same* `requestAnimationFrame` detect loop the `barcode`/QR scanner already uses
(`renderer/scan.js`), extended to track the four corner fiducials each frame
(**One-Euro–smoothed** — another shared kit primitive, see Portal) and score
readiness. It turns "did I get a good scan?" — a static gamble discovered
*later* — into a **correctable real-time loop**:

- an **alignment overlay** locks to the fiducials; live prompts nudge the user —
  *move closer · hold steady · glare on the calibration strip · tilt down · sheet not
  fully in frame*;
- **auto-shutter** fires only when the frame is square, sharp, evenly lit, and all
  fiducials + the header QR are found — no button-mashing, no blurry capture;
- because live mode sees **many frames, not one**, it can **fuse** them — keep the
  sharpest crop per zone and **majority-vote marks/glyphs across frames** — so it can
  be *more* reliable than a single flatbed pass, not less;
- **immediate feedback**: recognized marks light up and low-confidence digits flash
  for review *while the sheet is still in hand*, so a doubtful cell is re-checked on
  the spot, not after filing;
- **batch flow**: on a good ingest it says *✓ — next sheet*; feed a pile one after
  another. Each page self-identifies (header QR) and rectifies (fiducials)
  independently (Tier 3), so the camera becomes a human-paced sheet-feeder.

## 6. Text & handwriting — the honest seam

The seam is drawn by **segmentation, not by "handwriting hard."** The genuinely
unsolved-offline part of reading handwriting is *segmentation* (finding where one
character ends and the next begins) and *cursive*; isolated, pre-segmented glyph
*classification* is essentially solved (MNIST-class digit CNNs reach ~99.2%,
ensembles ~99.7%+, roughly human-level on clean input). A **comb field hands us the
segmentation for free** — one printed box per character → one isolated, centered
glyph → exactly the setting where recognition works. So there are **three tiers**,
chosen by how constrained the zone is:

- **(a) Boxed glyphs — bundled small classifier.** For comb fields, a purpose-built
  CNN classifies each isolated cell. This is the MNIST-shaped win, and — crucially —
  it is **light enough to fit the ethos**: a quantized model is ~100–400 kB and runs
  in milliseconds per cell in WASM/JS, *far* smaller than a general OCR engine, so it
  may be **bundled and default-on for combs**. Fixed geometry helps twice: we know
  each cell's exact rectangle, so we subtract the printed box outline and extract a
  clean, centered glyph before classifying. Per-cell **softmax confidence** flags only
  shaky cells for review (§5); constraints + any check digits (rules) catch the rest.
  Never authoritative: it *proposes*, the review step + constraints *dispose*.

  The recognizable set widens by difficulty, gated by how much you constrain the cell:
  - **Digits (0–9)** — the solved case (MNIST-class, ~99%+/cell clean). Default.
  - **Boxed block-capitals (A–Z)** — *feasible as a stretch* (proven by decades of
    commercial ICR on customs/postal forms; trained on **EMNIST**, the handwritten-
    letters extension of MNIST). 26 classes means **more confusable pairs** (O/0/Q,
    I/1/L, S/5, Z/2, B/8, U/V), so per-character accuracy is lower than digits — usable,
    not flawless. **The bundle barely grows** (an EMNIST-class CNN is still hundreds of
    kB); the cost is *accuracy and confusion*, not bytes. Lowercase / mixed-case /
    cursive stay out (→ crop-and-attach, (b)).
  - **Alphanumeric (0–9 + A–Z)** — the worst for confusion; only worth it when the
    field genuinely needs it, and then lean hard on the levers below.

  Two levers make the alphabet stretch actually work — and they're ones a generic OCR
  can't pull, because **Hopper holds the schema:**
  - **Restrict the alphabet per cell.** A field's type / `pattern` / choice list tells
    the classifier the *valid class set per position* (often ≪ 26): a `select`
    rendered as boxed text, a known code vocabulary, a date mask. Fewer classes →
    fewer confusions. Where shapes are genuinely indistinguishable by hand (EMNIST
    even *merges* such classes), output a small candidate set and let the
    schema/vocabulary pick.
  - **A recommended hand + a printed exemplar.** The sheet prints the canonical glyph
    shapes (slashed `0`, crossed `7`, open `4`, barred `I`, etc.) **right beside the
    comb** — a built-in, per-form character-formation guide co-designed with the
    model's training set. It nudges the writer toward the forms the model expects and,
    like Graffiti, **teaches a better hand by glancing at the examples**. Strictly a
    booster: higher accuracy when followed, never *required* — crop-and-attach (b) is
    always the floor for anyone who ignores it.

  *Honest limits:* per-cell accuracy is high but never perfect and **compounds per
  field** (≈99%/digit → ≈96% over 4 digits; letters worse), and a model must train
  beyond MNIST/EMNIST's clean, US-centric styles — real field hands vary (crossed `7`,
  upstroked `1`, slashed `0`, regional `4`/`9`), so augmentation and, over time,
  **fine-tuning on a project's own returned sheets** matter.
- **(b) Freeform text — crop-and-attach (the default for unconstrained zones).** A
  `text` write-in zone is cropped from the rectified page and stored as a
  **content-addressed image attachment** (SPEC-hopper-records §8) bound to the
  record, value left pending. "Scan now, transcribe later" — by a human or a heavier
  tool on a bigger machine (the **mill**). This is the highest-value, lowest-risk
  capability: *even with zero recognition, a clean crop of each answer beside its
  question is a huge win* over re-keying whole sheets, and it reuses blob storage +
  append-only as-is. Cursive and connected script live here, not in (a).
- **(c) General field OCR — heavy opt-in.** A build flavor *may* bundle
  `tesseract.js` (WASM, a few MB) for broader recognition. It fights the lean
  single-file ethos, so it is deliberate, labelled, and **never the default or
  silent** — reserved for users who explicitly want it. (The experimental browser
  `TextDetector` is too unevenly supported to depend on.)

**Provenance note.** A screen-filled record is signed by the *filler's* key. A
paper-ingested record is signed by the **scanner's** key — the scanner *attests* to
the transcription; the wet ink is not itself a signature. For audit, the whole
rectified sheet image may be attached to the record as evidence. This is stated,
not hidden (invariant #6): paper widens the trust boundary from "the author signed
this" to "a known peer attests they transcribed this sheet."

## 7. Map sketch → georeferenced raster

The field-mapping case, and the most novel: **print a basemap, sketch on it by
hand, scan it back to a georeferenced overlay.**

- **Print.** A `geotrace`/`geoshape` (or a dedicated map field) prints a **basemap
  tile at a known scale and extent**, with corner fiducials and the **ground-control
  corner coordinates** baked into the sheet metadata (carried in the header QR or a
  sidecar). The basemap may be a pre-cached raster (offline) or a plain graticule
  when no imagery is available.
- **Field use.** The mapper draws — a contact, a fault trace, a sample polygon,
  flow directions — in ink, on paper, in the rain, with gloves.
- **Scan.** Dewarp via the fiducials; because the printed extent's corner
  coordinates are known, **the rectified image is georeferenced** by construction.
  Output, bound to the record as attachments: (a) a **cleaned georeferenced raster**
  — threshold the ink, optionally drop the basemap, keep just the annotation as a
  transparent overlay with its world extent; and (b) *optionally* a **vectorization**
  of the strokes into `geotrace`/`geoshape` coordinates for downstream query.
- **Honest accuracy.** Precision is bounded by print scale + dewarp residual +
  hand-sketch fidelity — a *field sketch*, georeferenced, not a survey instrument.
  Stated plainly so nobody mistakes it for one.

This gives offline, paper-based field mapping that **round-trips to georeferenced
data** — a capability we believe is essentially absent in this corner of the
toolspace, and a natural fit for Hopper's geoscience roots.

**Cross-stack note — capture → model → inspect.** The same georeferencing
generalizes from the horizontal *map* plane to arbitrary **section planes** (encode
the plane's 3D embedding — section line + elevation range + dip — in the header
marker; lift the dewarped strokes into 3D), and N georeferenced planes + drillhole
collars are the input to **implicit 3D modeling** — a *mill*-side / WASM step, not the
lean collector. That closes one GCU pipeline: **capture** here (paper/acrylic
sections) → **model** in the mill → **inspect** in **Portal** (the head-coupled
viewing mode — "lean to look around the deposit"; `auditable/spec_inbox/portal-spec.md`).
The fiducial+pose detector (§3) and the One-Euro filter (§5) are shared across it.

## 8. Paper as a carrier (the reverse direction)

Paper is not only an input medium; it is a `capsule`-class transport:

- **Paper-as-capsule.** A blank sheet's header QR can carry the *form capsule*
  itself → scanning a printed blank **bootstraps the form into a device with zero
  network.** Hand someone a sheet; they get the digital form.
- **Records on paper.** A *filled* record, encoded via the positional codec
  (SPEC-hopper-records §10) and rendered as a dense OMR/QR block, makes paper an
  **air-gapped sync medium** between two Hoppers — mail, fax, or hand-carry a record.
  Conflict-free like every carrier, because the objects are immutable and
  content-addressed (SPEC-hopper-records §6).

## 9. Honest seams & non-goals

Named, not hidden (SPEC-hopper invariant #6):

- **Handwriting reading is tiered, not blanket-promised** — boxed digits/caps are
  recognized (a small bundled model); freeform/cursive is crop-and-attach; general
  field OCR is a heavy opt-in (§6). Recognition proposes; review + constraints dispose.
- **Camera variance is real** — fiducials + the calibration wedge are *required*,
  not optional polish; without them, phone-photo OMR is unreliable.
- **Print fidelity demands fixed geometry** — SVG/PDF at exact coordinates, never
  reflowing print-CSS (§3).
- **Repeat cardinality is bounded per sheet** — paper can't grow an array; print K
  instances + continuation sheets (§4).
- **Media fields can't live on paper** — photo/audio/file are captured on a device;
  paper only links to them (§4).
- **Interactive capture is a progressive enhancement** — static import (incl. a real
  flatbed/feed scanner) is always the baseline; live camera-as-scanner needs a camera
  + a secure context (served/installed, which Hopper already requires — §collector 6).
- **Provenance widens** — paper records are *attested by the scanner*, not signed by
  the filler (§6).

## 10. Stack

Rides on what Hopper already has: **qrcodegen** (print the header QR; already
vendored), **BarcodeDetector** (decode header QR + fiducials; already used),
**canvas 2D** (homography rectification + zone sampling), the **§8 tree** (layout +
read schema), **content-addressed blobs** (crop-and-attach; map rasters), the
**positional codec** (shared with QR/chirp), and — for interactive capture — the
renderer's **`startBarcodeScan` rAF loop** (`renderer/scan.js`), extended to per-frame
fiducial tracking + a readiness score (getUserMedia, already a secure-context path). Layout generation emits **SVG/PDF** at
fixed coordinates. Recognition is right-sized to the job (§6): a **small bundled
digit/box-glyph model** (~100–400 kB, WASM/JS) for combs — light enough to ship by
default; **`tesseract.js`** only as a heavy, labelled opt-in for general field OCR.
No server, no native scanner, no cloud.

## 11. Scope — tiers (build order)

- **Tier 0 — Print blank forms.** A print *view* of the tree (flow layout is fine;
  not scannable). Immediate utility. *(small)*
- **Tier 1 — Smart paper (v1 target).** The fixed-geometry layout engine + header
  QR + corner fiducials + calibration wedge + OMR/comb zones + **text crop-and-
  attach** (§6b) + the read pipeline (§5) with human-review-before-commit, fed by
  **static import** (a photo / a real flatbed/feed scanner). Deterministic, offline,
  **no recognition model**. This is the headline capability.
- **Tier 2 — Boxed-glyph recognition.** The small bundled CNN for combs (§6a):
  per-cell classification, confidence-flagged review, clean box-subtracted glyph
  extraction, constraint/check-digit backstop, and the printed recommended-hand
  exemplar. **Digits first** (MNIST-class, the solved win, default-on); **block-
  capitals A–Z a stretch** (EMNIST-class — more confusable, leans on per-cell
  alphabet restriction + the exemplar). Light enough (~100–400 kB) either way — the
  cost of the alphabet is accuracy, not bytes. Lowercase/cursive stay in (b).
- **Tier 2.5 — Interactive capture.** The live camera-as-scanner mode (§5): alignment
  overlay, guidance prompts, auto-shutter, and multi-frame fusion (sharpest-crop +
  cross-frame vote — an accuracy booster only live mode enables). Layers on Tier 1's
  pipeline; degrades to static import where there's no camera.
- **Tier 3 — Batch dewarp.** Feed a stack ("✓ — next sheet"); per-page self-identify
  + rectify. Pairs with interactive capture's batch flow.
- **Tier 4 — Research.** Map sketch → georeferenced raster (§7); paper-as-carrier
  and records-on-paper (§8).
- **Cross-cutting opt-in (any tier).** General field OCR via bundled `tesseract.js`
  (§6c) — heavy, labelled, never default.

**Out / deferred:** general-purpose document OCR; non-Hopper form scanning; survey-
grade map georeferencing; automatic handwriting transcription as a default.

## 12. Worked flow

A mapping team prints 40 **QF Sample Log** sheets before driving into a valley with
no signal — each sheet a fixed-geometry page with a header QR (form hash + sheet
id), corner fiducials, a grayscale wedge, bubble grids for lithology and a
resample yes/no, digit combs for Fe %, a write-in box for notes, and a basemap tile
for the outcrop sketch. In the field they fill them by hand in the rain. Back at
camp, offline, one phone photographs the stack: each sheet self-identifies, dewarps
against its fiducials, thresholds against its own wedge, and yields a §8 record —
lithology and resample read cleanly as marks, Fe % from the comb, the note kept as
a cropped image to type up later, the outcrop sketch saved as a georeferenced
overlay. Constraints re-run on ingest; the surveyor reviews two low-confidence
digits, commits, and the records are signed (attested by the camp phone) and queued
in the outbox — never single-copy, ready to sync when signal returns.

---

## 13. Printed editions — notebooks & binders

The layout engine (§3) emits **print-ready editions**, not just one-off sheets: a
**GCU field notebook** whose pages are pre-printed Hopper sheets (sample log, free-
write + flags, a map-sketch section, …), generated from a chosen form set and frozen
as an **edition** (a snapshot of those forms + their capsules). Bind it; print a run;
optionally on waterproof stock (the Rite-in-the-Rain lineage). It's an artifact you
own and carry — and its **back cover boots the software**: print the form **capsules**
there (§8 paper-as-capsule), plus the project/registry capsule, the edition id, a
"how to scan" strip, and a **fiducial calibration target** (the §4.3 / Portal target).
Open a fresh notebook, scan the back, and the digital forms load with **no network**.

**Not new, but inverted.** Moleskine's Evernote Smart Notebook and Rocketbook proved
the idea — and proved the anti-pattern: the notebook was a *funnel into a walled cloud
subscription*, the structure proprietary, the data rented. The GCU edition inverts the
topology: **owned, no server, no rent, host-it-yourself**; the back cover loads *open*
forms into a single-file app that works offline and outlives the notebook. Same object,
opposite ownership — which is the whole GCU thesis in a thing you can pocket.

**The binder edition** unlocks physical composition (the same compose-from-parts move,
in atoms):
- **Mix and reorder form sections** for the trip; **continuation sheets become the
  paper answer to repeat cardinality** (§4) — run out of sample rows, add a page.
- **Tabbed capsule dividers** — each section's tab carries its form's capsule (a paper
  *menu* of capsule-loadable surfaces — the cousin of `cradle`'s dispatcher).
- **Reference inserts** — Munsell/grain charts, a scale bar with calibration ticks, the
  §6a recommended-hand exemplar — field reference + capture device in one binder.
- **The rigid cover doubles as a flat, fiducial-cornered scanning mat** — exactly the
  flat known surface the dewarp (§5) wants.

Honest note: a printed edition is a **physical print product** (a run, binding, stock),
a different kind of "ship" than software — but the *design* (page templates, the back-
cover capsule sheet, the flag margins, the calibration target) all falls out of the one
layout engine. GCU "publishes a notebook" = generate the print-ready PDF from the form
set, send it to a printer.

---

*Geoscientific Chaos Union · spec CC0 · 2026 · single-file*
