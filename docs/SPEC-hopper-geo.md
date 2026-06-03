# SPEC-hopper-geo

**System:** part of Hopper — see **SPEC-hopper** (architecture), **SPEC-hopper-form** (the format), **SPEC-hopper-collector** (the app)
**Component:** geo capture — location fixes captured with care: live-converging, accuracy-honest, optionally averaged
**Status:** Draft v0.1 (design / roadmap)
**Editor:** Arthur Endlein Correia (with Claude)
**Last revised:** 2026-06-02
**License:** spec CC0 · reference implementation MIT
**Rides on:** SPEC-hopper-form §4 (the `geo`/`geotrace`/`geoshape` field types + the `capture-accuracy` prop), SPEC-hopper-records §2/§8 (the value/metadata in the signed envelope), SPEC-hopper-paper §7 (georeferenced sketches) + the QGIS off-ramp (CRS), DECISIONS §1 (honest reliability).

## Abstract

The geo field family — `geo` (a point), `geotrace` (an ordered polyline), `geoshape`
(a closed polygon) — already has a clean value contract: an ordered set of
`{lat,lng,acc}` points in `values` (built, SPEC-hopper-form §4). This document specs the
part that *isn't* a tweak: **capturing those fixes well.** A location in a field record
is not decoration — it feeds downstream models (the 3D/section pipeline of
SPEC-hopper-paper §7, the QGIS off-ramp, the mill), so a fix's *quality must travel with
it and never be overstated.* That means live-converging capture (not a single snapshot),
accuracy surfaced and thresholded, optional occupy-and-average for static points, richer
self-describing metadata, manual + external-receiver entry, and explicit CRS honesty —
each a named seam where it's hard. It is invariant #6 (honest reliability) applied to
location.

## 1. Why capture quality is a subsystem, not a tweak

**The one fact that reframes it:** a single `getCurrentPosition()` returns whatever fix
the device holds *at that instant* — which, on the first call, is very often a stale,
coarse **wifi/cell fix** (±50–2000 m), *not* a converged GNSS fix. A real GPS fix takes
seconds to acquire satellites and tighten. So "snapshot once" — the naive floor we ship
today — silently records a coarse fix as if it were the answer. For field-grade data
that's a lie of omission.

**Why it matters for Hopper specifically.** A sample station's coordinate is an input to
real models: the implicit 3D geology (§7), a georeferenced map, a QGIS layer. A
50-metre-accuracy point treated as survey-grade propagates that error into an orebody
wireframe. The ODK lineage learned this the hard way and added accuracy thresholds,
on-screen accuracy, and "stand still and occupy" averaging. Hopper inherits that lesson:
**the record must carry its own quality so downstream can weight, filter, or reject by
it.** Honest reliability isn't only about storage durability — it's about not certifying
a fix the device couldn't actually deliver.

## 2. What the API gives (and its honesty caveats)

The browser **Geolocation API** (`getCurrentPosition` / `watchPosition`) yields a
`coords` object: `latitude`, `longitude`, `accuracy` (horizontal, metres), `altitude`,
`altitudeAccuracy`, `heading`, `speed`, plus a `timestamp`. `enableHighAccuracy: true`
*requests* GNSS over wifi/cell (we set it), and `watchPosition` **streams fixes as they
improve**. Caveats to state, not hide:

- **`accuracy` is a device-reported horizontal estimate** — the spec doesn't pin its
  confidence level, implementations vary, and it is sometimes *optimistic*. We surface
  it; we do not certify it.
- **`enableHighAccuracy` is a request, not a guarantee** — indoors / under canopy / in
  an urban canyon the device may return only a fused coarse fix, or none.
- **The datum is WGS84** (see §9). Altitude is often the weakest component.

## 3. Live-converging capture — the core upgrade

Capture is a **watch, not a snapshot**:

- Open a `watchPosition`; show the fix **converging live** — a tightening ±metres readout
  and a quality state (*searching → coarse → good → excellent*) mapped to accuracy bands
  (Switchboard accents: fault/caution/go).
- The user captures when satisfied, **or** the widget auto-captures when accuracy reaches
  the target (§4's `capture-accuracy`) and holds for a moment (so it doesn't fire on a
  lucky single sample).
- **Stop the watch** on capture/cancel — sustained high-accuracy GNSS is a real battery
  drain.
- **Honest seam:** if it never converges (indoors/canopy), surface "no good fix — captured
  ±N m" or let the user abandon — never silently bank a coarse fix as if it were precise.

This is the headline: it changes the *default* from "grab the stale fix" to "watch it
get good, then take it."

## 4. Accuracy contract — surface it, threshold it, never hide it

- **Always store and show `acc`.** A coarse fix is *allowed* but *labelled*; precision is
  never implied.
- **Wire `capture-accuracy`** (the form §4 prop, e.g. `10` m) as the **target/threshold**.
  Configurable strictness: a *soft warn* ("±35 m — below target, capture anyway?") or a
  *hard block* below target — author's choice via the prop (e.g. `capture-accuracy: {target: 10, block: true}`).
- A **quality indicator** by band (go/caution/fault) so a gloved field worker reads "good
  enough?" at a glance.
- The payoff: because the record carries its own accuracy, the **mill / QGIS / 3D model
  can weight or filter by quality** — the fix is self-describing.

## 5. Averaging — occupy and average (with honest limits)

For a **stationary occupation**, collect N watch samples over T seconds and output the
mean position (optionally **inverse-variance weighted**, ∝ 1/acc², the optimal combine
of independent estimates), reporting the sample count and the resulting spread.

**State the limits plainly — averaging is not magic:**
- It reduces **random scatter only**. It does **not** remove **bias** (multipath,
  ionospheric delay, a poor satellite geometry) — a biased fix averaged a thousand times
  is still biased.
- It is **wrong for a moving point.** `geotrace`/`geoshape` vertices are positions *in
  motion*, not occupations — averaging them smears the path. Averaging is an explicit
  *per-point "occupy & average"* mode for static points (a sample station, a benchmark),
  not a blanket smoother.
- **Convergence beats averaging early** — averaging a still-converging fix is worse than
  waiting for it to settle, then averaging. Order: converge (§3), *then* occupy.

The averaged point records its **sample count + spread** as metadata (§6), so its
provenance stays honest — a 60-sample ±2 m occupation reads differently from a single
±40 m grab, and downstream knows which it has.

## 6. The point metadata schema (forward-compatible growth)

The floor is `{lat, lng, acc}`. It grows **additively** (JSON, no schema break — old
records stay valid):

```
{ lat, lng, acc,          // horizontal: position + its ±metres
  alt?, altAcc?,          // 3D — matters for sections / outcrop elevation (§7 paper)
  ts?,                    // capture time (best-effort; not an ordering key — records §7)
  n?,                     // samples averaged (1 = single fix)
  method? }               // 'single' | 'averaged' | 'manual' | 'external'
```

`geotrace`/`geoshape` are ordered arrays of these. This is what makes a geo value
**self-describing about its own quality** — and the §8 tree + signed envelope carry it
unchanged, so nothing else in the stack needs to know.

## 7. Manual entry & external receivers

- **Manual / paste** — type or paste known coordinates (a survey benchmark, a
  total-station reading, a value from a paper map or another instrument). `method:
  'manual'`; accuracy only if the user supplies it. Essential for survey tie-ins and for
  when the device GNSS is useless.
- **External survey-grade receivers** *(tail)* — a Bluetooth/USB GNSS unit (NMEA over
  **Web Bluetooth / Web Serial**) for dm–cm grade (RTK). Same value contract; only the
  *source* differs (`method: 'external'`). This rides the experimental hardware-carrier
  family (SPEC-hopper-collector §5.6) — Android + a gadget, an accessory, never the
  zero-dependency core.

## 8. CRS & datum honesty

The Geolocation API is **WGS84**. **Capture and store WGS84** (the lingua franca) — and
*say so*. Geoscience often works in projected/local CRS (UTM zones; **SIRGAS 2000** in
Brazil). Display or entry in another CRS — and reprojection to UTM/local — is a
**conversion concern owned by the off-ramp** (the QGIS plugin / the mill, SPEC-hopper-paper
§7), not the capture floor: capture stays WGS84, convert downstream. **Never silently mix
datums** — a SIRGAS-vs-WGS84 or wrong-UTM-zone confusion is metres-to-kilometres of
error, exactly the kind of silent lie this spec exists to forbid.

## 9. Honest seams & non-goals

Named, not hidden (SPEC-hopper invariant #6):

- **Background / continuous tracking is a named seam** (SPEC-hopper §5, collector §7) —
  browsers throttle/deny background geolocation; capture is **foreground**, never a silent
  always-on tracker.
- **No fix indoors / under canopy** — surfaced, not faked.
- **Battery** — high-accuracy GNSS drains; the watch stops on capture/cancel.
- **`accuracy` is device-reported and sometimes optimistic** — we surface it, we don't
  certify it.
- **Not a survey instrument** — unless an external RTK receiver is attached (§8). v1 is
  consumer-grade GNSS, labelled as such.

## 10. Scope — tiers (build order)

- **T0 — Snapshot floor.** ✅ shipped: single `getCurrentPosition`, `enableHighAccuracy`,
  show ±acc; `geo` point + `geotrace`/`geoshape` ordered-list widgets.
- **T1 — Live-converging capture (the headline).** `watchPosition` convergence UI +
  accuracy surfacing/bands + wire `capture-accuracy` (warn/block) + stop-the-watch.
- **T2 — Occupy & average + richer metadata.** Static-point averaging with sample/spread
  reporting (§5) + the `{alt,altAcc,ts,n,method}` schema (§6).
- **T3 — Manual / paste entry** (§7).
- **T4 — Tail / research.** External NMEA receivers (Web Bluetooth/Serial, §7); in-CRS
  display/entry via the off-ramp (§8).

**Out / deferred:** background/passive tracking; survey-grade certification; in-app
reprojection (that's the off-ramp's job, §9).

## 11. Worked flow

A geologist reaches an outcrop and taps the `geo` field. Instead of banking the stale
±900 m wifi fix, the widget opens a watch: the readout tightens — ±120 → ±28 → ±9 m — the
band flips caution→go as it crosses the form's `capture-accuracy: 10`. They stand still and
tap **Occupy** (10 s): 14 samples, mean ±4 m, recorded with `n:14, method:'averaged',
alt:842 m`. The watch stops. The signed record carries the coordinate *and its quality*,
so back in the mill it's weighted as a good fix, exported to the QGIS layer in WGS84, and
honestly distinguished from the ±40 m single-grabs elsewhere in the dataset — never
silently equated with them.

---

*Geoscientific Chaos Union · spec CC0 · 2026 · single-file*
