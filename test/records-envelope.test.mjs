import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateStreamKey, sign, verify } from '../src/js/records/crypto.js';
import { makeRecord, verifyRecord, correct, tombstone, resolve } from '../src/js/records/envelope.js';

const utf8 = (s) => new TextEncoder().encode(s);
const CTX = { stream: 'streamAAA', counter: 0, form: 'sha256-formhash', at: '2026-06-01T14:22:07Z' };

test('Ed25519 — sign/verify round-trip, tamper + wrong-key rejection', async () => {
  const k = await generateStreamKey();
  const sig = await sign(utf8('hello'), k.privateKey);
  assert.equal(await verify(utf8('hello'), sig, k.publicKey), true);
  assert.equal(await verify(utf8('hellp'), sig, k.publicKey), false);    // tampered message
  const other = await generateStreamKey();
  assert.equal(await verify(utf8('hello'), sig, other.publicKey), false); // wrong key
});

test('envelope — makeRecord signs, verifyRecord checks, tamper fails', async () => {
  const k = await generateStreamKey();
  const rec = await makeRecord({ ...CTX, values: { site_id: 'QF-118', fe_pct: 64.2 } }, k.privateKey);
  assert.equal(rec.id, 'streamAAA/0');
  assert.equal(rec.kind, 'record');
  assert.equal(typeof rec.sig, 'string');
  assert.equal(await verifyRecord(rec, k.publicKey), true);

  const tampered = structuredClone(rec);
  tampered.values.fe_pct = 46.2;                                 // alter a value
  assert.equal(await verifyRecord(tampered, k.publicKey), false);
});

test('envelope — signature is over canonical data, not stored bytes', async () => {
  const k = await generateStreamKey();
  const rec = await makeRecord({ ...CTX, values: { b: 2, a: 1 } }, k.privateKey);
  // simulate a round-trip through storage with reordered keys / whitespace
  const reread = JSON.parse(JSON.stringify({ sig: rec.sig, values: { a: 1, b: 2 }, attachments: {}, at: rec.at, supersedes: null, form: rec.form, kind: rec.kind, id: rec.id, v: rec.v }));
  assert.equal(await verifyRecord(reread, k.publicKey), true);
});

test('corrections & tombstones build valid signed records', async () => {
  const k = await generateStreamKey();
  const c = await correct('streamAAA/0', { fe_pct: 46.2 }, { ...CTX, counter: 4 }, k.privateKey);
  assert.equal(c.kind, 'correction');
  assert.equal(c.supersedes, 'streamAAA/0');
  assert.equal(await verifyRecord(c, k.publicKey), true);

  const t = await tombstone('streamAAA/0', { ...CTX, counter: 5 }, k.privateKey);
  assert.equal(t.kind, 'tombstone');
  assert.deepEqual(t.values, {});
  assert.equal(await verifyRecord(t, k.publicKey), true);
});

test('resolve — chain head wins; tombstoned chain dropped', () => {
  const r0 = { id: 's/0', kind: 'record', supersedes: null, values: { fe: 64.2 } };
  const r1 = { id: 's/4', kind: 'correction', supersedes: 's/0', values: { fe: 46.2 } };
  const standalone = { id: 's/1', kind: 'record', supersedes: null, values: { fe: 70 } };

  const eff = resolve([r0, r1, standalone]);
  assert.deepEqual(eff.map((r) => r.id).sort(), ['s/1', 's/4']);     // r0 superseded by r4
  assert.equal(eff.find((r) => r.id === 's/4').values.fe, 46.2);

  const tomb = { id: 's/5', kind: 'tombstone', supersedes: 's/1' };
  const eff2 = resolve([r0, r1, standalone, tomb]);
  assert.deepEqual(eff2.map((r) => r.id).sort(), ['s/4']);           // s/1 retracted, s/0 superseded
});
