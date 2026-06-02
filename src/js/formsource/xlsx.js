// XLSForm (.xlsx) form source — SheetJS parses the binary into the survey/choices/
// settings rows our converter already eats (SPEC-hopper-form §9). The ODK on-ramp.
//
// SheetJS is large (~900 kB); it's vendored and bundled for now (a known
// lazy-load optimization for later). `workbookToTree` takes the XLSX module
// injected so it's node-testable; `loadXlsx` uses the bundled one.

import * as sheetjs from '../../../vendor/sheetjs.mjs';
import { xlsformToTree } from '../xlsform/index.js';

export function workbookToTree(XLSX, arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const sheet = (name) => {
    const ws = wb.Sheets[name] || wb.Sheets[name[0].toUpperCase() + name.slice(1)];
    return ws ? XLSX.utils.sheet_to_json(ws, { defval: '' }) : [];
  };
  return xlsformToTree({ survey: sheet('survey'), choices: sheet('choices'), settings: sheet('settings') });
}

export const loadXlsx = (arrayBuffer) => workbookToTree(sheetjs, arrayBuffer);
