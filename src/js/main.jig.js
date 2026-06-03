// Hopper jig — ordered import manifest for the `--target=jig` surface (build.js).
// The schema-from-example builder (SPEC-hopper-form §10). A separate artifact from
// the collector by design (surfaces-not-apps, DECISIONS §7); it shares the same
// src/ and lowers to the same §8 tree, then hands a form off via the capsule/share
// path the collector already ingests. Keep this imports-only (no body runs here).
//
// Namespace consts (sideact/sheetjs/capsule) must precede the modules that read
// them at top level (render/state) — flat build = one shared scope.
import './rules/eval.js';        // → parse, evaluate, deps — validate + the preview engine
import * as sideact from '../../vendor/sideact.js';     // reactive signals (namespace-wrapped)
import './renderer/scan.js';     // imported by render.js (barcode/QR widgets)
import './renderer/state.js';    // → createForm: tree → reactive engine (live preview)
import './renderer/render.js';   // → renderForm: engine → DOM (the free WYSIWYG preview)
import './xlsform/index.js';     // → treeToXlsform: §8 tree → XLSForm rows (xlsx export)
import * as sheetjs from '../../vendor/sheetjs.mjs';    // SheetJS — CSV/XLSX intake + xlsx write
import * as capsule from '../../vendor/capsule.js';     // @gcu/capsule — makeShare (share a form out)
import '../../vendor/qrcodegen.js';                     // Nayuki QR gen → `qrcodegen` global (share QR)
import './jig/infer.js';         // → inferTree: a table → a flat §8 tree + seams (§10)
import './jig/validate.js';      // → validateTree, IDENT_RE: the contract guardrail
import './jig/edit.js';          // → pure tree→tree edits + applyOverrides
import './jig/ui.js';            // → mountJig: the builder shell (intake · seams · fields · preview · export)
import './jig/boot.js';          // entry: mount jig into #app
