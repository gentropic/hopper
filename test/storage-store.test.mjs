import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBackend } from '../vendor/vfs.js';
import { createStore } from '../src/js/storage/store.js';
import { verifyRecord } from '../src/js/records/envelope.js';

const FORM = { type: 'form', meta: { id: 'qf' }, fields: [{ name: 'site_id', fieldType: 'text', label: 'Site', props: {} }], choices: {}, rules: [], views: [] };

test('store: identity, putForm, append + sign, list', async () => {
  const store = createStore(new MemoryBackend());
  const id = await store.init({ name: 'Arthur' });
  assert.match(id.streamId, /^[A-Za-z0-9_-]{22}$/);
  assert.ok(id.publicKey && id.privateKey);

  const fh = await store.putForm(FORM);
  assert.match(fh, /^sha256-/);
  assert.equal(await store.putForm(FORM), fh, 'same form → same hash (idempotent)');

  const r0 = await store.saveRecord({ form: fh, values: { site_id: 'QF-118' } });
  assert.equal(r0.id, `${id.streamId}/0`);
  assert.equal(r0.form, fh);
  assert.equal(await verifyRecord(r0, id.publicKey), true, 'saved record verifies');

  const r1 = await store.saveRecord({ form: fh, values: { site_id: 'QF-119' } });
  assert.equal(r1.id, `${id.streamId}/1`, 'counter increments');

  const list = await store.listRecords();
  assert.deepEqual(list.map((r) => r.id), [`${id.streamId}/0`, `${id.streamId}/1`]);
  assert.deepEqual(list[0].values, { site_id: 'QF-118' });
});

test('store: export bundle + single-copy (unbacked) tracking', async () => {
  const store = createStore(new MemoryBackend());
  const id = await store.init();
  const fh = await store.putForm(FORM);
  await store.saveRecord({ form: fh, values: { site_id: 'A' } });
  await store.saveRecord({ form: fh, values: { site_id: 'B' } });

  assert.equal(await store.unbackedUp(), 2, 'two records, none backed up');

  const bundle = await store.exportBundle();
  assert.equal(bundle.records.length, 2);
  assert.ok(bundle.streams[`${id.streamId}.json`], 'stream registration included (records stay verifiable)');
  assert.equal(Object.keys(bundle.forms).length, 1, 'form included');
  assert.equal(JSON.stringify(bundle).includes(id.privateKey), false, 'private key NOT in the data export');

  await store.markExported();
  assert.equal(await store.unbackedUp(), 0, 'cleared after export');
  await store.saveRecord({ form: fh, values: { site_id: 'C' } });
  assert.equal(await store.unbackedUp(), 1, 'new record is single-copy again');
});

test('store: folder mirror auto-backs-up the repo (backfill + ongoing)', async () => {
  const primary = new MemoryBackend(), folder = new MemoryBackend();
  const store = createStore(primary);
  const id = await store.init();
  const fh = await store.putForm(FORM);
  await store.saveRecord({ form: fh, values: { a: 1 } });
  assert.equal(await store.unbackedUp(), 1, 'single-copy before a mirror');

  await store.setMirror(folder);                       // pick a folder → backfill
  assert.equal(await store.unbackedUp(), 0, 'mirror clears the single-copy warning');
  assert.ok(await folder.exists(`/records/${id.streamId}/000000.json`), 'existing record backfilled to folder');
  assert.ok(await folder.exists(`/forms/${fh}.json`), 'form backfilled');
  assert.ok(await folder.exists(`/streams/${id.streamId}.json`), 'stream registration backfilled');

  await store.saveRecord({ form: fh, values: { a: 2 } });   // ongoing writes mirror too
  assert.ok(await folder.exists(`/records/${id.streamId}/000001.json`), 'new record lands in the folder');
  assert.equal(await store.unbackedUp(), 0);
  assert.equal((await store.status()).mirrored, true);
});

test('store: saveBlob is content-addressed, binary-safe, dedups; getBlob round-trips', async () => {
  const store = createStore(new MemoryBackend());
  await store.init();

  // bytes that are NOT valid UTF-8 — proves binary round-trips (not string-mangled)
  const bytes = new Uint8Array([0, 255, 1, 254, 0x89, 0x50, 0x4e, 0x47, 128, 0]);
  const hash = await store.saveBlob(bytes);
  assert.match(hash, /^sha256-[A-Za-z0-9_-]+$/);

  const back = await store.getBlob(hash);
  assert.ok(back instanceof Uint8Array);
  assert.deepEqual([...back], [...bytes], 'blob bytes survive exactly');

  assert.equal(await store.saveBlob(bytes), hash, 'same bytes → same hash (dedup)');
  const other = await store.saveBlob(new Uint8Array([1, 2, 3]));
  assert.notEqual(other, hash, 'different bytes → different hash');
  assert.equal(await store.getBlob('sha256-missing'), null, 'unknown hash → null');

  // a record can bind the blob by hash in its attachments (SPEC-records §8)
  const fh = await store.putForm(FORM);
  const rec = await store.saveRecord({ form: fh, values: {}, attachments: { photo: { blob: hash, mime: 'image/png', bytes: bytes.byteLength } } });
  assert.equal(rec.attachments.photo.blob, hash);
});

test('store: folder mirror backfills + ongoing-writes blobs', async () => {
  const primary = new MemoryBackend(), folder = new MemoryBackend();
  const store = createStore(primary);
  await store.init();
  const pre = await store.saveBlob(new Uint8Array([10, 20, 30]));   // before a mirror

  await store.setMirror(folder);
  assert.ok(await folder.exists(`/blobs/${pre}`), 'existing blob backfilled to folder');
  assert.deepEqual([...(await folder.readFile(`/blobs/${pre}`, 'bytes'))], [10, 20, 30]);

  const post = await store.saveBlob(new Uint8Array([40, 50]));      // after a mirror
  assert.ok(await folder.exists(`/blobs/${post}`), 'new blob lands in the folder too');
});

test('store: listForms + recordsView feed the collector shell', async () => {
  const store = createStore(new MemoryBackend());
  await store.init();
  const f1 = await store.putForm(FORM);
  const f2 = await store.putForm({ ...FORM, meta: { id: 'qf2', title: 'Second Form' } });

  const forms = await store.listForms();
  assert.equal(forms.length, 2);
  const byHash = Object.fromEntries(forms.map((f) => [f.hash, f]));
  assert.equal(byHash[f1].title, 'qf');                       // falls back to meta.id when no title
  assert.equal(byHash[f2].title, 'Second Form');

  await store.saveRecord({ form: f1, values: { site_id: 'A' }, attachments: { photo: { blob: 'sha256-x', mime: 'image/png', bytes: 1 } } });
  await store.saveRecord({ form: f1, values: { site_id: 'B' } });

  let view = await store.recordsView();
  assert.deepEqual(view.map((r) => r.counter), [0, 1]);
  assert.deepEqual(view.map((r) => r.backedUp), [false, false], 'nothing backed up yet');
  assert.deepEqual(view.map((r) => r.hasAttachments), [true, false]);
  assert.equal(view[0].form, f1, 'records carry their form hash (group-by-form in Outbox)');

  await store.markExported();                                  // exports through count=2
  view = await store.recordsView();
  assert.deepEqual(view.map((r) => r.backedUp), [true, true], 'both backed up after export');
});

test('store: importBundle unions a peer (verify + idempotent + transitive gossip)', async () => {
  // peer A authors two records against a form
  const A = createStore(new MemoryBackend());
  const idA = await A.init({ name: 'A' });
  const fh = await A.putForm(FORM);
  await A.saveRecord({ form: fh, values: { site_id: 'A1' } });
  await A.saveRecord({ form: fh, values: { site_id: 'A2' } });
  const bundleA = await A.exportBundle();
  assert.equal(bundleA.records.length, 2);

  // peer B (own identity, no records) imports A's bundle → union
  const B = createStore(new MemoryBackend());
  const idB = await B.init({ name: 'B' });
  assert.notEqual(idA.streamId, idB.streamId);
  const r1 = await B.importBundle(bundleA);
  assert.deepEqual({ s: r1.streams, f: r1.forms, r: r1.records, rej: r1.rejected }, { s: 1, f: 1, r: 2, rej: 0 });

  // A's form is now available to B; B's *own* outbox (its stream) is still empty
  assert.equal((await B.listForms()).length, 1, 'imported form is fillable');
  assert.equal((await B.recordsView()).length, 0, 'collector browses only your own records (§2)');
  assert.equal(B.count(), 0, "import does not touch B's own counter");

  // idempotent: re-importing the same bundle adds nothing
  const r2 = await B.importBundle(bundleA);
  assert.deepEqual({ r: r2.records, skipped: r2.skipped }, { r: 0, skipped: 2 });

  // transitive: B can re-export A's records onward (grow-only-set gossip)
  const bundleB = await B.exportBundle();
  assert.equal(bundleB.records.length, 2, "B re-exports A's records");
  assert.ok(bundleB.streams[`${idA.streamId}.json`], "A's stream registration travels with it");

  // B can still author its own record after importing (counter intact)
  const own = await B.saveRecord({ form: fh, values: { site_id: 'B1' } });
  assert.equal(own.id, `${idB.streamId}/0`);
});

test('store: importBundle rejects a tampered record', async () => {
  const A = createStore(new MemoryBackend());
  await A.init({ name: 'A' });
  const fh = await A.putForm(FORM);
  await A.saveRecord({ form: fh, values: { site_id: 'real' } });
  const bundle = await A.exportBundle();
  bundle.records[0].values.site_id = 'tampered';        // mutate after signing

  const B = createStore(new MemoryBackend());
  await B.init({ name: 'B' });
  const r = await B.importBundle(bundle);
  assert.deepEqual({ r: r.records, rej: r.rejected }, { r: 0, rej: 1 }, 'bad signature → rejected, not written');
  assert.equal((await B.exportBundle()).records.length, 0, 'nothing leaked into the repo');
});

test('store: recordsView resolves corrections (head wins) + tombstones (dropped)', async () => {
  const store = createStore(new MemoryBackend());
  const id = await store.init();
  const fh = await store.putForm(FORM);
  const a = await store.saveRecord({ form: fh, values: { site_id: 'A' } });   // #0
  const b = await store.saveRecord({ form: fh, values: { site_id: 'B' } });   // #1
  await store.saveRecord({ form: fh, values: { site_id: 'A-fixed' }, kind: 'correction', supersedes: a.id });   // #2 corrects #0
  await store.saveRecord({ form: fh, values: {}, kind: 'tombstone', supersedes: b.id });                        // #3 retracts #1

  const view = await store.recordsView();
  // A's chain resolves to its correction head; B is retracted entirely → one effective record
  assert.equal(view.length, 1, 'four appended → one effective (A corrected, B retracted)');
  assert.equal(view[0].values.site_id, 'A-fixed', 'correction head replaces the original');
  assert.equal(view[0].corrected, true, 'correction head flagged corrected');
  assert.equal(view.some((r) => r.id === a.id || r.id === b.id), false, 'superseded original + tombstoned record both hidden');

  // every appended object still exists in the log + exports (append-only durability)
  assert.equal((await store.listRecords()).length, 4, 'log keeps all four objects');
  assert.equal((await store.exportBundle()).records.length, 4, 'export carries the full history');
  assert.equal(store.count(), 4, 'counter counts appended objects, not effective');
});

test('store: identity + counter persist across reload (same backend)', async () => {
  const backend = new MemoryBackend();
  const s1 = createStore(backend);
  const id1 = await s1.init({ name: 'Arthur' });
  await s1.saveRecord({ form: 'f', values: {} });

  const s2 = createStore(backend);                 // fresh store, same persisted backend
  const id2 = await s2.init();
  assert.equal(id2.streamId, id1.streamId, 'identity loaded, not regenerated');
  assert.equal(id2.privateKey, id1.privateKey);

  const r = await s2.saveRecord({ form: 'f', values: {} });
  assert.equal(r.id, `${id1.streamId}/1`, 'counter restored from existing records');
});
