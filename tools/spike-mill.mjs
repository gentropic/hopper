// Mill display spike — drives tools/spike-mill.html in real Chromium to confirm the
// pre-1.0 display libs (loom grid + plot chart) actually mount and render over a real
// mill runQuery result. Not in the default test run; `node tools/spike-mill.mjs`.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

const srv = await startServer({ root: process.cwd(), port: 0 });
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

try {
  await page.goto(srv.url + 'tools/spike-mill.html');
  await page.waitForFunction(() => window.__spike, undefined, { timeout: 8000 });
  const r = await page.evaluate(() => window.__spike);
  if (!r.ok) throw new Error('spike script threw: ' + r.err);
  assert.equal(r.groups, 2, 'runQuery produced 2 lithology groups');

  // loom painted a real, sized <canvas> grid (virtualized canvas renderer)
  await page.waitForFunction(() => { const c = document.querySelector('#grid canvas'); return c && c.width > 0 && c.height > 0; }, undefined, { timeout: 5000 });
  // plot painted a real <canvas> chart
  await page.waitForFunction(() => { const c = document.querySelector('#chart canvas'); return c && c.width > 0 && c.height > 0; }, undefined, { timeout: 5000 });
  const dims = await page.evaluate(() => {
    const g = document.querySelector('#grid canvas'), c = document.querySelector('#chart canvas');
    return { gw: g.width, gh: g.height, cw: c.width, ch: c.height };
  });

  assert.deepEqual(errs, [], 'no page errors');
  console.log(`✓ mill spike — loom grid (${dims.gw}×${dims.gh}) + plot chart (${dims.cw}×${dims.ch}) render over a runQuery result`);
  await browser.close(); await srv.close();
} catch (e) {
  console.error('✗ mill spike FAILED:', e.message);
  if (errs.length) console.error('  page errors:', errs.join('; '));
  try {
    const diag = await page.evaluate(() => ({
      spike: window.__spike,
      grid: document.getElementById('grid')?.innerHTML?.slice(0, 200),
      chart: document.getElementById('chart')?.innerHTML?.slice(0, 200),
      gridCanvases: document.querySelectorAll('#grid canvas').length,
      chartCanvases: document.querySelectorAll('#chart canvas').length,
      anyCanvas: [...document.querySelectorAll('canvas')].map((c) => ({ id: c.parentElement?.id, w: c.width, h: c.height })),
    }));
    console.error('  diag:', JSON.stringify(diag, null, 1));
  } catch {}
  await browser.close(); await srv.close();
  process.exit(1);
}
