// In-page barcode/QR scanning over getUserMedia + BarcodeDetector. Shared by the
// `barcode` field widget (any format) and the collector's "Scan QR" form source
// (qr_code only). Browser-only; callers gate on BarcodeDetector availability.
//
// Open the camera, poll each frame, fire onCode on the first hit then tear down.
// Returns the `{ stop }` handle **synchronously** so a caller can stop the scan the
// instant it starts it — even before the camera finishes acquiring (a fast
// navigate-away / surface dispose must not leak a live stream). The async camera
// work runs in a detached task that re-checks `ended` after each await, so a stop
// that lands mid-acquisition still releases the freshly-opened tracks. `onEnd`
// fires on any termination (hit, manual stop, failure). `formats` is an optional
// BarcodeDetector format allow-list (e.g. ['qr_code']); omit for all.
export function startBarcodeScan(box, btn, onCode, onEnd, formats) {
  let stream = null, raf = 0, ended = false;
  const label = btn.textContent;
  const video = document.createElement('video'); video.className = 'hf-scan-video';
  video.setAttribute('playsinline', ''); video.muted = true;
  const stop = () => {
    if (ended) return; ended = true;
    if (raf) cancelAnimationFrame(raf);
    if (stream) for (const t of stream.getTracks()) t.stop();
    video.remove(); btn.textContent = label; if (onEnd) onEnd();
  };
  (async () => {
    try {
      const detector = new window.BarcodeDetector(formats ? { formats } : undefined);
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (ended) { for (const t of stream.getTracks()) t.stop(); return; }   // stopped while acquiring → release now
      video.srcObject = stream; box.append(video); await video.play();
      if (ended) return;                                                     // stopped during play()
      btn.textContent = '◼ stop';
      const tick = async () => {
        if (ended) return;
        try { const codes = await detector.detect(video); if (codes.length) { onCode(codes[0].rawValue); stop(); return; } } catch {}
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } catch { stop(); }
  })();
  return { stop };
}
