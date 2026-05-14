// Shared storage primitives for both background service worker and content scripts.
// Loaded via importScripts in background, injected as content script elsewhere.
// Creates globalThis.__STORAGE_PRIMITIVES — completely self-contained, no external dependencies.
(() => {
  if (globalThis.__STORAGE_PRIMITIVES) return;

  const __writeQueues = {};

  function serializedWrite(key, asyncFn) {
    const prev = __writeQueues[key] || Promise.resolve();
    const run = () => asyncFn();
    const next = prev.then(run, run);
    __writeQueues[key] = next.catch(() => {});
    return next;
  }

  function isQuotaExceededError(err) {
    try {
      if (!err) return false;
      if (err.name === 'QuotaExceededError') return true;
      const text = String(err && (err.message || err.toString && err.toString() || err) || '');
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
      const limit = Number.isFinite(maxKeys) ? Math.max(1, Math.floor(maxKeys)) : 400;
      const keys = Object.keys(map);
      if (keys.length <= limit) return map;
      const removeCount = keys.length - limit;
      for (let i = 0; i < removeCount; i++) {
        try { delete map[keys[i]]; } catch (_) {}
      }
      return map;
    } catch (_) {
      return map;
    }
  }

  globalThis.__STORAGE_PRIMITIVES = {
    serializedWrite, isQuotaExceededError, touchObjectKey, pruneObjectToLimit
  };
})();
