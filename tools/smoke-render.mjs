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
import { createStore } from '../src/js/storage/store.js';
import { MemoryBackend } from '../vendor/vfs.js';
import * as XLSX from '../vendor/sheetjs.mjs';
import * as Capsule from '../vendor/capsule.js';

// a 1×1 PNG — exercises real binary-blob capture (saveBlob → IDB → attachment)
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const srv = await startServer({ root: process.cwd(), port: 0 });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.context().grantPermissions(['geolocation']);            // for the geotrace capture
await page.context().setGeolocation({ latitude: -20.12, longitude: -43.45, accuracy: 6 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

const shutdown = async () => { await browser.close(); await srv.close(); };

const nav = (name) => page.locator('.co-nav button', { hasText: name });

try {
  page.on('download', (d) => d.cancel());
  await page.goto(srv.url);

  // shell boots on the Forms screen with the seeded demo form listed
  await page.waitForSelector('.co-nav', { timeout: 5000 });

  // first-run durability nudge (§4.2) — present while storage isn't durable yet
  // (headless: usually not persisted, so it shows); dismissible. Conditional so the
  // smoke is robust to whether the browser auto-grants persistence.
  if (await page.locator('.co-onboard').count()) {
    await page.locator('.co-onboard').getByRole('button', { name: 'Dismiss' }).click();
    await page.locator('.co-onboard').waitFor({ state: 'detached', timeout: 2000 });
  }

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

  // geotrace: capture two GPS points (mocked location) → an ordered point list
  const traverse = page.locator('.hf-field').filter({ hasText: 'Traverse' });
  await traverse.locator('.hf-capture').click();
  await traverse.locator('.hf-geopt').first().waitFor({ timeout: 3000 });
  await traverse.locator('.hf-capture').click();
  await page.waitForFunction(() => document.querySelectorAll('.hf-geopath-list .hf-geopt').length === 2, undefined, { timeout: 3000 });

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

  // editable collector name → setName rewrites identity/stream reg, survives re-render
  await page.locator('.co-name-input').fill('Smoke Surveyor');
  await page.locator('.co-name-input').blur();
  await page.waitForFunction(() => document.querySelector('.co-name-input')?.value === 'Smoke Surveyor', undefined, { timeout: 2000 });

  // Build tab (jig embedded): paste a CSV → infer a form → "Use this form" routes
  // it into the store via onEmit and jumps straight to Fill (build → collect)
  await nav('Build').click();
  await page.waitForSelector('.co-build .jig-wrap', { timeout: 3000 });
  await page.locator('.co-build .jig-title').fill('Built In Collector');
  await page.locator('.co-build .jig-paste').fill('Station,Depth\nA1,12\nA2,8');
  await page.locator('.co-build').getByRole('button', { name: 'Infer form' }).click();
  await page.locator('.co-build .jig-field').first().waitFor({ timeout: 3000 });
  await page.locator('.co-build').getByRole('button', { name: 'Use this form' }).click();
  await page.waitForFunction(() => document.querySelector('.co-filltitle')?.textContent === 'Built In Collector', undefined, { timeout: 3000 });
  assert.ok((await page.getByText('Station').count()) >= 1, 'jig-built form is fillable in the collector');

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

  // inbound capsule — a form definition that travels (SPEC-collector §1).
  const CAPFORM = { type: 'form', meta: { id: 'cap', title: 'Capsule Form' }, fields: [{ name: 'q', fieldType: 'text', label: 'Q', props: {} }], choices: {}, rules: [], views: [] };
  const cap = await Capsule.encodeInline(JSON.stringify(CAPFORM), { form: 'q' });

  // (a) a shared link: open the app at #<fragment-encoded capsule> → confirm → add.
  // (goto with only a hash change is a same-document nav; reload() forces a fresh
  // boot so the shell's open-time auto-resolve runs against the hash.)
  await page.goto(srv.url + '#' + Capsule.fragmentEncode(cap));
  await page.reload();
  await page.waitForSelector('.co-confirm', { timeout: 3000 });
  assert.ok((await page.locator('.co-confirm-title').textContent()).includes('Capsule Form'), 'confirm previews the form title');
  await page.locator('.co-confirm').getByRole('button', { name: 'Add form' }).click();
  await page.waitForFunction(() => document.querySelector('.co-filltitle')?.textContent === 'Capsule Form', undefined, { timeout: 3000 });
  await page.waitForFunction(() => location.hash === '', undefined, { timeout: 2000 });   // one-shot: hash cleared

  // (b) paste the capsule string into the add-form sheet → resolve → confirm → add
  await page.reload();                       // clean boot, no hash → Forms screen
  await page.waitForSelector('.co-nav', { timeout: 3000 });
  await page.locator('.co-addrow').click();
  await page.locator('.co-paste-input').fill(cap);
  await page.getByRole('button', { name: 'Resolve' }).click();
  await page.waitForSelector('.co-confirm', { timeout: 3000 });
  await page.locator('.co-confirm').getByRole('button', { name: 'Add form' }).click();
  await page.waitForFunction(() => document.querySelector('.co-filltitle')?.textContent === 'Capsule Form', undefined, { timeout: 3000 });

  // (c) share OUT: from the form's Fill header → QR + copy-link; the link round-
  // trips back through the inbound auto-resolve (generate → open → confirm → add)
  await page.locator('.co-share-btn').click();
  await page.waitForSelector('.co-share .co-qr', { timeout: 3000 });   // QR rendered (Nayuki, flat-inlined)
  const shareUrl = await page.locator('.co-share-url').inputValue();
  assert.ok(/#/.test(shareUrl) && shareUrl.length > 20, 'share URL carries a #fragment capsule');
  await page.goto(shareUrl);
  await page.reload();                                                 // open the shared link → auto-resolve
  await page.waitForSelector('.co-confirm', { timeout: 3000 });
  await page.locator('.co-confirm').getByRole('button', { name: 'Add form' }).click();
  await page.waitForFunction(() => document.querySelector('.co-filltitle')?.textContent === 'Capsule Form', undefined, { timeout: 3000 });

  // (d) archive import — set-union merge: pull a peer's bundle in (sigs verified),
  // its form becomes fillable without touching your own records (§2, §6).
  const PEERFORM = { type: 'form', meta: { id: 'peer', title: 'Imported Peer Form' }, fields: [{ name: 'p', fieldType: 'text', label: 'P', props: {} }], choices: {}, rules: [], views: [] };
  const peer = createStore(new MemoryBackend());
  await peer.init({ name: 'Peer' });
  const pfh = await peer.putForm(PEERFORM);
  await peer.saveRecord({ form: pfh, values: { p: 'hi' } });
  const peerBundle = await peer.exportBundle();

  await nav('Outbox').click();
  await page.locator('.co-import').waitFor({ state: 'attached', timeout: 2000 });
  await page.locator('.co-import').setInputFiles({ name: 'peer.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(peerBundle)) });
  await page.waitForFunction(() => /Imported\b.*1 record\b.*1 form\b/.test(document.querySelector('.co-toast')?.textContent || ''), undefined, { timeout: 3000 });
  await nav('Forms').click();
  await page.locator('.co-formrow', { hasText: 'Imported Peer Form' }).waitFor({ timeout: 3000 });

  // (d.2) corrections — resolved on read (§5/§9). Correct the demo record (form
  // re-opens pre-filled → a correction supersedes it), then retract it (tombstone).
  await nav('Outbox').click();
  await page.locator('.co-rec').first().waitFor({ timeout: 3000 });
  await page.locator('.co-rec-act', { hasText: 'correct' }).first().click();
  await page.waitForSelector('.hf-form', { timeout: 3000 });
  await page.locator('.co-flash', { hasText: 'Correcting' }).waitFor({ timeout: 2000 });
  const siteInput = page.locator('.hf-field').filter({ hasText: 'Site ID' }).locator('input');
  assert.equal(await siteInput.inputValue(), 'QF-SMOKE', 'correction form pre-filled with the record values');
  await siteInput.fill('QF-FIXED');
  await page.getByRole('button', { name: 'Save record' }).click();
  // back on the Outbox, the resolved head is flagged "corrected" (the durable proof
  // the correction saved + superseded + resolved — robust to transient toast stacking)
  await page.locator('.co-rec-kind', { hasText: 'corrected' }).waitFor({ timeout: 3000 });

  await page.locator('.co-rec-act', { hasText: 'retract' }).first().click();
  await page.locator('.co-confirm').getByRole('button', { name: 'Retract' }).click();
  await page.waitForSelector('.co-empty', { timeout: 3000 });   // tombstone resolves away → outbox empty

  // (d.3) WebRTC loopback — the real transport. Two RTCPeerConnections connect in one
  // page (SDP passed directly, no QR needed for the transport itself); syncSession runs
  // over the live DataChannel and unions two fake stores. Proves WebRTC + the merge
  // protocol end to end before the (camera-only, unsmokeable) QR handshake of 2c.
  const sync = await page.evaluate(async () => {
    const mkStore = (rid) => {
      const recs = [{ id: rid, kind: 'record' }];
      return {
        exportBundle: async () => ({ v: 1, streams: {}, forms: {}, records: recs.map((r) => ({ ...r })) }),
        importBundle: async (b) => { let n = 0; for (const r of (b.records || [])) if (!recs.some((x) => x.id === r.id)) { recs.push(r); n++; } return { streams: 0, forms: 0, records: n, skipped: 0, rejected: 0 }; },
        missingBlobs: async () => [],   // these fakes carry no attachments → blob lane no-ops
        count: () => recs.length,
      };
    };
    const A = mkStore('A/0'), B = mkStore('B/0');
    const offer = await webrtcOffer();
    const answer = await webrtcAnswer(offer.sdp);
    const [oc, ac] = await Promise.all([offer.connect(answer.sdp), answer.connect()]);
    const [ra, rb] = await Promise.all([syncSession(oc.channel, A), syncSession(ac.channel, B)]);
    oc.close(); ac.close();
    return { a: A.count(), b: B.count(), aRecv: ra.received.records, bRecv: rb.received.records };
  });
  assert.deepEqual(sync, { a: 2, b: 2, aRecv: 1, bRecv: 1 }, 'WebRTC DataChannel sync unioned both records');

  // (d.4) sync UI — the offerer path through the real shell: Outbox → "Sync with a
  // peer" → Start → a handshake QR renders (real RTCPeerConnection offer + ICE +
  // encodeHandshake + qrSvg). The scan/connect leg is camera-only, so it stops here.
  await nav('Outbox').click();
  await page.getByRole('button', { name: 'Sync with a peer' }).click();
  await page.locator('.co-sync').getByRole('button', { name: 'Start' }).click();
  await page.locator('.co-sync .co-qr').waitFor({ timeout: 8000 });
  await page.locator('.co-sync').getByRole('button', { name: 'Close' }).click();

  // (e) offline: the service worker serves the cached shell for a navigation to
  // the bare origin "/" (not just the exact precached URL) — the durability point
  // of a served PWA. Wait for the SW to control the page, cut the network, reload.
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, { timeout: 6000 });
  await page.context().setOffline(true);
  await page.goto(srv.url);                                          // bare "/" while offline → SW shell fallback
  // a form row proves it both booted from the cached shell AND read IDB offline
  await page.locator('.co-formrow').first().waitFor({ timeout: 6000 });
  await page.context().setOffline(false);

  assert.deepEqual(errors, [], 'no page errors');
  console.log('✓ collector smoke passed — shell, capture→sign→IDB, durability, Build-tab (jig), add yaml/xlsx, capsule in/out, archive import, correct/retract, WebRTC sync, offline shell');
  await shutdown();
} catch (e) {
  console.error('✗ renderer smoke FAILED:', e.message);
  if (errors.length) console.error('  page errors:', errors.join('; '));
  await shutdown();
  process.exit(1);
}

