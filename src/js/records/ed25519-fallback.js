// Wires the bundled noble-ed25519 into records/crypto.js as the Ed25519 backend,
// used only when the browser lacks native Web Crypto Ed25519. Importing this
// module registers the backend (a side effect) — `crypto.js` still prefers
// native and only reaches for noble on the fallback path.
//
// noble v3's async API (keygenAsync/signAsync/verifyAsync) gets its SHA-512 from
// Web Crypto by default — universally supported, even where Ed25519 isn't. Keys
// are raw 32-byte values, matching `crypto.js`'s native encoding, so signatures
// interoperate (verified in test/records-noble.test.mjs).

import * as nobleEd from '../../vendor/noble-ed25519.js';
import { setEd25519Backend } from './crypto.js';
import { bytesToB64Url } from './address.js';

setEd25519Backend({
  generateStreamKey: async () => {
    const { secretKey, publicKey } = await nobleEd.keygenAsync();
    return { publicKey: bytesToB64Url(publicKey), privateKey: bytesToB64Url(secretKey) };
  },
  sign: (bytes, seedBytes) => nobleEd.signAsync(bytes, seedBytes),       // → sig bytes (crypto.js b64url-wraps)
  verify: (bytes, sigBytes, pubBytes) => nobleEd.verifyAsync(sigBytes, bytes, pubBytes),
});
