import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax, stripImportsAndExports } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadIsTocContentIdentical() {
  var file = path.join(repoRoot, 'src/utils/core-utils.ts');
  var source = stripImportsAndExports(stripTsSyntax(fs.readFileSync(file, 'utf8')));
  var sandbox = {
    console: console,
    location: { protocol: 'https:', host: 'example.com' },
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    source + '\n__exports.isTocContentIdentical = isTocContentIdentical;',
    sandbox,
    { filename: file }
  );
  return sandbox.__exports.isTocContentIdentical;
}

test('a level change on the same element/text is not identical (forces a rebuild)', () => {
  var isTocContentIdentical = loadIsTocContentIdentical();
  var el = {};
  // Same element + same text, but aria-level changed 2 -> 3.
  var prev = [{ text: 'Heading', el: el, level: 2 }];
  var next = [{ text: 'Heading', el: el, level: 3 }];
  assert.equal(isTocContentIdentical(prev, next), false);
});

test('same text, element, and level is identical', () => {
  var isTocContentIdentical = loadIsTocContentIdentical();
  var el = {};
  var prev = [{ text: 'Heading', el: el, level: 2 }];
  var next = [{ text: 'Heading', el: el, level: 2 }];
  assert.equal(isTocContentIdentical(prev, next), true);
});

test('different length is not identical', () => {
  var isTocContentIdentical = loadIsTocContentIdentical();
  assert.equal(isTocContentIdentical([{ text: 'A', el: {}, level: 1 }], []), false);
});

test('different text or element is not identical', () => {
  var isTocContentIdentical = loadIsTocContentIdentical();
  var el = {};
  assert.equal(
    isTocContentIdentical([{ text: 'A', el: el, level: 1 }], [{ text: 'B', el: el, level: 1 }]),
    false
  );
  assert.equal(
    isTocContentIdentical([{ text: 'A', el: el, level: 1 }], [{ text: 'A', el: {}, level: 1 }]),
    false
  );
});
