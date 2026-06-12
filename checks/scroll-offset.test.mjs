import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadScrollToElement(mocks) {
  var file = path.join(repoRoot, 'src/utils/dom-utils.ts');
  var source = stripTsSyntax(fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\r?\n/gm, '')
    .replace(/export\s+async\s+function /g, 'async function ')
    .replace(/export function /g, 'function '));
  var sandbox = {
    console: console,
    Date: Date,
    document: mocks.document,
    window: mocks.window,
    SCROLL_TOP_PADDING: 80,
    HEADER_CACHE_TTL: 5000,
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source + '\n__exports.scrollToElement = scrollToElement;', sandbox, { filename: file });
  return sandbox.__exports.scrollToElement;
}

test('scrollToElement accounts for a fixed overlay header covering the scroll area (IDE-style layout)', () => {
  // A non-semantic fixed div header (120px) covers the top of the chat scroll
  // area — the kind detectFixedHeaderHeight misses (not header/nav/banner).
  var headerEl = {
    getBoundingClientRect: function () { return { top: 0, left: 0, right: 1000, bottom: 120, width: 1000, height: 120 }; }
  };
  var scrollToCalls = [];
  var scrollContainer = {
    getBoundingClientRect: function () { return { top: 0, left: 0, right: 1000, width: 1000, height: 800 }; },
    scrollTop: 0,
    scrollHeight: 2000,
    clientHeight: 800,
    scrollTo: function (opts) { scrollToCalls.push(opts); },
    parentElement: null
  };
  var target = {
    getBoundingClientRect: function () { return { top: 500, left: 0, right: 1000, width: 1000, height: 30 }; },
    parentElement: scrollContainer
  };
  var scrollToElement = loadScrollToElement({
    document: {
      documentElement: { nodeType: 9 },
      body: { parentElement: null },
      querySelectorAll: function () { return []; }, // no semantic header
      elementsFromPoint: function () { return [headerEl, scrollContainer]; }
    },
    window: {
      innerWidth: 1000,
      matchMedia: function () { return { matches: false }; },
      getComputedStyle: function (el) {
        if (el === headerEl) return { position: 'fixed' };
        if (el === scrollContainer) return { overflowY: 'auto' };
        return {};
      }
    }
  });

  scrollToElement(target);

  assert.equal(scrollToCalls.length, 1);
  // scrollTop(0) + (elRect.top 500 - containerTop 0) - overlay(120) = 380.
  // Without overlay detection the offset would be 80 -> 420.
  assert.equal(scrollToCalls[0].top, 380);
});

test('scrollToElement still applies the default padding when no overlay covers the area', () => {
  var scrollToCalls = [];
  var scrollContainer = {
    getBoundingClientRect: function () { return { top: 0, left: 0, right: 1000, width: 1000, height: 800 }; },
    scrollTop: 0, scrollHeight: 2000, clientHeight: 800,
    scrollTo: function (opts) { scrollToCalls.push(opts); },
    parentElement: null
  };
  var target = {
    getBoundingClientRect: function () { return { top: 500, left: 0, right: 1000, width: 1000, height: 30 }; },
    parentElement: scrollContainer
  };
  var scrollToElement = loadScrollToElement({
    document: {
      documentElement: { nodeType: 9 },
      body: { parentElement: null },
      querySelectorAll: function () { return []; },
      // Nothing covers the top — first painted element is the container itself.
      elementsFromPoint: function () { return [scrollContainer]; }
    },
    window: {
      innerWidth: 1000,
      matchMedia: function () { return { matches: false }; },
      getComputedStyle: function (el) {
        if (el === scrollContainer) return { overflowY: 'auto' };
        return {};
      }
    }
  });

  scrollToElement(target);
  // No overlay -> offset = SCROLL_TOP_PADDING (80). 0 + (500-0) - 80 = 420.
  assert.equal(scrollToCalls[0].top, 420);
});
