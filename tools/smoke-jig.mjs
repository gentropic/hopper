// Browser smoke for the jig surface — drives the built jig.html in real Chromium
// (Playwright, dev-only). The engine (infer/edit/validate) is unit-tested in node;
// this confirms the builder shell works in a browser: paste a table → inferred
// fields + seams → live preview → a seam toggle → and the exports actually round
// back (JSON parses to a §8 tree; the .xlsx parses to real XLSForm sheets).
// Run: node build.js --target=jig && node tools/smoke-jig.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';
import * as XLSX from '../vendor/sheetjs.mjs';

const CSV = `Site ID,Lithology,Fe pct,Sampled,Coords
QF-118,itabirite,58.2,2026-06-01,"-20.1, -43.5"
QF-119,quartzite,41.0,2026-06-02,"-20.2, -43.6"
QF-120,itabirite,60.1,2026-06-03,"-20.0, -43.4"`;

const srv = await startServer({ root: process.cwd(), port: 0 });
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const shutdown = async () => { await browser.close(); await srv.close(); };

// field name → its type-dropdown value, read straight off the DOM
const typeOf = (name) => page.evaluate((n) => {
  for (const r of document.querySelectorAll('.jig-field'))
    if (r.querySelector('.jig-name')?.value === n) return r.querySelector('.jig-type')?.value;
  return null;
}, name);

const grabDownload = async (clickIt) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), clickIt()]);
  return { name: dl.suggestedFilename(), path: await dl.path() };
};

try {
  await page.goto(srv.url + 'jig.html');
  await page.waitForSelector('.jig-wrap', { timeout: 5000 });

  // paste a CSV table → infer
  await page.locator('.jig-title').fill('QF Sample Log');
  await page.locator('.jig-paste').fill(CSV);
  await page.getByRole('button', { name: 'Infer form' }).click();

  // deterministic per-column inference (§10) lands the right field types
  await page.locator('.jig-field').first().waitFor({ timeout: 3000 });
  assert.equal(await page.locator('.jig-field').count(), 5, 'five columns → five fields');
  assert.equal(await typeOf('site_id'), 'text', 'QF-### is text, not a number');
  assert.equal(await typeOf('lithology'), 'select', 'repeated values → select');
  assert.equal(await typeOf('fe_pct'), 'number');
  assert.equal(await typeOf('sampled'), 'date');
  assert.equal(await typeOf('coords'), 'geo', 'lat,lng → geo');

  // the live preview renders the inferred form through the real renderer
  await page.waitForSelector('.jig-preview-host .hf-form', { timeout: 3000 });
  assert.ok((await page.locator('.jig-preview-host .hf-label', { hasText: 'Lithology' }).count()) >= 1, 'preview shows the fields');

  // the contract guardrail says it's valid
  await page.locator('.jig-valid.jig-ok').waitFor({ timeout: 2000 });

  // export JSON → it parses back to a §8 tree with the inferred shape intact
  const j = await grabDownload(() => page.getByRole('button', { name: 'JSON' }).click());
  assert.match(j.name, /\.json$/);
  const tree = JSON.parse(await readFile(j.path, 'utf8'));
  assert.equal(tree.fields.length, 5);
  assert.equal(tree.meta.identity, 'site_id', 'identity seam recommendation applied');
  const lith = tree.fields.find((f) => f.name === 'lithology');
  assert.equal(lith.fieldType, 'select');
  assert.equal(tree.choices[lith.props.list].length, 2, 'inferred choices carried');

  // export XLSForm → the .xlsx parses to real survey/choices sheets (the ODK off-ramp)
  const x = await grabDownload(() => page.getByRole('button', { name: 'XLSForm' }).click());
  assert.match(x.name, /\.xlsx$/);
  const wb = XLSX.read(await readFile(x.path), { type: 'buffer' });
  const survey = XLSX.utils.sheet_to_json(wb.Sheets.survey, { defval: '' });
  const choices = XLSX.utils.sheet_to_json(wb.Sheets.choices, { defval: '' });
  assert.ok(survey.some((r) => String(r.type).startsWith('select_one')), 'select_one emitted');
  assert.ok(survey.some((r) => r.type === 'geopoint'), 'geopoint emitted');
  assert.ok(choices.some((r) => r.label === 'itabirite'), 'choices sheet carries the inferred options');

  // seam interview: flip lithology select → text; the type updates through the engine
  const seam = page.locator('.jig-seam', { hasText: 'choice list' });
  await seam.getByRole('button', { name: 'text' }).click();
  await page.waitForFunction(() => {
    for (const r of document.querySelectorAll('.jig-field'))
      if (r.querySelector('.jig-name')?.value === 'lithology') return r.querySelector('.jig-type')?.value === 'text';
    return false;
  }, undefined, { timeout: 2000 });
  // feedback: the chosen option is highlighted and the question is marked answered
  await seam.locator('.jig-seg-on', { hasText: 'text' }).waitFor({ timeout: 2000 });
  await seam.locator('.jig-done').waitFor({ timeout: 2000 });

  // a manual edit routes through the pure engine too: rename a field, preview re-renders
  const nameInput = page.locator('.jig-field', { has: page.locator('.jig-name') }).first().locator('.jig-name');
  await nameInput.fill('locality');
  await nameInput.blur();
  await page.locator('.jig-valid.jig-ok').waitFor({ timeout: 2000 });

  assert.deepEqual(errors, [], 'no page errors');
  console.log('✓ jig smoke passed — infer types + seams, live preview, JSON + XLSForm export round-trip, seam toggle + rename through the engine');
  await shutdown();
} catch (e) {
  console.error('✗ jig smoke FAILED:', e.message);
  if (errors.length) console.error('  page errors:', errors.join('; '));
  try {
    const toast = await page.locator('.co-toast').count() ? await page.locator('.co-toast').first().textContent() : '(none)';
    const fields = await page.locator('.jig-field').count();
    console.error('  toast:', toast, '| .jig-field count:', fields);
  } catch {}
  await shutdown();
  process.exit(1);
}
