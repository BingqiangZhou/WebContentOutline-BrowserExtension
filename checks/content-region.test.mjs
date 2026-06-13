import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// DOM mock helpers
// ---------------------------------------------------------------------------

function makeElement(tag, opts = {}) {
  const el = {
    tagName: tag.toUpperCase(),
    isConnected: true,
    parentElement: opts.parentElement || null,
    id: opts.id || '',
    _className: opts.className || '',
    _children: opts.children || [],
    get children() { return this._children; },
    offsetWidth: opts.offsetWidth !== undefined ? opts.offsetWidth : 600,
    offsetHeight: opts.offsetHeight !== undefined ? opts.offsetHeight : 800,
    ownerDocument: null,
    getAttribute(attr) {
      if (attr === 'class') return this._className;
      return null;
    },
    querySelector(sel) {
      // Simple mock: check if any child matches heading tags
      if (/h[1-6]/i.test(sel)) {
        return this._findHeading();
      }
      return null;
    },
    querySelectorAll(sel) {
      if (/h[2-4]/i.test(sel)) {
        return this._collectHeadings();
      }
      if (sel === '*') {
        return this._collectAll();
      }
      if (sel === 'a') {
        return this._collectLinks ? this._collectLinks() : [];
      }
      if (sel === 'h2, h3, h4') {
        return this._collectHeadings();
      }
      return [];
    },
    _findHeading() {
      for (const c of this._children) {
        if (/^H[1-6]$/.test(c.tagName)) return c;
        const found = c._findHeading && c._findHeading();
        if (found) return found;
      }
      return null;
    },
    _collectHeadings() {
      const result = [];
      for (const c of this._children) {
        if (/^H[2-4]$/.test(c.tagName)) result.push(c);
        if (c._collectHeadings) result.push(...c._collectHeadings());
      }
      return result;
    },
    _collectAll() {
      const result = [...this._children];
      for (const c of this._children) {
        if (c._collectAll) result.push(...c._collectAll());
      }
      return result;
    },
    contains(other) {
      if (!other) return false;
      let cur = other;
      while (cur) {
        if (cur === this) return true;
        cur = cur.parentElement;
      }
      return false;
    },
  };
  el.ownerDocument = opts.ownerDocument || { evaluate: () => {} };
  return el;
}

function makeHeading(tag, parent) {
  const el = makeElement(tag, { parentElement: parent, offsetWidth: 100, offsetHeight: 30 });
  return el;
}

// ---------------------------------------------------------------------------
// Module loader
// ---------------------------------------------------------------------------

function loadModule(docMock, locMock) {
  const file = path.join(repoRoot, 'src/utils/content-region.ts');
  const source = stripTsSyntax(fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\r?\n/gm, '')
    .replace(/^export /gm, ''));

  const sandbox = {
    console,
    document: docMock,
    location: locMock || { href: 'https://example.com/page' },
    window: { innerWidth: 1200, innerHeight: 900 },
    Map: globalThis.Map,
    Set: globalThis.Set,
    Record: undefined,
    __exports: {},
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(
    `${source}\n__exports.detectContentRegion = detectContentRegion;\n__exports.invalidateContentRegionCache = invalidateContentRegionCache;`,
    sandbox,
    { filename: file }
  );

  return sandbox.__exports;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('Layer 1: detects <main> with headings', () => {
  const h2 = makeHeading('H2', null);
  const main = makeElement('main', { children: [h2] });
  h2.parentElement = main;

  const doc = {
    querySelector(sel) {
      if (sel === 'main') return main;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === 'article') return [];
      return [];
    },
  };

  const { detectContentRegion } = loadModule(doc);
  const result = detectContentRegion();
  assert.equal(result.root, main);
  assert.equal(result.source, 'landmark');
});

test('Layer 1: detects <article> when no <main> exists', () => {
  const h2 = makeHeading('H2', null);
  const article = makeElement('article', { children: [h2] });
  h2.parentElement = article;

  const doc = {
    querySelector(sel) {
      if (sel === 'main' || sel === '[role="main"]') return null;
      if (sel === 'article') return article;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === 'article') return [article];
      return [];
    },
  };

  const { detectContentRegion } = loadModule(doc);
  const result = detectContentRegion();
  assert.equal(result.root, article);
  assert.equal(result.source, 'landmark');
});

test('Layer 1: <main> drills down to primary article child', () => {
  const h2a = makeHeading('H2', null);
  const h3a = makeHeading('H3', null);
  const article = makeElement('article', { children: [h2a, h3a] });
  h2a.parentElement = article;
  h3a.parentElement = article;

  const commentHeading = makeHeading('H3', null);
  const comments = makeElement('section', { className: 'comments', children: [commentHeading] });
  commentHeading.parentElement = comments;

  const relatedHeading = makeHeading('H2', null);
  const related = makeElement('section', { className: 'related', children: [relatedHeading] });
  relatedHeading.parentElement = related;

  const main = makeElement('main', { children: [article, comments, related] });
  article.parentElement = main;
  comments.parentElement = main;
  related.parentElement = main;

  const doc = {
    querySelector(sel) {
      if (sel === 'main') return main;
      return null;
    },
    querySelectorAll() { return []; },
  };

  const { detectContentRegion } = loadModule(doc);
  const result = detectContentRegion();
  assert.equal(result.source, 'landmark');
  // Should pick the dominant article, not the broad <main>
  assert.equal(result.root, article);
});

test('Layer 1: <main> with no dominant child uses main itself', () => {
  const h2a = makeHeading('H2', null);
  const div1 = makeElement('div', { children: [h2a] });
  h2a.parentElement = div1;

  const h2b = makeHeading('H2', null);
  const div2 = makeElement('div', { children: [h2b] });
  h2b.parentElement = div2;

  const main = makeElement('main', { children: [div1, div2] });
  div1.parentElement = main;
  div2.parentElement = main;

  const doc = {
    querySelector(sel) {
      if (sel === 'main') return main;
      return null;
    },
    querySelectorAll() { return []; },
  };

  const { detectContentRegion } = loadModule(doc);
  const result = detectContentRegion();
  assert.equal(result.source, 'landmark');
  // No clear winner — use <main> itself
  assert.equal(result.root, main);
});

test('Layer 2: detects .content when no semantic landmarks exist', () => {
  const h2 = makeHeading('H2', null);
  const contentDiv = makeElement('div', { className: 'content', children: [h2] });
  h2.parentElement = contentDiv;

  const doc = {
    querySelector() { return null; },
    querySelectorAll(sel) {
      if (sel === '.content') return [contentDiv];
      return [];
    },
  };

  const { detectContentRegion } = loadModule(doc);
  const result = detectContentRegion();
  assert.equal(result.root, contentDiv);
  assert.equal(result.source, 'heuristic-class');
});

test('Layer 2: picks highest-scoring candidate', () => {
  const h2a = makeHeading('H2', null);
  const h3a = makeHeading('H3', null);
  const goodDiv = makeElement('div', { className: 'post-content', children: [h2a, h3a] });
  h2a.parentElement = goodDiv;
  h3a.parentElement = goodDiv;

  const h2b = makeHeading('H2', null);
  const weakDiv = makeElement('div', { className: 'content', children: [h2b] });
  h2b.parentElement = weakDiv;

  const doc = {
    querySelector() { return null; },
    querySelectorAll(sel) {
      if (sel === '.post-content') return [goodDiv];
      if (sel === '.content') return [weakDiv];
      return [];
    },
  };

  const { detectContentRegion } = loadModule(doc);
  const result = detectContentRegion();
  assert.equal(result.root, goodDiv);
});

test('Cache: same URL returns cached result', () => {
  const h2 = makeHeading('H2', null);
  const main = makeElement('main', { children: [h2] });
  h2.parentElement = main;

  let callCount = 0;
  const doc = {
    querySelector(sel) {
      callCount++;
      if (sel === 'main') return main;
      return null;
    },
    querySelectorAll() { return []; },
  };

  const loc = { href: 'https://example.com/page' };
  const { detectContentRegion } = loadModule(doc, loc);
  const r1 = detectContentRegion();
  const r2 = detectContentRegion();
  assert.equal(r1.root, r2.root);
  assert.equal(callCount, 1); // second call should use cache
});

test('Cache: different URL re-runs detection', () => {
  const h2 = makeHeading('H2', null);
  const main = makeElement('main', { children: [h2] });
  h2.parentElement = main;

  let callCount = 0;
  const doc = {
    querySelector(sel) {
      callCount++;
      if (sel === 'main') return main;
      return null;
    },
    querySelectorAll() { return []; },
  };

  const loc = { href: 'https://example.com/page1' };
  const { detectContentRegion } = loadModule(doc, loc);
  detectContentRegion();
  assert.equal(callCount, 1);

  // Simulate URL change
  loc.href = 'https://example.com/page2';
  detectContentRegion();
  assert.ok(callCount > 1); // re-ran detection
});

test('Cache: disconnected root invalidates cache', () => {
  const h2 = makeHeading('H2', null);
  const main = makeElement('main', { children: [h2] });
  h2.parentElement = main;

  const doc = {
    querySelector(sel) {
      if (sel === 'main') return main;
      return null;
    },
    querySelectorAll() { return []; },
  };

  const loc = { href: 'https://example.com/page' };
  const { detectContentRegion } = loadModule(doc, loc);
  const r1 = detectContentRegion();
  assert.equal(r1.root, main);

  // Disconnect the element (SPA replaced the DOM)
  main.isConnected = false;
  // Now build a new main to return on the next querySelector call
  const h2b = makeHeading('H2', null);
  const main2 = makeElement('main', { children: [h2b] });
  h2b.parentElement = main2;

  const originalQS = doc.querySelector;
  doc.querySelector = (sel) => {
    if (sel === 'main') return main2;
    return null;
  };

  const r2 = detectContentRegion();
  assert.equal(r2.root, main2);
});

test('invalidateContentRegionCache clears the cache', () => {
  const h2 = makeHeading('H2', null);
  const main = makeElement('main', { children: [h2] });
  h2.parentElement = main;

  let callCount = 0;
  const doc = {
    querySelector(sel) {
      callCount++;
      if (sel === 'main') return main;
      return null;
    },
    querySelectorAll() { return []; },
  };

  const loc = { href: 'https://example.com/page' };
  const { detectContentRegion, invalidateContentRegionCache } = loadModule(doc, loc);
  detectContentRegion();
  assert.equal(callCount, 1);

  invalidateContentRegionCache();
  detectContentRegion();
  assert.ok(callCount > 1);
});

test('Fallback: returns null when no content region detected', () => {
  const doc = {
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };

  const { detectContentRegion } = loadModule(doc);
  const result = detectContentRegion();
  assert.equal(result.root, null);
  assert.equal(result.source, 'fallback');
});

test('Layer 2: skips elements with no headings', () => {
  const emptyDiv = makeElement('div', { className: 'content', children: [] });

  const doc = {
    querySelector() { return null; },
    querySelectorAll(sel) {
      if (sel === '.content') return [emptyDiv];
      return [];
    },
  };

  const { detectContentRegion } = loadModule(doc);
  const result = detectContentRegion();
  assert.equal(result.source, 'fallback');
});

test('Layer 2: penalizes elements near negative-pattern ancestors', () => {
  const h2good = makeHeading('H2', null);
  const goodDiv = makeElement('div', { className: 'post-content', children: [h2good] });
  h2good.parentElement = goodDiv;

  const h2bad = makeHeading('H2', null);
  const badDiv = makeElement('div', { className: 'sidebar-content', children: [h2bad] });
  h2bad.parentElement = badDiv;
  // badDiv is child of a sidebar
  const sidebar = makeElement('div', { className: 'sidebar', children: [badDiv] });
  badDiv.parentElement = sidebar;

  const doc = {
    querySelector() { return null; },
    querySelectorAll(sel) {
      if (sel === '.post-content') return [goodDiv];
      if (sel === '.sidebar-content') return [badDiv];
      return [];
    },
  };

  const { detectContentRegion } = loadModule(doc);
  const result = detectContentRegion();
  assert.equal(result.root, goodDiv);
});

// ---------------------------------------------------------------------------
// Shadow DOM: content region inside an open shadow root (the F10 fix)
// ---------------------------------------------------------------------------

test('Layer 1: detects <main> rendered inside an open shadow root', () => {
  // Page whose article content lives inside a web component's open shadow root.
  // The light DOM has no <main>/<article>/.content — without shadow-aware
  // region detection this fell through to the full-page fallback, letting
  // light-DOM nav/footer headings leak into the TOC.
  const h2 = makeHeading('H2', null);
  const shadowMain = makeElement('main', { children: [h2] });
  h2.parentElement = shadowMain;

  const shadowRoot = {
    querySelector(sel) {
      if (sel === 'main' || sel === '[role="main"]' || sel === 'article' || sel === '[role="article"]') return shadowMain;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '*') return [shadowMain, h2];
      if (sel === 'main' || sel === 'article') return [shadowMain];
      if (/h[2-4]/i.test(sel)) return [h2];
      return [];
    }
  };

  const host = makeElement('div', {});
  host.shadowRoot = shadowRoot;

  const doc = {
    querySelector() { return null; },
    querySelectorAll(sel) {
      if (sel === '*') return [host];   // the component host is in the light DOM
      return [];
    }
  };

  const { detectContentRegion } = loadModule(doc);
  const result = detectContentRegion();
  assert.equal(result.root, shadowMain);
  assert.equal(result.source, 'landmark');
});

test('Layer 2: detects .content rendered inside an open shadow root', () => {
  const h2 = makeHeading('H2', null);
  const shadowContent = makeElement('div', { className: 'content', children: [h2] });
  h2.parentElement = shadowContent;

  const shadowRoot = {
    querySelector() { return null; },   // no landmarks in the shadow tree either
    querySelectorAll(sel) {
      if (sel === '*') return [shadowContent, h2];
      if (sel === '.content') return [shadowContent];
      if (/h[2-4]/i.test(sel)) return [h2];
      return [];
    }
  };

  const host = makeElement('div', {});
  host.shadowRoot = shadowRoot;

  const doc = {
    querySelector() { return null; },
    querySelectorAll(sel) {
      if (sel === '*') return [host];
      return [];
    }
  };

  const { detectContentRegion } = loadModule(doc);
  const result = detectContentRegion();
  assert.equal(result.root, shadowContent);
  assert.equal(result.source, 'heuristic-class');
});
