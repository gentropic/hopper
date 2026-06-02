import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from '../vendor/sheetjs.mjs';
import { workbookToTree } from '../src/js/formsource/xlsx.js';
import { treeToXlsform } from '../src/js/xlsform/index.js';

// Full round-trip through a real .xlsx: a §8 tree → XLSForm sheets → SheetJS
// writes an xlsx → SheetJS reads it → our converter → tree. Proves the binary
// parse + the survey/choices/settings extraction the ODK on-ramp depends on.
test('xlsx → tree via SheetJS (round-trip a real .xlsx binary)', () => {
  const tree0 = {
    type: 'form',
    meta: { id: 'qf', title: 'QF Sample Log', version: '1', lang: 'en' },
    fields: [
      { name: 'site_id', fieldType: 'text', label: 'Site ID', props: { required: true } },
      { name: 'lithology', fieldType: 'select', label: 'Lithology', props: { list: 'litho' } },
      { name: 'fe_pct', fieldType: 'number', label: 'Fe %', props: {} },
    ],
    choices: { litho: [{ value: 'itabirite', label: 'itabirite' }, { value: 'canga', label: 'canga' }] },
    rules: [{ verb: 'constrain', target: 'fe_pct', expr: 'fe_pct between 0 and 100', message: '0–100' }],
    views: [],
  };

  const { survey, choices, settings } = treeToXlsform(tree0);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(survey), 'survey');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(choices), 'choices');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(settings), 'settings');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });

  const { tree, warnings } = workbookToTree(XLSX, buf);
  assert.equal(tree.type, 'form');
  assert.equal(tree.meta.id, 'qf');
  assert.equal(tree.fields.find((f) => f.name === 'fe_pct').fieldType, 'number');
  assert.equal(tree.fields.find((f) => f.name === 'lithology').props.list, 'litho');
  assert.equal(tree.fields.find((f) => f.name === 'site_id').props.required, true);
  assert.deepEqual(tree.choices.litho.map((c) => c.value), ['itabirite', 'canga']);
  assert.equal(tree.rules.find((r) => r.verb === 'constrain' && r.target === 'fe_pct').expr, 'fe_pct between 0 and 100');
  assert.deepEqual(warnings, []);
});
