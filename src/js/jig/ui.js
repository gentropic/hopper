// mountJig — the jig builder shell (SPEC-hopper-form §10). Deliberately plain
// (.co-* + a little .jig-* layout); structure first, Switchboard polish later.
// Browser-only DOM; all the real logic lives in the pure, node-tested engine
// (infer.js / edit.js / validate.js).
//
//   mountJig(root, { onEmit, initialTree })
//
// Host-agnostic by design: the standalone jig.html exports via download / capsule
// share; a host that passes `onEmit(tree)` (e.g. the collector mounting jig as a
// tab) gets the built tree routed wherever it wants. The UI holds ONE piece of
// state — the current draft §8 tree — and never a parallel model: every action is
// `draft = <pure edit>(draft, …); rerender()`. That is invariant §4.1 holding by
// construction.

import { inferTree } from './infer.js';
import { validateTree } from './validate.js';
import { applyOverrides, findField, moveField, removeField, setLabel, setProps, renameField, addField } from './edit.js';
import { createForm } from '../renderer/state.js';
import { renderForm } from '../renderer/render.js';
import { treeToXlsform } from '../xlsform/index.js';
// Vendored namespaces — MUST match the names main.jig.js binds (`sheetjs`,
// `capsule`): the flat build strips these import lines and resolves the bare names
// to the manifest's namespace-wrapped globals (same pattern as render.js + sideact).
import * as sheetjs from '../../../vendor/sheetjs.mjs';
import * as capsule from '../../../vendor/capsule.js';

const jel = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// The field types offered in the per-row dropdown (a useful subset of §4 — the
// full set stays valid, this is just the common authoring palette).
const JIG_PICK_TYPES = ['text', 'number', 'select', 'multiselect', 'date', 'datetime', 'time', 'geo', 'photo', 'file', 'note'];

// Parse pasted text into row objects: JSON (array or single object) or, failing
// that, CSV via the bundled SheetJS. Throws on unusable input — the caller toasts.
function jigParseTable(text) {
  const t = String(text).trim();
  if (!t) throw new Error('nothing to read');
  if (t[0] === '[' || t[0] === '{') {
    const j = JSON.parse(t);
    return Array.isArray(j) ? j : [j];
  }
  // raw:true keeps cells as their original strings — without it SheetJS coerces
  // an ISO date column to an (off-by-one, locale-formatted) Excel serial, which
  // would defeat the per-column date sniff. The type dropdown is the fallback.
  const wb = sheetjs.read(t, { type: 'string', raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return sheetjs.utils.sheet_to_json(ws, { defval: '' });
}

// Read a dropped/picked file into rows (.json/.csv as text, .xlsx as binary).
function jigReadFile(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    const xlsx = /\.xlsx?$/i.test(file.name);
    fr.onerror = () => rej(fr.error || new Error('read failed'));
    fr.onload = () => {
      try {
        if (xlsx) {
          const wb = sheetjs.read(fr.result, { type: 'array', raw: true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          res(sheetjs.utils.sheet_to_json(ws, { defval: '' }));
        } else res(jigParseTable(fr.result));
      } catch (e) { rej(e); }
    };
    if (xlsx) fr.readAsArrayBuffer(file); else fr.readAsText(file);
  });
}

function jigDownloadBytes(filename, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
  const a = jel('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Render a string as a QR (Nayuki qrcodegen, flat-inlined global). Throws past
// capacity — the caller falls back to the copy-link.
function jigQrSvg(text) {
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
  svg.append(bg, path); return svg;
}

export function mountJig(root, opts = {}) {
  const onEmit = opts.onEmit || null;
  let draft = opts.initialTree || null;        // the single source of truth
  let seams = [];
  let inferredChoices = {};                     // stash so a select↔text toggle is reversible
  let metaTitle = 'Form';

  root.replaceChildren();
  const wrap = jel('div', 'jig-wrap');

  // ── header + intake ──
  const head = jel('header', 'jig-head');
  head.append(jel('div', 'jig-brand', 'Hopper · jig'), jel('div', 'jig-sub', 'a form from an example table'));

  const intake = jel('div', 'jig-intake');
  const titleInput = jel('input', 'jig-title'); titleInput.placeholder = 'Form title'; titleInput.value = metaTitle;
  titleInput.addEventListener('input', () => { metaTitle = titleInput.value || 'Form'; if (draft) { draft.meta = { ...draft.meta, title: metaTitle, id: slug(metaTitle) }; } });
  const ta = jel('textarea', 'jig-paste'); ta.placeholder = 'Paste a CSV or JSON rows here…';
  const fileBtn = jel('input'); fileBtn.type = 'file'; fileBtn.accept = '.csv,.tsv,.json,.xlsx,.xls'; fileBtn.className = 'jig-file';
  const inferBtn = jel('button', 'co-btn', 'Infer form');
  const intakeActions = jel('div', 'jig-intake-actions'); intakeActions.append(fileBtn, inferBtn);
  intake.append(titleInput, ta, intakeActions);

  inferBtn.addEventListener('click', () => { try { importRows(jigParseTable(ta.value)); } catch (e) { jigToast('Could not read: ' + e.message); } });
  fileBtn.addEventListener('change', async () => {
    const f = fileBtn.files && fileBtn.files[0]; if (!f) return;
    try { importRows(await jigReadFile(f)); } catch (e) { jigToast('Could not read file: ' + e.message); }
    fileBtn.value = '';
  });

  // ── body: schema (left) · live preview (right) ──
  const body = jel('div', 'jig-body');
  const left = jel('div', 'jig-pane jig-left');
  const right = jel('div', 'jig-pane jig-right');
  const seamBox = jel('div', 'jig-seams');
  const fieldBox = jel('div', 'jig-fields');
  const addBtn = jel('button', 'co-btn co-ghost jig-addfield', '+ Add field');
  addBtn.addEventListener('click', () => {
    if (!draft) return;
    let i = 1; const names = new Set(); (function w(a){ for (const f of a) { names.add(f.name); if (f.children) w(f.children); } })(draft.fields);
    while (names.has('field_' + i)) i++;
    draft = addField(draft, { name: 'field_' + i, fieldType: 'text', label: 'Field ' + i });
    rerender();
  });
  left.append(seamBox, fieldBox, addBtn);
  right.append(jel('div', 'jig-preview-empty', 'Live preview appears here once you infer a form.'));
  body.append(left, right);

  // ── footer: validation + export ──
  const bar = jel('footer', 'jig-bar');
  wrap.append(head, intake, body, bar);
  root.append(wrap);

  // ---- state helpers ----
  function slug(s) { return String(s).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'form'; }

  function importRows(rows) {
    const res = inferTree(rows, { title: metaTitle });
    inferredChoices = res.tree.choices || {};
    const overrides = {};
    const req = res.seams.find((s) => s.type === 'required'); if (req) overrides.required = req.recommend;
    const idc = res.seams.find((s) => s.type === 'identity'); if (idc) overrides.identity = idc.recommend;
    draft = applyOverrides(res.tree, overrides);
    seams = res.seams;
    rerender();
  }

  // Change a field's type, keeping select-family reversible (restore the stashed
  // inferred choices when toggling back to a select).
  function setFieldType(name, type) {
    if (['select', 'multiselect', 'rank'].includes(type)) {
      const t = structuredClone(draft);
      const loc = findField(t, name); if (!loc) return;
      loc.field.fieldType = type;
      loc.field.props = loc.field.props || {}; loc.field.props.list = name;
      if (!t.choices[name] && inferredChoices[name]) t.choices[name] = structuredClone(inferredChoices[name]);
      draft = t;
    } else {
      draft = applyOverrides(draft, { setType: { [name]: type } });
    }
    rerender();
  }

  // ---- renderers ----
  function rerender() { renderSeams(); renderFields(); renderPreview(); renderBar(); }

  function renderSeams() {
    seamBox.replaceChildren();
    if (!draft) return;
    const live = seams.filter((s) => seamRelevant(s));
    if (!live.length) return;
    seamBox.append(jel('div', 'jig-seams-h', 'A few questions'));
    for (const s of live) seamBox.append(renderSeam(s));
  }

  function seamRelevant(s) {
    if (s.type === 'identity' || s.type === 'required') return false;          // identity handled below; required = row checkboxes
    if (s.type === 'geo-merge') return findField(draft, s.field[0]) && findField(draft, s.field[1]);
    return !!(s.field && findField(draft, s.field));
  }

  function renderSeam(s) {
    const row = jel('div', 'jig-seam');
    row.append(jel('div', 'jig-seam-q', s.question));
    if (s.type === 'select-or-text' || s.type === 'number-or-text') {
      const cur = findField(draft, s.field).field.fieldType;
      const grp = jel('div', 'jig-toggle');
      for (const o of s.options) {
        const b = jel('button', 'co-btn co-ghost' + (cur === o ? ' jig-on' : ''), o);
        b.addEventListener('click', () => setFieldType(s.field, o));
        grp.append(b);
      }
      row.append(grp);
    } else if (s.type === 'geo-merge') {
      const b = jel('button', 'co-btn', 'Merge into a geo point');
      b.addEventListener('click', () => { draft = applyOverrides(draft, { geoMerge: { lat: s.field[0], lng: s.field[1], into: 'location', label: 'Location' } }); rerender(); });
      row.append(b);
    }
    return row;
  }

  function renderFields() {
    fieldBox.replaceChildren();
    if (!draft) return;
    // identity picker (a table-level seam) sits atop the field list
    const idSeam = seams.find((s) => s.type === 'identity');
    if (idSeam) {
      const idRow = jel('div', 'jig-idrow');
      idRow.append(jel('span', 'jig-idlabel', 'Record label'));
      const sel = jel('select', 'jig-idsel');
      for (const f of flatNames(draft)) sel.append(new Option(f, f, false, draft.meta && draft.meta.identity === f));
      sel.value = (draft.meta && draft.meta.identity) || idSeam.recommend;
      sel.addEventListener('change', () => { draft.meta = { ...draft.meta, identity: sel.value }; });
      idRow.append(sel);
      fieldBox.append(idRow);
    }
    draft.fields.forEach((f, i) => fieldBox.append(renderFieldRow(f, i)));
  }

  function renderFieldRow(f, idx) {
    const row = jel('div', 'jig-field');

    const ord = jel('div', 'jig-ord');
    const up = jel('button', 'co-btn co-ghost jig-mini', '↑'); up.disabled = idx === 0;
    const dn = jel('button', 'co-btn co-ghost jig-mini', '↓'); dn.disabled = idx === draft.fields.length - 1;
    up.addEventListener('click', () => { draft = moveField(draft, f.name, idx - 1); rerender(); });
    dn.addEventListener('click', () => { draft = moveField(draft, f.name, idx + 1); rerender(); });
    ord.append(up, dn);

    const nameI = jel('input', 'jig-name'); nameI.value = f.name; nameI.title = 'field name';
    nameI.addEventListener('change', () => {
      try { draft = renameField(draft, f.name, nameI.value.trim()); rerender(); }
      catch (e) { jigToast(e.message); nameI.value = f.name; }
    });

    const labelI = jel('input', 'jig-label'); labelI.value = f.label || ''; labelI.title = 'label';
    labelI.addEventListener('change', () => { draft = setLabel(draft, f.name, labelI.value); });

    const typeS = jel('select', 'jig-type');
    const types = JIG_PICK_TYPES.includes(f.fieldType) ? JIG_PICK_TYPES : [f.fieldType, ...JIG_PICK_TYPES];
    for (const t of types) typeS.append(new Option(t, t, false, t === f.fieldType));
    typeS.value = f.fieldType;
    typeS.addEventListener('change', () => setFieldType(f.name, typeS.value));

    const reqWrap = jel('label', 'jig-req');
    const reqC = jel('input'); reqC.type = 'checkbox'; reqC.checked = !!(f.props && f.props.required);
    reqC.addEventListener('change', () => { draft = setProps(draft, f.name, { required: reqC.checked ? true : null }); });
    reqWrap.append(reqC, jel('span', null, 'req'));

    const del = jel('button', 'co-btn co-ghost jig-mini jig-del', '✕');
    del.addEventListener('click', () => { draft = removeField(draft, f.name); rerender(); });

    row.append(ord, nameI, labelI, typeS, reqWrap, del);
    if (f.fieldType === 'select' || f.fieldType === 'multiselect') {
      const list = (draft.choices && draft.choices[f.props && f.props.list]) || [];
      row.append(jel('div', 'jig-choices', list.length ? 'choices: ' + list.map((o) => o.label).join(', ') : 'no choices'));
    }
    return row;
  }

  function renderPreview() {
    right.replaceChildren();
    if (!draft) { right.append(jel('div', 'jig-preview-empty', 'Live preview appears here once you infer a form.')); return; }
    const host = jel('div', 'jig-preview-host');
    right.append(jel('div', 'jig-pane-h', 'Preview'), host);
    try { renderForm(createForm(draft), host); }
    catch (e) { host.append(jel('div', 'jig-preview-empty', 'Preview unavailable: ' + e.message)); }
  }

  function renderBar() {
    bar.replaceChildren();
    if (!draft) return;
    const v = validateTree(draft);
    const status = jel('div', 'jig-valid ' + (v.ok ? 'jig-ok' : 'jig-bad'));
    status.textContent = v.ok ? '✓ valid form' : `${v.errors.length} issue${v.errors.length === 1 ? '' : 's'}: ${v.errors[0]}`;
    if (v.warnings.length) status.title = v.warnings.join('\n');
    bar.append(status);

    const actions = jel('div', 'jig-bar-actions');
    const jsonB = jel('button', 'co-btn', 'JSON');
    jsonB.addEventListener('click', () => jigDownloadBytes((draft.meta.id || 'form') + '.json', JSON.stringify(draft, null, 2), 'application/json'));
    const xlsB = jel('button', 'co-btn', 'XLSForm');
    xlsB.addEventListener('click', () => { try { exportXlsx(draft); } catch (e) { jigToast('XLSForm export failed: ' + e.message); } });
    const shareB = jel('button', 'co-btn', '⤴ Share');
    shareB.addEventListener('click', () => jigShare(draft).catch((e) => jigToast('Could not build share: ' + e.message)));
    actions.append(jsonB, xlsB, shareB);
    if (onEmit) { const useB = jel('button', 'co-btn', 'Use this form →'); useB.addEventListener('click', () => onEmit(structuredClone(draft))); actions.append(useB); }
    bar.append(actions);
  }

  // ---- exports ----
  function exportXlsx(tree) {
    const { survey, choices, settings } = treeToXlsform(tree);
    const X = sheetjs;
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(survey), 'survey');
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(choices.length ? choices : [{ list_name: '', name: '', label: '' }]), 'choices');
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(settings), 'settings');
    const out = X.write(wb, { type: 'array', bookType: 'xlsx' });
    jigDownloadBytes((tree.meta.id || 'form') + '.xlsx', out, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  async function jigShare(tree) {
    const base = location.origin + location.pathname;
    const share = await capsule.makeShare(JSON.stringify(tree), { form: 'q', baseUrl: base });
    const url = base + '#' + share.fragment;
    const scrim = jel('div', 'co-scrim');
    const panel = jel('div', 'co-confirm co-share');
    panel.append(jel('h3', 'co-confirm-h', 'Share this form'));
    panel.append(jel('div', 'co-confirm-title', (tree.meta && (tree.meta.title || tree.meta.id)) || 'Untitled form'));
    try { const w = jel('div', 'co-qr-wrap'); w.append(jigQrSvg(url)); panel.append(w); }
    catch { panel.append(jel('div', 'co-share-toobig', '⚠ Too large to scan as a QR — use the link below.')); }
    const linkRow = jel('div', 'co-share-link');
    const input = jel('input', 'co-share-url'); input.readOnly = true; input.value = url;
    const copy = jel('button', 'co-btn', 'Copy link');
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(url); copy.textContent = 'Copied ✓'; } catch { input.select(); } });
    linkRow.append(input, copy); panel.append(linkRow);
    panel.append(jel('div', 'co-confirm-meta', `${share.urlBytes} B · ${share.tightestFit ? 'fits ' + share.tightestFit : 'link only'}`));
    const close = jel('button', 'co-btn co-ghost', 'Close'); close.addEventListener('click', () => scrim.remove());
    panel.append(close); scrim.append(panel);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) scrim.remove(); });
    document.body.append(scrim);
  }

  function jigToast(msg) {
    const t = jel('div', 'co-toast', msg);
    document.body.append(t); setTimeout(() => t.remove(), 3800);
  }

  function flatNames(tree) { const out = []; (function w(a){ for (const f of a) { out.push(f.name); if (f.children) w(f.children); } })(tree.fields || []); return out; }

  if (draft) rerender();
  return { getTree: () => draft && structuredClone(draft), import: importRows };
}
