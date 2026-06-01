import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytesToB64Url, contentAddress, streamId, utf8 } from '../src/js/records/address.js';

test('bytesToB64Url — RFC 4648 §5 vectors, unpadded, URL-safe', () => {
  assert.equal(bytesToB64Url(utf8('')), '');
  assert.equal(bytesToB64Url(utf8('f')), 'Zg');
  assert.equal(bytesToB64Url(utf8('fo')), 'Zm8');
  assert.equal(bytesToB64Url(utf8('foo')), 'Zm9v');
  assert.equal(bytesToB64Url(utf8('foob')), 'Zm9vYg');
  // URL-safe alphabet: bytes that map to + / in standard base64 become - _
  assert.equal(bytesToB64Url(new Uint8Array([0xff, 0xff, 0xff])), '____');
  assert.equal(bytesToB64Url(new Uint8Array([0xfb, 0xff, 0xbf])), '-_-_');
});

test('contentAddress — sha256("hello"), prefixed + base64url', async () => {
  // sha256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
  assert.equal(await contentAddress(utf8('hello')),
    'sha256-LPJNul-wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ');
});

test('streamId — shape, determinism, and epoch-sensitivity', async () => {
  const id = await streamId('pubAAA', 'deviceX', 'epoch1');
  assert.match(id, /^[A-Za-z0-9_-]{22}$/, '22-char url-safe handle');
  assert.equal(id, await streamId('pubAAA', 'deviceX', 'epoch1'), 'deterministic');
  assert.notEqual(id, await streamId('pubAAA', 'deviceX', 'epoch2'), 'epoch changes the stream');
  assert.notEqual(id, await streamId('pubBBB', 'deviceX', 'epoch1'), 'pubkey changes the stream');
  // length-prefixed join: ("a","bc") and ("ab","c") must not collide
  assert.notEqual(await streamId('a', 'bc', 'e'), await streamId('ab', 'c', 'e'));
});
