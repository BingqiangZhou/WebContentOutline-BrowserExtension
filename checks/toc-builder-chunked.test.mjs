/**
 * Characterization + cancellation tests for the (async, batched) TOC build.
 *
 * - The three "characterization" tests pin current output across batch
 *   boundaries. They pass on the OLD synchronous code (await unwraps a plain
 *   object) AND must keep passing after the build becomes async + chunked,
 *   proving the refactor does not change results.
 * - The "abort" test is a RED test for NEW behavior: an AbortSignal must let a
 *   build short-circuit. It fails on the old synchronous code (which ignores
 *   the signal) and passes once cancellation is wired in.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax, stripImportsAndExports, loadDedupeMirrorItems } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function createVisibleElement(tagName, text) {
  return {
    tagName: tagName,
    textContent: text,
    isConnected: true,
    offsetParent: {},
    offsetWidth: 120,
    offsetHeight: 24,
    parentElement: null,
    getAttribute: function () { return null; },
    getBoundingClientRect: function () {
      return { top: 0, right: 120, bottom: 24, left: 0, width: 120, height: 24 };
    }
  };
}

function loadBuilder(setup) {
  setup = setup || {};
  var calls = { collectBySelector: 0 };
  var file = path.join(repoRoot, 'src/utils/toc-builder.ts');
  var source = stripImportsAndExports(stripTsSyntax(fs.readFileSync(file, 'utf8')));
  var sandbox = {
    console: console,
    uiConst: function (_n, f) { return f; },
    collectBySelector: function () { calls.collectBySelector++; return setup.collectElements || []; },
    uniqueInDocumentOrder: function (nodes) { return nodes; },
    getBoundedText: function (el) { return el.textContent || ''; },
    document: { documentElement: { scrollWidth: 1200, scrollHeight: 900 } },
    window: {
      getComputedStyle: function () {
        return { display: 'block', position: 'static', visibility: 'visible', opacity: '1', clipPath: 'none' };
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
  vm.runInNewContext(source + '\n__exports.buildTocItemsFromSelectors = buildTocItemsFromSelectors;', sandbox, { filename: file });
  return { buildTocItemsFromSelectors: sandbox.__exports.buildTocItemsFromSelectors, calls: calls };
}

function makeElements(n) {
  var arr = [];
  for (var i = 0; i < n; i++) arr.push(createVisibleElement('H2', 'T' + i));
  return arr;
}

// ---- Characterization: identical output before & after the async refactor ----

test('builds all visible candidates across batch boundaries (>64 elements)', async () => {
  var env = loadBuilder({ collectElements: makeElements(200) });
  var result = await env.buildTocItemsFromSelectors([{ type: 'css', expr: 'h2' }], {});

  // NOTE: compare via primitives only — result arrays come from the vm sandbox
  // (different Array.prototype), so deepEqual/deepStrictEqual rejects them as
  // "not reference-equal" even when contents match.
  assert.equal(result.items.length, 200, 'all candidates survive');
  assert.equal(
    result.items.slice(0, 5).map(function (it) { return it.text; }).join(','),
    'T0,T1,T2,T3,T4',
    'document order preserved'
  );
  assert.equal(result.items.every(function (it) { return it.level === 2; }), true, 'all level 2');
  assert.equal(result.meta.truncated, false);
  assert.equal(result.meta.totalCandidates, 200);
});

test('one element over a batch boundary (65) still yields an identical result', async () => {
  var env = loadBuilder({ collectElements: makeElements(65) });
  var result = await env.buildTocItemsFromSelectors([{ type: 'css', expr: 'h2' }], {});
  assert.equal(result.items.length, 65);
});

test('zero candidates returns an empty result', async () => {
  var env = loadBuilder({ collectElements: [] });
  var result = await env.buildTocItemsFromSelectors([{ type: 'css', expr: 'h2' }], {});
  assert.equal(result.items.length, 0);
});

// ---- New behavior: AbortSignal cancellation (RED until implemented) ----

test('a pre-aborted signal short-circuits before any collection', async () => {
  var env = loadBuilder({ collectElements: makeElements(200) });
  var result = await env.buildTocItemsFromSelectors([{ type: 'css', expr: 'h2' }], {}, { aborted: true });

  assert.equal(result.aborted, true);
  assert.equal(result.items, undefined, 'aborted build must not return items');
  assert.equal(env.calls.collectBySelector, 0, 'collection must not run when aborted at entry');
});
