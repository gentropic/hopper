// Form source: @gcu/capsule — a form definition that *travels*. A capsule string
// either carries the tree inline (`q:`/`i:`/`inline:` — compressed into a QR or a
// URL fragment, no network) or references it (`gh:`/`gist:`/`url:`/… — fetched,
// CORS-gated). capsule.resolve() handles the scheme dispatch; we only normalize
// the input and turn the resolved bytes into a §8 tree. (SPEC-hopper-collector §1.)
//
// Inbound only for now — these *pull a definition* (never send records). Sharing
// a form out (encodeInline + QR) is the matching follow-up.
//
// Namespace-import the vendored bundle (flat build wraps it to a `capsule` global);
// do NOT destructure `resolve` (collides with other modules in the shared scope).

import * as capsule from '../../../vendor/capsule.js';
import { loadFormFromText } from './load.js';

// A scanned/pasted value comes in three shapes; normalize to a bare capsule
// string for resolve():
//   1. already a capsule        `q:…` / `i:…` / `inline:…` / `gh:…` / `url:…`  → as-is
//   2. a share URL              `https://host/app/#<fragment-encoded capsule>`  → fragment-decode the #part
//      (the `q:` fragment gotcha — capsules are always fragment-encoded on the wire; SPEC-capsule §10)
//   3. a plain web URL          `https://host/form.json`                        → `url:` it (fetch the target)
export function normalizeCapsuleInput(input) {
  const s = String(input).trim();
  if (/^https?:\/\//i.test(s)) {
    const i = s.indexOf('#');
    if (i >= 0 && i < s.length - 1) return capsule.fragmentDecode(s.slice(i + 1));
    return 'url:' + s;
  }
  return s;
}

// Resolve a capsule/link to a Hopper form tree. `ctx` is the optional capsule
// ResolutionContext (e.g. an AbortSignal). Throws on resolve failure (bad
// scheme, network/CORS, offline) or if the bytes aren't a §8 form — surface it.
export async function resolveFormCapsule(input, ctx) {
  const bytes = await capsule.resolve(normalizeCapsuleInput(input), ctx);
  return loadFormFromText(new TextDecoder().decode(bytes));
}
