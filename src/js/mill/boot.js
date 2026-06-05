// mill entry — open a repo archive (the collector's "Export archive" bundle) into
// an in-memory store, then mount the analysis console over its resolved union via
// the surface contract (mount(ctx) → dispose). If the page is opened at a shared-
// analysis link (mill.html#<capsule>), the analysis is decoded and applied once
// you open the archive it targets — analyses travel like forms. Standalone
// surface: no IDB, no SW (ephemeral session).

import { createStore } from '../storage/store.js';
import { mountMill } from './ui.js';
import { bootSurface } from '../surface/contract.js';
import * as vfs from '../../../vendor/vfs.js';
import * as capsule from '../../../vendor/capsule.js';

const ce = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// A shared-analysis capsule in the URL #fragment → the analysis object (or null).
async function decodeHashAnalysis() {
  const h = (location.hash || '').slice(1);
  if (!h) return null;
  try {
    const bytes = await capsule.resolve(capsule.fragmentDecode(h));
    const obj = JSON.parse(new TextDecoder().decode(bytes));
    return (obj && obj.kind === 'hopper-analysis') ? obj : null;
  } catch { return null; }
}

// Render the open-archive landing. On a chosen file, mount the mill and report its
// dispose back via onMount so the surface teardown can reach the live grid.
function landing(app, pending, onMount) {
  app.replaceChildren();
  const wrap = ce('div', 'mill-landing');
  wrap.append(ce('h1', 'mill-brand', 'Hopper · mill'));
  wrap.append(ce('p', 'mill-sub', 'Open a Hopper archive (.json) to analyze its records.'));
  if (pending) wrap.append(ce('p', 'mill-pending', `An analysis is ready${pending.formTitle ? ` — "${pending.formTitle}"` : ''}. Open the archive it applies to and it will run automatically.`));
  const label = ce('label', 'co-btn mill-open', 'Open archive…');
  const input = ce('input'); input.type = 'file'; input.accept = '.json,application/json'; input.style.display = 'none';
  const err = ce('div', 'mill-err');
  label.append(input);
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0]; if (!f) return;
    err.textContent = '';
    try {
      const bundle = JSON.parse(await f.text());
      const store = createStore(new vfs.MemoryBackend());
      await store.init({ name: 'mill' });
      await store.importBundle(bundle);                 // unions + verifies signatures
      const dispose = await mountMill({ root: app, store, analysis: pending });
      if (onMount) onMount(dispose);
    } catch (e) { err.textContent = 'Could not open: ' + e.message; }
  });
  wrap.append(label, err);
  app.append(wrap);
}

bootSurface(async ({ root }) => {
  let millDispose = null;
  let pending = null;
  try { pending = await decodeHashAnalysis(); } catch {}
  if (pending) { try { history.replaceState(null, '', location.pathname + location.search); } catch {} }   // one-shot: clear the hash
  landing(root, pending, (d) => { millDispose = d; });
  return () => { if (millDispose) { try { millDispose(); } catch {} millDispose = null; } };
}, { label: 'mill' });
