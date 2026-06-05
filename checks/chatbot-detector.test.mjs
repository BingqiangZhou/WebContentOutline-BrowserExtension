import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'vitest';
import vm from 'node:vm';

const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);

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
    offsetHeight: opts.offsetHeight !== undefined ? opts.offsetHeight : 200,
    ownerDocument: null,
    getAttribute(attr) {
      if (attr === 'class') return this._className;
      if (attr === 'data-message-author-role') return this._role || null;
      if (attr === 'data-testid') return this._testId || null;
      if (attr === 'aria-hidden') return this._ariaHidden || null;
      return null;
    },
    querySelector(sel) {
      if (/h[1-6]/i.test(sel)) {
        return this._findHeading();
      }
      if (sel === 'p, .whitespace-pre-wrap, [class*="text"]') {
        return this._children[0] || null;
      }
      return null;
    },
    querySelectorAll(sel) {
      if (/h[1-6]/i.test(sel)) {
        return this._collectHeadings();
      }
      if (sel.includes('markdown-body') || sel.includes('prose')) {
        return this._collectByClass(sel);
      }
      return [];
    },
    compareDocumentPosition(other) {
      // Simple mock: use _docOrder to simulate position
      if (this._docOrder < other._docOrder) return 4; // DOCUMENT_POSITION_FOLLOWING
      if (this._docOrder > other._docOrder) return 2; // DOCUMENT_POSITION_PRECEDING
      return 0;
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
        if (/^H[1-6]$/.test(c.tagName)) result.push(c);
        if (c._collectHeadings) result.push(...c._collectHeadings());
      }
      return result;
    },
    _collectByClass(sel) {
      // Return self if it matches any class in the selector
      const classes = ['markdown-body', 'prose'];
      for (const cls of classes) {
        if (this._className.includes(cls)) return [this];
      }
      // Search children
      const result = [];
      for (const c of this._children) {
        for (const cls of classes) {
          if (c._className.includes(cls)) result.push(c);
        }
      }
      return result;
    },
  };
  // Assign role for chatbot messages
  if (opts.role) el._role = opts.role;
  if (opts.testId) el._testId = opts.testId;
  if (opts.ariaHidden) el._ariaHidden = opts.ariaHidden;
  if (opts.docOrder !== undefined) el._docOrder = opts.docOrder;
  else el._docOrder = makeElement._counter++;
  el.ownerDocument = opts.ownerDocument || { evaluate: () => {} };
  // Set parent for children
  for (const c of el._children) { c.parentElement = el; }
  return el;
}
makeElement._counter = 0;

function makeHeading(tag, text, opts = {}) {
  return makeElement(tag, {
    ...opts,
    children: [],
    offsetWidth: 100,
    offsetHeight: 30,
    textContent: text,
  });
}

// Add textContent support to mock
function addTextContent(el, text) {
  el.textContent = text;
  return el;
}

// ---------------------------------------------------------------------------
// Module loader
// ---------------------------------------------------------------------------

function loadModule(locMock) {
  const file = path.join(repoRoot, 'src/utils/chatbot-detector.ts');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\n/gm, '')
    .replace(/^export /gm, '');

  const sandbox = {
    console,
    location: locMock || { hostname: 'example.com', href: 'https://example.com' },
    window: {
      getComputedStyle() {
        return { display: 'block', position: 'static', visibility: 'visible', opacity: '1' };
      }
    },
    document: {
      querySelector() { return null; },
      querySelectorAll() { return []; },
    },
    Map: globalThis.Map,
    Set: globalThis.Set,
    __exports: {},
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(
    `${source}\n__exports.tryBuildChatbotTocItems = tryBuildChatbotTocItems;\n__exports.isChatbotPage = isChatbotPage;\n__exports.getChatbotSentinelSelector = getChatbotSentinelSelector;`,
    sandbox,
    { filename: file }
  );

  return sandbox.__exports;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('non-chatbot page returns null', () => {
  const { tryBuildChatbotTocItems } = loadModule({ hostname: 'example.com' });
  const result = tryBuildChatbotTocItems();
  assert.equal(result, null);
});

test('isChatbotPage returns false for non-chatbot', () => {
  const { isChatbotPage } = loadModule({ hostname: 'example.com' });
  assert.equal(isChatbotPage(), false);
});

test('getChatbotSentinelSelector returns null for non-chatbot', () => {
  const { getChatbotSentinelSelector } = loadModule({ hostname: 'example.com' });
  assert.equal(getChatbotSentinelSelector(), null);
});

test('isChatbotPage returns true for ChatGPT', () => {
  const { isChatbotPage } = loadModule({ hostname: 'chatgpt.com' });
  assert.equal(isChatbotPage(), true);
});

test('isChatbotPage returns true for DeepSeek', () => {
  const { isChatbotPage } = loadModule({ hostname: 'chat.deepseek.com' });
  assert.equal(isChatbotPage(), true);
});

test('ChatGPT: builds conversation TOC with user prompts as level 1', () => {
  makeElement._counter = 0;

  // User message 1
  const userMsg1 = addTextContent(
    makeElement('div', { role: 'user', docOrder: 0, offsetWidth: 600, offsetHeight: 100 }),
    'How to implement Promise?'
  );

  // Assistant response 1 with markdown headings
  const h2a = addTextContent(makeHeading('h2', 'Overview', { docOrder: 2 }), 'Overview');
  const h3a = addTextContent(makeHeading('h3', 'Basic Concepts', { docOrder: 3 }), 'Basic Concepts');
  const h2b = addTextContent(makeHeading('h2', 'Implementation', { docOrder: 4 }), 'Implementation');
  const markdown1 = makeElement('div', { className: 'markdown-body', children: [h2a, h3a, h2b], docOrder: 1 });
  h2a.parentElement = markdown1;
  h3a.parentElement = markdown1;
  h2b.parentElement = markdown1;
  const assistantMsg1 = makeElement('div', { role: 'assistant', docOrder: 1, children: [markdown1] });
  markdown1.parentElement = assistantMsg1;
  addTextContent(assistantMsg1, 'Here is how to implement Promise...');

  // User message 2
  const userMsg2 = addTextContent(
    makeElement('div', { role: 'user', docOrder: 5, offsetWidth: 600, offsetHeight: 80 }),
    'What about async/await?'
  );

  // Assistant response 2
  const h2c = addTextContent(makeHeading('h2', 'Async/Await', { docOrder: 7 }), 'Async/Await');
  const markdown2 = makeElement('div', { className: 'markdown-body', children: [h2c], docOrder: 6 });
  h2c.parentElement = markdown2;
  const assistantMsg2 = makeElement('div', { role: 'assistant', docOrder: 6, children: [markdown2] });
  markdown2.parentElement = assistantMsg2;
  addTextContent(assistantMsg2, 'Async/await is...');

  const doc = {
    querySelector(sel) {
      if (sel === '[data-message-author-role="user"]') return userMsg1;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === '[data-message-author-role="user"]') return [userMsg1, userMsg2];
      if (sel === '[data-message-author-role="assistant"]') return [assistantMsg1, assistantMsg2];
      if (sel.includes('markdown-body')) {
        if (sel === '.markdown-body, .prose, [class*="markdown"]') {
          return [markdown1, markdown2];
        }
      }
      return [];
    },
  };

  const { tryBuildChatbotTocItems } = loadModule({ hostname: 'chatgpt.com', href: 'https://chatgpt.com/c/123' });
  // Override document in the loaded module
  const file = path.join(repoRoot, 'src/utils/chatbot-detector.ts');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\n/gm, '')
    .replace(/^export /gm, '');

  const sandbox = {
    console,
    location: { hostname: 'chatgpt.com', href: 'https://chatgpt.com/c/123' },
    window: {
      getComputedStyle() {
        return { display: 'block', position: 'static', visibility: 'visible', opacity: '1' };
      }
    },
    document: doc,
    Map: globalThis.Map,
    Set: globalThis.Set,
    __exports: {},
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${source}\n__exports.tryBuildChatbotTocItems = tryBuildChatbotTocItems;`,
    sandbox,
    { filename: file }
  );

  const result = sandbox.__exports.tryBuildChatbotTocItems();
  assert.ok(result !== null, 'should return non-null for chatbot page');
  assert.ok(result.items.length > 0, 'should have items');

  // First item should be user prompt at level 1
  const firstItem = result.items[0];
  assert.equal(firstItem.level, 1);
  assert.ok(firstItem.text.includes('Promise'), 'first prompt should mention Promise');

  // Second item should be heading at level 3 (h2 + 1 = 3)
  // Wait, the logic is h2 → level 3 (hLevel + 1)
  assert.equal(result.items[1].level, 3, 'h2 heading should be level 3');
  assert.equal(result.items[1].text, 'Overview');

  // h3 should be level 4
  assert.equal(result.items[2].level, 4, 'h3 heading should be level 4');
  assert.equal(result.items[2].text, 'Basic Concepts');
});

test('getChatbotSentinelSelector returns selector for ChatGPT', () => {
  const { getChatbotSentinelSelector } = loadModule({ hostname: 'chatgpt.com' });
  const sel = getChatbotSentinelSelector();
  assert.ok(typeof sel === 'string' && sel.length > 0);
});

test('chatbot page with no user messages returns null', () => {
  const doc = {
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };

  const file = path.join(repoRoot, 'src/utils/chatbot-detector.ts');
  const source = fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\n/gm, '')
    .replace(/^export /gm, '');

  const sandbox = {
    console,
    location: { hostname: 'chatgpt.com', href: 'https://chatgpt.com' },
    window: { getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; } },
    document: doc,
    Map: globalThis.Map,
    Set: globalThis.Set,
    __exports: {},
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    `${source}\n__exports.tryBuildChatbotTocItems = tryBuildChatbotTocItems;`,
    sandbox,
    { filename: file }
  );

  const result = sandbox.__exports.tryBuildChatbotTocItems();
  assert.equal(result, null, 'no user messages → null');
});

test('isChatbotPage returns true for subdomains', () => {
  const { isChatbotPage } = loadModule({ hostname: 'sub.chatgpt.com' });
  assert.equal(isChatbotPage(), true);
});
