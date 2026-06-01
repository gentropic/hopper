// Boot — mounts the collector shell and registers the service worker.
// Scaffold: renders a placeholder (and a live content-address, proving the
// records/ module works in-browser) until the renderer and shell land.

import { contentAddress, utf8 } from './records/address.js';

async function mount() {
  const app = document.getElementById('app');
  if (!app) return;
  let addr = '(computing…)';
  try { addr = await contentAddress(utf8('hopper')); } catch (e) { addr = '(crypto unavailable)'; }
  app.innerHTML = `
    <main class="scaffold">
      <h1>Hopper</h1>
      <p class="tag">collector · scaffold build</p>
      <p class="muted">The shell, renderer, storage, and sync land here.
      See <code>docs/</code> for the specs.</p>
      <p class="muted">content-address of <code>"hopper"</code>:<br><code>${addr}</code></p>
    </main>`;
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
document.addEventListener('DOMContentLoaded', mount);
