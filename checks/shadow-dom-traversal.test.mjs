import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDomUtils(docMock) {
  var file = path.join(repoRoot, 'src/utils/dom-utils.ts');
  var source = stripTsSyntax(fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\r?\n/gm, '')
    .replace(/export\s+async\s+function /g, 'async function ')
    .replace(/export function /g, 'function '));
  var sandbox = {
    console: console,
    document: docMock,
    XPathResult: { ORDERED_NODE_ITERATOR_TYPE: 1 },
    uiConst: function (_n, f) { return f; },
    isSafeXPathExpression: function () { return true; },
    isHighRiskBroadCssSelector: function () { return false; },
    TOC_MAX_CANDIDATES: 1200,
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    source + '\n__exports.collectBySelector = collectBySelector;',
    sandbox,
    { filename: file }
  );
  return sandbox.__exports.collectBySelector;
}

function he(tag, text) {
  return { tagName: tag, textContent: text };
}

test('collectBySelector penetrates open shadow roots and same-origin iframes', () => {
  var lightH2 = he('H2', 'Light');
  var shadowH2 = he('H2', 'Shadow');
  var iframeH2 = he('H2', 'Iframe');

  var shadowRoot = { querySelectorAll: function (expr) { return expr === 'h2' ? [shadowH2] : []; } };
  var iframeDoc = { querySelectorAll: function (expr) { return expr === 'h2' ? [iframeH2] : []; } };
  var shadowHost = { tagName: 'DIV', shadowRoot: shadowRoot };
  var iframeEl = { tagName: 'IFRAME', contentDocument: iframeDoc };

  var docMock = {
    querySelectorAll: function (expr) {
      if (expr === 'h2') return [lightH2];
      if (expr === '*') return [lightH2, shadowHost, iframeEl];
      return [];
    },
    evaluate: function () { return { iterateNext: function () { return null; } }; }
  };

  var collectBySelector = loadDomUtils(docMock);
  var result = collectBySelector({ type: 'css', expr: 'h2' }, 100);

  assert.deepEqual(
    Array.from(result, function (n) { return n.textContent; }),
    ['Light', 'Shadow', 'Iframe']
  );
});

test('collectBySelector still collects light-DOM headings when no shadow/iframe present', () => {
  var a = he('H2', 'A');
  var b = he('H3', 'B');
  var docMock = {
    querySelectorAll: function (expr) {
      if (expr === 'h2, h3') return [a, b];
      if (expr === '*') return [a, b];
      return [];
    }
  };
  var collectBySelector = loadDomUtils(docMock);
  var result = collectBySelector({ type: 'css', expr: 'h2, h3' }, 100);
  assert.equal(result.length, 2);
});

test('cross-origin iframe (no accessible contentDocument) is skipped without throwing', () => {
  var lightH2 = he('H2', 'Light');
  // contentDocument getter throws like a cross-origin access would
  var iframeEl = {
    tagName: 'IFRAME',
    get contentDocument() { throw new Error('blocked a frame with origin'); }
  };
  var docMock = {
    querySelectorAll: function (expr) {
      if (expr === 'h2') return [lightH2];
      if (expr === '*') return [lightH2, iframeEl];
      return [];
    }
  };
  var collectBySelector = loadDomUtils(docMock);
  var result = collectBySelector({ type: 'css', expr: 'h2' }, 100);
  assert.deepEqual(
    Array.from(result, function (n) { return n.textContent; }),
    ['Light']
  );
});

test('hidden / zero-size iframes are not traversed (no invisible content leaks in)', () => {
  var lightH2 = he('H2', 'Light');
  var iframeInnerH2 = he('H2', 'Inside hidden iframe');
  var hiddenIframeDoc = {
    querySelectorAll: function (expr) { return expr === 'h2' ? [iframeInnerH2] : []; }
  };
  // display:none / zero-size iframe — its inner doc is still laid out, so the
  // heading would pass the geometry filter if collected.
  var hiddenIframe = {
    tagName: 'IFRAME',
    offsetWidth: 0,
    offsetHeight: 0,
    contentDocument: hiddenIframeDoc
  };
  var docMock = {
    querySelectorAll: function (expr) {
      if (expr === 'h2') return [lightH2];
      if (expr === '*') return [lightH2, hiddenIframe];
      return [];
    }
  };
  var collectBySelector = loadDomUtils(docMock);
  var result = collectBySelector({ type: 'css', expr: 'h2' }, 100);
  assert.deepEqual(
    Array.from(result, function (n) { return n.textContent; }),
    ['Light']
  );
});
