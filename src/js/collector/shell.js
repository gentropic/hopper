// The collector shell — SPEC-hopper-collector §2–4. Three destinations around the
// renderer: Forms · Outbox · Settings (plus the Fill screen the engine lives on).
// It manages *which* forms exist, *where* records are kept, and *how* they leave
// the device — all over state that already lives in store.js (no new persistence
// here, this slice is UI composition + a router). Browser-only (DOM).
//
// UI/UX is deliberately plain for now — structure first, Switchboard polish later.

import { createForm } from '../renderer/state.js';
import { renderForm } from '../renderer/render.js';
import { startBarcodeScan } from '../renderer/scan.js';
import { mountJig } from '../jig/ui.js';
import { loadFormByName } from '../formsource/load.js';
import { loadXlsx } from '../formsource/xlsx.js';
import { resolveFormCapsule } from '../formsource/capsule.js';
import { syncSession } from '../sync/session.js';
import { webrtcOffer, webrtcAnswer } from '../sync/webrtc.js';
import { encodeHandshake, decodeHandshake } from '../sync/handshake.js';
import * as capsule from '../../../vendor/capsule.js';
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
function isStandalone() { try { return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true; } catch { return false; } }

// Count fields in a §8 tree (recursing into group/repeat children) — for the
// add-form confirm preview, so the user sees the shape of what's landing.
function countFields(nodes) {
  let n = 0;
  for (const node of nodes || []) { if (node.children) n += countFields(node.children); else n += 1; }
  return n;
}

// A transient bottom toast (errors, advisories). Auto-dismisses.
function toast(msg) {
  const t = ce('div', 'co-toast', msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 3800);
}

// "Add this form?" — a confirm step before any capsule/link form is added. A
// stranger's definition is safe to *open* (totality is the boundary), but adding
// it is the user's call, and they should see what + from where. Resolves to a bool.
function confirmAddForm(tree, source) {
  return new Promise((res) => {
    const scrim = ce('div', 'co-scrim');
    const panel = ce('div', 'co-confirm');
    const n = countFields(tree.fields);
    panel.append(ce('h3', 'co-confirm-h', 'Add this form?'));
    panel.append(ce('div', 'co-confirm-title', (tree.meta && (tree.meta.title || tree.meta.id)) || 'Untitled form'));
    panel.append(ce('div', 'co-confirm-meta', `${n} field${n === 1 ? '' : 's'} · from ${source}`));
    const actions = ce('div', 'co-confirm-actions');
    const cancel = ce('button', 'co-btn co-ghost', 'Cancel');
    const add = ce('button', 'co-btn', 'Add form');
    const done = (ok) => { scrim.remove(); res(ok); };
    cancel.addEventListener('click', () => done(false));
    add.addEventListener('click', () => done(true));
    scrim.addEventListener('click', (e) => { if (e.target === scrim) done(false); });
    actions.append(cancel, add); panel.append(actions); scrim.append(panel);
    document.body.append(scrim);
  });
}

// Render a string as a QR (Nayuki qrcodegen, flat-inlined global). SVG so it
// scales crisply in the single-file artifact. Throws if the data exceeds QR
// capacity — callers catch and fall back to the copy-link.
function qrSvg(text) {
  const QR = globalThis.qrcodegen.QrCode;
  const qr = QR.encodeText(text, QR.Ecc.MEDIUM);
  const n = qr.size, b = 2, dim = n + b * 2;
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.getModule(x, y)) d += `M${x + b} ${y + b}h1v1h-1z`;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${dim} ${dim}`); svg.setAttribute('class', 'co-qr'); svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(NS, 'rect'); bg.setAttribute('width', String(dim)); bg.setAttribute('height', String(dim)); bg.setAttribute('fill', '#fff');
  const path = document.createElementNS(NS, 'path'); path.setAttribute('d', d); path.setAttribute('fill', '#000');
  svg.append(bg, path);
  return svg;
}

// Share a form *out* — the producer for the links/QRs the shell consumes (§1).
// encodeInline the §8 tree as a `q:` capsule, fragment-encode it into a share URL
// (the `q:` gotcha — always fragment-encode), render a QR + a copy-link. makeShare
// gives the URL size + tightest channel fit; the QR degrades to link-only when big.
async function shareForm(tree) {
  const base = location.origin + location.pathname;
  const share = await capsule.makeShare(JSON.stringify(tree), { form: 'q', baseUrl: base });
  const url = base + '#' + share.fragment;

  const scrim = ce('div', 'co-scrim');
  const panel = ce('div', 'co-confirm co-share');
  panel.append(ce('h3', 'co-confirm-h', 'Share this form'));
  panel.append(ce('div', 'co-confirm-title', (tree.meta && (tree.meta.title || tree.meta.id)) || 'Untitled form'));

  try { const w = ce('div', 'co-qr-wrap'); w.append(qrSvg(url)); panel.append(w); }
  catch { panel.append(ce('div', 'co-share-toobig', '⚠ Too large to scan as a QR — use the link below.')); }

  const linkRow = ce('div', 'co-share-link');
  const input = ce('input', 'co-share-url'); input.readOnly = true; input.value = url;
  const copy = ce('button', 'co-btn', 'Copy link');
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); copy.textContent = 'Copied ✓'; setTimeout(() => { copy.textContent = 'Copy link'; }, 1500); }
    catch { input.select(); }
  });
  linkRow.append(input, copy); panel.append(linkRow);
  panel.append(ce('div', 'co-confirm-meta', `${share.urlBytes} B · ${share.tightestFit ? 'fits ' + share.tightestFit : 'link only'}`));

  const actions = ce('div', 'co-confirm-actions');
  const close = ce('button', 'co-btn co-ghost', 'Close'); close.addEventListener('click', () => scrim.remove());
  scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
  actions.append(close); panel.append(actions); scrim.append(panel);
  document.body.append(scrim);
}

// Generic confirm overlay (retract, etc.) → Promise<bool>.
function confirmDialog({ title, body, ok = 'OK', danger = false }) {
  return new Promise((res) => {
    const scrim = ce('div', 'co-scrim');
    const panel = ce('div', 'co-confirm');
    panel.append(ce('h3', 'co-confirm-h', title));
    if (body) panel.append(ce('div', 'co-confirm-meta', body));
    const actions = ce('div', 'co-confirm-actions');
    const cancel = ce('button', 'co-btn co-ghost', 'Cancel');
    const okb = ce('button', 'co-btn' + (danger ? ' co-danger' : ''), ok);
    const done = (v) => { scrim.remove(); res(v); };
    cancel.addEventListener('click', () => done(false));
    okb.addEventListener('click', () => done(true));
    scrim.addEventListener('click', (e) => { if (e.target === scrim) done(false); });
    actions.append(cancel, okb); panel.append(actions); scrim.append(panel);
    document.body.append(scrim);
  });
}

// Populate a fresh form from a values map (the inverse of form.values()) — for
// correcting a record. Scalars via set(); repeats by re-adding instances; calc is
// recomputed (ignored); media lives in attachments (carried forward), not values.
function applyValues(form, values) {
  const repeats = new Set(form.repeatNames ? form.repeatNames() : []);
  for (const [k, val] of Object.entries(values || {})) {
    if (repeats.has(k)) {
      if (Array.isArray(val)) for (const instVals of val) {
        const inst = form.repeat(k).add();
        for (const [ck, cv] of Object.entries(instVals || {})) { const cell = inst.children.get(ck); if (cell) cell.set(cv); }
      }
    } else { form.set(k, val); }
  }
}

// A small seed form so a fresh install has something to fill (idempotent: same
// hash on every boot). Real forms arrive via the add-form sources (§1).
const SEED_FORM = {
  type: 'form',
  meta: { id: 'qfdemo', title: 'QF Sample Log (demo)', mode: 'append' },
  fields: [
    { name: 'site_id', fieldType: 'text', label: 'Site ID', props: { required: true } },
    { name: 'coords', fieldType: 'geo', label: 'Coordinates', props: {} },
    { name: 'traverse', fieldType: 'geotrace', label: 'Traverse', props: {} },
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

const ONBOARD_KEY = 'hopper-onboard-dismissed';

export async function mountShell(store, root, opts = {}) {
  const id = store.identity();
  applyTheme(localStorage.getItem(THEME_KEY) || null);
  // install hook from boot (captures `beforeinstallprompt`); safe no-op default.
  const installer = opts.installer || { available: () => false, prompt: async () => false };

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
  const navBuild = navBtn('build', 'Build');
  const navOutbox = navBtn('outbox', 'Outbox');
  const navSettings = navBtn('settings', 'Settings');
  nav.append(navForms, navBuild, navOutbox, navSettings);
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
    for (const b of [navForms, navBuild, navOutbox, navSettings]) b.classList.toggle('on', b.dataset.nav === (screen === 'fill' ? 'forms' : screen));
  }
  async function refreshChrome() {
    const s = await store.status();
    const effective = (await store.recordsView()).length;   // resolved records — matches the Outbox list
    navOutbox.textContent = effective ? `Outbox (${effective})` : 'Outbox';
    if (s.unbackedUp > 0) {
      warn.hidden = false; warn.dataset.unbacked = String(s.unbackedUp);
      warn.textContent = `⚠ ${s.unbackedUp} record${s.unbackedUp === 1 ? '' : 's'} exist only on this device — back up or sync`;
    } else { warn.hidden = true; delete warn.dataset.unbacked; }
  }

  async function render() {
    setNavActive();
    let view;
    if (screen === 'fill') view = viewFill();
    else if (screen === 'build') view = viewBuild();
    else if (screen === 'outbox') view = await viewOutbox();
    else if (screen === 'settings') view = await viewSettings();
    else view = await viewForms();
    screenEl.replaceChildren(view);
    await refreshChrome();
  }

  // First-run durability nudge (§4.2): records live in evictable browser storage
  // until you make them durable — install for persistent storage, or back up to a
  // folder. Shown once (dismissible) on Forms while not yet durable / not installed.
  async function onboardCard() {
    if (localStorage.getItem(ONBOARD_KEY) || isStandalone()) return null;
    const s = await store.status();
    if (s.persisted || s.mirrored) return null;                 // already durable — no nudge
    const card = ce('div', 'co-onboard');
    card.append(ce('div', 'co-onboard-h', 'Keep your records safe'));
    card.append(ce('div', 'co-onboard-b', 'Your records live in this browser, which can evict them. Make storage durable — install the app for persistent, eviction-proof storage, or back up to a folder (Settings).'));
    const acts = ce('div', 'co-onboard-acts');
    if (installer.available()) {
      const ins = ce('button', 'co-btn', 'Install app');
      ins.addEventListener('click', async () => { await installer.prompt(); await render(); });
      acts.append(ins);
    }
    const per = ce('button', 'co-btn' + (installer.available() ? ' co-ghost' : ''), 'Grant persistence');
    per.addEventListener('click', async () => { const ok = await store.persistRequest(); toast(ok ? 'Persistent storage granted ✓' : 'Browser declined — install the app to qualify'); await render(); });
    const dis = ce('button', 'co-btn co-ghost', 'Dismiss');
    dis.addEventListener('click', () => { localStorage.setItem(ONBOARD_KEY, '1'); render(); });
    acts.append(per, dis); card.append(acts);
    return card;
  }

  // ---- Build (jig) ----
  // The schema-from-example builder, embedded as a tab. jig is host-agnostic
  // (mountJig(onEmit)); here onEmit routes the built tree into the record store
  // and jumps straight to Fill — build → collect with no file handoff. The same
  // surface also ships standalone as jig.html (surfaces-not-apps, DECISIONS §7).
  function viewBuild() {
    const v = ce('section', 'co-view');
    const host = ce('div', 'co-build');
    mountJig(host, {
      embedded: true,
      onEmit: async (tree) => {
        const hash = await store.putForm(tree);
        current = { tree, hash }; fillFlash = '';
        toast('Form added ✓');
        await go('fill');
      },
    });
    v.append(host);
    return v;
  }

  // ---- Forms ----
  async function viewForms() {
    const v = ce('section', 'co-view');
    const head = ce('div', 'co-vhead'); head.append(ce('h2', null, 'Forms')); v.append(head);
    const ob = await onboardCard(); if (ob) v.append(ob);

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

    // file upload — explicit, so no confirm step
    const fileLabel = ce('label', 'co-source');
    fileLabel.append(ce('span', null, '▤ Upload form file'), ce('span', 'co-source-d', '.yaml · .json · .xlsx (XLSForm)'));
    const fileInput = ce('input'); fileInput.type = 'file'; fileInput.accept = '.yaml,.yml,.json,.xlsx'; fileInput.className = 'co-file';
    fileInput.addEventListener('change', () => onPickFile(fileInput.files && fileInput.files[0]));
    fileLabel.append(fileInput);
    sheet.append(fileLabel);

    // paste a capsule string or share link (inline = offline; gh:/gist:/url: fetched)
    const paste = ce('div', 'co-source');
    paste.append(ce('span', null, '⧉ Paste a capsule or link'), ce('span', 'co-source-d', 'q: / i: / gh: / gist: / url: · or a share link'));
    const ta = ce('textarea', 'co-paste-input'); ta.rows = 2; ta.placeholder = 'q:d… or https://…/#…';
    const resolveBtn = ce('button', 'co-btn', 'Resolve'); resolveBtn.type = 'button';
    const perr = ce('div', 'co-paste-err');
    resolveBtn.addEventListener('click', async () => {
      const val = ta.value.trim();
      if (!val) return;
      perr.textContent = ''; resolveBtn.disabled = true; resolveBtn.textContent = 'resolving…';
      try { await onResolveCapsule(val, 'a pasted capsule'); }
      catch (e) { perr.textContent = 'Could not resolve: ' + e.message; }
      finally { resolveBtn.disabled = false; resolveBtn.textContent = 'Resolve'; }
    });
    paste.append(ta, resolveBtn, perr);
    sheet.append(paste);

    // scan a QR (camera → capsule). Paste stays the floor where BarcodeDetector
    // is absent (Firefox/Safari); the decoded string flows through resolve+confirm.
    const hasScanner = typeof window !== 'undefined' && 'BarcodeDetector' in window && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
    const scanWrap = ce('div', 'co-source');
    scanWrap.append(ce('span', null, '▦ Scan QR'), ce('span', 'co-source-d', hasScanner ? 'camera → capsule' : 'camera not available — paste above'));
    if (hasScanner) {
      const scanBtn = ce('button', 'co-btn', '📷 Scan'); scanBtn.type = 'button';
      let session = null;
      scanBtn.addEventListener('click', async () => {
        if (session) { session.stop(); return; }
        session = await startBarcodeScan(scanWrap, scanBtn,
          async (val) => { try { await onResolveCapsule(val, 'a scanned QR'); } catch (e) { toast('Could not resolve QR: ' + e.message); } },
          () => { session = null; }, ['qr_code']);
      });
      scanWrap.append(scanBtn);
    } else { scanWrap.classList.add('co-soon'); }
    sheet.append(scanWrap);
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
    } catch (e) { toast('Could not load form: ' + e.message); }
  }

  // Add a capsule/link-resolved form, gated by a confirm preview, then open it.
  async function addResolvedForm(tree, source) {
    if (!(await confirmAddForm(tree, source))) return false;
    const hash = await store.putForm(tree);
    sheetOpen = false; current = { tree, hash }; fillFlash = '';
    await go('fill');
    return true;
  }
  async function onResolveCapsule(input, source) {
    const tree = await resolveFormCapsule(input);   // throws → caller surfaces it
    await addResolvedForm(tree, source);
  }

  // Open: if the URL carries a capsule in its #fragment (a shared link), offer to
  // add it — confirmed, never silent. One-shot: clear the hash so a reload won't
  // re-prompt. Failures toast and fall through to the normal shell (§1, §5).
  async function checkInboundCapsule() {
    if (!location.hash || location.hash.length < 2) return;
    const href = location.href;
    history.replaceState(null, '', location.pathname + location.search);
    try { await addResolvedForm(await resolveFormCapsule(href), 'a shared link'); }
    catch (e) { toast('Could not open the shared form: ' + e.message); }
  }

  // ---- Fill (the renderer) ----
  function viewFill() {
    const v = ce('section', 'co-view');
    const head = ce('div', 'co-fillhead');
    const correcting = current.correcting;
    const back = ce('button', 'co-back', '‹'); back.setAttribute('aria-label', 'back'); back.addEventListener('click', () => go(correcting ? 'outbox' : 'forms'));
    const shareBtn = ce('button', 'co-share-btn', '⤴ Share'); shareBtn.type = 'button';
    shareBtn.addEventListener('click', () => shareForm(current.tree).catch((e) => toast('Could not build share: ' + e.message)));
    head.append(back, ce('div', 'co-filltitle', (current.tree.meta && current.tree.meta.title) || 'Form'), shareBtn);
    v.append(head);
    if (correcting) v.append(ce('div', 'co-flash', `Correcting #${shortId(correcting.id)} — save to supersede it`));
    if (fillFlash) { v.append(ce('div', 'co-flash', fillFlash)); fillFlash = ''; }
    const host = ce('div'); v.append(host);

    const form = createForm(current.tree);
    if (correcting) applyValues(form, correcting.values);     // pre-fill from the record being corrected

    renderForm(form, host, async (values, attachments) => {
      if (correcting) {
        // append a correction superseding the original; carry forward its attachments, overlay any re-captured
        const rec = await store.saveRecord({ form: current.hash, values, attachments: { ...(correcting.attachments || {}), ...(attachments || {}) }, kind: 'correction', supersedes: correcting.id });
        current.correcting = null;
        await go('outbox');
        toast(`✓ correction saved — #${shortId(correcting.id)} superseded`);
        return rec;
      }
      const rec = await store.saveRecord({ form: current.hash, values, attachments });
      fillFlash = `✓ saved — #${shortId(rec.id)} queued in Outbox`;
      await render();                          // fresh form for the next record + the flash
      return rec;
    }, (bytes) => store.saveBlob(bytes));
    return v;
  }

  // Serverless WebRTC sync (§5.1–5.3): the two-scan QR handshake. One peer Starts
  // (shows an offer code, scans the reply), the other Joins (scans the offer, shows
  // a reply). Both then run `syncSession` over the live DataChannel → set-union merge.
  // Camera + same-LAN required; no server. (Compaction of the QR is 2d — see handshake.js.)
  function openSyncPeer() {
    const scrim = ce('div', 'co-scrim');
    const panel = ce('div', 'co-confirm co-sync');
    panel.append(ce('h3', 'co-confirm-h', 'Sync with a peer'));
    const body = ce('div', 'co-sync-body'); panel.append(body);
    let teardown = () => {};                                  // closes the live peer connection
    const closeBtn = ce('button', 'co-btn co-ghost', 'Close');
    closeBtn.addEventListener('click', () => { try { teardown(); } catch {} scrim.remove(); });
    const actions = ce('div', 'co-confirm-actions'); actions.append(closeBtn); panel.append(actions);
    scrim.append(panel); document.body.append(scrim);

    const status = (msg, cls) => body.replaceChildren(ce('div', 'co-sync-status' + (cls ? ' ' + cls : ''), msg));
    const fail = (e) => status('Sync failed: ' + (e && e.message ? e.message : e), 'co-sync-err');
    const showQR = (label, code) => { body.append(ce('div', 'co-sync-step', label)); const w = ce('div', 'co-qr-wrap'); w.append(qrSvg(code)); body.append(w); };
    const scanControl = (label, onCode) => {
      body.append(ce('div', 'co-sync-step', label));
      const sbox = ce('div'); const sbtn = ce('button', 'co-btn', '📷 Scan'); body.append(sbox, sbtn);
      let session = null;
      sbtn.addEventListener('click', async () => {
        if (session) { session.stop(); return; }
        session = await startBarcodeScan(sbox, sbtn, onCode, () => { session = null; }, ['qr_code']);
      });
    };
    const afterConnect = async (conn) => {
      teardown = conn.close;
      status('Syncing…');
      const res = await syncSession(conn.channel, store);
      conn.close(); teardown = () => {};
      await render();                                        // refresh outbox counts / records
      const photos = (n) => (n ? ` + ${n} photo${n === 1 ? '' : 's'}` : '');
      status(`Synced ✓ — received ${res.received.records} rec${photos(res.blobs.received)}, sent ${res.sent.records} rec${photos(res.blobs.sent)}`, 'co-sync-ok');
    };

    async function runOfferer() {
      try {
        status('Preparing your code…');
        const offer = await webrtcOffer();
        teardown = offer.close;
        const code = await encodeHandshake(offer.sdp);
        body.replaceChildren();
        showQR('1 · Show this to your peer', code);
        scanControl('2 · Scan their reply', async (text) => {
          try { status('Connecting…'); await afterConnect(await offer.connect(await decodeHandshake(text))); }
          catch (e) { fail(e); }
        });
      } catch (e) { fail(e); }
    }
    async function runAnswerer() {
      try {
        body.replaceChildren();
        scanControl('1 · Scan your peer’s code', async (text) => {
          try {
            status('Preparing your reply…');
            const answer = await webrtcAnswer(await decodeHandshake(text));
            teardown = answer.close;
            const code = await encodeHandshake(answer.sdp);
            body.replaceChildren();
            showQR('2 · Show this back to your peer', code);
            body.append(ce('div', 'co-sync-status', 'Waiting to connect…'));
            await afterConnect(await answer.connect());
          } catch (e) { fail(e); }
        });
      } catch (e) { fail(e); }
    }

    body.append(ce('p', 'co-sync-hint', 'Both of you on the same wifi. One Starts and one Joins — then scan each other’s codes.'));
    const roles = ce('div', 'co-sync-roles');
    const start = ce('button', 'co-btn', 'Start'); start.addEventListener('click', runOfferer);
    const join = ce('button', 'co-btn co-ghost', 'Join'); join.addEventListener('click', runAnswerer);
    roles.append(start, join); body.append(roles);
  }

  // ---- Outbox ----
  async function viewOutbox() {
    const v = ce('section', 'co-view');
    const head = ce('div', 'co-vhead'); head.append(ce('h2', null, 'Outbox')); v.append(head);

    const recs = await store.recordsView();
    const forms = await store.listForms();
    const titleByHash = Object.fromEntries(forms.map((f) => [f.hash, f.title]));
    const formByHash = Object.fromEntries(forms.map((f) => [f.hash, f]));

    // re-open the form pre-filled with this record's values; saving appends a
    // correction that supersedes it (resolved on read — §5/§9).
    function onCorrect(r) {
      const f = formByHash[r.form];
      if (!f) { toast('That form isn’t loaded — add it to correct this record.'); return; }
      current = { tree: f.tree, hash: f.hash, correcting: { id: r.id, values: r.values, attachments: r.attachments || {} } };
      fillFlash = '';
      go('fill');
    }
    // append a tombstone — append-only: the record stays in the log but drops from view.
    async function onRetract(r) {
      const ok = await confirmDialog({ title: 'Retract this record?', body: `#${shortId(r.id)} will be tombstoned — append-only, so it stays in the signed log but drops from your outbox. Reversible with another correction.`, ok: 'Retract', danger: true });
      if (!ok) return;
      await store.saveRecord({ form: r.form, values: {}, kind: 'tombstone', supersedes: r.id });
      await render();
    }

    if (!recs.length) {
      v.append(ce('p', 'co-empty', 'No records yet — fill a form to collect one, or import an archive below.'));
    } else {
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
          if (r.corrected) row.append(ce('span', 'co-rec-kind', 'corrected'));
          const acts = ce('span', 'co-rec-acts');
          const cor = ce('button', 'co-rec-act', 'correct'); cor.type = 'button'; cor.addEventListener('click', () => onCorrect(r));
          const ret = ce('button', 'co-rec-act', 'retract'); ret.type = 'button'; ret.addEventListener('click', () => onRetract(r));
          acts.append(cor, ret); row.append(acts);
          v.append(row);
        }
      }
    }

    // send is opt-in (§5). Network carriers aren't built yet; the working carriers
    // are the archive file — export (the durability floor) and import (set-union
    // merge — pull a peer's bundle in, conflict-free, sigs verified — §6).
    const actions = ce('div', 'co-actions');
    const exp = ce('button', 'co-btn', 'Export archive');
    exp.addEventListener('click', async () => {
      dlJSON(`hopper-records-${shortId(id.streamId)}.json`, await store.exportBundle());
      await store.markExported(); await render();
    });
    actions.append(exp);

    const imp = ce('label', 'co-btn co-ghost'); imp.textContent = 'Import archive';
    const impInput = ce('input', 'co-import'); impInput.type = 'file'; impInput.accept = '.json'; impInput.hidden = true;
    impInput.addEventListener('change', async () => {
      const f = impInput.files && impInput.files[0];
      if (!f) return;
      try {
        const r = await store.importBundle(JSON.parse(await f.text()));
        const bits = [`${r.records} record${r.records === 1 ? '' : 's'}`, `${r.forms} form${r.forms === 1 ? '' : 's'}`];
        if (r.skipped) bits.push(`${r.skipped} already had`);
        if (r.rejected) bits.push(`${r.rejected} rejected`);
        toast('Imported ' + bits.join(' · '));
        await render();
      } catch (e) { toast('Import failed: ' + e.message); }
    });
    imp.append(impInput); actions.append(imp);

    const sync = ce('button', 'co-btn co-ghost', 'Sync with a peer');
    sync.addEventListener('click', () => openSyncPeer());
    actions.append(sync);
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

    // Collector identity — the name rides into peer sync as your label (§3); editable.
    const coll = sec('Collector');
    const nameInput = ce('input', 'co-name-input'); nameInput.value = id.name || ''; nameInput.placeholder = 'your name';
    nameInput.addEventListener('change', async () => { const n = await store.setName(nameInput.value); toast('Name set: ' + n); await render(); });
    srow(coll, 'Name', nameInput);
    srow(coll, 'Stream', ce('span', 'co-val co-mono', id.streamId.slice(0, 16) + '…'));
    srow(coll, 'Device', ce('span', 'co-val co-mono', id.device));

    // Storage durability
    const stor = sec('Storage');
    const persBadge = ce('span', 'hf-badge ' + (s.persisted ? 'ok' : 'warn'), s.persisted ? 'persistent' : 'best-effort');
    srow(stor, 'Persistence', persBadge);
    srow(stor, 'Used', ce('span', 'co-val co-mono', `${(s.bytesUsed / 1024).toFixed(0)} KB · ${s.recordCount} rec`));
    srow(stor, 'Off-device backup', ce('span', 'co-val', s.mirrored ? `↪ ${backupName || 'folder'}` : 'none'));

    const storActions = ce('div', 'co-srow co-srow-actions');
    if (installer.available()) {
      const ins = ce('button', 'co-btn', 'Install app');
      ins.addEventListener('click', async () => { await installer.prompt(); await render(); });
      storActions.append(ins);
    }
    if (!s.persisted) {
      const per = ce('button', 'co-btn' + (installer.available() ? ' co-ghost' : ''), 'Grant persistence');
      per.addEventListener('click', async () => { const ok = await store.persistRequest(); toast(ok ? 'Persistent storage granted ✓' : 'Browser declined — install the app to qualify'); await render(); });
      storActions.append(per);
    }
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
  await checkInboundCapsule();               // a shared link → offer to add its form
  return { go };
}
