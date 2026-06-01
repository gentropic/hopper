// Ed25519 sign / verify / keygen — SPEC-hopper-records §3. The provenance layer.
//
// Prefers native Web Crypto Ed25519 (auditable's notebook-signing approach;
// fast, zero-dependency). When a browser lacks it, a **vendored noble-ed25519**
// backend takes over — bundled, never lazy-loaded (a fallback can't depend on a
// network fetch that may not be there; same rule as ggwave). Wire it once at
// startup with `setEd25519Backend(adapter)` (see vendor/PROVENANCE.md for the
// adapter shape). noble's SHA-512 comes from Web Crypto (universally supported).
//
// Keys are raw 32-byte values, base64url — matching auditable's keygen/sign, so
// keys interoperate across the stack. (Never hand-roll the curve math; this file
// only does key *encoding* around vetted implementations.)

import { bytesToB64Url, b64UrlToBytes } from './address.js';

// PKCS#8 DER prefix for an Ed25519 private key; the 32-byte seed follows.
const PKCS8_ED25519_PREFIX = Uint8Array.from(
  [0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);

let _backend = null;
let _native = null;

// Install the vendored noble backend. Adapter shape:
//   { generateStreamKey(): {publicKey,privateKey b64url},
//     sign(bytes, seedBytes): sigBytes,  verify(bytes, sigBytes, pubBytes): bool }
export function setEd25519Backend(adapter) { _backend = adapter; }

async function nativeOK() {
  if (_native !== null) return _native;
  try { await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']); _native = true; }
  catch { _native = false; }
  return _native;
}

function pkcs8FromSeed(seed) {
  const der = new Uint8Array(PKCS8_ED25519_PREFIX.length + 32);
  der.set(PKCS8_ED25519_PREFIX, 0);
  der.set(seed, PKCS8_ED25519_PREFIX.length);
  return der;
}

function unavailable() {
  throw new Error('Ed25519 unavailable: no Web Crypto support and no vendored backend (vendor/PROVENANCE.md)');
}

export async function generateStreamKey() {
  if (await nativeOK()) {
    const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
    return { publicKey: bytesToB64Url(pub), privateKey: bytesToB64Url(pkcs8.slice(-32)) };
  }
  if (_backend) return _backend.generateStreamKey();
  unavailable();
}

export async function sign(bytes, privateKeyB64) {
  const seed = b64UrlToBytes(privateKeyB64);
  if (await nativeOK()) {
    const key = await crypto.subtle.importKey('pkcs8', pkcs8FromSeed(seed), { name: 'Ed25519' }, false, ['sign']);
    return bytesToB64Url(new Uint8Array(await crypto.subtle.sign('Ed25519', key, bytes)));
  }
  if (_backend) return bytesToB64Url(await _backend.sign(bytes, seed));
  unavailable();
}

export async function verify(bytes, sigB64, publicKeyB64) {
  const sig = b64UrlToBytes(sigB64), pub = b64UrlToBytes(publicKeyB64);
  if (await nativeOK()) {
    const key = await crypto.subtle.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']);
    return crypto.subtle.verify('Ed25519', key, sig, bytes);
  }
  if (_backend) return _backend.verify(bytes, sig, pub);
  unavailable();
}
