import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadBoundedText() {
  var file = path.join(repoRoot, 'src/utils/bounded-text.ts');
  var source = stripTsSyntax(fs.readFileSync(file, 'utf8')
    .replace(/export function /g, 'function '));
  var sandbox = { __exports: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    source + '\n__exports.getBoundedText = getBoundedText;',
    sandbox,
    { filename: file }
  );
  return sandbox.__exports.getBoundedText;
}

function textNode(value) {
  return { nodeType: 3, nodeValue: value, childNodes: [] };
}
function el(children, opts) {
  opts = opts || {};
  return {
    nodeType: 1,
    getAttribute: function (attr) {
      if (attr === 'aria-hidden') return opts.ariaHidden ? 'true' : null;
      return null;
    },
    className: opts.className || '',
    childNodes: children
  };
}

test('getBoundedText includes plain descendant text', () => {
  var getBoundedText = loadBoundedText();
  var root = el([textNode('Hello '), el([textNode('world')])]);
  assert.equal(getBoundedText(root, { maxChars: 1000 }), 'Hello world');
});

test('getBoundedText excludes aria-hidden child text', () => {
  var getBoundedText = loadBoundedText();
  var root = el([
    textNode('Visible '),
    el([textNode('screen-reader only')], { ariaHidden: true })
  ]);
  assert.equal(getBoundedText(root, { maxChars: 1000 }).trim(), 'Visible');
});

test('getBoundedText excludes sr-only / visually-hidden child text', () => {
  var getBoundedText = loadBoundedText();
  var root = el([
    textNode('Heading '),
    el([textNode('sr-only label')], { className: 'sr-only' }),
    el([textNode('visually-hidden label')], { className: 'link visually-hidden' }),
    el([textNode('cdk label')], { className: 'cdk-visually-hidden' }),
    el([textNode('anchor glyph')], { ariaHidden: true })
  ]);
  assert.equal(getBoundedText(root, { maxChars: 1000 }).trim(), 'Heading');
});
