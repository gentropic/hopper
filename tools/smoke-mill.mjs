// Browser smoke for the mill surface — generates a real repo bundle (a form + a
// few signed records via the actual store), opens mill.html, loads the archive,
// and drives the query builder: group-by + aggregate → loom grid + plot chart, with
// the result row-count verified. Run: node build.js --target=mill && node tools/smoke-mill.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';
import { createStore } from '../src/js/storage/store.js';
import { MemoryBackend } from '../vendor/vfs.js';

const FORM = {
  type: 'form', meta: { id: 'qf', title: 'QF Sample Log' },
  fields: [
    { name: 'site_id', fieldType: 'text', label: 'Site' },
    { name: 'lithology', fieldType: 'select', label: 'Lithology', props: { list: 'litho' } },
    { name: 'fe_pct', fieldType: 'number', label: 'Fe %' },
  ], choices: {}, rules: [], views: [],
};
const ROWS = [
  { site_id: 'QF-1', lithology: 'itabirite', fe_pct: 58 },
  { site_id: 'QF-2', lithology: 'quartzite', fe_pct: 41 },
  { site_id: 'QF-3', lithology: 'itabirite', fe_pct: 60 },
  { site_id: 'QF-4', lithology: 'itabirite', fe_pct: 55 },
];

// Build a real archive bundle the way the collector's "Export archive" does.
const src = createStore(new MemoryBackend());
await src.init({ name: 'gen' });
const fh = await src.putForm(FORM);
for (const values of ROWS) await src.saveRecord({ form: fh, values });
const bundle = await src.exportBundle();
assert.equal(bundle.records.length, 4, 'bundle carries 4 records');

const srv = await startServer({ root: process.cwd(), port: 0 });
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

const gridCanvas = () => page.waitForFunction(() => { const c = document.querySelector('.mill-grid canvas'); return c && c.width > 0 && c.height > 0; }, undefined, { timeout: 5000 });

try {
  await page.goto(srv.url + 'mill.html');
  // landing → open the archive
  await page.locator('.mill-open input[type="file"]').setInputFiles({ name: 'qf-archive.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });

  // the console mounts; the form auto-selects and the grid renders the raw rows
  await page.waitForSelector('.mill-formsel', { timeout: 5000 });
  const rowsIs = (n) => page.waitForFunction((txt) => document.body.textContent.includes(txt), `Results · ${n} row${n === 1 ? '' : 's'}`, { timeout: 3000 });

  await gridCanvas();
  await rowsIs(4);                                                  // initial projection: all 4 records

  // total-calculus filter narrows the projection, then clears back
  await page.locator('.mill-filter').fill('fe_pct >= 50');
  await page.locator('.mill-filter').blur();
  await rowsIs(3);                                                  // QF-1, QF-3, QF-4
  await page.locator('.mill-filter').fill('');
  await page.locator('.mill-filter').blur();
  await rowsIs(4);

  // group by lithology → 2 groups (default count); add a mean(Fe %) aggregate → bar chart
  await page.locator('.mill-groupby').selectOption('lithology');
  await rowsIs(2);
  await page.getByRole('button', { name: '+ aggregate' }).click();
  await page.locator('.mill-aggop').last().selectOption('mean');
  await page.locator('.mill-aggfield').last().selectOption('fe_pct');
  await rowsIs(2);
  await gridCanvas();
  await page.waitForFunction(() => { const c = document.querySelector('.mill-chart canvas'); return c && c.width > 0 && c.height > 0; }, undefined, { timeout: 5000 });

  assert.deepEqual(errs, [], 'no page errors');
  console.log('✓ mill smoke — open archive → resolved union → query builder (filter/group/aggregate) → loom grid + plot chart');
  await browser.close(); await srv.close();
} catch (e) {
  console.error('✗ mill smoke FAILED:', e.message);
  if (errs.length) console.error('  page errors:', errs.join('; '));
  try {
    const d = await page.evaluate(() => ({
      landingErr: document.querySelector('.mill-err')?.textContent,
      hasFormsel: !!document.querySelector('.mill-formsel'),
      formOptions: [...document.querySelectorAll('.mill-formsel option')].map((o) => o.textContent),
      paneHs: [...document.querySelectorAll('.mill-pane-h')].map((h) => h.textContent),
      gridCanvases: document.querySelectorAll('.mill-grid canvas').length,
      resultsText: document.querySelector('.mill-results')?.textContent?.slice(0, 120),
    }));
    console.error('  diag:', JSON.stringify(d, null, 1));
  } catch {}
  await browser.close(); await srv.close();
  process.exit(1);
}
