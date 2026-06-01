// DOM layer for the renderer — binds widgets to the reactive engine (state.js)
// via sideact `effect`s. Browser-only (the testable logic lives in state.js).
// Walks the hierarchical tree: leaf widgets, collapsible groups, repeat
// add/remove. Relevance hides; validity shows errors; calc/aggregates display.

import * as sideact from '../../../vendor/sideact.js';
const { effect } = sideact;

const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const opt = (value, label) => { const o = document.createElement('option'); o.value = value; o.textContent = label; return o; };
const fmt = (v) => (v == null ? '' : String(v));

export function renderForm(form, mount) {
  mount.replaceChildren();
  const formEl = el('form', 'hf-form');
  formEl.addEventListener('submit', (e) => e.preventDefault());
  for (const node of form.tree.fields || []) formEl.append(renderNode(form, node, null));

  const flagsBar = el('div', 'hf-flags');
  effect(() => {
    const on = form.flags().filter((f) => f.on);
    flagsBar.replaceChildren(...on.map((f) => { const c = el('span', 'hf-flag'); c.textContent = f.label; return c; }));
  });

  const save = el('button', 'hf-save'); save.type = 'button'; save.textContent = 'Save record';
  const out = el('pre', 'hf-out');
  save.addEventListener('click', () => { out.textContent = JSON.stringify(form.values(), null, 2); });

  mount.append(flagsBar, formEl, save, out);
  return { values: () => form.values() };
}

function renderNode(form, node, inst) {
  if (node.fieldType === 'group') return renderGroup(form, node, inst);
  if (node.fieldType === 'repeat') return renderRepeat(form, node);
  return renderField(form, node, inst);
}

function renderGroup(form, node, inst) {
  const d = el('details', 'hf-group'); d.open = true;
  const sum = document.createElement('summary'); sum.textContent = node.label || node.name; d.append(sum);
  for (const c of node.children || []) d.append(renderNode(form, c, inst));
  effect(() => { d.hidden = !form.isRelevant(node.name, inst); });
  return d;
}

function renderRepeat(form, node) {
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
      for (const c of node.children || []) card.append(renderNode(form, c, inst));
      return card;
    }));
  });
  return wrap;
}

function renderField(form, node, inst) {
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
  } else if (['geo', 'geotrace', 'geoshape', 'photo', 'audio', 'video', 'file', 'barcode'].includes(ft)) {
    input = el('div', 'hf-stub'); input.textContent = `[${ft} capture — not yet implemented]`;
    wrap.append(input);
    effect(() => { wrap.hidden = !form.isRelevant(node.name, inst); });
    return wrap;
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
