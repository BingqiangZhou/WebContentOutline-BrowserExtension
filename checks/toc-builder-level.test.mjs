import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function createVisibleElement(tagName, text, opts) {
  opts = opts || {};
  const rect = opts.rect || { top: 0, right: 120, bottom: 24, left: 0, width: 120, height: 24 };
  return {
    tagName,
    textContent: text,
    isConnected: true,
    offsetParent: {},
    offsetWidth: 120,
    offsetHeight: 24,
    parentElement: null,
    getAttribute(attr) {
      if (attr === 'aria-level') return opts.ariaLevel != null ? String(opts.ariaLevel) : null;
      return null;
    },
    getBoundingClientRect() {
      return rect;
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
    getBoundedText(el) { return el.textContent || ''; },
    document: { documentElement: { scrollWidth: 1200, scrollHeight: 900 } },
    window: {
      getComputedStyle() {
        return { display: 'block', position: 'static', visibility: 'visible', opacity: '1' };
      }
    },
    TOC_MAX_CANDIDATES: 1200,
    TOC_TEXT_MAX_LEN: 200,
    TOC_MAX_ITEMS: 400,
    HEADING_LEVEL_WEIGHTS: { H1: 40, H2: 100, H3: 80, H4: 60, H5: 20, H6: 10 },
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

test('ARIA heading level (aria-level) is honored for non-h* elements', () => {
  const buildTocItemsFromSelectors = loadBuilder([
    createVisibleElement('H2', 'Real h2'),
    createVisibleElement('DIV', 'ARIA level 3', { ariaLevel: 3 }),
    createVisibleElement('DIV', 'No aria-level defaults to 2')
  ]);

  const result = buildTocItemsFromSelectors([{ type: 'css', expr: 'h2, div' }], {});

  assert.deepEqual(
    Array.from(result.items, (item) => item.level),
    [2, 3, 2]
  );
});

test('documents using all six heading levels keep their deep levels', () => {
  const buildTocItemsFromSelectors = loadBuilder([
    createVisibleElement('H1', 'One'),
    createVisibleElement('H2', 'Two'),
    createVisibleElement('H3', 'Three'),
    createVisibleElement('H4', 'Four'),
    createVisibleElement('H5', 'Five'),
    createVisibleElement('H6', 'Six')
  ]);

  const result = buildTocItemsFromSelectors([{ type: 'css', expr: 'h1, h2, h3, h4, h5, h6' }], {});

  // Before the fix the top-3 proportionality filter amputated h4/h5/h6.
  assert.deepEqual(
    Array.from(result.items, (item) => item.el.tagName),
    ['H1', 'H2', 'H3', 'H4', 'H5', 'H6']
  );
});

test('icon/glyph-only headings are dropped as noise', () => {
  const buildTocItemsFromSelectors = loadBuilder([
    createVisibleElement('H2', '#'),
    createVisibleElement('H2', 'Real title'),
    createVisibleElement('H2', '¶')
  ]);

  const result = buildTocItemsFromSelectors([{ type: 'css', expr: 'h2' }], {});

  assert.deepEqual(
    Array.from(result.items, (item) => item.text),
    ['Real title']
  );
});

