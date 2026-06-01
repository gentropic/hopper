// Zero-dependency build for @gcu/hopper (weir/cradle pattern).
//
// Dev workflow: edit files under src/, run `node build.js`, open the artifact.
// The single-file HTML IS the artifact — there is no separate dev page.
//
// Surfaces, not apps (DECISIONS §7): the same src/ builds into different entry
// HTMLs via `--target=`. `collector` (default) today; `jig` / `mill` later —
// they add a manifest + template, nothing else changes.
//
// What it does:
//   1. Inlines src/js/ modules — the target's main.<x>.js is an ordered import
//      manifest; each relative import is read, its import/export syntax stripped,
//      and the bodies concatenated in order (globals-in-scope).
//   2. Inlines src/style.css.
//   3. Fills src/template.html and writes <target>.html at the repo root.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

const TARGETS = {
  collector: { manifest: 'src/js/main.js', template: 'src/template.html', out: 'collector.html', title: 'Hopper' },
  // jig:  { manifest: 'src/js/main.jig.js',  template: 'src/template.html', out: 'jig.html',  title: 'Hopper · jig'  },
  // mill: { manifest: 'src/js/main.mill.js', template: 'src/template.html', out: 'mill.html', title: 'Hopper · mill' },
};

const target = process.argv.slice(2).find(a => a.startsWith('--target='))?.split('=')[1] || 'collector';
const cfg = TARGETS[target];
if (!cfg) { console.error(`unknown target: ${target} (have: ${Object.keys(TARGETS).join(', ')})`); process.exit(1); }

// Strip ES-module syntax so a module's top-level declarations land as globals in
// the single concatenated <script>. (Same approach as auditable/weir build.js.)
function stripModuleSyntax(src) {
  src = src.replace(/^import\b[\s\S]*?from\s+['"][^'"]*['"];?[ \t]*(?:\/\/[^\n]*)?$/gm, '');
  src = src.replace(/^import\s+['"][^'"]*['"];?[ \t]*(?:\/\/[^\n]*)?$/gm, '');
  src = src.replace(/^export function /gm, 'function ');
  src = src.replace(/^export async function /gm, 'async function ');
  src = src.replace(/^export const /gm, 'const ');
  src = src.replace(/^export let /gm, 'let ');
  src = src.replace(/^export class /gm, 'class ');
  src = src.replace(/^export\s*\{[\s\S]*?\}\s*;?\s*$/gm, '');
  src = src.replace(/^export\s+default\s+/gm, '');
  return src.replace(/^\n+/, '').replace(/\n+$/, '');
}

// Read the manifest, follow its relative imports in declared order, inline each
// once. The manifest is imports-only by convention (no body runs from it).
function inlineModules(manifestPath) {
  const manifestDir = dirname(manifestPath);
  const importPaths = [];
  for (const raw of readFileSync(manifestPath, 'utf8').split('\n')) {
    const m = raw.replace(/\r$/, '').match(/^import\s+.*['"](\.\.?\/.+?)['"];?\s*(?:\/\/.*)?$/);
    if (m) importPaths.push(m[1]);
  }
  const chunks = [];
  const seen = new Set();
  for (const rel of importPaths) {
    const file = resolve(manifestDir, rel);
    if (seen.has(file)) continue;
    seen.add(file);
    if (!existsSync(file)) { console.error(`import not found: ${rel} (from ${relative(ROOT, manifestPath)})`); process.exit(1); }
    const label = relative(ROOT, file).replace(/\\/g, '/');
    chunks.push(`// ── ${label} ──\n${stripModuleSyntax(readFileSync(file, 'utf8'))}`);
  }
  return chunks.join('\n\n');
}

const css = readFileSync(resolve(ROOT, 'src/style.css'), 'utf8');
const js = inlineModules(resolve(ROOT, cfg.manifest));
const tpl = readFileSync(resolve(ROOT, cfg.template), 'utf8');

// Function replacers — the CSS/JS payloads contain `$` (template literals), which
// a string replacement would mis-interpret as `$&`/`$$` patterns.
const html = tpl
  .replace('{{TITLE}}', () => cfg.title)
  .replace('{{STYLE}}', () => `<style>\n${css}\n</style>`)
  .replace('{{SCRIPT}}', () => `<script>\n"use strict";\n${js}\n</script>`);

writeFileSync(resolve(ROOT, cfg.out), html);
console.log(`built ${cfg.out} (${(html.length / 1024).toFixed(1)} kB) — target=${target}`);
