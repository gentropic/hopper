import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBackend } from '../vendor/vfs.js';
import { createStore } from '../src/js/storage/store.js';
import { syncSession } from '../src/js/sync/session.js';

const FORM = { type: 'form', meta: { id: 'qf' }, fields: [{ name: 'site_id', fieldType: 'text', label: 'Site', props: {} }], choices: {}, rules: [], views: [] };

// An in-memory channel pair: a message sent on one end arrives (async) at the other's
// onMessage — the minimal `{ send, onMessage, onClose, close }` syncSession expects.
function pipe() {
  const ends = [{ h: {} }, { h: {} }];
  const wire = (self, peer) => Object.assign(self, {
    send: (m) => { Promise.resolve().then(() => peer.h.message && peer.h.message(m)); },
    onMessage: (cb) => { self.h.message = cb; },
    onClose: (cb) => { self.h.close = cb; },
    close: () => { Promise.resolve().then(() => peer.h.close && peer.h.close()); },
  });
  wire(ends[0], ends[1]); wire(ends[1], ends[0]);
  return ends;
}

test('syncSession: two peers union their records over a channel', async () => {
  const A = createStore(new MemoryBackend()); const idA = await A.init({ name: 'A' });
  const B = createStore(new MemoryBackend()); const idB = await B.init({ name: 'B' });
  const fh = await A.putForm(FORM); await B.putForm(FORM);   // same form (content-addressed)
  await A.saveRecord({ form: fh, values: { site_id: 'A1' } });
  await B.saveRecord({ form: fh, values: { site_id: 'B1' } });

  const [ca, cb] = pipe();
  const [ra, rb] = await Promise.all([syncSession(ca, A), syncSession(cb, B)]);

  // each accepted exactly the other's one record
  assert.equal(ra.received.records, 1, 'A imported B’s record');
  assert.equal(ra.sent.records, 1, 'B imported A’s record');
  assert.equal(rb.received.records, 1);
  assert.equal(rb.sent.records, 1);

  // both repos now hold both streams' records (set-union)
  assert.equal((await A.exportBundle()).records.length, 2, 'A has both records');
  assert.equal((await B.exportBundle()).records.length, 2, 'B has both records');
  // and the collector still browses only your own (recordsView = local stream)
  assert.equal((await A.recordsView()).length, 1);
  assert.notEqual(idA.streamId, idB.streamId);
});

test('syncSession: idempotent — re-syncing the same peers adds nothing', async () => {
  const A = createStore(new MemoryBackend()); await A.init();
  const B = createStore(new MemoryBackend()); await B.init();
  const fh = await A.putForm(FORM); await B.putForm(FORM);
  await A.saveRecord({ form: fh, values: { site_id: 'A1' } });
  await B.saveRecord({ form: fh, values: { site_id: 'B1' } });

  let [ca, cb] = pipe();
  await Promise.all([syncSession(ca, A), syncSession(cb, B)]);
  [ca, cb] = pipe();
  const [ra] = await Promise.all([syncSession(ca, A), syncSession(cb, B)]);
  assert.equal(ra.received.records, 0, 'nothing new on a second sync');
  assert.equal((await A.exportBundle()).records.length, 2);
});

test('syncSession: a tampered record from the peer is rejected, not stored', async () => {
  const A = createStore(new MemoryBackend()); await A.init();
  const B = createStore(new MemoryBackend()); await B.init();
  const fh = await B.putForm(FORM);
  await B.saveRecord({ form: fh, values: { site_id: 'real' } });

  // B sends a tampered bundle: mutate a record's values after it was signed
  const realExport = B.exportBundle.bind(B);
  B.exportBundle = async () => { const b = await realExport(); b.records[0].values.site_id = 'tampered'; return b; };

  const [ca, cb] = pipe();
  const [ra] = await Promise.all([syncSession(ca, A), syncSession(cb, B)]);
  assert.equal(ra.received.records, 0, 'bad signature → not accepted');
  assert.equal(ra.received.rejected, 1);
  assert.equal((await A.exportBundle()).records.length, 0, 'nothing leaked into A');
});
