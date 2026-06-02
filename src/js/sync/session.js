// Sync session — the transport-agnostic merge protocol (SPEC-hopper-collector §5,
// SPEC-hopper-records §6). Given any reliable, ordered message **channel**, two
// peers exchange repo snapshots and run set-union: each sends its `exportBundle`,
// the other `importBundle`s it (sig-verified, idempotent, conflict-free). Symmetric
// — both sides do the same thing — so there's no client/server here; "who offered"
// is purely a WebRTC-handshake concern, below this layer.
//
// The channel is the only coupling to a transport: `{ send, onMessage, onClose, close }`
// over string messages. That's why WebRTC (now), Trystero, PeerJS, even chirp later
// are "a new channel factory, same syncSession" — not a rewrite (CLAUDE.md sequence).
//
// v1 sends the whole bundle as one message (values-first bundles are small; large
// repos need chunking — a noted 2d polish, since a DataChannel caps message size).

const SYNC_TIMEOUT = 20000;

export function syncSession(channel, store) {
  return new Promise((resolve, reject) => {
    let received = null;   // what I imported from the peer's bundle
    let sent = null;       // what the peer imported from mine (their report back)
    let finished = false;
    const finish = (fn) => { if (finished) return; finished = true; clearTimeout(timer); fn(); };
    const timer = setTimeout(() => finish(() => reject(new Error('sync timed out'))), SYNC_TIMEOUT);
    const maybeDone = () => { if (received && sent) finish(() => resolve({ received, sent })); };

    channel.onClose(() => finish(() => reject(new Error('peer closed before sync completed'))));
    channel.onMessage(async (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      try {
        if (msg.t === 'bundle') {
          received = await store.importBundle(msg.bundle);   // verifies sigs, unions in
          channel.send(JSON.stringify({ t: 'result', result: received }));
          maybeDone();
        } else if (msg.t === 'result') {
          sent = msg.result;
          maybeDone();
        }
      } catch (e) { finish(() => reject(e)); }
    });

    Promise.resolve(store.exportBundle())
      .then((bundle) => channel.send(JSON.stringify({ t: 'bundle', bundle })))
      .catch((e) => finish(() => reject(e)));
  });
}
