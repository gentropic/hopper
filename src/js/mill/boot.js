// mill entry — open a repo archive (the collector's "Export archive" bundle) into
// an in-memory store, then mount the analysis console over its resolved union.
// Standalone surface: no IDB, no SW — an ephemeral analysis session over a bundle
// you point it at. (A collector "Mill" tab could mount mountMill over the live
// store the same way — mountMill is host-agnostic.)

import { createStore } from './storage/store.js';
import { mountMill } from './mill/ui.js';
import * as vfs from '../../vendor/vfs.js';

function landing(app) {
  app.replaceChildren();
  const wrap = document.createElement('div'); wrap.className = 'mill-landing';
  const h = document.createElement('h1'); h.className = 'mill-brand'; h.textContent = 'Hopper · mill';
  const sub = document.createElement('p'); sub.className = 'mill-sub'; sub.textContent = 'Open a Hopper archive (.json) to analyze its records.';
  const label = document.createElement('label'); label.className = 'co-btn mill-open'; label.textContent = 'Open archive…';
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json'; input.style.display = 'none';
  const err = document.createElement('div'); err.className = 'mill-err';
  label.append(input);
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0]; if (!f) return;
    err.textContent = '';
    try {
      const bundle = JSON.parse(await f.text());
      const store = createStore(new vfs.MemoryBackend());
      await store.init({ name: 'mill' });
      await store.importBundle(bundle);                 // unions + verifies signatures
      await mountMill(store, app);
    } catch (e) { err.textContent = 'Could not open: ' + e.message; }
  });
  wrap.append(h, sub, label, err);
  app.append(wrap);
}

document.addEventListener('DOMContentLoaded', () => {
  const app = document.getElementById('app');
  if (!app) return;
  try { landing(app); }
  catch (e) { app.textContent = 'mill init error: ' + e.message; }
});
