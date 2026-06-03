// jig entry — mount the builder into #app. Standalone surface: output leaves via
// download / capsule-share (the collector's existing intake), so no record store
// and no service worker here (the collector owns persistence + the SW; jig is a
// stateless authoring surface). Dropped into the collector as a tab later, the
// host would pass an `onEmit` to route the built tree into store.putForm instead.

import { mountJig } from './ui.js';

document.addEventListener('DOMContentLoaded', () => {
  const app = document.getElementById('app');
  if (!app) return;
  try { mountJig(app, {}); }
  catch (e) { app.textContent = 'jig init error: ' + e.message; }
});
