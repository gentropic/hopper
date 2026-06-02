// Boot — create the record store, mount the collector shell, register the SW.
// The shell (Forms · Outbox · Settings around the renderer) owns the UI; this is
// just the entry point. Store backend: IndexedDB in the browser.

import { createStore } from './storage/store.js';
import { mountShell } from './collector/shell.js';
import * as vfs from '../../vendor/vfs.js';

async function setup() {
  const app = document.getElementById('app');
  if (!app) return;
  const store = createStore(new vfs.IDBBackend({ name: 'hopper' }));
  await store.init({ name: 'collector' });
  await store.persistRequest();                  // ask for persistent storage (the eviction lever)
  await mountShell(store, app);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
document.addEventListener('DOMContentLoaded', () => {
  setup().catch((e) => { const a = document.getElementById('app'); if (a) a.textContent = 'init error: ' + e.message; });
});
