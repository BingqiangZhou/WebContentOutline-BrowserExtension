import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax, stripImportsAndExports } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDedupeMirrorItems() {
  var file = path.join(repoRoot, 'src/utils/core-utils.ts');
  var source = stripImportsAndExports(stripTsSyntax(fs.readFileSync(file, 'utf8')));
  var sandbox = { console: console, location: { protocol: 'https:', host: 'example.com' }, __exports: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source + '\n__exports.dedupeMirrorItems = dedupeMirrorItems;', sandbox, { filename: file });
  return sandbox.__exports.dedupeMirrorItems;
}

test('keeps same-text items at different positions (repeated sections survive)', () => {
  var dedupeMirrorItems = loadDedupeMirrorItems();
  var out = dedupeMirrorItems([
    { id: '1', text: 'Summary', _pos: { left: 0, top: 100, right: 100, bottom: 130 } },
    { id: '2', text: 'Summary', _pos: { left: 0, top: 800, right: 100, bottom: 830 } }
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0]._pos, undefined, '_pos is stripped from the result');
});

test('dedupes same-text items at the same position (mirror copy)', () => {
  var dedupeMirrorItems = loadDedupeMirrorItems();
  var rect = { left: 0, top: 100, right: 100, bottom: 130 };
  var out = dedupeMirrorItems([
    { id: '1', text: 'Title', _pos: rect },
    { id: '2', text: 'Title', _pos: rect }
  ]);
  assert.equal(out.length, 1);
});

test('items without _pos are never deduped (no false mirror collapse)', () => {
  var dedupeMirrorItems = loadDedupeMirrorItems();
  var out = dedupeMirrorItems([
    { id: '1', text: 'Continue' },
    { id: '2', text: 'Continue' }
  ]);
  assert.equal(out.length, 2);
});
