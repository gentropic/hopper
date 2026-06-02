// SDP ↔ QR handshake codec (SPEC-hopper-collector §5.1). A WebRTC offer/answer SDP
// must cross to the peer out-of-band, in a QR — so it's compacted. v1 deflates the
// *whole* SDP via @gcu/capsule's `q:` form (base45 — packs into a QR's alphanumeric
// mode). This is the simple-first path **behind a stable interface**: 2c calls
// encode/decode and never sees the impl.
//
// ⚠ Measured reality: deflate barely shrinks an SDP (its entropy — the DTLS
// fingerprint hash + the random ICE password — is irreducible, and base45 re-expands
// ~33%), so a ~420-byte LAN SDP yields a ~420-char code → a *dense* (v11–16-ish) QR.
// Workable for v1, but it makes the **template-strip the real win, not optional**:
// rebuild the boilerplate both sides already hold, carry only fingerprint + ICE
// ufrag/pwd + candidates as raw bytes (no base45 bloat) → a tiny QR. That's the 2d
// optimization, and it lands behind this same `encode/decode` seam. Multi-interface
// machines emit larger SDPs that may overflow a single QR → multi-QR split (also 2d).
//
// The QR carries the bare `q:` capsule (no URL wrapper — both ends are Hopper, the
// in-app scanner reads it straight), so the `q:` fragment gotcha doesn't apply here.

import * as capsule from '../../../vendor/capsule.js';

export async function encodeHandshake(sdp) {
  return capsule.encodeInline(sdp, { form: 'q' });            // → 'q:…' (deflated, base45)
}
export async function decodeHandshake(code) {
  return capsule.decodeInlineText(String(code).trim());       // exact SDP back
}
// Rough QR-density signal for the UI: base45 chars ≈ the QR's alphanumeric payload.
export function handshakeSize(code) {
  return String(code).length;
}
