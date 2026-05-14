// Re-export shim: all utils have been split into focused modules.
// This file is kept for backward compatibility but contains no logic.
// The actual implementations live in:
//   src/utils/constants.js, core-utils.js, toast.js, storage.js,
//   badge-position.js, dom-utils.js
(() => {
  // No-op: all sub-modules already populated globalThis.TOC_UTILS.
  // This shim exists only to maintain backward compatibility if loaded directly.
})();
