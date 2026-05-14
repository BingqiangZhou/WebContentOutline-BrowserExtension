// Shared storage primitives for both background service worker and content scripts.
// Loaded via importScripts in background, injected as content script elsewhere.
// Creates globalThis.__STORAGE_PRIMITIVES — completely self-contained, no external dependencies.

var __storagePrimitivesFactory = function() {
  var __writeQueues = {};

  function serializedWrite(key, asyncFn) {
    var prev = __writeQueues[key] || Promise.resolve();
    var run = function() { return asyncFn(); };
    var next = prev.then(run, run);
    __writeQueues[key] = next.catch(function() {});
    return next;
  }

  function isQuotaExceededError(err) {
    try {
      if (!err) return false;
      if (err.name === 'QuotaExceededError') return true;
      var text = String(err && (err.message || err.toString && err.toString() || err) || '');
      return /quota/i.test(text) || /QUOTA_BYTES/i.test(text) || /MAX_WRITE_OPERATIONS/i.test(text);
    } catch (_) {
      return false;
    }
  }

  function touchObjectKey(map, key, value) {
    try {
      if (!map || !key) return;
      if (Object.prototype.hasOwnProperty.call(map, key)) {
        try { delete map[key]; } catch (_) {}
      }
      map[key] = value;
    } catch (_) {}
  }

  function pruneObjectToLimit(map, maxKeys) {
    try {
      if (!map || typeof map !== 'object') return map;
      var limit = Number.isFinite(maxKeys) ? Math.max(1, Math.floor(maxKeys)) : 400;
      var keys = Object.keys(map);
      if (keys.length <= limit) return map;
      var removeCount = keys.length - limit;
      for (var i = 0; i < removeCount; i++) {
        try { delete map[keys[i]]; } catch (_) {}
      }
      return map;
    } catch (_) {
      return map;
    }
  }

  var api = {
    serializedWrite: serializedWrite,
    isQuotaExceededError: isQuotaExceededError,
    touchObjectKey: touchObjectKey,
    pruneObjectToLimit: pruneObjectToLimit
  };
  try { globalThis.__STORAGE_PRIMITIVES = api; } catch (_) {}
  return api;
};

// Register with define() if available (content script context),
// otherwise set global directly (service worker context via importScripts).
if (typeof define === 'function') {
  define('storage-primitives', [], __storagePrimitivesFactory);
} else {
  __storagePrimitivesFactory();
}
