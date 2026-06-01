// Browser smoke test for the renderer — drives the built collector.html in a
// real Chromium (Playwright, dev-only). The headless engine is unit-tested in
// node; this confirms the DOM layer + reactivity actually work in a browser.
// Run: node build.js && node tools/smoke-render.mjs
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const url = pathToFileURL(resolve('collector.html')).href;
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(url);
  await page.waitForSelector('.hf-form', { timeout: 5000 });

  // form rendered
  assert.equal(await page.locator('.hf-form').count(), 1, 'form renders');
  assert.ok((await page.getByText('Site ID').count()) >= 1, 'site_id field present');

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

  // save → signs an immutable record (Ed25519: native or bundled noble fallback)
  // → persists to IndexedDB → the single-copy durability warning appears
  page.on('download', (d) => d.cancel());
  await page.locator('.hf-field').filter({ hasText: 'Site ID' }).locator('input').fill('QF-SMOKE');
  await page.getByRole('button', { name: 'Save record' }).click();
  await page.waitForFunction(() => /saved ✓/.test(document.querySelector('.hf-out')?.textContent || ''), undefined, { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector('.hf-warn')?.dataset.unbacked === '1', undefined, { timeout: 2000 });

  // export off-device → the single-copy warning clears (durability floor, DECISIONS §1)
  await page.getByRole('button', { name: 'Export all' }).click();
  await page.waitForFunction(() => !document.querySelector('.hf-warn'), undefined, { timeout: 2000 });

  assert.deepEqual(errors, [], 'no page errors');
  console.log('✓ renderer smoke passed — form, relevance, repeat+aggregate, constraint, save→sign→IDB, durability warn+export');
  await browser.close();
} catch (e) {
  console.error('✗ renderer smoke FAILED:', e.message);
  if (errors.length) console.error('  page errors:', errors.join('; '));
  await browser.close();
  process.exit(1);
}
