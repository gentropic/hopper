// Boot — renders a demo form end-to-end (engine + DOM renderer) and registers
// the service worker. Forms will arrive from yaml / xlsform / capsule / registry;
// this embedded tree is a stand-in until those land.

import { createForm } from './renderer/state.js';
import { renderForm } from './renderer/render.js';

const DEMO = {
  type: 'form',
  meta: { id: 'qfdemo', title: 'QF Sample Log (demo)', mode: 'append' },
  fields: [
    { name: 'site_id', fieldType: 'text', label: 'Site ID', props: { required: true } },
    { name: 'coords', fieldType: 'geo', label: 'Coordinates', props: {} },
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

function mount() {
  const app = document.getElementById('app');
  if (!app) return;
  app.replaceChildren();
  const main = document.createElement('main'); main.className = 'hf-app';
  const h1 = document.createElement('h1'); h1.textContent = DEMO.meta.title; main.append(h1);
  const host = document.createElement('div'); main.append(host);
  app.append(main);
  renderForm(createForm(DEMO), host);
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
document.addEventListener('DOMContentLoaded', mount);
