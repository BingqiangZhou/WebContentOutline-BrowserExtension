// src/utils/toc-utils.js - Aggregate module combining all utility APIs
define('toc-utils', ['toc-constants', 'core-utils', 'toast', 'toc-storage'],
  function(constants, coreUtils, toast, storage) {
    var api = {};
    Object.assign(api, constants, coreUtils, toast, storage);
    // Backward compat
    try {
      var ROOT = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : self);
      ROOT.TOC_UTILS = api;
    } catch (_) {}
    return api;
  }
);
