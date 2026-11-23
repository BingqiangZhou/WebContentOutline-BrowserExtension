/**
 * createOverlayDialog: where focus goes when the dialog closes.
 *
 * The dialog is always opened from inside the extension's shadow root (the
 * dock's settings button), so "is the previous focus still in the document"
 * cannot be answered with document.contains() — that call does not cross the
 * shadow boundary and reports every shadow-tree node as gone.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import vm from 'node:vm';
import { stripTsSyntax } from './test-helpers.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal element double: enough tree/listener surface for the real dialog and
// the real focus trap to run.
function makeNode(tagName) {
  return {
    tagName: String(tagName).toUpperCase(),
    nodeType: 1,
    className: '',
    id: '',
    tabIndex: 0,
    textContent: '',
    isConnected: false,
    parentNode: null,
    children: [],
    _attrs: {},
    _listeners: {},
    setAttribute(name, value) { this._attrs[name] = String(value); },
    getAttribute(name) { return this._attrs[name]; },
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    removeEventListener(type, fn) { this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn); },
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter((c) => c !== this);
      this.parentNode = null;
    },
    focus() {}
  };
}

// Runs the REAL overlay-dialog.ts on top of the REAL focus-trap.ts. `prevFocus`
// is what getDeepActiveElement() captured when the dialog was created.
function loadOverlayDialog(prevFocus) {
  const asScript = (relativePath) => stripTsSyntax(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'))
    .replace(/^import .+;\r?\n/gm, '')
    .replace(/export function /g, 'function ');

  const sandbox = {
    console,
    document: {
      createElement: makeNode,
      documentElement: makeNode('html'),
      querySelector: () => null,
      // DOM semantics: contains() does not see into shadow trees.
      contains: () => false
    },
    getTocShadowRootSync: () => null,
    getDeepActiveElement: () => prevFocus,
    getFocusableWithin: () => [],
    requestAnimationFrame(fn) { fn(); return 1; },
    cancelAnimationFrame() {},
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(
    asScript('src/utils/focus-trap.ts') + '\n' + asScript('src/ui/overlay-dialog.ts') +
    '\n__exports.createOverlayDialog = createOverlayDialog;',
    sandbox,
    { filename: 'focus-trap.ts + overlay-dialog.ts' }
  );
  return sandbox.__exports.createOverlayDialog;
}

// The real use: focus the dock's settings button, open the dialog, close it.
function openAndCloseDialog(opener) {
  const createOverlayDialog = loadOverlayDialog(opener);
  const dialog = createOverlayDialog({ owner: 'web-toc-assistant', title: 'Site Configuration' });
  const closeButton = makeNode('button');
  dialog.mount(closeButton);
  dialog.close();
}

test('closing the dialog returns focus to the control that opened it', () => {
  const opener = makeNode('button');
  opener.isConnected = true;                 // it lives in the shadow tree, attached to the document
  const refocuses = { count: 0 };
  opener.focus = () => { refocuses.count++; };

  openAndCloseDialog(opener);

  assert.equal(refocuses.count, 1, 'focus must return to the opener');
});

test('focus is not returned to a control that has left the document', () => {
  const opener = makeNode('button');
  opener.isConnected = false;                // e.g. the dock was torn down while the dialog was open
  const refocuses = { count: 0 };
  opener.focus = () => { refocuses.count++; };

  openAndCloseDialog(opener);

  assert.equal(refocuses.count, 0);
});
