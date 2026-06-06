import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function createVisibleElement(tagName, text) {
  return {
    tagName,
    textContent: text,
    isConnected: true,
    offsetParent: {},
    offsetWidth: 120,
    offsetHeight: 24,
    parentElement: null,
    getBoundingClientRect() {
      return { top: 0, right: 120, bottom: 24, left: 0, width: 120, height: 24 };
    }
  };
}

function loadBuilder(elements) {
  const file = path.join(repoRoot, 'src/utils/toc-builder.ts');
  const source = stripTsSyntax(fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\r?\n/gm, '')
    .replace(/export function /g, 'function '));
  const sandbox = {
    console,
    uiConst(name, fallback) { return fallback; },
    collectBySelector() { return elements; },
    uniqueInDocumentOrder(nodes) { return nodes; },
    document: { documentElement: { scrollWidth: 1200, scrollHeight: 900 } },
    window: {
      getComputedStyle() {
        return { display: 'block', position: 'static', visibility: 'visible', opacity: '1' };
      }
    },
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${source}\n__exports.buildTocItemsFromSelectors = buildTocItemsFromSelectors;`,
    sandbox,
    { filename: file }
  );
  return sandbox.__exports.buildTocItemsFromSelectors;
}

test('toc builder preserves semantic heading levels and defaults custom elements to level two', () => {
  const buildTocItemsFromSelectors = loadBuilder([
    createVisibleElement('H1', 'Overview'),
    createVisibleElement('H4', 'Details'),
    createVisibleElement('DIV', 'Custom section')
  ]);

  const result = buildTocItemsFromSelectors([{ type: 'css', expr: 'h1, h4, div' }], {});

  assert.deepEqual(
    Array.from(result.items, (item) => item.level),
    [1, 4, 2]
  );
});

