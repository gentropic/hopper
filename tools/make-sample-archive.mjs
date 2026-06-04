// Generate a realistic, signed Hopper archive for trying out the mill.
// Uses the real store (so records carry valid Ed25519 signatures importBundle
// accepts) → writes examples/qf-sample-archive.json. Run: node tools/make-sample-archive.mjs
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore } from '../src/js/storage/store.js';
import { MemoryBackend } from '../vendor/vfs.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FORM = {
  type: 'form',
  meta: { id: 'qfsamp', title: 'QF Sample Log', version: '2026-06-01', lang: 'en', mode: 'append' },
  fields: [
    { name: 'site_id', fieldType: 'text', label: 'Site ID', props: { required: true } },
    { name: 'lithology', fieldType: 'select', label: 'Lithology', props: { list: 'litho' } },
    { name: 'sample_type', fieldType: 'select', label: 'Sample Type', props: { list: 'stype' } },
    { name: 'fe_pct', fieldType: 'number', label: 'Fe %' },
    { name: 'sio2_pct', fieldType: 'number', label: 'SiO₂ %' },
    { name: 'depth_m', fieldType: 'number', label: 'Depth (m)' },
    { name: 'sampled', fieldType: 'date', label: 'Sampled' },
  ],
  choices: {
    litho: ['itabirite', 'quartzite', 'schist', 'phyllite', 'hematitite'].map((v) => ({ value: v, label: v })),
    stype: ['grab', 'channel', 'chip'].map((v) => ({ value: v, label: v })),
  },
  rules: [], views: [],
};

// A varied, plausible QF dataset (iron grades higher in itabirite/hematitite).
const R = [
  ['QF-101', 'itabirite', 'channel', 58.2, 12.1, 8, '2026-05-28'],
  ['QF-102', 'itabirite', 'channel', 61.4, 9.8, 14, '2026-05-28'],
  ['QF-103', 'quartzite', 'grab', 22.5, 68.0, 5, '2026-05-29'],
  ['QF-104', 'hematitite', 'channel', 66.1, 3.2, 22, '2026-05-29'],
  ['QF-105', 'schist', 'grab', 18.9, 54.3, 3, '2026-05-30'],
  ['QF-106', 'itabirite', 'chip', 55.0, 15.7, 19, '2026-05-30'],
  ['QF-107', 'phyllite', 'grab', 12.4, 60.1, 4, '2026-05-31'],
  ['QF-108', 'hematitite', 'channel', 67.8, 2.1, 27, '2026-05-31'],
  ['QF-109', 'itabirite', 'channel', 59.6, 11.0, 16, '2026-06-01'],
  ['QF-110', 'quartzite', 'chip', 25.1, 64.5, 9, '2026-06-01'],
  ['QF-111', 'itabirite', 'grab', 52.3, 18.9, 6, '2026-06-02'],
  ['QF-112', 'hematitite', 'channel', 64.9, 4.0, 31, '2026-06-02'],
  ['QF-113', 'schist', 'chip', 16.2, 57.8, 11, '2026-06-03'],
  ['QF-114', 'itabirite', 'channel', 60.7, 10.4, 24, '2026-06-03'],
  ['QF-115', 'phyllite', 'grab', 14.8, 58.2, 7, '2026-06-04'],
  ['QF-116', 'itabirite', 'channel', 57.1, 13.3, 18, '2026-06-04'],
  ['QF-117', 'hematitite', 'chip', 65.5, 3.6, 29, '2026-06-04'],
  ['QF-118', 'quartzite', 'grab', 21.0, 70.2, 2, '2026-06-05'],
];

const store = createStore(new MemoryBackend());
await store.init({ name: 'QF Field Team' });
const fh = await store.putForm(FORM);
for (const [site_id, lithology, sample_type, fe_pct, sio2_pct, depth_m, sampled] of R) {
  await store.saveRecord({ form: fh, values: { site_id, lithology, sample_type, fe_pct, sio2_pct, depth_m, sampled } });
}
const bundle = await store.exportBundle();
const out = resolve(ROOT, 'examples/qf-sample-archive.json');
writeFileSync(out, JSON.stringify(bundle, null, 2));
console.log(`wrote ${out} — ${bundle.records.length} signed records, ${Object.keys(bundle.forms).length} form(s)`);
