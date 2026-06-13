import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax, stripImportsAndExports, loadDedupeMirrorItems } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function visibleElement(tagName, text, rect) {
  rect = rect || { top: 0, right: 120, bottom: 24, left: 0, width: 120, height: 24 };
  return {
    tagName: tagName,
    textContent: text,
    isConnected: true,
    offsetParent: {},
    offsetWidth: 120,
    offsetHeight: 24,
    parentElement: null,
    getAttribute: function () { return null; },
    getBoundingClientRect: function () { return rect; }
  };
}

function loadBuilder(elements) {
  const file = path.join(repoRoot, 'src/utils/toc-builder.ts');
  const source = stripImportsAndExports(stripTsSyntax(fs.readFileSync(file, 'utf8')));
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
    dedupeMirrorItems: loadDedupeMirrorItems(),
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

test('repeated same-text headings at different positions are both kept', async () => {
  const build = loadBuilder([
    visibleElement('H2', 'References', { top: 100, right: 120, bottom: 124, left: 0, width: 120, height: 24 }),
    visibleElement('H2', 'References', { top: 800, right: 120, bottom: 824, left: 0, width: 120, height: 24 })
  ]);

  const result = await build([{ type: 'css', expr: 'h2' }], {});

  assert.equal(result.items.length, 2, 'two same-named sections at different positions survive dedup');
});

test('genuine mirror headings at the same position are still deduped', async () => {
  const rect = { top: 100, right: 120, bottom: 124, left: 0, width: 120, height: 24 };
  const build = loadBuilder([
    visibleElement('H2', 'Title', rect),
    visibleElement('H2', 'Title', rect)
  ]);

  const result = await build([{ type: 'css', expr: 'h2' }], {});

  assert.equal(result.items.length, 1, 'overlapping mirror copy is collapsed');
});
