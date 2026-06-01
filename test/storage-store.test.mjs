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
