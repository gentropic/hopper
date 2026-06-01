// Content-addressing & stream identity — SPEC-hopper-records §1, §3. Pure.
//
// Self-contained base64url for now; will delegate to the vendored @gcu/capsule
// `bytesToB64Url` once vendored (same output). `crypto` is the Web Crypto global,
// present in browsers and Node ≥ 20.

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// Unpadded, URL-safe base64 of a byte sequence.
export function bytesToB64Url(input) {
  const b = new Uint8Array(input);
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const rem = b.length - i;
    const n = (b[i] << 16) | ((rem > 1 ? b[i + 1] : 0) << 8) | (rem > 2 ? b[i + 2] : 0);
    out += B64URL[(n >> 18) & 63] + B64URL[(n >> 12) & 63];
    if (rem > 1) out += B64URL[(n >> 6) & 63];
    if (rem > 2) out += B64URL[n & 63];
  }
  return out;
}

// Inverse of bytesToB64Url. Tolerates the unpadded URL-safe form.
export function b64UrlToBytes(s) {
  const std = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = std.length % 4 ? '='.repeat(4 - (std.length % 4)) : '';
  const bin = atob(std + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const utf8 = (s) => new TextEncoder().encode(s);

export async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

// `sha256-<b64url>` — the content address of forms and attachment blobs (§3).
export async function contentAddress(bytes) {
  return 'sha256-' + bytesToB64Url(await sha256(bytes));
}

// The self-verifying stream handle (§1): a 22-char (~128-bit) base64url prefix of
// SHA-256 over the identifying triple. The spec's `‖` join is realized here as a
// length-prefixed encoding, so no field's content can be confused for another's.
export async function streamId(pubkey, deviceId, epoch) {
  const joined = utf8([pubkey, deviceId, epoch].map((s) => `${String(s).length}:${s}`).join(''));
  return bytesToB64Url(await sha256(joined)).slice(0, 22);
}
