/**
 * css-selector.ts: identifiers in generated selectors must be valid CSS.
 *
 * The element picker turns the picked element's classes/id into a selector.
 * Escaping only the non-word characters produced `.2xl\:flex` for a Tailwind
 * breakpoint class — `querySelector` rejects it (an identifier may not start
 * with a digit), so the saved selector matched nothing and the TOC stayed empty.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { moduleScript } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Runs the real css-selector.ts. Node has no global `CSS`, so unless one is
// passed in these tests exercise the hand-rolled fallback.
function loadCssSelector(extras = {}) {
  const file = path.join(repoRoot, 'src/utils/css-selector.ts');
  const sandbox = { CSS_PATH_MAX_DEPTH: 20, __exports: {}, ...extras };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    moduleScript(fs.readFileSync(file, 'utf8')) +
    '\n__exports.buildClassSelector = buildClassSelector;\n__exports.cssPathFor = cssPathFor;',
    sandbox,
    { filename: file }
  );
  return sandbox.__exports;
}

test('a class that starts with a digit is escaped into a valid identifier', () => {
  const { buildClassSelector } = loadCssSelector();
  // Tailwind's 2xl breakpoint: `.2xl\:flex` is a SyntaxError in querySelector.
  assert.equal(buildClassSelector({ classList: ['2xl:flex', 'items-center'] }), '.\\32 xl\\:flex.items-center');
});

test('a class that starts with a hyphen and a digit is escaped into a valid identifier', () => {
  const { buildClassSelector } = loadCssSelector();
  assert.equal(buildClassSelector({ classList: ['-2x'] }), '.-\\32 x');
});

test('an id that starts with a digit is escaped into a valid identifier', () => {
  const { cssPathFor } = loadCssSelector();
  assert.equal(cssPathFor({ nodeType: 1, tagName: 'DIV', id: '2col', classList: [], parentElement: null }), 'div#\\32 col');
});

test('the platform\'s CSS.escape is used when it exists', () => {
  // In a browser CSS.escape covers every identifier edge case; ours is only the fallback.
  const { buildClassSelector } = loadCssSelector({ CSS: { escape: (value) => 'E(' + value + ')' } });
  assert.equal(buildClassSelector({ classList: ['a b'] }), '.E(a b)');
});
