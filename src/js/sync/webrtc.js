// Serverless WebRTC carrier (SPEC-hopper-collector §5.1–5.3). The only browser↔
// browser pipe is WebRTC, and opening one needs the offer/answer SDP exchanged
// out-of-band first — our QR handshake (the two-scan dance, §5.1). This module is
// the WebRTC-specific half: it produces the SDP to put in a QR and, once the peer's
// SDP comes back, a connected **channel** for `syncSession`. Browser-only.
//
// **Non-trickle ICE:** we gather *all* candidates, then hand back the complete SDP —
// a QR can't carry trickling candidates on a back-channel. On a shared LAN, those are
// host candidates (local IP:port): small, slow to expire, no STUN/TURN, fully
// serverless (§5.2). `rtcConfig` lets a later slice add a STUN server for cross-network.
//
// v1 carries the whole (deflated, by the caller) SDP; the ~65-byte template-strip
// compaction (§5.1) is a later optimization. Channel: { send, onMessage, onClose, close }.

const ICE_TIMEOUT = 6000;

function waitIceComplete(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((res) => {
    let done = false;
    const finish = () => { if (done) return; done = true; pc.removeEventListener('icegatheringstatechange', check); res(); };
    const check = () => { if (pc.iceGatheringState === 'complete') finish(); };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(finish, ICE_TIMEOUT);   // proceed with whatever candidates we have
  });
}

function wrapChannel(dc) {
  dc.binaryType = 'arraybuffer';
  return {
    send: (msg) => dc.send(msg),
    onMessage: (cb) => dc.addEventListener('message', (e) => cb(e.data)),
    onClose: (cb) => dc.addEventListener('close', cb),
    close: () => { try { dc.close(); } catch {} },
  };
}

function channelWhenOpen(dc) {
  return new Promise((res, rej) => {
    if (dc.readyState === 'open') return res(wrapChannel(dc));
    dc.addEventListener('open', () => res(wrapChannel(dc)));
    dc.addEventListener('error', (e) => rej(e.error || new Error('datachannel error')));
  });
}

// Initiator: create the offer SDP (after ICE gathering). `connect(answerSdp)` finishes
// the handshake and resolves to { channel, close } once the DataChannel opens.
export async function webrtcOffer(rtcConfig) {
  const pc = new RTCPeerConnection(rtcConfig || {});
  const dc = pc.createDataChannel('hopper', { ordered: true });
  await pc.setLocalDescription(await pc.createOffer());
  await waitIceComplete(pc);
  return {
    sdp: pc.localDescription.sdp,
    async connect(answerSdp) {
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      const channel = await channelWhenOpen(dc);
      return { channel, close: () => { channel.close(); pc.close(); } };
    },
  };
}

// Responder: given the initiator's offer SDP, create the answer SDP (after ICE).
// `connect()` resolves to { channel, close } once the DataChannel opens.
export async function webrtcAnswer(offerSdp, rtcConfig) {
  const pc = new RTCPeerConnection(rtcConfig || {});
  const channelPromise = new Promise((res, rej) => {
    pc.addEventListener('datachannel', (e) => channelWhenOpen(e.channel).then(res, rej));
  });
  await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
  await pc.setLocalDescription(await pc.createAnswer());
  await waitIceComplete(pc);
  return {
    sdp: pc.localDescription.sdp,
    async connect() {
      const channel = await channelPromise;
      return { channel, close: () => { channel.close(); pc.close(); } };
    },
  };
}
