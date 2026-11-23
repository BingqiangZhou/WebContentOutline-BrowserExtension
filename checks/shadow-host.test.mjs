import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Loads src/ui/shadow-root.ts in a vm sandbox with a minimal mocked DOM so we
// can call getTocShadowRoot(), inspect the host element it creates and the mode
// it was attached with, and drive getDeepActiveElement(). Returns the module
// exports plus handles to the captured host and root.
function loadShadowRoot() {
  const file = path.join(repoRoot, 'src/ui/shadow-root.ts');
  const source = stripTsSyntax(fs.readFileSync(file, 'utf8')
    .replace(/^import .+;\r?\n/gm, '')
    .replace(/^export /gm, ''));

  let createdHost = null;
  let createdRoot = null;
  let attachInit = null;

  function makeStyle() {
    // Record setProperty calls (with priority) so we can assert z-index !important.
    const store = {};
    const style = {
      set position(v) { store['position'] = { value: v }; },
      get position() { return store['position'] ? store['position'].value : ''; },
      set top(v) { store['top'] = { value: v }; },
      set left(v) { store['left'] = { value: v }; },
      set width(v) { store['width'] = { value: v }; },
      set height(v) { store['height'] = { value: v }; },
      setProperty(k, v, priority) { store[k] = { value: v, priority: priority }; },
      _store: store,
    };
    return style;
  }

  const sandbox = {
    console,
    EXTENSION_OWNER: 'web-toc-assistant',
    MAX_Z_INDEX: 2147483647,
    document: {
      activeElement: null,
      createElement(tag) {
        const el = {
          tagName: (tag || '').toUpperCase(),
          className: '',
          _attrs: {},
          setAttribute(k, v) { this._attrs[k] = v; },
          getAttribute(k) { return this._attrs[k]; },
          style: makeStyle(),
          isConnected: true,
          appendChild() {},
          attachShadow(init) {
            attachInit = init;
            // injectStylesheet returns early on empty CSS, so a bare root is fine;
            // activeElement is what getDeepActiveElement descends through.
            createdRoot = { adoptedStyleSheets: [], appendChild() {}, replaceChildren() {}, activeElement: null };
            return createdRoot;
          },
        };
        if ((tag || '').toLowerCase() === 'div') createdHost = el;
        return el;
      },
      documentElement: { appendChild() {} },
    },
    // fetchCss() resolves to '' -> injectStylesheet() returns without touching CSSStyleSheet.
    fetch() { return Promise.resolve({ text: () => '' }); },
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  // Expose only what exists, so a test fails on its own assertion instead of the
  // whole file failing at load time when an export is not defined yet.
  const expose = (name) => `__exports[${JSON.stringify(name)}] = typeof ${name} === 'undefined' ? undefined : ${name};`;
  vm.runInNewContext(
    source + '\n' + expose('getTocShadowRoot') + '\n' + expose('getTocShadowRootSync') + '\n' + expose('getDeepActiveElement'),
    sandbox,
    { filename: file }
  );

  return Object.assign({}, sandbox.__exports, {
    getCreatedHost: () => createdHost,
    getCreatedRoot: () => createdRoot,
    getAttachMode: () => attachInit && attachInit.mode,
    setActiveElement: (el) => { sandbox.document.activeElement = el; }
  });
}

test('shadow host carries a top-level z-index so page overlays cannot cover the UI', async () => {
  const mod = loadShadowRoot();
  await mod.getTocShadowRoot();
  const host = mod.getCreatedHost();
  assert.ok(host, 'a shadow host div is created');

  const z = host.style._store['z-index'];
  assert.ok(z, 'host has z-index set');
  assert.equal(z.value, '2147483647', 'host z-index is the maximum (matches --toc-z-index)');
  assert.equal(z.priority, 'important', 'host z-index is !important so page CSS cannot override it');

  // Sanity: the host is still a zero-size fixed container (UI is positioned in the shadow).
  assert.equal(host.style._store['position'].value, 'fixed');
  assert.equal(host.style._store['width'].value, '0');
  assert.equal(host.style._store['height'].value, '0');
});

test('the shadow root is closed, so page scripts cannot reach the UI', async () => {
  const mod = loadShadowRoot();
  await mod.getTocShadowRoot();
  assert.equal(mod.getAttachMode(), 'closed');
});

test('in-extension code gets the closed root from the module, not from the host', async () => {
  const mod = loadShadowRoot();
  assert.equal(typeof mod.getTocShadowRootSync, 'function', 'getTocShadowRootSync must be exported');
  assert.equal(mod.getTocShadowRootSync(), null, 'no root before initialization');
  await mod.getTocShadowRoot();
  assert.strictEqual(mod.getTocShadowRootSync(), mod.getCreatedRoot());
});

test('focus capture descends into the closed root through the module reference', async () => {
  const mod = loadShadowRoot();
  await mod.getTocShadowRoot();
  const host = mod.getCreatedHost();
  const inner = {};                      // e.g. the dock's settings button
  host.shadowRoot = null;                // what a real browser exposes for a closed root
  mod.getCreatedRoot().activeElement = inner;
  mod.setActiveElement(host);
  assert.strictEqual(mod.getDeepActiveElement(), inner);
});

test('focus capture still descends into the page\'s own open shadow roots', async () => {
  const mod = loadShadowRoot();
  await mod.getTocShadowRoot();
  const inner = {};
  const otherHost = { shadowRoot: { activeElement: inner } };
  mod.setActiveElement(otherHost);
  assert.strictEqual(mod.getDeepActiveElement(), inner);
});
