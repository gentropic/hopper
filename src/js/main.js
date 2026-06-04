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
import './records/address.js';   // → streamId, contentAddress, b64url (pure; SPEC-hopper-records §1/§3)
import './records/jcs.js';       // → canonicalize (RFC 8785 signing form; §3)
import './records/crypto.js';    // → Ed25519 sign/verify/keygen (Web Crypto preferred; §3)
import * as nobleEd from '../../vendor/noble-ed25519.js';  // bundled Ed25519 fallback (namespace-wrapped)
import './records/ed25519-fallback.js';                    // registers noble as the fallback backend
import './records/envelope.js';  // → makeRecord, verifyRecord, correct, tombstone, resolve (§2/§5/§9)
import './rules/eval.js';        // → parse, evaluate, evalBool, constraintValid, deps (SPEC-hopper-rules)
import './xlsform/index.js';     // → xlsformToTree, treeToXlsform (+ bridge) — SPEC-hopper-form §9
import * as sideact from '../../vendor/sideact.js';  // reactive signals (namespace-wrapped)
import './renderer/scan.js';     // → startBarcodeScan: getUserMedia + BarcodeDetector (barcode field + Scan-QR)
import './renderer/state.js';    // → createForm: tree → reactive engine
import './renderer/render.js';   // → renderForm: engine → DOM
import * as vfs from '../../vendor/vfs.js';  // VFS backends (namespace-wrapped)
import './storage/store.js';     // → createStore: signed append-only record store
import * as yaml from '../../vendor/yaml.js';  // @gcu/yaml (namespace-wrapped)
import './formsource/load.js';   // → loadFormByName/Text: yaml/json → §8 tree
import './formsource/yamlemit.js'; // → treeToYaml: §8 tree → YAML (jig Source view + .yaml export)
import * as sheetjs from '../../vendor/sheetjs.mjs';  // SheetJS (bundled, namespace-wrapped)
import './formsource/xlsx.js';   // → loadXlsx: .xlsx → §8 tree (the ODK on-ramp)
import * as capsule from '../../vendor/capsule.js';  // @gcu/capsule (bundled ESM, namespace-wrapped)
import './formsource/capsule.js'; // → resolveFormCapsule: capsule/URL → §8 tree (SPEC-collector §1)
import '../../vendor/qrcodegen.js'; // Nayuki QR gen — classic global script, flat-inlined → `qrcodegen` global (share QR)
import './sync/session.js';       // → syncSession: transport-agnostic bundle exchange + set-union merge
import './sync/webrtc.js';        // → webrtcOffer/webrtcAnswer: serverless WebRTC channel (QR handshake)
import './sync/handshake.js';     // → encodeHandshake/decodeHandshake: SDP ↔ QR (capsule-deflated)
import './jig/infer.js';         // → inferTree: a table → a flat §8 tree + seams (the Build tab)
import './jig/validate.js';      // → validateTree, IDENT_RE: the contract guardrail
import './jig/edit.js';          // → pure tree→tree edits + applyOverrides
import './jig/ui.js';            // → mountJig: the schema-from-example builder (embedded as a tab)
import './collector/shell.js';   // → mountShell: Forms · Build · Outbox · Settings around the renderer
import './boot.js';              // creates the store, mounts the shell, registers the SW
