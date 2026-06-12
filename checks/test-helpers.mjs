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
    .replace(/^export\s+\{[^}]*\};?\r?\n?/g, '')
    .replace(/export\s+async\s+function /g, 'async function ')
    .replace(/export\s+function /g, 'function ')
    .replace(/export\s+default\s+/g, '')
    .replace(/export\s+(var|let|const)\s+/g, '$1 ');
}
