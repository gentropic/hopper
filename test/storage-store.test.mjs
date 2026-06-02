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
