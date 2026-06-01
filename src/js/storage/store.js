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
import { makeRecord } from '../records/envelope.js';

const encStr = (s) => new TextEncoder().encode(s);   // distinct name (flat build: one shared scope)
const dirname = (p) => p.slice(0, p.lastIndexOf('/')) || '/';
const pad = (n) => String(n).padStart(6, '0');
function randId(n = 8) { const a = new Uint8Array(n); crypto.getRandomValues(a); return bytesToB64Url(a); }

export function createStore(backend) {
  let identity = null;
  let counter = 0;

  const ensureDir = async (dir) => { try { await backend.mkdir(dir, { recursive: true }); } catch {} };
  const readJSON = async (p) => ((await backend.exists(p)) ? JSON.parse(await backend.readFile(p)) : null);
  const writeJSON = async (p, obj) => { await ensureDir(dirname(p)); await backend.writeFile(p, JSON.stringify(obj, null, 2)); };
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

  return { init, putForm, saveRecord, listRecords, identity: () => identity, count: () => counter };
}
