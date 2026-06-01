# reference/

Working reference implementations produced during design. They are *correct and
tested* but are single-file prototypes, not the shipped modules — port them into
`src/` against the specs.

- **hopper-renderer.html** — tree-walk renderer: reactive recompute, rules
  (`relevant` / `require` / `constrain` / `show`) via a small expression
  evaluator, required + constraint validation, append-only in-memory records.
  Vendors the real `@gcu/yaml` in its Source tab. Open in a browser and try the
  presets (QF Sample Log, Daily Safety).
- **hopper-xlsform.js** — XLSForm ↔ tree converter with the bidirectional
  expression bridge (XPath ↔ soft, common subset). Pure functions over
  SheetJS-shaped rows; round-trip tested. `window.HopperXLSForm` in the browser,
  or import in Node.

Stubbed in the renderer prototype: capture widgets, persistence (in-memory
only), and the real transpiler. See SPEC-hopper-form for what the production
engine must add.
