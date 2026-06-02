// Boot — renders a demo form end-to-end (engine + DOM renderer) and registers
// the service worker. Forms will arrive from yaml / xlsform / capsule / registry;
// this embedded tree is a stand-in until those land.

import { createForm } from './renderer/state.js';
import { renderForm } from './renderer/render.js';
import { createStore } from './storage/store.js';
import { loadFormByName } from './formsource/load.js';
import { loadXlsx } from './formsource/xlsx.js';
import * as vfs from '../../vendor/vfs.js';

const DEMO = {
  type: 'form',
  meta: { id: 'qfdemo', title: 'QF Sample Log (demo)', mode: 'append' },
  fields: [
    { name: 'site_id', fieldType: 'text', label: 'Site ID', props: { required: true } },
    { name: 'coords', fieldType: 'geo', label: 'Coordinates', props: {} },
    { name: 'resample', fieldType: 'select', label: 'Resample needed?', props: { list: 'yesno' } },
    { name: 'why', fieldType: 'text', label: 'Why resample?', props: {} },
    { name: 'samples', fieldType: 'repeat', label: 'Samples', props: {}, children: [
      { name: 'lithology', fieldType: 'select', label: 'Lithology', props: { list: 'litho' } },
      { name: 'fe_pct', fieldType: 'number', label: 'Fe %', props: {} },
    ] },
    { name: 'n_samples', fieldType: 'calc', label: 'Sample count', props: {} },
    { name: 'thanks', fieldType: 'note', label: 'Logged. Obrigado.', props: {} },
  ],
  choices: {
    yesno: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }],
    litho: [{ value: 'itabirite', label: 'itabirite' }, { value: 'hematitite', label: 'hematitite' }, { value: 'canga', label: 'canga' }],
  },
  rules: [
    { verb: 'relevant', target: 'why', expr: 'resample = "yes"' },
    { verb: 'constrain', target: 'fe_pct', expr: 'fe_pct between 0 and 100', message: 'Must be 0–100' },
    { verb: 'calculate', target: 'n_samples', expr: 'count(samples)' },
    { verb: 'show', label: 'high-grade', expr: 'mean(samples.fe_pct) > 60' },
  ],
  views: [],
};

const mk = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };

function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = mk('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Tiny IDB keyval to persist the chosen backup-folder handle across reloads, so
// "back up to a folder" is set once, not every session (FileSystemDirectoryHandle
// is structured-cloneable into IndexedDB).
function prefKV(method, val) {
  return new Promise((res, rej) => {
    const req = indexedDB.open('hopper-prefs', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onerror = () => rej(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', method === 'get' ? 'readonly' : 'readwrite');
      const r = method === 'get' ? tx.objectStore('kv').get('backupDir') : tx.objectStore('kv').put(val, 'backupDir');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    };
  });
}

async function setup() {
  const app = document.getElementById('app');
  if (!app) return;
  app.replaceChildren();
  const main = mk('main', 'hf-app');
  const h1 = mk('h1'); main.append(h1);
  const bar = mk('div', 'hf-toolbar');
  const fileLabel = mk('label', 'hf-load'); fileLabel.textContent = 'Load form ';
  const fileInput = mk('input'); fileInput.type = 'file'; fileInput.accept = '.yaml,.yml,.json,.xlsx';
  fileLabel.append(fileInput); bar.append(fileLabel); main.append(bar);
  const readout = mk('div', 'hf-readout'); main.append(readout);
  const host = mk('div'); main.append(host);
  app.append(main);

  const store = createStore(new vfs.IDBBackend({ name: 'hopper' }));
  const id = await store.init({ name: 'collector' });
  let formHash;
  await store.persistRequest();                         // ask for persistent storage (the eviction lever)

  let backupName = null;
  const supportsFolder = typeof window.showDirectoryPicker === 'function';

  // Best-effort: restore a previously chosen backup folder (set-once across reloads).
  async function attachFolder(handle, alreadyGranted) {
    if (!alreadyGranted && (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
    const m = new vfs.FSAABackend({ handle }); await m.init();
    await store.setMirror(m); backupName = handle.name;
    return true;
  }
  if (supportsFolder) {
    try {
      const h = await prefKV('get');
      if (h && (await h.queryPermission({ mode: 'readwrite' })) === 'granted') await attachFolder(h, true);
    } catch {}
  }

  // The storage readout — a trust instrument (DECISIONS §1 / collector §4.3):
  // persistence, record count, bytes, the loud single-copy warning, and the
  // durability actions (folder auto-backup, data export, key backup).
  async function refresh() {
    const s = await store.status();
    readout.replaceChildren();
    const line = mk('div', 'hf-readout-line');
    const badge = mk('span', 'hf-badge ' + (s.persisted ? 'ok' : 'warn'));
    badge.textContent = s.persisted ? 'persistent ✓' : 'best-effort ⚠';
    const info = mk('span', 'hf-readout-info');
    info.textContent = `${s.recordCount} record${s.recordCount === 1 ? '' : 's'} · ${(s.bytesUsed / 1024).toFixed(0)} KB`
      + (s.mirrored ? ` · ↪ ${backupName || 'folder'}` : '') + ` · ${id.streamId.slice(0, 8)}…`;
    line.append(badge, info);

    if (supportsFolder && !s.mirrored) {
      const fb = mk('button', 'hf-export'); fb.type = 'button'; fb.textContent = 'Back up to folder…';
      fb.addEventListener('click', async () => {
        try {
          const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
          if (await attachFolder(dir, false)) { try { await prefKV('put', dir); } catch {} await refresh(); }
        } catch {}
      });
      line.append(fb);
    }
    const exp = mk('button', 'hf-export'); exp.type = 'button'; exp.textContent = 'Export all';
    exp.addEventListener('click', async () => {
      downloadJSON(`hopper-${DEMO.meta.id}-${Date.now()}.json`, await store.exportBundle());
      await store.markExported(); await refresh();
    });
    const key = mk('button', 'hf-export'); key.type = 'button'; key.textContent = 'Back up key'; key.title = 'Downloads your signing key — keep it private and safe';
    key.addEventListener('click', () => downloadJSON('hopper-identity.key.json', store.exportIdentity()));
    line.append(exp, key);
    readout.append(line);

    if (s.unbackedUp > 0) {
      const w = mk('div', 'hf-warn'); w.dataset.unbacked = String(s.unbackedUp);
      w.textContent = `⚠ ${s.unbackedUp} record${s.unbackedUp === 1 ? '' : 's'} exist only on this device — back up to a folder, export, or sync`;
      readout.append(w);
    }
  }
  await refresh();

  // Load a form (uploaded file, or the default) → store its definition → render.
  // Save signs the values into an immutable record against the loaded form's hash.
  async function loadForm(tree) {
    h1.textContent = (tree.meta && tree.meta.title) || 'Form';
    formHash = await store.putForm(tree);
    renderForm(createForm(tree), host, async (values) => {
      const rec = await store.saveRecord({ form: formHash, values });
      await refresh();
      return rec;
    });
  }
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    try {
      let tree, warnings = [];
      if (/\.xlsx$/i.test(f.name)) ({ tree, warnings } = loadXlsx(await f.arrayBuffer()));
      else tree = loadFormByName(f.name, await f.text());
      await loadForm(tree);
      if (warnings.length) console.warn('XLSForm import warnings:', warnings);
    } catch (e) { window.alert('Could not load form: ' + e.message); }
  });
  await loadForm(DEMO);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
document.addEventListener('DOMContentLoaded', () => {
  setup().catch((e) => { const a = document.getElementById('app'); if (a) a.textContent = 'init error: ' + e.message; });
});
