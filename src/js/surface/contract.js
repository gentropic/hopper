// The Hopper surface contract — `mount(ctx) → dispose` (DECISIONS §14).
//
// Every Hopper surface (Collect / Build / Analyze) is a pure function of an
// injected context that returns a teardown:
//
//   mount(ctx) → disposeFn | Promise<disposeFn>
//   ctx = { root, store?, onEmit?, initialTree?, embedded?, installer?, … }
//
// `root` is the mount element; `store` is the record store (absent for the
// stateless jig); the rest are surface-specific. `dispose()` MUST release live
// OS/network resources — camera/MediaStreams, WebRTC/Trystero connections, loom
// grids, timers, and any document-level listeners — so a host can unmount a
// surface without leaking into its realm.
//
// This deliberately mirrors the Works inline-mount contract (auditable
// SURFACES.md §12.5, ctx = { root, bus, tab, vfs, home }): `store` stands in for
// `vfs`, and bus/tab/home are absent standalone. Keeping this shape now makes
// Works-citizenship a later thin A-Bus adapter rather than a rewrite — see
// ../auditable/INTEROP.md and the §5.2 Surface ABI (@gcu/surface).

// bootSurface — the standalone host adapter. Waits for the DOM, finds the mount
// root (#app by default), calls mount({ root }), and holds the returned dispose
// for teardown on page hide (so a reload never leaks a live camera). The `mount`
// callback builds the rest of `ctx` (creating the store, decoding a hash, …) and
// returns the surface's dispose. Mirrors @gcu/surface's `bootSurface` role for
// the sandboxed path. Init errors render into the root rather than blanking it.
//
// Returns a `teardown()` the caller can invoke directly (HMR, tests).
export function bootSurface(mount, opts = {}) {
  const rootId = opts.rootId || 'app';
  const label = opts.label || 'surface';
  let dispose = null;
  let disposed = false;

  const teardown = () => {
    if (disposed) return;
    disposed = true;
    if (typeof dispose === 'function') { try { dispose(); } catch {} }
    dispose = null;
  };

  const start = async () => {
    const root = document.getElementById(rootId);
    if (!root) return;
    try { dispose = await mount({ root }); }
    catch (e) { root.textContent = `${label} init error: ${(e && e.message) || e}`; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  if (typeof window !== 'undefined') window.addEventListener('pagehide', teardown, { once: true });

  return teardown;
}
