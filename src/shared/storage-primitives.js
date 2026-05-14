var writeQueues = {};

export function serializedWrite(key, asyncFn) {
  var prev = writeQueues[key] || Promise.resolve();
  var run = function() { return asyncFn(); };
  var next = prev.then(run, run);
  writeQueues[key] = next.catch(function() {});
  return next;
}

export function isQuotaExceededError(err) {
  try {
    if (!err) return false;
    if (err.name === 'QuotaExceededError') return true;
    var text = String(err && (err.message || err.toString && err.toString() || err) || '');
    return /quota/i.test(text) || /QUOTA_BYTES/i.test(text) || /MAX_WRITE_OPERATIONS/i.test(text);
  } catch (_) {
    return false;
  }
}

export function touchObjectKey(map, key, value) {
  try {
    if (!map || !key) return;
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      try { delete map[key]; } catch (_) {}
    }
    map[key] = value;
  } catch (_) {}
}

export function pruneObjectToLimit(map, maxKeys) {
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
