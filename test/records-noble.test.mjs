import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as nobleEd from '../vendor/noble-ed25519.js';
import { sign as nativeSign, verify as nativeVerify } from '../src/js/records/crypto.js';
import { bytesToB64Url, b64UrlToBytes } from '../src/js/records/address.js';

// The fallback is only correct if it produces Ed25519 signatures interoperable
// with the native Web Crypto path AND shares its raw 32-byte key encoding.
// (Runs noble directly — on Node, crypto.js prefers native, so we cross-check.)
const msg = new TextEncoder().encode('hopper field record');

test('vendored noble v3 — self round-trip', async () => {
  const { secretKey, publicKey } = await nobleEd.keygenAsync();
  const sig = await nobleEd.signAsync(msg, secretKey);
  assert.equal(await nobleEd.verifyAsync(sig, msg, publicKey), true);
  assert.equal(await nobleEd.verifyAsync(sig, new TextEncoder().encode('tampered'), publicKey), false);
});

test('noble ↔ Web Crypto interop (same keys, same signatures)', async () => {
  const { secretKey, publicKey } = await nobleEd.keygenAsync();
  const pubB64 = bytesToB64Url(publicKey), seedB64 = bytesToB64Url(secretKey);

  // noble signs → native verifies
  const sigNoble = await nobleEd.signAsync(msg, secretKey);
  assert.equal(await nativeVerify(msg, bytesToB64Url(sigNoble), pubB64), true);

  // native signs → noble verifies (proves crypto.js's seed→pkcs8 encoding matches noble's)
  const sigNative = b64UrlToBytes(await nativeSign(msg, seedB64));
  assert.equal(await nobleEd.verifyAsync(sigNative, msg, publicKey), true);
});
