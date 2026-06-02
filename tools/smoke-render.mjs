// Browser smoke test for the collector — drives the built collector.html in a
// real Chromium (Playwright, dev-only). The headless engine + store are unit-
// tested in node; this confirms the shell (Forms · Fill · Outbox · Settings),
// the DOM layer, and reactivity actually work in a browser.
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

const nav = (name) => page.locator('.co-nav button', { hasText: name });

try {
  page.on('download', (d) => d.cancel());
  await page.goto(srv.url);

  // shell boots on the Forms screen with the seeded demo form listed
  await page.waitForSelector('.co-nav', { timeout: 5000 });
  const demoRow = page.locator('.co-formrow', { hasText: 'QF Sample Log (demo)' });
  await demoRow.waitFor({ state: 'visible', timeout: 3000 });

  // open it → the Fill screen renders the form through the engine
  await demoRow.click();
  await page.waitForSelector('.hf-form', { timeout: 3000 });
  assert.ok((await page.getByText('Site ID').count()) >= 1, 'site_id field present');
  assert.ok((await page.locator('.hf-capture').count()) >= 1, 'geo capture control renders');

  // relevance: "Why resample?" hidden until resample = yes
  const why = page.locator('.hf-field').filter({ hasText: 'Why resample?' });
  assert.equal(await why.isVisible(), false, 'why hidden before resample=yes');
  await page.locator('select').first().selectOption('yes');
  await why.waitFor({ state: 'visible', timeout: 2000 });

  // repeat: add an instance → count() calc updates to 1
  await page.getByRole('button', { name: '+ add' }).click();
  await page.waitForFunction(() => document.querySelector('.hf-calc')?.textContent === '1', undefined, { timeout: 2000 });

  // constraint inside a repeat: an out-of-range Fe % shows its validation message
  await page.locator('.hf-instance input[type="number"]').first().fill('140');
  await page.waitForFunction(
    () => [...document.querySelectorAll('.hf-instance .hf-error')].some((e) => e.textContent.includes('100')),
    undefined, { timeout: 2000 });
  await page.locator('.hf-instance input[type="number"]').first().fill('64');   // fix it before saving

  // media capture: file/camera input → bytes → store.saveBlob (real IDB binary
  // write, content-addressed) → attachment ref; widget shows the stored hash+size
  await page.locator('.hf-media input[type="file"]').setInputFiles({ name: 'outcrop.png', mimeType: 'image/png', buffer: PNG_1PX });
  await page.waitForFunction(() => /✓.*sha256-/.test(document.querySelector('.hf-media-val')?.textContent || ''), undefined, { timeout: 3000 });

  // save → signs an immutable record → appends to the outbox; the fill view resets
  // with a flash, the Outbox nav count ticks, and the single-copy warning appears
  await page.locator('.hf-field').filter({ hasText: 'Site ID' }).locator('input').fill('QF-SMOKE');
  await page.getByRole('button', { name: 'Save record' }).click();
  await page.waitForSelector('.co-flash', { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('.co-warn')?.dataset.unbacked === '1', undefined, { timeout: 2000 });
  await nav('Outbox').waitFor();
  assert.match(await nav('Outbox').textContent(), /Outbox \(1\)/, 'outbox count reflects the saved record');

  // Outbox: the record is listed, single-copy, carrying its photo attachment
  await nav('Outbox').click();
  await page.waitForSelector('.co-rec', { timeout: 2000 });
  assert.equal(await page.locator('.co-rec-state.warn').count(), 1, 'record shows "on device only"');
  assert.equal(await page.locator('.co-rec-att').count(), 1, 'record carries an attachment marker');

  // export archive → off-device copy → warning clears, state flips to backed up
  await page.getByRole('button', { name: 'Export archive' }).click();
  await page.waitForFunction(() => document.querySelector('.co-warn')?.hidden !== false, undefined, { timeout: 2000 });
  await page.waitForSelector('.co-rec-state.ok', { timeout: 2000 });

  // Settings: the trust readout (persistence badge, identity, theme)
  await nav('Settings').click();
  await page.waitForSelector('.co-sec', { timeout: 2000 });
  assert.ok((await page.locator('.hf-badge').count()) >= 1, 'persistence badge renders');
  assert.ok((await page.locator('.co-legend .co-sw').count()) === 6, 'six-accent legend in About');

  // add a form from a file (@gcu/yaml) → jumps into Fill with the new title
  await nav('Forms').click();
  await page.locator('.co-addrow').click();
  await page.locator('.co-sheet .co-file').setInputFiles('examples/qf-sample-log.yaml');
  await page.waitForFunction(() => document.querySelector('.co-filltitle')?.textContent === 'QF Sample Log', undefined, { timeout: 3000 });
  assert.ok((await page.getByText('Lithology').count()) >= 1, 'loaded form fields render');

  // add an actual .xlsx (bundled SheetJS parses it in-browser)
  const t = { type: 'form', meta: { id: 'imp', title: 'Imported XLSForm', version: '1', lang: 'en' }, fields: [{ name: 'station', fieldType: 'text', label: 'Station', props: {} }], choices: {}, rules: [], views: [] };
  const { survey, settings } = treeToXlsform(t);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(survey), 'survey');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(settings), 'settings');
  const buffer = Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  await nav('Forms').click();
  await page.locator('.co-addrow').click();
  await page.locator('.co-sheet .co-file').setInputFiles({ name: 'imported.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
  await page.waitForFunction(() => document.querySelector('.co-filltitle')?.textContent === 'Imported XLSForm', undefined, { timeout: 3000 });
  assert.ok((await page.getByText('Station').count()) >= 1, 'xlsx-loaded field renders');

  assert.deepEqual(errors, [], 'no page errors');
  console.log('✓ collector smoke passed — shell (Forms·Fill·Outbox·Settings), capture→blob→sign→IDB, durability, add yaml + xlsx');
  await shutdown();
} catch (e) {
  console.error('✗ renderer smoke FAILED:', e.message);
  if (errors.length) console.error('  page errors:', errors.join('; '));
  await shutdown();
  process.exit(1);
}
