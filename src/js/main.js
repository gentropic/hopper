// Hopper collector — ordered import manifest. build.js inlines these in order;
// keep this file imports-only (no body runs from it).
//
// Vendored deps load first, as modules start needing them (see
// vendor/PROVENANCE.md · run `node tools/sync-vendor.mjs` to populate):
//   import '../../vendor/yaml.js';      // → @gcu/yaml: parse, emit, check
//   import '../../vendor/sideact.js';   // → @gcu/sideact: signal, computed, effect
//   import '../../vendor/vfs.js';       // → @gcu/vfs: VFS + backends
//   import '../../vendor/capsule.js';   // → @gcu/capsule: encodeInline, resolve, …
//
// Internal modules, in dependency order:
import './records/address.js';   // → streamId, contentAddress (pure; SPEC-hopper-records §1/§3)
import './rules/eval.js';        // → parse, evaluate, evalBool, constraintValid, deps (SPEC-hopper-rules)
import './boot.js';              // mounts the shell, registers the service worker
