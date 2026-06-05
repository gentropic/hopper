// Boot — capture the install prompt, register the SW, and mount the collector
// shell through the surface contract (surface/contract.js: mount(ctx) → dispose).
// Thin by design: the shell owns the UI. Store backend: IndexedDB in the browser.

import { createStore } from './storage/store.js';
import { mountShell } from './collector/shell.js';
import { bootSurface } from './surface/contract.js';
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

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

bootSurface(async ({ root }) => {
  const store = createStore(new vfs.IDBBackend({ name: 'hopper' }));
  await store.init({ name: 'collector' });
  await store.persistRequest();                  // ask for persistent storage (the eviction lever)
  return mountShell({ root, store, installer });
}, { label: 'collector' });
