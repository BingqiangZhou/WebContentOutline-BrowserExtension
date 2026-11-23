/**
 * After the extension has been torn down on a tab (the site was disabled or the
 * script reinjected), nothing of it may show up in the page again.
 *
 * The shared mount points (toast container, overlay dialog) attach to the shared
 * shadow root and fall back to the host document when there is none. That
 * fallback is right when the root never initialized — and wrong once the root has
 * just been torn down: something that was already in flight (a config mutation
 * answering after the disable) would then land in the page's OWN DOM, unstyled
 * and reachable by the page's scripts.
 *
 * Runs the REAL shadow-root, toast, overlay-dialog and focus-trap modules.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { moduleScript } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Counts what reaches the page's own DOM ("light") and what reaches the shadow tree.
function makeDocument() {
  const counts = { light: 0, shadow: 0 };
  const inShadowTree = (node) => { for (let n = node; n; n = n._parent) if (n.isShadowRoot) return true; return false; };
  const appendChild = function (child) {
    this.children.push(child);
    child._parent = this;
    // The shadow HOST legitimately lives in the page while the extension is
    // enabled; everything else the page receives is UI that leaked out of it.
    if (this.isPage && child.className !== 'toc-shadow-host') counts.light++;
    else if (inShadowTree(this)) counts.shadow++;
    return child;
  };
  const makeEl = (tagName) => {
    const el = {
      tagName: String(tagName).toUpperCase(), className: '', children: [], _parent: null, dataset: {}, attrs: {}, textContent: '',
      style: { setProperty() {}, removeProperty() {} },
      setAttribute(name, value) { el.attrs[name] = String(value); },
      getAttribute(name) { return name in el.attrs ? el.attrs[name] : null; },
      appendChild,
      addEventListener() {}, removeEventListener() {}, focus() {}, remove() {},
      attachShadow() {
        return {
          isShadowRoot: true, children: [], _parent: null, adoptedStyleSheets: [],
          appendChild,
          querySelector: () => null,
          activeElement: null
        };
      }
    };
    return el;
  };
  const documentElement = makeEl('html');
  documentElement.isPage = true;
  // Nothing is ever "already there": no existing overlay / toast container.
  const querySelector = () => null;
  return { counts, createElement: makeEl, documentElement, querySelector, activeElement: null };
}

function load() {
  const document = makeDocument();
  const sandbox = {
    console,
    document,
    // fetchCss() resolves to '' -> no stylesheet is constructed.
    fetch: () => Promise.resolve({ text: () => '' }),
    requestAnimationFrame(cb) { cb(); return 1; },
    cancelAnimationFrame() {},
    window: { setTimeout() {} },
    // collaborators of toast / overlay-dialog
    msg: (key) => key,
    getFocusableWithin: () => [],
    EXTENSION_OWNER: 'web-toc-assistant',
    MAX_Z_INDEX: 2147483647,
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  const scripts = ['src/ui/shadow-root.ts', 'src/utils/focus-trap.ts', 'src/ui/overlay-dialog.ts', 'src/utils/toast.ts']
    .map((rel) => moduleScript(fs.readFileSync(path.join(repoRoot, rel), 'utf8')));
  vm.runInNewContext(
    scripts.join('\n') + '\n__exports.getTocShadowRoot = getTocShadowRoot;' +
    '\n__exports.disposeTocShadowRoot = disposeTocShadowRoot;' +
    '\n__exports.showToast = showToast;' +
    '\n__exports.createOverlayDialog = createOverlayDialog;',
    sandbox,
    { filename: 'shadow-root.ts + focus-trap.ts + overlay-dialog.ts + toast.ts' }
  );
  return {
    ...sandbox.__exports,
    counts: document.counts,
    mountDialog() {
      const dialog = sandbox.__exports.createOverlayDialog({ owner: 'web-toc-assistant', title: 'Site Configuration' });
      const button = document.createElement('button');
      dialog.mount(button);
    }
  };
}

test('a toast raised after the teardown does not land in the page', async () => {
  const env = load();
  await env.getTocShadowRoot();
  env.disposeTocShadowRoot();                    // the site was disabled

  const handle = env.showToast('a late failure', { type: 'error' });

  assert.equal(env.counts.light, 0, 'nothing may be attached to the page document');
  assert.equal(typeof handle.close, 'function', 'callers still get a handle');
});

test('a dialog mounted after the teardown does not land in the page', async () => {
  const env = load();
  await env.getTocShadowRoot();
  env.disposeTocShadowRoot();

  env.mountDialog();
  await flush();

  assert.equal(env.counts.light, 0);
});

test('before the root ever existed the document fallback still works, and it returns to the shadow root once the root is recreated', async () => {
  const env = load();

  env.showToast('no root yet');               // initialization never happened: fall back as before
  assert.equal(env.counts.light, 1);

  await env.getTocShadowRoot();
  env.showToast('in the root');
  assert.equal(env.counts.light, 1, 'no further page-DOM mounts');
  assert.equal(env.counts.shadow, 2, 'toast container + toast went to the shadow root');

  // Torn down and recreated (the site was disabled and enabled again): back in the root.
  env.disposeTocShadowRoot();
  env.showToast('still disabled');
  assert.equal(env.counts.light, 1, 'nothing in the page while disabled');
  await env.getTocShadowRoot();
  env.showToast('enabled again');
  assert.equal(env.counts.light, 1);
  assert.equal(env.counts.shadow, 4, 'the new toast container + toast went to the new root');
});
