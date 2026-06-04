// Production wiring for the Trystero carrier: the vendored `joinRoom` (nostr
// signaling) + the pure channel adapter. Kept separate from trystero.js so that
// adapter stays dependency-free (builds + node-tests without the bundle); this
// module is the one that actually imports the vendored lib.
//
// Namespace name MUST match the manifest binding (`trystero`) — the flat build
// strips this import and resolves it to the manifest's wrapped global.

import * as trystero from '../../../vendor/trystero.js';
import { trysteroChannel } from './trystero.js';

const APP_ID = 'gentropic-hopper';   // namespaces our rooms on the shared signaling network

// Join a sync room by id. Returns { room, channel } — `channel` is a Promise that
// resolves once a peer arrives (then hand it to syncSession); `room.leave()` cancels
// while still waiting. A room id is the only out-of-band secret two devices share —
// no QR, no camera, no same-network requirement.
export function joinSyncRoom(roomId, opts = {}) {
  const room = trystero.joinRoom({ appId: APP_ID }, String(roomId));
  return { room, channel: trysteroChannel(room, opts) };
}
