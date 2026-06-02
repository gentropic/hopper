import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as capsule from '../vendor/capsule.js';
import { normalizeCapsuleInput, resolveFormCapsule } from '../src/js/formsource/capsule.js';
import { loadFormFromText } from '../src/js/formsource/load.js';

const FORM = { type: 'form', meta: { id: 'cap', title: 'Capsule Form' }, fields: [{ name: 'q', fieldType: 'text', label: 'Q', props: {} }], choices: {}, rules: [], views: [] };

test('loadFormFromText sniffs JSON vs @gcu/yaml', () => {
  const fromJson = loadFormFromText(JSON.stringify(FORM));
  assert.equal(fromJson.meta.title, 'Capsule Form');
  const yamlSrc = 'type: "form"\nmeta:\n  id: "y"\n  title: "Y"\nfields:\n  - name: "a"\n    fieldType: "text"\n    label: "A"\n';
  const fromYaml = loadFormFromText(yamlSrc);
  assert.equal(fromYaml.meta.title, 'Y');
  assert.equal(fromYaml.fields[0].name, 'a');
  assert.throws(() => loadFormFromText('{"type":"notform"}'), /not a Hopper form/);
});

test('normalizeCapsuleInput: bare capsule, share-URL fragment, plain web URL', () => {
  assert.equal(normalizeCapsuleInput('  q:dABC  '), 'q:dABC', 'bare capsule trimmed, passed through');
  assert.equal(normalizeCapsuleInput('gh:owner/repo/form.json'), 'gh:owner/repo/form.json');
  // a share URL carries the (fragment-encoded) capsule in its #part
  const cap = 'q:dHELLO';
  const url = 'https://host.example/app/#' + capsule.fragmentEncode(cap);
  assert.equal(normalizeCapsuleInput(url), cap, 'fragment-decoded back to the capsule');
  // a plain web URL with no fragment → fetch it via url:
  assert.equal(normalizeCapsuleInput('https://host.example/form.json'), 'url:https://host.example/form.json');
});

test('resolveFormCapsule: inline capsule → form tree (offline, no network)', async () => {
  const cap = await capsule.encodeInline(JSON.stringify(FORM), { form: 'q' });
  const tree = await resolveFormCapsule(cap);
  assert.equal(tree.type, 'form');
  assert.equal(tree.meta.title, 'Capsule Form');
  assert.equal(tree.fields[0].name, 'q');
});

test('resolveFormCapsule: full share URL (capsule in the #fragment) → form tree', async () => {
  const cap = await capsule.encodeInline(JSON.stringify(FORM), { form: 'q' });
  const url = 'https://gentropic.org/hopper/#' + capsule.fragmentEncode(cap);
  const tree = await resolveFormCapsule(url);
  assert.equal(tree.meta.id, 'cap');
});

test('resolveFormCapsule: non-form payload rejects clearly', async () => {
  const cap = await capsule.encodeInline(JSON.stringify({ hello: 'world' }), { form: 'i' });
  await assert.rejects(() => resolveFormCapsule(cap), /not a Hopper form/);
});
