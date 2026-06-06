/**
 * Shared test helpers for loading and executing TypeScript source files
 * inside vm.runInNewContext() sandboxes.
 *
 * Uses the TypeScript compiler API (already installed as a project dependency)
 * to reliably strip all TypeScript syntax — handles every edge case including
 * complex generics, inline object types, unions, intersections, and more.
 */

import ts from 'typescript';

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
