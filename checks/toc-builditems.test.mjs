import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax, loadDedupeMirrorItems } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function visibleHeading(tag, text, rect) {
  rect = rect || { top: 0, right: 120, bottom: 24, left: 0, width: 120, height: 24 };
  return {
    tagName: tag,
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

function loadBuildTocItems(setup) {
  setup = setup || {};
  var calls = { collectBySelector: [], chatbotCalled: 0, confidence: 0 };
  var file = path.join(repoRoot, 'src/utils/toc-builder.ts');
  var source = stripTsSyntax(fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\r?\n/gm, '')
    .replace(/export function /g, 'function '));
  var sandbox = {
    console: console,
    uiConst: function (n, f) { return f; },
    collectBySelector: function (selector, _budget) {
      calls.collectBySelector.push(selector);
      return setup.collectElements || [];
    },
    uniqueInDocumentOrder: function (nodes) { return nodes; },
    getBoundedText: function (el) { return el.textContent || ''; },
    detectContentRegion: function () {
      return { root: setup.regionRoot !== undefined ? setup.regionRoot : null, source: setup.regionSource || 'fallback' };
    },
    getChatbotConfidence: function () { calls.confidence = setup.confidence || 0; return setup.confidence || 0; },
    tryBuildChatbotTocItems: function () {
      calls.chatbotCalled++;
      return setup.chatbotResult !== undefined ? setup.chatbotResult : null;
    },
    getChatbotSentinelSelector: function () { return setup.sentinel || null; },
    document: { documentElement: { scrollWidth: 1200, scrollHeight: 900 } },
    window: {
      getComputedStyle: function () {
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
  vm.runInNewContext(source + '\n__exports.buildTocItems = buildTocItems;', sandbox, { filename: file });
  return { buildTocItems: sandbox.__exports.buildTocItems, calls: calls };
}

test('custom selectors are scoped to the detected content region', () => {
  var mainRoot = { id: 'main-root' };
  var env = loadBuildTocItems({
    confidence: 0,
    regionRoot: mainRoot,
    regionSource: 'landmark',
    collectElements: [visibleHeading('H2', 'In content')]
  });

  env.buildTocItems({ selectors: [{ type: 'css', expr: 'h2' }] });

  assert.equal(env.calls.collectBySelector.length, 1);
  assert.strictEqual(
    env.calls.collectBySelector[0]._root, mainRoot,
    'custom selector should run against the detected content region root'
  );
});

test('custom selectors are not scoped when region detection falls back', () => {
  var env = loadBuildTocItems({
    confidence: 0,
    regionRoot: null,
    regionSource: 'fallback',
    collectElements: [visibleHeading('H2', 'x')]
  });

  env.buildTocItems({ selectors: [{ type: 'css', expr: 'h2' }] });

  assert.equal(env.calls.collectBySelector[0]._root, undefined, 'no root injected on fallback');
});

test('user-defined selectors take priority over chatbot detection', () => {
  var env = loadBuildTocItems({
    confidence: 0.9,
    chatbotResult: { items: [{ id: 'c', text: 'chat item', level: 1, source: 'user' }], meta: {} },
    collectElements: [visibleHeading('H2', 'My heading')]
  });

  var result = env.buildTocItems({ selectors: [{ type: 'css', expr: 'h2' }] });

  assert.equal(env.calls.chatbotCalled, 0, 'chatbot builder must not run when user selectors exist');
  assert.ok(env.calls.collectBySelector.length >= 1, 'custom extraction path should run');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].text, 'My heading');
});

test('default auto selector includes ARIA role=heading', () => {
  var env = loadBuildTocItems({ confidence: 0, regionRoot: null, regionSource: 'fallback', collectElements: [] });

  env.buildTocItems({ selectors: [] });

  assert.equal(env.calls.collectBySelector.length, 1);
  assert.match(env.calls.collectBySelector[0].expr, /\[role="heading"\]/);
});

test('chatbot still runs after the sentinel is injected (later rebuilds)', () => {
  // Regression: the chatbot branch injects a sentinel into cfg.selectors so the
  // DOM watcher tracks message mutations. cfg persists across rebuilds, so on
  // the 2nd+ rebuild cfg.selectors already holds the sentinel. The sentinel must
  // NOT count as a user-configured selector (otherwise the chatbot path gets
  // permanently disabled and AI replies disappear).
  var env = loadBuildTocItems({
    confidence: 0.9,
    sentinel: '[data-message-author-role]',
    chatbotResult: { items: [{ id: 'c', text: 'AI reply', level: 2, source: 'ai' }], meta: {} }
  });

  var cfg = {
    selectors: [{ type: 'css', expr: '[data-message-author-role]', _tocSentinel: true }]
  };
  var result = env.buildTocItems(cfg);

  assert.equal(env.calls.chatbotCalled, 1, 'chatbot must run even when the sentinel is present');
  assert.equal(result.items[0].text, 'AI reply');
});

test('injected sentinel is marked and injected only once', () => {
  var env = loadBuildTocItems({
    confidence: 0.9,
    sentinel: '[data-message-author-role]',
    chatbotResult: { items: [{ id: 'c', text: 'AI reply', level: 2 }], meta: {} }
  });
  var cfg = { selectors: [] };

  env.buildTocItems(cfg);
  var sentinels = cfg.selectors.filter(function (s) { return s._tocSentinel; });
  assert.equal(sentinels.length, 1, 'sentinel injected once');
  assert.equal(sentinels[0].expr, '[data-message-author-role]');

  env.calls.chatbotCalled = 0;
  env.buildTocItems(cfg);
  var sentinels2 = cfg.selectors.filter(function (s) { return s._tocSentinel; });
  assert.equal(sentinels2.length, 1, 'sentinel not double-injected');
});
