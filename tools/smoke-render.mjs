// Browser smoke test for the renderer — drives the built collector.html in a
// real Chromium (Playwright, dev-only). The headless engine is unit-tested in
// node; this confirms the DOM layer + reactivity actually work in a browser.
// Served over http://localhost (a secure context) so capture widgets that need
// one — geolocation, camera/mic — can run; file:// would block them.
// Run: node build.js && node tools/smoke-render.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';
import { treeToXlsform } from '../src/js/xlsform/index.js';
import * as XLSX from '../vendor/sheetjs.mjs';

// a 1×1 PNG — exercises real binary-blob capture (saveBlob → IDB → attachment)
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const srv = await startServer({ root: process.cwd(), port: 0 });
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

const shutdown = async () => { await browser.close(); await srv.close(); };

try {
  await page.goto(srv.url);
  await page.waitForSelector('.hf-form', { timeout: 5000 });

  // form rendered
  assert.equal(await page.locator('.hf-form').count(), 1, 'form renders');
  assert.ok((await page.getByText('Site ID').count()) >= 1, 'site_id field present');
  assert.ok((await page.locator('.hf-capture').count()) >= 1, 'geo capture control renders');
  // (not clicked — geolocation needs a secure context, i.e. served, not file://)

  // relevance: "Why resample?" hidden until resample = yes
  const why = page.locator('.hf-field').filter({ hasText: 'Why resample?' });
  assert.equal(await why.isVisible(), false, 'why hidden before resample=yes');
  await page.locator('select').first().selectOption('yes');
  await why.waitFor({ state: 'visible', timeout: 2000 });

  // repeat: add an instance → count() calc updates to 1
  await page.getByRole('button', { name: '+ add' }).click();
  await page.waitForFunction(() => document.querySelector('.hf-calc')?.textContent === '1', undefined, { timeout: 2000 });

  // constraint inside a repeat: an out-of-range Fe % shows its validation message
  // (proves the per-instance validity effect fires; the instance has >1 error span)
  await page.locator('.hf-instance input[type="number"]').first().fill('140');
  await page.waitForFunction(
    () => [...document.querySelectorAll('.hf-instance .hf-error')].some((e) => e.textContent.includes('100')),
    undefined, { timeout: 2000 });

  // media capture: a file/camera input → bytes → store.saveBlob (real IDB binary
  // write, content-addressed) → the field's attachment ref; the widget shows the
  // stored blob's hash + size, proving the whole capture→blob path ran in-browser
  await page.locator('.hf-media input[type="file"]').setInputFiles({ name: 'outcrop.png', mimeType: 'image/png', buffer: PNG_1PX });
  await page.waitForFunction(() => /✓.*sha256-/.test(document.querySelector('.hf-media-val')?.textContent || ''), undefined, { timeout: 3000 });

  // save → signs an immutable record (Ed25519: native or bundled noble fallback)
  // → persists to IndexedDB → the single-copy durability warning appears.
  // The saved record binds the captured photo by hash in its `attachments` (§8).
  page.on('download', (d) => d.cancel());
  await page.locator('.hf-field').filter({ hasText: 'Site ID' }).locator('input').fill('QF-SMOKE');
  await page.getByRole('button', { name: 'Save record' }).click();
  await page.waitForFunction(() => /saved ✓/.test(document.querySelector('.hf-out')?.textContent || ''), undefined, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('.hf-warn')?.dataset.unbacked === '1', undefined, { timeout: 2000 });

  // export off-device → the single-copy warning clears (durability floor, DECISIONS §1)
  await page.getByRole('button', { name: 'Export all' }).click();
  await page.waitForFunction(() => !document.querySelector('.hf-warn'), undefined, { timeout: 2000 });

  // load a real form from a file (@gcu/yaml) → the whole UI re-renders from the tree
  await page.locator('.hf-toolbar input[type="file"]').setInputFiles('examples/qf-sample-log.yaml');
  await page.waitForFunction(() => document.querySelector('.hf-app h1')?.textContent === 'QF Sample Log', undefined, { timeout: 3000 });
  assert.ok((await page.getByText('Lithology').count()) >= 1, 'loaded form fields render');

  // load an actual .xlsx (bundled SheetJS parses it in-browser → re-render)
  const t = { type: 'form', meta: { id: 'imp', title: 'Imported XLSForm', version: '1', lang: 'en' }, fields: [{ name: 'station', fieldType: 'text', label: 'Station', props: {} }], choices: {}, rules: [], views: [] };
  const { survey, settings } = treeToXlsform(t);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(survey), 'survey');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(settings), 'settings');
  const buffer = Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  await page.locator('.hf-toolbar input[type="file"]').setInputFiles({ name: 'imported.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
  await page.waitForFunction(() => document.querySelector('.hf-app h1')?.textContent === 'Imported XLSForm', undefined, { timeout: 3000 });
  assert.ok((await page.getByText('Station').count()) >= 1, 'xlsx-loaded field renders');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('✓ renderer smoke passed — collect→capture(blob)→sign→IDB, durability, load yaml + xlsx');
  await shutdown();
} catch (e) {
  console.error('✗ renderer smoke FAILED:', e.message);
  if (errors.length) console.error('  page errors:', errors.join('; '));
  await shutdown();
  process.exit(1);
}
