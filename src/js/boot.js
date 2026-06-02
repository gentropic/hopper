// Boot — create the record store, mount the collector shell, register the SW.
// The shell (Forms · Outbox · Settings around the renderer) owns the UI; this is
// just the entry point. Store backend: IndexedDB in the browser.

import { createStore } from './storage/store.js';
import { mountShell } from './collector/shell.js';
import * as vfs from '../../vendor/vfs.js';

// Capture the PWA install prompt early — `beforeinstallprompt` can fire before the
// shell mounts; stash it so the onboarding nudge / Settings can trigger it on tap.
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstallPrompt = e; });
const standalone = () => { try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; } catch { return false; } };
const installer = {
  available: () => !!deferredInstallPrompt && !standalone(),
  prompt: async () => {
    if (!deferredInstallPrompt) return false;
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;                 // one-shot
    return outcome === 'accepted';
  },
};

async function setup() {
  const app = document.getElementById('app');
  if (!app) return;
  const store = createStore(new vfs.IDBBackend({ name: 'hopper' }));
  await store.init({ name: 'collector' });
  await store.persistRequest();                  // ask for persistent storage (the eviction lever)
  await mountShell(store, app, { installer });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
document.addEventListener('DOMContentLoaded', () => {
  setup().catch((e) => { const a = document.getElementById('app'); if (a) a.textContent = 'init error: ' + e.message; });
});
