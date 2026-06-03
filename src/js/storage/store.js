// Storage — the record store over a @gcu/vfs backend (IndexedDB in the browser,
// MemoryBackend in tests). Owns the stream identity (keypair + device + epoch,
// SPEC-hopper-records §1), the per-stream monotonic counter, and the append-only
// record log; writes the repo layout (`/streams`, `/forms`, `/records/<stream>`).
//
// The backend is injected (not imported) so this is headless-testable. Records
// are JSON text (vfs backends round-trip strings); attachment blobs come later.

import { generateStreamKey } from '../records/crypto.js';
import { streamId, contentAddress, bytesToB64Url } from '../records/address.js';
import { canonicalize } from '../records/jcs.js';
import { makeRecord, verifyRecord, resolve } from '../records/envelope.js';

const encStr = (s) => new TextEncoder().encode(s);   // distinct name (flat build: one shared scope)
const dirname = (p) => p.slice(0, p.lastIndexOf('/')) || '/';
const pad = (n) => String(n).padStart(6, '0');
function randId(n = 8) { const a = new Uint8Array(n); crypto.getRandomValues(a); return bytesToB64Url(a); }

export function createStore(backend) {
  let identity = null;
  let counter = 0;
  let mirror = null;   // optional second backend (a chosen folder via FSAA) — auto-backup

  const ensureDirOn = async (be, dir) => { try { await be.mkdir(dir, { recursive: true }); } catch {} };
  const writeJSONOn = async (be, p, obj) => { await ensureDirOn(be, dirname(p)); await be.writeFile(p, JSON.stringify(obj, null, 2)); };
  const readJSON = async (p) => ((await backend.exists(p)) ? JSON.parse(await backend.readFile(p)) : null);
  const writeJSON = async (p, obj) => { await writeJSONOn(backend, p, obj); if (mirror) { try { await writeJSONOn(mirror, p, obj); } catch {} } };
  // Binary writes (attachment blobs): pass the Uint8Array straight through — vfs
  // round-trips bytes via the 'bytes' encoding; JSON.stringify would corrupt them.
  const writeBytesOn = async (be, p, bytes) => { await ensureDirOn(be, dirname(p)); await be.writeFile(p, bytes); };
  const writeBytes = async (p, bytes) => { await writeBytesOn(backend, p, bytes); if (mirror) { try { await writeBytesOn(mirror, p, bytes); } catch {} } };
  const listDir = async (dir) => { try { return await backend.readdir(dir); } catch { return []; } };

  async function init({ name } = {}) {
    if (backend.init && !backend.__hopperInited) { await backend.init(); backend.__hopperInited = true; }
    identity = await readJSON('/identity.json');
    if (!identity) {
      const key = await generateStreamKey();                       // Ed25519 (native or noble fallback)
      const device = randId(), epoch = randId();
      const sid = await streamId(key.publicKey, device, epoch);
      identity = { streamId: sid, publicKey: key.publicKey, privateKey: key.privateKey, device, epoch, name: name || 'collector' };
      await writeJSON('/identity.json', identity);
      await writeJSON(`/streams/${sid}.json`, { v: 1, pubkey: key.publicKey, device, epoch, name: identity.name });
    }
    counter = (await listDir(`/records/${identity.streamId}`)).length;   // append-only: file count = next counter
    return identity;
  }

  // Store a form definition once, content-addressed; returns its hash for records to point at.
  async function putForm(tree) {
    const hash = await contentAddress(encStr(canonicalize(tree)));
    const p = `/forms/${hash}.json`;
    if (!(await backend.exists(p))) await writeJSON(p, tree);
    return hash;
  }

  // Store an attachment blob once, content-addressed (SPEC-hopper-records §8);
  // returns its `sha256-…` hash for a record's `attachments` to bind by. Binary,
  // not JSON (it's git-LFS for outcrop photos). Dedup: the same photo attached
  // twice is one blob. Mirrors to the folder like every other write.
  async function saveBlob(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const hash = await contentAddress(data);
    const p = `/blobs/${hash}`;
    if (!(await backend.exists(p))) await writeBytes(p, data);
    return hash;
  }
  async function getBlob(hash) {
    const p = `/blobs/${hash}`;
    return (await backend.exists(p)) ? backend.readFile(p, 'bytes') : null;
  }

  // Every attachment-blob hash referenced by any record (across all streams). The
  // blob *bytes* sync separately (the fat lane, §8) — this is what they reconcile against.
  async function referencedBlobs() {
    const set = new Set();
    for (const sid of await listDir('/records'))
      for (const n of await listDir(`/records/${sid}`)) {
        const r = await readJSON(`/records/${sid}/${n}`);
        if (r && r.attachments) for (const a of Object.values(r.attachments)) if (a && a.blob) set.add(a.blob);
      }
    return [...set];
  }
  // Referenced blobs we don't hold — the "want" list the sync blob-lane requests (§8).
  async function missingBlobs() {
    const out = [];
    for (const h of await referencedBlobs()) if (!(await backend.exists(`/blobs/${h}`))) out.push(h);
    return out;
  }

  // The save boundary: sign the values into an immutable record and append it.
  async function saveRecord({ form, values, attachments, kind, supersedes } = {}) {
    if (!identity) throw new Error('store not initialised');
    const env = await makeRecord(
      { stream: identity.streamId, counter, form, at: new Date().toISOString(), values, attachments, kind, supersedes },
      identity.privateKey);
    await writeJSON(`/records/${identity.streamId}/${pad(counter)}.json`, env);
    counter += 1;
    return env;
  }

  async function listRecords() {
    const dir = `/records/${identity.streamId}`;
    const names = (await listDir(dir)).slice().sort();
    const out = [];
    for (const n of names) out.push(await readJSON(`${dir}/${n}`));
    return out;
  }

  // The loaded form set (collector Forms screen): each stored definition with its
  // hash + title. Forms are content-addressed (putForm), so this survives reloads.
  async function listForms() {
    const out = [];
    for (const n of (await listDir('/forms')).slice().sort()) {
      const tree = await readJSON(`/forms/${n}`);
      if (tree) out.push({ hash: n.replace(/\.json$/, ''), tree, title: (tree.meta && (tree.meta.title || tree.meta.id)) || 'Untitled' });
    }
    return out;
  }

  // Records annotated for the Outbox — the *effective* records (corrections/tombstones
  // resolved on read, §5/§9): a corrected record shows its latest head, a retracted one
  // drops out entirely. Each carries its counter, whether a copy exists off-device
  // (folder mirror auto-backs-up everything; export covers records up to its mark),
  // whether it carries attachments, and whether it's a correction (supersedes another).
  // Honest about sync state — network sync isn't built yet, so "backed up" means
  // folder/export, not "sent".
  async function recordsView() {
    const m = await readJSON('/export-meta.json');
    const exportedThrough = (m && m.count) || 0;
    return resolve(await listRecords()).map((r) => {
      const counter = Number(String(r.id).split('/')[1]);
      return {
        ...r, counter,
        backedUp: !!mirror || counter < exportedThrough,
        hasAttachments: !!(r.attachments && Object.keys(r.attachments).length),
        corrected: !!r.supersedes,
      };
    });
  }

  // ---- durability (DECISIONS §1) ----

  // A faithful repo snapshot — streams + forms + records from *every* stream we
  // hold (not just our own), so the bundle is a complete grow-only-set carrier:
  // re-exporting after an import gossips a peer's records onward (SPEC-records §6).
  // Excludes /identity.json (it holds the private key; key backup is a separate,
  // deliberate flow). Records stay verifiable: their signatures check against the
  // pubkey in streams/<sid>.json, also included. Values-first — attachment blobs
  // are not bundled here; they take the fat-pipe lane, bound by hash (§8).
  async function exportBundle() {
    const out = { v: 1, streams: {}, forms: {}, records: [] };
    for (const n of await listDir('/streams')) out.streams[n] = await readJSON(`/streams/${n}`);
    for (const n of await listDir('/forms')) out.forms[n] = await readJSON(`/forms/${n}`);
    for (const sid of (await listDir('/records')).slice().sort())
      for (const n of (await listDir(`/records/${sid}`)).slice().sort())
        out.records.push(await readJSON(`/records/${sid}/${n}`));
    return out;
  }

  // The merge that *is* sync (SPEC-records §6): union a peer's bundle into the
  // local repo, keyed by address/id. Conflict-free — immutable, content/id-addressed
  // objects, one writer per stream, so "already have it" ⇒ skip. Every record is
  // verified against its stream's pubkey before it's accepted (§7); a tampered or
  // unverifiable record is rejected, never written. Transport-free (an archive
  // file), so it's the floor carrier and the place the merge logic lives.
  async function importBundle(bundle) {
    if (!bundle || bundle.v !== 1) throw new Error('unrecognized bundle (expected { v: 1, … })');
    const out = { streams: 0, forms: 0, records: 0, skipped: 0, rejected: 0 };

    for (const [name, reg] of Object.entries(bundle.streams || {})) {
      const p = `/streams/${name}`;
      if (!(await backend.exists(p))) { await writeJSON(p, reg); out.streams += 1; }
    }
    for (const [name, tree] of Object.entries(bundle.forms || {})) {
      const p = `/forms/${name}`;
      if (!(await backend.exists(p))) { await writeJSON(p, tree); out.forms += 1; }
    }
    for (const rec of bundle.records || []) {
      const [sid, c] = String(rec && rec.id).split('/');
      const counterN = Number(c);
      if (!sid || !Number.isInteger(counterN)) { out.rejected += 1; continue; }
      const reg = (bundle.streams && bundle.streams[`${sid}.json`]) || await readJSON(`/streams/${sid}.json`);
      if (!reg || !reg.pubkey || !(await verifyRecord(rec, reg.pubkey))) { out.rejected += 1; continue; }
      const p = `/records/${sid}/${pad(counterN)}.json`;
      if (await backend.exists(p)) { out.skipped += 1; continue; }
      await writeJSON(p, rec);
      out.records += 1;
    }
    counter = (await listDir(`/records/${identity.streamId}`)).length;   // keep our own counter monotonic
    return out;
  }

  async function markExported() { await writeJSON('/export-meta.json', { count: counter, at: new Date().toISOString() }); }
  async function unbackedUp() {
    if (mirror) return 0;                      // a folder mirror auto-backs-up every save (DECISIONS §5)
    const m = await readJSON('/export-meta.json');
    return Math.max(0, counter - ((m && m.count) || 0));
  }

  // Attach a folder (FSAA) or any backend as an auto-backup mirror, backfilling
  // the existing repo. From then on every write lands in the folder too — the
  // "never have to remember" durability floor; if the folder is in a file-sync
  // service it is conflict-free off-device (DECISIONS §5).
  async function setMirror(be) {
    mirror = be;
    for (const dir of ['/streams', '/forms']) for (const n of await listDir(dir)) await writeJSONOn(be, `${dir}/${n}`, await readJSON(`${dir}/${n}`));
    const rdir = `/records/${identity.streamId}`;
    for (const n of (await listDir(rdir)).slice().sort()) await writeJSONOn(be, `${rdir}/${n}`, await readJSON(`${rdir}/${n}`));
    for (const n of await listDir('/blobs')) await writeBytesOn(be, `/blobs/${n}`, await backend.readFile(`/blobs/${n}`, 'bytes'));
  }
  // The identity incl. private key — for deliberate KEY backup (separate from the
  // data export, which omits it). Lose this and you can't keep signing as you.
  const exportIdentity = () => identity;

  // Browser-only: request persistent storage (the eviction lever — covers IDB +
  // OPFS) and read the durability status. Degrade gracefully off-browser/in tests.
  async function persistRequest() {
    try { return (navigator.storage && navigator.storage.persist) ? await navigator.storage.persist() : false; } catch { return false; }
  }
  async function status() {
    let persisted = false, bytesUsed = 0;
    try {
      if (typeof navigator !== 'undefined' && navigator.storage) {
        if (navigator.storage.persisted) persisted = await navigator.storage.persisted();
        if (navigator.storage.estimate) bytesUsed = (await navigator.storage.estimate()).usage || 0;
      }
    } catch {}
    return { persisted, bytesUsed, recordCount: counter, unbackedUp: await unbackedUp(), mirrored: !!mirror };
  }

  return {
    init, putForm, saveBlob, getBlob, referencedBlobs, missingBlobs, saveRecord, listRecords, listForms, recordsView, identity: () => identity, count: () => counter,
    exportBundle, importBundle, markExported, unbackedUp, persistRequest, status, setMirror, exportIdentity,
  };
}
