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

  // filter aid — a field chip inserts the stable name (chip shows the label)
  await page.locator('.mill-fieldchip', { hasText: 'Fe %' }).click();
  assert.ok((await page.locator('.mill-filter').inputValue()).includes('fe_pct'), 'chip inserted the field name');

  // total-calculus filter (typed name) narrows the projection
  await page.locator('.mill-filter').fill('fe_pct >= 50');
  await page.locator('.mill-filter').blur();
  await rowsIs(3);                                                  // QF-1, QF-3, QF-4

  // reference a field by LABEL via backticks → resolves to the stable name on commit
  await page.locator('.mill-filter').fill('`Fe %` >= 50');
  await page.locator('.mill-filter').blur();
  await rowsIs(3);
  const fv = await page.locator('.mill-filter').inputValue();
  assert.ok(fv.includes('fe_pct') && !fv.includes('`'), 'backtick label resolved to the name (stored expr is name-only)');

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

  // share this analysis (group lithology + mean Fe %) → capsule QR + link
  await page.getByRole('button', { name: 'Share analysis' }).click();
  await page.locator('.co-share .co-qr').waitFor({ timeout: 3000 });
  const shareUrl = await page.locator('.co-share-url').inputValue();
  assert.ok(/#/.test(shareUrl) && shareUrl.length > 20, 'share URL carries a #capsule');
  await page.locator('.co-share').getByRole('button', { name: 'Close' }).click();

  // open the analysis LINK fresh → pending → open the same archive → it auto-applies
  await page.goto(shareUrl);
  await page.reload();                                             // hash-only nav → force a fresh boot that reads it
  await page.waitForSelector('.mill-pending', { timeout: 3000 }); // landing notes the pending analysis
  await page.locator('.mill-open input[type="file"]').setInputFiles({ name: 'qf2.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bundle)) });
  await page.waitForSelector('.mill-formsel', { timeout: 5000 });
  await rowsIs(2);                                                 // the shared group/aggregate ran on open
  assert.equal(await page.locator('.mill-groupby').inputValue(), 'lithology', 'shared analysis restored the group-by');

  // surface contract (DECISIONS §14): the mill build wires the bootSurface host
  // adapter + the mount(ctx) export.
  const millShapes = await page.evaluate(() => ['bootSurface', 'mountMill'].map((n) => typeof window[n]));
  assert.deepEqual(millShapes, ['function', 'function'], 'mill exposes bootSurface + mountMill(ctx)');

  assert.deepEqual(errs, [], 'no page errors');
  console.log('✓ mill smoke — open archive → query builder (filter/group/aggregate) → grid + chart → share analysis → reopen via link applies it + surface contract');
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
