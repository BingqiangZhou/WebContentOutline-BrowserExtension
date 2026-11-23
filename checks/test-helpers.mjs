/**
 * Shared test helpers for loading and executing TypeScript source files
 * inside vm.runInNewContext() sandboxes.
 *
 * Uses the TypeScript compiler API (already installed as a project dependency)
 * to reliably strip all TypeScript syntax — handles every edge case including
 * complex generics, inline object types, unions, intersections, and more.
 */

import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Load the real `dedupeMirrorItems` from src/utils/core-utils.ts so test
 * harnesses that strip imports can inject the genuine implementation.
 */
export function loadDedupeMirrorItems() {
  const file = path.join(repoRoot, 'src/utils/core-utils.ts');
  const source = stripImportsAndExports(stripTsSyntax(fs.readFileSync(file, 'utf8')));
  const sandbox = { console, location: { protocol: 'https:', host: 'example.com' }, __exports: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source + '\n__exports.dedupeMirrorItems = dedupeMirrorItems;', sandbox, { filename: file });
  return sandbox.__exports.dedupeMirrorItems;
}

/**
 * Load the real `TOC_MESSAGE` constant map from src/shared/messages.ts so test
 * sandboxes that strip imports can inject the genuine message-type strings
 * (single source of truth) rather than restating the literals per test.
 */
export function loadTocMessage() {
  const file = path.join(repoRoot, 'src/shared/messages.ts');
  const source = stripImportsAndExports(stripTsSyntax(fs.readFileSync(file, 'utf8')));
  const sandbox = { __exports: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source + '\n__exports.TOC_MESSAGE = TOC_MESSAGE;', sandbox, { filename: file });
  return sandbox.__exports.TOC_MESSAGE;
}

/**
 * Load the real `gatherOpenShadowRoots` from src/utils/dom-utils.ts so test
 * sandboxes that strip imports can inject the genuine shadow-root traversal
 * (content-region.ts delegates to it after the gatherQuery/RegionRoots merge).
 */
export function loadGatherOpenShadowRoots() {
  const file = path.join(repoRoot, 'src/utils/dom-utils.ts');
  const source = stripImportsAndExports(stripTsSyntax(fs.readFileSync(file, 'utf8')));
  const sandbox = { console, __exports: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source + '\n__exports.gatherOpenShadowRoots = gatherOpenShadowRoots;', sandbox, { filename: file });
  return sandbox.__exports.gatherOpenShadowRoots;
}

/**
 * Load the real `normalizeSelectorList` from src/shared/primitives.ts so test
 * sandboxes that strip imports can inject the genuine selector-list dedupe
 * (storage.ts delegates to it after the normalizeSelectors/loop merge).
 */
export function loadNormalizeSelectorList() {
  const file = path.join(repoRoot, 'src/shared/primitives.ts');
  const source = stripImportsAndExports(stripTsSyntax(fs.readFileSync(file, 'utf8')));
  const sandbox = { console, __exports: {} };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source + '\n__exports.normalizeSelectorList = normalizeSelectorList;', sandbox, { filename: file });
  return sandbox.__exports.normalizeSelectorList;
}

/**
 * Strip TypeScript syntax from source code using the TypeScript compiler API.
 *
 * This is bulletproof — handles all TS syntax including complex generics,
 * inline object types, union/intersection types, type aliases, interfaces,
 * return type annotations, `as` casts, non-null assertions, and more.
 *
 * @param {string} source — TypeScript source
 * @returns {string} — plain JS source
 */
export function stripTsSyntax(source) {
  var result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      sourceMap: false,
      removeComments: false,
      strict: false,
      skipLibCheck: true,
      noEmit: false,
    },
    reportDiagnostics: false,
  });
  return result.outputText;
}

/**
 * Strip import statements and export keywords, handling CRLF line endings.
 * @param {string} source
 * @returns {string}
 */
export function stripImportsAndExports(source) {
  return source
    .replace(/^import .+;\r?\n/gm, '')
    .replace(/^export\s+\{[^}]*\};?\r?\n?/gm, '')
    .replace(/export\s+async\s+function /g, 'async function ')
    .replace(/export\s+function /g, 'function ')
    .replace(/export\s+default\s+/g, '')
    .replace(/export\s+(var|let|const)\s+/g, '$1 ');
}

/**
 * Turn one TypeScript module's source into plain script text for a vm sandbox:
 * strip TS syntax, then every import and export form — including the multi-line
 * `import { … } from '…'` lists that stripImportsAndExports leaves behind.
 * The sandbox has to supply the module's imports as globals.
 */
export function moduleScript(source) {
  return stripImportsAndExports(stripTsSyntax(source))
    .replace(/^import\s[^;]*;/gm, '');
}

/**
 * Runs the REAL src/core/toc-app.ts (the orchestrator) with its collaborators
 * stubbed. Storage and the TOC build are controllable:
 *  - `updateConfigFromStorage` returns the selector `.new` from its 2nd call on,
 *    and with `opts.parkConfigReads` every read stays pending until
 *    `releaseConfigRead()` is called.
 *  - every rebuild parks inside `buildTocItems` until `finishBuild()` is called.
 * `opts.window` replaces the sandbox's `window`.
 */
export function loadTocApp(opts = {}) {
  const counters = { configReads: 0, builds: 0 };
  const pendingBuilds = [];
  const pendingConfigReads = [];
  let dockOptions = null;
  const sandbox = {
    console: { ...console, warn() {}, debug() {} },
    AbortController,
    updateConfigFromStorage: (cfg) => {
      counters.configReads++;
      if (counters.configReads >= 2) cfg.selectors = [{ type: 'css', expr: '.new' }];
      if (!opts.parkConfigReads) return Promise.resolve();
      return new Promise((resolve) => pendingConfigReads.push(resolve));
    },
    buildTocItems: () => {
      counters.builds++;
      return new Promise((resolve) => pendingBuilds.push(resolve));
    },
    // Everything else: inert stubs with the real surface.
    renderEdgeDock: (options) => {
      dockOptions = options;
      return {
        setEmptyHidden() {}, setItems() {}, setActiveIndex() {},
        getSide: () => 'right', getPanelHost: () => null, getMode: () => 'collapsed',
        destroy() {}, collapse() {}, peek() {}
      };
    },
    renderFloatingPanel: () => { throw new Error('the panel is not rendered in this scenario'); },
    createElementPicker: () => ({ cleanup() {} }),
    showPickerResult() {},
    siteConfig: async () => {},
    saveSelector: async () => false,
    setOnConfigChanged() {},
    createRebuildScheduler: () => ({
      start() {}, disconnect() {},
      getPendingRebuild: () => false, setPendingRebuild() {}
    }),
    createActiveItemTracker: () => ({ setItems() {}, destroy() {} }),
    createNavLock: () => ({ lock() {}, unlock() {}, isLocked: () => false, destroy() {} }),
    NAV_LOCK_MS: 1000,
    msg: (key) => key,
    showToast() {},
    cleanupOwnedElements() {},
    scrollToElement() {},
    invalidateScrollCaches() {},
    buildClassSelector: () => '',
    cssPathFor: () => '',
    isContextInvalidatedError: () => false,
    isExtensionContextInvalidated: () => false,
    normalizeSide: (side) => (side === 'left' ? 'left' : 'right'),
    isTocContentIdentical: () => false,
    debug() {},
    EXTENSION_OWNER: 'web-toc-assistant',
    getTocShadowRootSync: () => null,
    window: opts.window || {},
    // No production code should construct one; defined so that a test spying on
    // window.dispatchEvent can SEE a (re)introduced window event instead of the
    // construct throwing and being swallowed by a try/catch.
    CustomEvent: class { constructor(type) { this.type = type; } },
    document: { createElement: () => ({ setAttribute() {}, appendChild() {}, addEventListener() {} }) },
    __exports: {}
  };
  sandbox.globalThis = sandbox;
  const file = path.join(repoRoot, 'src/core/toc-app.ts');
  vm.runInNewContext(moduleScript(fs.readFileSync(file, 'utf8')) + '\n__exports.initForConfig = initForConfig;', sandbox, { filename: file });
  return {
    counters,
    initForConfig: sandbox.__exports.initForConfig,
    finishBuild() { pendingBuilds.shift()([{ id: 'toc-item-0', el: {}, text: 'heading', level: 2 }]); },
    releaseConfigRead() { pendingConfigReads.shift()(); },
    dockOptions: () => dockOptions
  };
}
