import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeHandshake, decodeHandshake, handshakeSize } from '../src/js/sync/handshake.js';

// a representative data-only WebRTC offer SDP (host candidate, LAN), CRLF-terminated
const SDP = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:F7gI',
  'a=ice-pwd:x9cml/YzichV2+XlhiMu8g 5',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=candidate:1 1 UDP 2122252543 192.168.1.5 54321 typ host',
  '',
].join('\r\n');

test('handshake codec: exact SDP round-trip, compacted, q: form', async () => {
  const code = await encodeHandshake(SDP);
  assert.match(code, /^q:/, 'q: form (QR-dense base45)');
  assert.ok(handshakeSize(code) < SDP.length, `compacted: ${handshakeSize(code)} < ${SDP.length}`);
  assert.equal(await decodeHandshake(code), SDP, 'decodes back to the exact SDP (lossless)');
});

test('handshake codec: trims surrounding whitespace from a scanned code', async () => {
  const code = await encodeHandshake(SDP);
  assert.equal(await decodeHandshake('  ' + code + '\n'), SDP);
});
