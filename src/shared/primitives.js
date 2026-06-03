// Merged shared primitives for background service worker (IIFE bundle via esbuild).
// This file is bundled into a single IIFE and loaded via importScripts in background.js.

// --- Storage primitives ---

var writeQueues = {};

function serializedWrite(key, asyncFn) {
  var prev = writeQueues[key] || Promise.resolve();
  var run = function() { return asyncFn(); };
  var next = prev.then(run, run);
  var stored = next.catch(function() {});
  writeQueues[key] = stored;
  stored.finally(function() {
    if (writeQueues[key] === stored) delete writeQueues[key];
  });
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

// --- Config primitives ---

function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  var proto = Object.getPrototypeOf(value);
  return proto === null || Object.prototype.toString.call(value) === '[object Object]';
}

function positiveLimit(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : fallback;
}

function isHighRiskBroadCssSelector(expr) {
  var parts = expr.split(',');
  for (var i = 0; i < parts.length; i++) {
    var normalized = String(parts[i] || '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (normalized === '*' || normalized === 'html *' || normalized === 'body *' || normalized === ':root *') return true;
  }
  return false;
}

function isHighRiskBroadXPathExpression(expr) {
  var normalized = String(expr || '').trim().replace(/\s+/g, '').toLowerCase();
  if (!normalized) return false;
  if (/^\/\/*\*/.test(normalized) || /^\.\/\*/.test(normalized)) return true;
  if (/^\/\/(html|body)\/(descendant-or-self::)?\*/.test(normalized)) return true;
  if (/^descendant(-or-self)?::\*/.test(normalized)) return true;
  return false;
}

function normalizeSelector(selector) {
  if (!isPlainObject(selector)) return null;
  var type = selector.type === 'css' || selector.type === 'xpath' ? selector.type : null;
  var expr = String(selector.expr || '').trim();
  if (!type || !expr || expr.length > 2000) return null;
  if (type === 'css' && isHighRiskBroadCssSelector(expr)) return null;
  if (type === 'xpath' && isHighRiskBroadXPathExpression(expr)) return null;
  return Object.assign({}, selector, { type: type, expr: expr });
}

function normalizeSelectors(selectors, maxSelectors) {
  var list = Array.isArray(selectors) ? selectors : [];
  var seen = new Set();
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var sel = normalizeSelector(list[i]);
    if (!sel) continue;
    var key = sel.type + ':' + sel.expr;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sel);
    if (out.length >= maxSelectors) break;
  }
  return out;
}

function normalizeConfigs(configs, limits) {
  var maxSites = positiveLimit(limits && limits.maxSites, 200);
  var maxSels = positiveLimit(limits && limits.maxSelectorsPerSite, 50);
  var list = Array.isArray(configs) ? configs : [];
  var byPattern = new Map();
  for (var i = 0; i < list.length; i++) {
    var raw = list[i];
    if (!isPlainObject(raw)) continue;
    var urlPattern = String(raw.urlPattern || '').trim();
    if (!urlPattern) continue;
    var cfg = Object.assign({}, raw, {
      urlPattern: urlPattern,
      side: raw.side === 'left' ? 'left' : 'right',
      selectors: normalizeSelectors(raw.selectors, maxSels),
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
    });
    var previous = byPattern.get(urlPattern);
    if (!previous || cfg.updatedAt >= previous.cfg.updatedAt) {
      byPattern.set(urlPattern, { cfg: cfg, index: i });
    }
  }
  return Array.from(byPattern.values())
    .sort(function(a, b) {
      if (a.cfg.updatedAt !== b.cfg.updatedAt) return b.cfg.updatedAt - a.cfg.updatedAt;
      return b.index - a.index;
    })
    .slice(0, maxSites)
    .map(function(item) { return item.cfg; });
}

function applyTocConfigMutation(configs, mutation, now, limits) {
  var original = Array.isArray(configs) ? configs : [];
  var normalized = normalizeConfigs(configs, limits);
  var unchanged = function(reason) {
    return { ok: false, reason: reason, configs: original, config: null, changed: false };
  };
  if (!isPlainObject(mutation)) return unchanged('invalid-mutation');

  var operation = mutation.operation;
  var urlPattern = String(mutation.urlPattern || '').trim();
  if (!urlPattern) return unchanged('invalid-url-pattern');
  if (operation !== 'add-selector' && operation !== 'remove-selector' && operation !== 'clear-site') {
    return unchanged('invalid-operation');
  }

  var timestamp = Number.isFinite(now) ? now : Date.now();
  if (operation === 'clear-site') {
    var cleared = normalized.filter(function(cfg) { return cfg.urlPattern !== urlPattern; });
    return { ok: true, reason: null, configs: cleared, config: null, changed: cleared.length !== normalized.length };
  }

  var selector = normalizeSelector(mutation.selector);
  if (!selector) return unchanged('invalid-selector');
  var index = normalized.findIndex(function(cfg) { return cfg.urlPattern === urlPattern; });

  if (operation === 'remove-selector') {
    if (index < 0) return { ok: true, reason: null, configs: normalized, config: null, changed: false };
    var existing = normalized[index];
    var sels = existing.selectors.filter(function(item) {
      return !(item.type === selector.type && item.expr === selector.expr);
    });
    var removed = sels.length !== existing.selectors.length;
    var updated = removed
      ? Object.assign({}, existing, { selectors: sels, updatedAt: timestamp })
      : existing;
    var afterRemove = normalized.slice();
    afterRemove[index] = updated;
    return { ok: true, reason: null, configs: normalizeConfigs(afterRemove, limits), config: updated, changed: removed };
  }

  var maxSels = positiveLimit(limits && limits.maxSelectorsPerSite, 50);
  var current = index >= 0 ? normalized[index] : {
    urlPattern: urlPattern,
    side: mutation.side === 'left' ? 'left' : 'right',
    selectors: [],
    updatedAt: 0
  };
  var nextSels = current.selectors.filter(function(item) {
    return !(item.type === selector.type && item.expr === selector.expr);
  });
  nextSels.unshift(selector);
  nextSels = nextSels.slice(0, maxSels);
  var nextConfig = Object.assign({}, current, {
    urlPattern: urlPattern,
    side: current.side === 'left' ? 'left' : 'right',
    selectors: nextSels,
    updatedAt: timestamp
  });
  var afterAdd = normalized.slice();
  if (index >= 0) afterAdd[index] = nextConfig;
  else afterAdd.push(nextConfig);
  var finalConfigs = normalizeConfigs(afterAdd, limits);
  var finalConfig = finalConfigs.find(function(cfg) { return cfg.urlPattern === urlPattern; }) || null;
  return { ok: true, reason: null, configs: finalConfigs, config: finalConfig, changed: true };
}

// --- UI state primitives ---

function normalizePosition(value) {
  if (!isPlainObject(value)) return null;
  var x = Number(value.x);
  var y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  var result = { x: x, y: y };
  var updatedAt = Number(value.updatedAt);
  if (Number.isFinite(updatedAt)) result.updatedAt = updatedAt;
  if (value.anchorX === 'left' || value.anchorX === 'right') result.anchorX = value.anchorX;
  return result;
}

function validateUiStateMutationSource(mutation, senderUrl) {
  if (!isPlainObject(mutation)) return { ok: false, reason: 'bad-site' };
  try {
    var parsed = new URL(senderUrl);
    if (!/^https?:$/.test(parsed.protocol)) return { ok: false, reason: 'bad-site' };
    var expectedKey = mutation.operation === 'set-badge-position'
      ? parsed.host
      : mutation.operation === 'set-panel-expanded'
        ? parsed.origin
        : '';
    return expectedKey && String(mutation.key || '').trim() === expectedKey
      ? { ok: true, reason: null }
      : { ok: false, reason: 'bad-site' };
  } catch (_) {
    return { ok: false, reason: 'bad-site' };
  }
}

function applyUiStateMutation(currentMap, mutation, maxKeys) {
  var map = isPlainObject(currentMap) ? Object.assign({}, currentMap) : {};
  if (!isPlainObject(mutation)) return { ok: false, reason: 'invalid-mutation', map: map };
  var operation = mutation.operation;
  var key = String(mutation.key || '').trim();
  if (!key || key.length > 2048) return { ok: false, reason: 'invalid-key', map: map };

  var value;
  if (operation === 'set-badge-position') {
    value = normalizePosition(mutation.value);
    if (!value) return { ok: false, reason: 'invalid-position', map: map };
  } else if (operation === 'set-panel-expanded') {
    if (typeof mutation.value !== 'boolean') return { ok: false, reason: 'invalid-expanded', map: map };
    value = mutation.value;
  } else {
    return { ok: false, reason: 'invalid-operation', map: map };
  }

  if (Object.prototype.hasOwnProperty.call(map, key)) delete map[key];
  map[key] = value;
  pruneObjectToLimit(map, maxKeys);
  return { ok: true, reason: null, map: map, value: map[key] };
}

// --- Exports (globalThis) ---

export {
  serializedWrite, isQuotaExceededError, touchObjectKey, pruneObjectToLimit,
  applyTocConfigMutation,
  validateUiStateMutationSource, applyUiStateMutation
};
