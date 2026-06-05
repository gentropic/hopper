// Hopper mill — ordered import manifest for the `--target=mill` surface (build.js).
// The analysis / aggregation console (DECISIONS §6/§7): open a repo bundle, query
// the append-only union (total-calculus filters + group-by/aggregate), see results
// in a virtualized grid + charts. A sibling surface to the collector — kept its own
// artifact so the collector stays lean (loom/plot weight lives only here).
//
// Records/store stack: the mill spins up an in-memory store, imports a bundle, and
// reads the resolved union (exportBundle + resolve) — same code the collector uses.
// No sideact/renderer here (loom/plot are vanilla canvas; the engine is pure).
import './records/address.js';   // contentAddress / streamId / b64
import './records/jcs.js';       // canonicalize
import './records/crypto.js';    // Ed25519 (importBundle verification)
import * as nobleEd from '../../vendor/noble-ed25519.js';   // fallback (namespace-wrapped)
import './records/ed25519-fallback.js';
import './records/envelope.js';  // → makeRecord/verifyRecord/correct/tombstone/resolve (the union resolver)
import './rules/eval.js';        // → parse/evaluate/evalBool — the total-calculus query layer
import * as vfs from '../../vendor/vfs.js';   // MemoryBackend for the analysis-session store (namespace-wrapped)
import './storage/store.js';     // → createStore: importBundle + exportBundle + listForms
import './mill/table.js';        // → recordsToRows: union → flat analysis table
import './mill/query.js';        // → runQuery: structured (shareable) query over a table
import * as loom from '../../vendor/loom.js';   // virtualized canvas grid (namespace-wrapped)
import * as plot from '../../vendor/plot.js';   // matplotlib-style charts (namespace-wrapped)
import * as capsule from '../../vendor/capsule.js';   // @gcu/capsule — share an analysis (namespace-wrapped)
import '../../vendor/qrcodegen.js';             // Nayuki QR gen → `qrcodegen` global (share QR)
import './surface/contract.js';  // → bootSurface: the mount(ctx) → dispose host adapter (DECISIONS §14)
import './mill/ui.js';           // → mountMill: the query builder + grid + chart
import './mill/boot.js';         // entry: open an archive → store → mountMill
