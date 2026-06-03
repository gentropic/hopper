// DOM layer for the renderer — binds widgets to the reactive engine (state.js)
// via sideact `effect`s. Browser-only (the testable logic lives in state.js).
// Walks the hierarchical tree: leaf widgets, collapsible groups, repeat
// add/remove. Relevance hides; validity shows errors; calc/aggregates display.

import * as sideact from '../../../vendor/sideact.js';
import { startBarcodeScan } from './scan.js';
const { effect } = sideact;

const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const opt = (value, label) => { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; };
const fmt = (v) => (v == null ? '' : String(v));

export function renderForm(form, mount, onSave, saveBlob) {
  mount.replaceChildren();
  const formEl = el('form', 'hf-form');
  formEl.addEventListener('submit', (e) => e.preventDefault());
  for (const node of form.tree.fields || []) formEl.append(renderNode(form, node, null, saveBlob));

  const flagsBar = el('div', 'hf-flags');
  effect(() => {
    const on = form.flags().filter((f) => f.on);
    flagsBar.replaceChildren(...on.map((f) => { const c = el('span', 'hf-flag'); c.textContent = f.label; return c; }));
  });

  const save = el('button', 'hf-save'); save.type = 'button'; save.textContent = 'Save record';
  const out = el('pre', 'hf-out');
  save.addEventListener('click', async () => {
    if (!onSave) { out.textContent = JSON.stringify({ values: form.values(), attachments: form.attachments() }, null, 2); return; }
    save.disabled = true; out.textContent = 'saving…';
    try { const rec = await onSave(form.values(), form.attachments()); out.textContent = `saved ✓ ${rec.id}`; }
    catch (e) { out.textContent = 'save failed: ' + e.message; }
    finally { save.disabled = false; }
  });

  mount.append(flagsBar, formEl, save, out);
  return { values: () => form.values() };
}

function renderNode(form, node, inst, saveBlob) {
  if (node.fieldType === 'group') return renderGroup(form, node, inst, saveBlob);
  if (node.fieldType === 'repeat') return renderRepeat(form, node, saveBlob);
  return renderField(form, node, inst, saveBlob);
}

function renderGroup(form, node, inst, saveBlob) {
  const d = el('details', 'hf-group'); d.open = true;
  const sum = document.createElement('summary'); sum.textContent = node.label || node.name; d.append(sum);
  for (const c of node.children || []) d.append(renderNode(form, c, inst, saveBlob));
  effect(() => { d.hidden = !form.isRelevant(node.name, inst); });
  return d;
}

function renderRepeat(form, node, saveBlob) {
  const wrap = el('div', 'hf-repeat');
  const head = el('div', 'hf-repeat-head'); head.textContent = node.label || node.name; wrap.append(head);
  const list = el('div', 'hf-repeat-list'); wrap.append(list);
  const add = el('button', 'hf-add'); add.type = 'button'; add.textContent = '+ add';
  add.addEventListener('click', () => form.repeat(node.name).add());
  wrap.append(add);
  // re-render instances only when the array changes (add/remove), not on edits
  effect(() => {
    const items = form.repeat(node.name).items();
    list.replaceChildren(...items.map((inst, i) => {
      const card = el('div', 'hf-instance');
      const rm = el('button', 'hf-remove'); rm.type = 'button'; rm.textContent = '×';
      rm.addEventListener('click', () => form.repeat(node.name).remove(i));
      card.append(rm);
      for (const c of node.children || []) card.append(renderNode(form, c, inst, saveBlob));
      return card;
    }));
  });
  return wrap;
}

function renderField(form, node, inst, saveBlob) {
  const ft = node.fieldType;
  if (ft === 'note') { const p = el('p', 'hf-note'); p.textContent = node.label || ''; return p; }

  const wrap = el('label', 'hf-field');
  const lab = el('span', 'hf-label');
  lab.textContent = (node.label || node.name) + (node.props && node.props.required ? ' *' : '');
  wrap.append(lab);

  const getV = () => (inst ? inst.children.get(node.name).get() : form.get(node.name));
  const setV = (v) => (inst ? inst.children.get(node.name).set(v) : form.set(node.name, v));
  const choicesFor = () => (node.props && form.tree.choices && form.tree.choices[node.props.list]) || [];

  if (ft === 'calc') {
    const o = el('output', 'hf-calc');
    effect(() => { o.textContent = fmt(form.calcValue(node.name, inst)); });
    wrap.append(o);
    return wrap;
  }

  let input;
  if (ft === 'select') {
    input = document.createElement('select');
    input.append(opt('', '—'));
    for (const c of choicesFor()) input.append(opt(c.value, c.label));
    input.value = getV() ?? '';
    input.addEventListener('change', () => setV(input.value || null));
  } else if (ft === 'multiselect') {
    const box = el('div', 'hf-multi');
    const cur = () => getV() || [];
    for (const c of choicesFor()) {
      const l = el('label', 'hf-check'); const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = c.value; cb.checked = cur().includes(c.value);
      cb.addEventListener('change', () => { const s = new Set(cur()); cb.checked ? s.add(c.value) : s.delete(c.value); setV([...s]); });
      l.append(cb, document.createTextNode(' ' + c.label)); box.append(l);
    }
    input = box;
  } else if (ft === 'number' || ft === 'range') {
    input = document.createElement('input'); input.type = ft === 'range' ? 'range' : 'number';
    const p = node.props || {}; if (p.min != null) input.min = p.min; if (p.max != null) input.max = p.max; if (p.step != null) input.step = p.step;
    input.value = getV() ?? '';
    input.addEventListener('input', () => setV(input.value === '' ? null : Number(input.value)));
  } else if (ft === 'date' || ft === 'time' || ft === 'datetime') {
    input = document.createElement('input'); input.type = ft === 'datetime' ? 'datetime-local' : ft;
    input.value = getV() ?? '';
    input.addEventListener('input', () => setV(input.value || null));
  } else if (ft === 'geo') {                 // single GPS point → { lat, lng, acc }
    const box = el('div', 'hf-geo');
    const btn = el('button', 'hf-capture'); btn.type = 'button'; btn.textContent = '📍 Capture GPS';
    const val = el('span', 'hf-geo-val');
    effect(() => { const v = getV(); val.textContent = v ? `${v.lat.toFixed(5)}, ${v.lng.toFixed(5)} (±${Math.round(v.acc)} m)` : ''; });
    btn.addEventListener('click', () => {
      if (!navigator.geolocation) { val.textContent = 'no geolocation'; return; }
      btn.disabled = true; const prev = btn.textContent; btn.textContent = 'locating…';
      navigator.geolocation.getCurrentPosition(
        (p) => { setV({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); btn.disabled = false; btn.textContent = prev; },
        (e) => { val.textContent = 'failed: ' + e.message; btn.disabled = false; btn.textContent = prev; },
        { enableHighAccuracy: true, timeout: 10000 });
    });
    box.append(btn, val);
    input = box;
  } else if (ft === 'photo' || ft === 'audio' || ft === 'video' || ft === 'file') {
    input = mediaWidget(ft, getV, setV, saveBlob);
  } else if (ft === 'barcode') {
    input = barcodeWidget(getV, setV);
  } else if (ft === 'geotrace' || ft === 'geoshape') {
    input = geoPathWidget(getV, setV);       // value: ordered [{lat,lng,acc}] (geoshape = closed)
  } else {                                   // text, hidden, rank, and unknown → text input
    input = document.createElement('input'); input.type = 'text';
    input.value = getV() ?? '';
    input.addEventListener('input', () => setV(input.value || null));
  }
  wrap.append(input);

  const err = el('span', 'hf-error'); wrap.append(err);
  effect(() => { wrap.hidden = !form.isRelevant(node.name, inst); });
  effect(() => { const { valid, message } = form.validity(node.name, inst); err.textContent = valid ? '' : message; wrap.classList.toggle('hf-invalid', !valid); });
  return wrap;
}

// Geo path capture (geotrace = open polyline, geoshape = closed polygon). The value
// is an **ordered array** of `{lat,lng,acc}` points — same point shape as `geo`,
// lives in `values` (not an attachment). v1 is the data-clean back end: capture the
// current GPS point, append, list, remove, reorder-by-remove. The map/sketch surface
// is deliberately later UI work; the value contract is what matters now.
function geoPathWidget(getV, setV) {
  const box = el('div', 'hf-geopath');
  const list = el('div', 'hf-geopath-list');
  const msg = el('span', 'hf-geo-val');
  const points = () => getV() || [];
  effect(() => {                              // re-render the list whenever the value changes
    list.replaceChildren(...points().map((p, i) => {
      const row = el('div', 'hf-geopt');
      row.append(el('span', 'hf-geopt-i', String(i + 1)));
      row.append(el('span', 'hf-geopt-val', `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}${p.acc != null ? ` ±${Math.round(p.acc)} m` : ''}`));
      const rm = el('button', 'hf-geopt-rm'); rm.type = 'button'; rm.textContent = '×';
      rm.addEventListener('click', () => { const a = points().slice(); a.splice(i, 1); setV(a.length ? a : null); });
      row.append(rm); return row;
    }));
  });
  const add = el('button', 'hf-capture'); add.type = 'button'; add.textContent = '📍 Add point';
  add.addEventListener('click', () => {
    if (!navigator.geolocation) { msg.textContent = 'no geolocation'; return; }
    add.disabled = true; const prev = add.textContent; add.textContent = 'locating…';
    navigator.geolocation.getCurrentPosition(
      (pos) => { setV([...points(), { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }]); add.disabled = false; add.textContent = prev; msg.textContent = ''; },
      (e) => { msg.textContent = 'failed: ' + e.message; add.disabled = false; add.textContent = prev; },
      { enableHighAccuracy: true, timeout: 10000 });
  });
  box.append(list, add, msg);
  return box;
}

// Media capture (photo/audio/video/file) → a content-addressed attachment blob.
// The file/camera input gives bytes; saveBlob stores them out of band and returns
// a hash; the field value holds the ref {blob, mime, bytes} the engine collects
// into the record's `attachments` (SPEC-hopper-records §8). `capture` hints the
// device camera/mic but degrades to a file picker where unsupported.
function mediaWidget(ft, getV, setV, saveBlob) {
  const box = el('div', 'hf-media');
  const fileEl = document.createElement('input'); fileEl.type = 'file';
  if (ft === 'photo') { fileEl.accept = 'image/*'; fileEl.setAttribute('capture', 'environment'); }
  else if (ft === 'audio') fileEl.accept = 'audio/*';
  else if (ft === 'video') { fileEl.accept = 'video/*'; fileEl.setAttribute('capture', 'environment'); }
  const status = el('span', 'hf-media-val');
  effect(() => {
    const v = getV();
    status.textContent = v && v.blob ? `✓ ${v.mime || 'file'} · ${(v.bytes / 1024).toFixed(0)} KB · ${v.blob.slice(0, 16)}…` : '';
  });
  fileEl.addEventListener('change', async () => {
    const f = fileEl.files && fileEl.files[0];
    if (!f) return;
    if (!saveBlob) { status.textContent = 'no blob store'; return; }
    status.textContent = 'storing…';
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const blob = await saveBlob(bytes);
      setV({ blob, mime: f.type || 'application/octet-stream', bytes: bytes.byteLength });
    } catch (e) { status.textContent = 'store failed: ' + e.message; }
  });
  box.append(fileEl, status);
  return box;
}

// Barcode/QR — the value is the decoded string (not a blob), so it lives in
// `values`. Manual text entry always works; an in-page BarcodeDetector scan
// (live camera) is offered where the browser supports it, degrading silently.
function barcodeWidget(getV, setV) {
  const box = el('div', 'hf-barcode');
  const text = document.createElement('input'); text.type = 'text'; text.placeholder = 'barcode / QR';
  text.value = getV() ?? '';
  text.addEventListener('input', () => setV(text.value || null));
  box.append(text);
  const hasScanner = typeof window !== 'undefined' && 'BarcodeDetector' in window
    && navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
  if (hasScanner) {
    const scan = el('button', 'hf-capture'); scan.type = 'button'; scan.textContent = '📷 Scan';
    let session = null;
    scan.addEventListener('click', async () => {
      if (session) { session.stop(); return; }
      session = await startBarcodeScan(box, scan, (code) => { text.value = code; setV(code); }, () => { session = null; });
    });
    box.append(scan);
  }
  return box;
}
