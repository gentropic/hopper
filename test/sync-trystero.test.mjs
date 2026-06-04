import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryBackend } from '../vendor/vfs.js';
import { createStore } from '../src/js/storage/store.js';
import { syncSession } from '../src/js/sync/session.js';
import { trysteroChannel } from '../src/js/sync/trystero.js';

const FORM = { type: 'form', meta: { id: 'qf' }, fields: [{ name: 'site_id', fieldType: 'text', label: 'Site', props: {} }], choices: {}, rules: [], views: [] };

// A faithful mock of the Trystero room API surface trysteroChannel uses:
// makeAction → [send(data,target?), get(cb(data,fromId))], onPeerJoin/Leave, leave.
// Rooms in one `net` share a bus; delivery is async (queueMicrotask), like the real lib.
function mockNet() {
  const peers = new Map();   // id → { getters, joinCbs, leaveCbs }
  const makeRoom = (selfId) => {
    const rec = { getters: {}, joinCbs: [], leaveCbs: [] };
    peers.set(selfId, rec);
    return {
      makeAction(name) {
        const send = (data, target) => {
          for (const [id, r] of peers) {
            if (id === selfId || (target && id !== target)) continue;
            for (const cb of (r.getters[name] || [])) queueMicrotask(() => cb(data, selfId));
          }
        };
        const get = (cb) => { (rec.getters[name] = rec.getters[name] || []).push(cb); };
        return [send, get];
      },
      onPeerJoin(cb) { rec.joinCbs.push(cb); },
      onPeerLeave(cb) { rec.leaveCbs.push(cb); },
      leave() {
        peers.delete(selfId);
        for (const [, r] of peers) for (const cb of r.leaveCbs) queueMicrotask(() => cb(selfId));
      },
    };
  };
  const announce = () => {                          // every present peer "sees" every other
    const ids = [...peers.keys()];
    for (const a of ids) for (const b of ids) if (a !== b) for (const cb of peers.get(a).joinCbs) queueMicrotask(() => cb(b));
  };
  return { makeRoom, announce };
}

test('trysteroChannel: two peers union their records by joining a room', async () => {
  const A = createStore(new MemoryBackend()); const idA = await A.init({ name: 'A' });
  const B = createStore(new MemoryBackend()); const idB = await B.init({ name: 'B' });
  const fh = await A.putForm(FORM); await B.putForm(FORM);
  await A.saveRecord({ form: fh, values: { site_id: 'A1' } });
  await B.saveRecord({ form: fh, values: { site_id: 'B1' } });

  const net = mockNet();
  const pa = trysteroChannel(net.makeRoom('A'), { timeout: 0 });
  const pb = trysteroChannel(net.makeRoom('B'), { timeout: 0 });
  net.announce();                                   // peers connect → channels resolve
  const [ca, cb] = await Promise.all([pa, pb]);
  assert.equal(ca.peerId, 'B'); assert.equal(cb.peerId, 'A');

  const [ra, rb] = await Promise.all([syncSession(ca, A), syncSession(cb, B)]);
  assert.equal(ra.received.records, 1, 'A imported B’s record over Trystero');
  assert.equal(rb.received.records, 1);
  assert.equal((await A.exportBundle()).records.length, 2, 'set-union over the room');
  assert.equal((await B.exportBundle()).records.length, 2);
  assert.notEqual(idA.streamId, idB.streamId);
});

test('trysteroChannel: blob lane rides the same channel (attachment transfers)', async () => {
  const A = createStore(new MemoryBackend()); await A.init();
  const B = createStore(new MemoryBackend()); await B.init();
  const fh = await A.putForm(FORM); await B.putForm(FORM);
  const bytes = new Uint8Array([1, 2, 3, 4, 5, 0, 255, 128]);
  const hash = await A.saveBlob(bytes);
  await A.saveRecord({ form: fh, values: { site_id: 'A1' }, attachments: { photo: { blob: hash, mime: 'image/png', bytes: bytes.length } } });

  const net = mockNet();
  const pa = trysteroChannel(net.makeRoom('A'), { timeout: 0 });
  const pb = trysteroChannel(net.makeRoom('B'), { timeout: 0 });
  net.announce();
  const [ca, cb] = await Promise.all([pa, pb]);
  await Promise.all([syncSession(ca, A), syncSession(cb, B)]);

  assert.deepEqual([...(await B.getBlob(hash))], [...bytes], 'B received the blob over Trystero');
  assert.deepEqual(await B.missingBlobs(), [], 'no longer missing');
});

test('trysteroChannel: a peer leaving fires onClose', async () => {
  const net = mockNet();
  const roomA = net.makeRoom('A');
  const pa = trysteroChannel(roomA, { timeout: 0 });
  const pb = trysteroChannel(net.makeRoom('B'), { timeout: 0 });
  net.announce();
  const [ca, cb] = await Promise.all([pa, pb]);

  const closed = new Promise((res) => ca.onClose(res));
  cb.close();                                       // B leaves the room
  await closed;                                     // A's channel sees the departure
});

test('trysteroChannel: rejects if no peer joins before the timeout', async () => {
  const net = mockNet();
  await assert.rejects(
    trysteroChannel(net.makeRoom('lonely'), { timeout: 20 }),
    /no peer joined/,
  );
});
