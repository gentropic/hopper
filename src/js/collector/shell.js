// The collector shell — SPEC-hopper-collector §2–4. Three destinations around the
// renderer: Forms · Outbox · Settings (plus the Fill screen the engine lives on).
// It manages *which* forms exist, *where* records are kept, and *how* they leave
// the device — all over state that already lives in store.js (no new persistence
// here, this slice is UI composition + a router). Browser-only (DOM).
//
// UI/UX is deliberately plain for now — structure first, Switchboard polish later.

import { createForm } from '../renderer/state.js';
import { renderForm } from '../renderer/render.js';
import { loadFormByName } from '../formsource/load.js';
import { loadXlsx } from '../formsource/xlsx.js';
import * as vfs from '../../../vendor/vfs.js';

// distinct top-level names (flat build = one shared scope; avoid render.js's `el`,
// state.js's helpers, store.js's, and the old boot's `mk`/`downloadJSON`/`prefKV`)
const ce = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const shortId = (id) => String(id).split('/').slice(-1)[0];
function dlJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = ce('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Persist the chosen backup-folder handle across reloads (set-once, §4.2).
// FileSystemDirectoryHandle is structured-cloneable into IndexedDB.
function dirPref(method, val) {
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

const THEME_KEY = 'hopper-theme';
function applyTheme(t) { if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme'); }

// A small seed form so a fresh install has something to fill (idempotent: same
// hash on every boot). Real forms arrive via the add-form sources (§1).
const SEED_FORM = {
  type: 'form',
  meta: { id: 'qfdemo', title: 'QF Sample Log (demo)', mode: 'append' },
  fields: [
    { name: 'site_id', fieldType: 'text', label: 'Site ID', props: { required: true } },
    { name: 'coords', fieldType: 'geo', label: 'Coordinates', props: {} },
    { name: 'outcrop_photo', fieldType: 'photo', label: 'Outcrop photo', props: {} },
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

export async function mountShell(store, root) {
  const id = store.identity();
  applyTheme(localStorage.getItem(THEME_KEY) || null);

  // ---- shell state ----
  let screen = 'forms';        // forms | fill | outbox | settings
  let current = null;          // { tree, hash } being filled
  let sheetOpen = false;       // add-form panel
  let fillFlash = '';          // transient post-save confirmation
  let backupName = null;       // attached folder name, if any
  const supportsFolder = typeof window.showDirectoryPicker === 'function';

  // ---- static frame (built once) ----
  root.replaceChildren();
  const app = ce('main', 'co-app');
  const top = ce('header', 'co-top');
  top.append(ce('span', 'co-brand', 'Hopper'));
  const pill = ce('span', 'co-pill', 'offline · append'); top.append(pill);
  const warn = ce('div', 'co-warn'); warn.hidden = true;
  const screenEl = ce('div', 'co-screen');
  const nav = ce('nav', 'co-nav');
  const navBtn = (key, label) => { const b = ce('button', null, label); b.dataset.nav = key; b.addEventListener('click', () => go(key)); return b; };
  const navForms = navBtn('forms', 'Forms');
  const navOutbox = navBtn('outbox', 'Outbox');
  const navSettings = navBtn('settings', 'Settings');
  nav.append(navForms, navOutbox, navSettings);
  app.append(top, warn, screenEl, nav);
  root.append(app);

  // ---- folder mirror (restore a previously chosen folder; §4.2/§5) ----
  async function attachFolder(handle, alreadyGranted) {
    if (!alreadyGranted && (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
    const m = new vfs.FSAABackend({ handle }); await m.init();
    await store.setMirror(m); backupName = handle.name;
    return true;
  }
  if (supportsFolder) {
    try {
      const h = await dirPref('get');
      if (h && (await h.queryPermission({ mode: 'readwrite' })) === 'granted') await attachFolder(h, true);
    } catch {}
  }

  // ---- navigation + chrome ----
  async function go(s) { screen = s; await render(); }
  function setNavActive() {
    for (const b of [navForms, navOutbox, navSettings]) b.classList.toggle('on', b.dataset.nav === (screen === 'fill' ? 'forms' : screen));
  }
  async function refreshChrome() {
    const s = await store.status();
    navOutbox.textContent = s.recordCount ? `Outbox (${s.recordCount})` : 'Outbox';
    if (s.unbackedUp > 0) {
      warn.hidden = false; warn.dataset.unbacked = String(s.unbackedUp);
      warn.textContent = `⚠ ${s.unbackedUp} record${s.unbackedUp === 1 ? '' : 's'} exist only on this device — back up or sync`;
    } else { warn.hidden = true; delete warn.dataset.unbacked; }
  }

  async function render() {
    setNavActive();
    let view;
    if (screen === 'fill') view = viewFill();
    else if (screen === 'outbox') view = await viewOutbox();
    else if (screen === 'settings') view = await viewSettings();
    else view = await viewForms();
    screenEl.replaceChildren(view);
    await refreshChrome();
  }

  // ---- Forms ----
  async function viewForms() {
    const v = ce('section', 'co-view');
    const head = ce('div', 'co-vhead'); head.append(ce('h2', null, 'Forms')); v.append(head);

    const forms = await store.listForms();
    const recs = await store.recordsView();
    const countByForm = {};
    for (const r of recs) countByForm[r.form] = (countByForm[r.form] || 0) + 1;

    // add-form row (the only accent; opens the source panel — §2)
    const addRow = ce('button', 'co-addrow');
    addRow.append(ce('span', 'co-plus', '+'), ce('span', null, 'add form'));
    addRow.addEventListener('click', () => { sheetOpen = !sheetOpen; render(); });
    v.append(addRow);
    if (sheetOpen) v.append(addSheet());

    const list = ce('div', 'co-list');
    if (!forms.length) list.append(ce('p', 'co-empty', 'No forms yet — add one above.'));
    for (const f of forms) {
      const row = ce('button', 'co-formrow');
      const main = ce('div', 'co-formmain');
      main.append(ce('div', 'co-formtitle', f.title));
      main.append(ce('div', 'co-formsub', f.hash.slice(0, 19) + '…'));
      const n = countByForm[f.hash] || 0;
      row.append(main, ce('span', 'co-count', n ? `${n} rec` : 'fill'));
      row.addEventListener('click', () => { current = { tree: f.tree, hash: f.hash }; fillFlash = ''; go('fill'); });
      list.append(row);
    }
    v.append(list);
    return v;
  }

  function addSheet() {
    const sheet = ce('div', 'co-sheet');
    sheet.append(ce('p', 'co-sheet-h', 'Add a form — definitions only; your records never leave the device until you send them.'));

    const fileLabel = ce('label', 'co-source');
    fileLabel.append(ce('span', null, '▤ Upload form file'), ce('span', 'co-source-d', '.yaml · .json · .xlsx (XLSForm)'));
    const fileInput = ce('input'); fileInput.type = 'file'; fileInput.accept = '.yaml,.yml,.json,.xlsx'; fileInput.className = 'co-file';
    fileInput.addEventListener('change', () => onPickFile(fileInput.files && fileInput.files[0]));
    fileLabel.append(fileInput);
    sheet.append(fileLabel);

    for (const [glyph, name, desc] of [['▦', 'Scan a capsule', 'q: QR → form def'], ['↗', 'From URL', 'gh: / gist: / sheet']]) {
      const r = ce('div', 'co-source co-soon');
      r.append(ce('span', null, `${glyph} ${name}`), ce('span', 'co-source-d', `${desc} · (soon)`));
      sheet.append(r);
    }
    return sheet;
  }

  async function onPickFile(f) {
    if (!f) return;
    try {
      let tree, warnings = [];
      if (/\.xlsx$/i.test(f.name)) ({ tree, warnings } = loadXlsx(await f.arrayBuffer()));
      else tree = loadFormByName(f.name, await f.text());
      const hash = await store.putForm(tree);
      if (warnings && warnings.length) console.warn('XLSForm import warnings:', warnings);
      sheetOpen = false;
      current = { tree, hash }; fillFlash = '';
      await go('fill');                       // jump straight into the newly added form
    } catch (e) { window.alert('Could not load form: ' + e.message); }
  }

  // ---- Fill (the renderer) ----
  function viewFill() {
    const v = ce('section', 'co-view');
    const head = ce('div', 'co-fillhead');
    const back = ce('button', 'co-back', '‹'); back.setAttribute('aria-label', 'back'); back.addEventListener('click', () => go('forms'));
    head.append(back, ce('div', 'co-filltitle', (current.tree.meta && current.tree.meta.title) || 'Form'));
    v.append(head);
    if (fillFlash) { v.append(ce('div', 'co-flash', fillFlash)); fillFlash = ''; }
    const host = ce('div'); v.append(host);

    renderForm(createForm(current.tree), host, async (values, attachments) => {
      const rec = await store.saveRecord({ form: current.hash, values, attachments });
      fillFlash = `✓ saved — #${shortId(rec.id)} queued in Outbox`;
      await render();                          // fresh form for the next record + the flash
      return rec;
    }, (bytes) => store.saveBlob(bytes));
    return v;
  }

  // ---- Outbox ----
  async function viewOutbox() {
    const v = ce('section', 'co-view');
    const head = ce('div', 'co-vhead'); head.append(ce('h2', null, 'Outbox')); v.append(head);

    const recs = await store.recordsView();
    const forms = await store.listForms();
    const titleByHash = Object.fromEntries(forms.map((f) => [f.hash, f.title]));

    if (!recs.length) { v.append(ce('p', 'co-empty', 'No records yet — fill a form to collect one.')); return v; }

    // group by form (collector browses *your own* records; the union is the mill — §2)
    const groups = {};
    for (const r of recs) (groups[r.form] = groups[r.form] || []).push(r);
    for (const [hash, rows] of Object.entries(groups)) {
      v.append(ce('div', 'co-group', titleByHash[hash] || hash.slice(0, 19) + '…'));
      for (const r of rows.slice().reverse()) {
        const row = ce('div', 'co-rec');
        row.append(ce('span', 'co-rec-id', '#' + r.counter));
        const state = ce('span', 'co-rec-state ' + (r.backedUp ? 'ok' : 'warn'), r.backedUp ? 'backed up' : 'on device only');
        row.append(state);
        if (r.hasAttachments) row.append(ce('span', 'co-rec-att', '📎'));
        if (r.kind && r.kind !== 'record') row.append(ce('span', 'co-rec-kind', r.kind));
        v.append(row);
      }
    }

    // send is opt-in (§5); network sync isn't built yet, so the honest action here
    // is the durability floor: an off-device archive export.
    const actions = ce('div', 'co-actions');
    const exp = ce('button', 'co-btn', 'Export archive');
    exp.addEventListener('click', async () => {
      dlJSON(`hopper-records-${shortId(id.streamId)}.json`, await store.exportBundle());
      await store.markExported(); await render();
    });
    actions.append(exp);
    const send = ce('button', 'co-btn co-ghost', 'Send over network · (soon)'); send.disabled = true;
    actions.append(send);
    v.append(actions);
    return v;
  }

  // ---- Settings (the trust controls — §4.3) ----
  async function viewSettings() {
    const v = ce('section', 'co-view');
    const head = ce('div', 'co-vhead'); head.append(ce('h2', null, 'Settings')); v.append(head);
    const s = await store.status();

    const sec = (label) => { const d = ce('div', 'co-sec'); d.append(ce('div', 'co-seclabel', label)); const p = ce('div', 'co-panel'); d.append(p); v.append(d); return p; };
    const srow = (panel, lab, valEl) => { const r = ce('div', 'co-srow'); r.append(ce('div', 'co-lab', lab)); if (valEl) r.append(valEl); panel.append(r); return r; };

    // Collector identity
    const coll = sec('Collector');
    srow(coll, 'Name', ce('span', 'co-val', id.name || '—'));
    srow(coll, 'Stream', ce('span', 'co-val co-mono', id.streamId.slice(0, 16) + '…'));
    srow(coll, 'Device', ce('span', 'co-val co-mono', id.device));

    // Storage durability
    const stor = sec('Storage');
    const persBadge = ce('span', 'hf-badge ' + (s.persisted ? 'ok' : 'warn'), s.persisted ? 'persistent' : 'best-effort');
    srow(stor, 'Persistence', persBadge);
    srow(stor, 'Used', ce('span', 'co-val co-mono', `${(s.bytesUsed / 1024).toFixed(0)} KB · ${s.recordCount} rec`));
    srow(stor, 'Off-device backup', ce('span', 'co-val', s.mirrored ? `↪ ${backupName || 'folder'}` : 'none'));

    const storActions = ce('div', 'co-srow co-srow-actions');
    if (supportsFolder && !s.mirrored) {
      const fb = ce('button', 'co-btn', 'Back up to folder…');
      fb.addEventListener('click', async () => {
        try {
          const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
          if (await attachFolder(dir, false)) { try { await dirPref('put', dir); } catch {} await render(); }
        } catch {}
      });
      storActions.append(fb);
    }
    const expAll = ce('button', 'co-btn co-ghost', 'Export all');
    expAll.addEventListener('click', async () => { dlJSON(`hopper-records-${shortId(id.streamId)}.json`, await store.exportBundle()); await store.markExported(); await render(); });
    const keyBtn = ce('button', 'co-btn co-ghost', 'Back up key'); keyBtn.title = 'Downloads your signing key — keep it private and safe';
    keyBtn.addEventListener('click', () => dlJSON('hopper-identity.key.json', store.exportIdentity()));
    storActions.append(expAll, keyBtn);
    stor.append(storActions);

    // Appearance
    const appr = sec('Appearance');
    const seg = ce('div', 'co-seg');
    const cur = localStorage.getItem(THEME_KEY) || '';
    for (const [val, lab] of [['light', 'light'], ['dark', 'dark'], ['', 'auto']]) {
      const b = ce('button', cur === val ? 'on' : null, lab);
      b.addEventListener('click', () => { if (val) localStorage.setItem(THEME_KEY, val); else localStorage.removeItem(THEME_KEY); applyTheme(val || null); render(); });
      seg.append(b);
    }
    srow(appr, 'Theme', seg);

    // About — the six-accent legend lives here as a labelled signature (§2)
    const about = sec('About');
    about.append(ce('div', 'co-about', 'Hopper · gcu/hopper · single-file · self-hostable\nMIT — your records, your device, your host'));
    const legend = ce('div', 'co-legend');
    for (const [color, name] of [['#C8551B', 'action'], ['#2F7E8C', 'info'], ['#3E7D54', 'go'], ['#B8860B', 'caution'], ['#C8443B', 'fault'], ['#5560B8', 'selected']]) {
      const sw = ce('span', 'co-sw'); const chip = ce('span', 'co-chip'); chip.style.background = color; sw.append(chip, ce('span', 'co-swname', name)); legend.append(sw);
    }
    about.append(legend);
    return v;
  }

  // seed a form on first run, then render
  if (!(await store.listForms()).length) await store.putForm(SEED_FORM);
  await render();
  return { go };
}
