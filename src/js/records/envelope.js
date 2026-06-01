// The record envelope — SPEC-hopper-records §2, §5, §9. The save boundary:
// a finished fill becomes an immutable, signed record. Pure data + crypto;
// no storage, no counter source (storage owns the monotonic counter), no UI.

import { canonicalize } from './jcs.js';
import { sign, verify } from './crypto.js';

const enc = new TextEncoder();

// The bytes that get signed: the JCS canonicalization of the envelope without
// its own signature (§3). Stored files may be pretty-printed; this re-derives
// the signing bytes from the data, so whitespace never affects verification.
function signingBytes(env) {
  const { sig, ...rest } = env;
  return enc.encode(canonicalize(rest));
}

// Build + sign a record. `ctx` carries the stream context storage provides.
//   { stream, counter, form, values?, attachments?, at?, kind?, supersedes? }
export async function makeRecord(ctx, privateKeyB64) {
  const env = {
    v: 1,
    id: `${ctx.stream}/${ctx.counter}`,
    kind: ctx.kind || 'record',
    form: ctx.form,
    at: ctx.at ?? null,                 // best-effort device time; never an ordering key (§7)
    values: ctx.values || {},
    attachments: ctx.attachments || {},
    supersedes: ctx.supersedes ?? null,
  };
  env.sig = await sign(signingBytes(env), privateKeyB64);
  return env;
}

export async function verifyRecord(env, publicKeyB64) {
  if (!env || typeof env.sig !== 'string') return false;
  try { return await verify(signingBytes(env), env.sig, publicKeyB64); }
  catch { return false; }
}

// A correction supersedes a record with new values; a tombstone retracts it.
// Both are ordinary signed records in the author's stream (§5).
export function correct(originalId, newValues, ctx, privateKeyB64) {
  return makeRecord({ ...ctx, kind: 'correction', supersedes: originalId, values: newValues }, privateKeyB64);
}
export function tombstone(originalId, ctx, privateKeyB64) {
  return makeRecord({ ...ctx, kind: 'tombstone', supersedes: originalId, values: {} }, privateKeyB64);
}

// Resolve supersede-chains to effective records (§5): the head of each chain
// (the record nothing supersedes), with tombstoned chains dropped.
//
// v1 assumes single-writer-per-stream, so chains are linear (no forks); the
// cross-stream `(counter, stream-id)` tiebreak for forks is a noted refinement.
export function resolve(records) {
  const superseded = new Set();
  for (const r of records) if (r.supersedes) superseded.add(r.supersedes);
  const out = [];
  for (const r of records) {
    if (superseded.has(r.id)) continue;     // not a chain head
    if (r.kind === 'tombstone') continue;   // head is a retraction → drop
    out.push(r);
  }
  return out;
}

export { signingBytes };
