function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false;
  var proto = Object.getPrototypeOf(value);
  return proto === null || Object.prototype.toString.call(value) === '[object Object]';
}

function positiveLimit(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : fallback;
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

function isHighRiskBroadCssSelector(expr) {
  var parts = [];
  var current = '';
  var depth = 0;
  var inSingle = false;
  var inDouble = false;
  for (var i = 0; i < expr.length; i++) {
    var ch = expr[i];
    if (!inDouble && ch === "'") {
      inSingle = !inSingle;
      current += ch;
      continue;
    }
    if (!inSingle && ch === '"') {
      inDouble = !inDouble;
      current += ch;
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
      else if (ch === ',' && depth === 0) {
        parts.push(current);
        current = '';
        continue;
      }
    }
    current += ch;
  }
  parts.push(current);

  for (var p = 0; p < parts.length; p++) {
    var normalized = String(parts[p] || '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (normalized === '*' || normalized === 'html *' || normalized === 'body *' || normalized === ':root *') return true;
  }
  return false;
}

function isHighRiskBroadXPathExpression(expr) {
  var normalized = String(expr || '').trim().replace(/\s+/g, '').toLowerCase();
  if (!normalized) return false;

  if (normalized.indexOf('//*') === 0) return true;
  if (normalized.indexOf('.//*') === 0) return true;
  if (normalized.indexOf('//html//*') === 0) return true;
  if (normalized.indexOf('//body//*') === 0) return true;
  if (normalized.indexOf('//html/descendant::*') === 0) return true;
  if (normalized.indexOf('//body/descendant::*') === 0) return true;
  if (normalized.indexOf('descendant::*') === 0) return true;
  if (/^\/\/(node|text|comment)\(/i.test(normalized)) return true;

  return false;
}

function normalizeSelectors(selectors, maxSelectors) {
  var list = Array.isArray(selectors) ? selectors : [];
  var seen = new Set();
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var selector = normalizeSelector(list[i]);
    if (!selector) continue;
    var key = selector.type + ':' + selector.expr;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(selector);
    if (out.length >= maxSelectors) break;
  }
  return out;
}

function normalizeConfigs(configs, limits) {
  var maxSites = positiveLimit(limits && limits.maxSites, 200);
  var maxSelectors = positiveLimit(limits && limits.maxSelectorsPerSite, 50);
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
      selectors: normalizeSelectors(raw.selectors, maxSelectors),
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

export function applyTocConfigMutation(configs, mutation, now, limits) {
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
    var selectors = existing.selectors.filter(function(item) {
      return !(item.type === selector.type && item.expr === selector.expr);
    });
    var removed = selectors.length !== existing.selectors.length;
    var updated = removed
      ? Object.assign({}, existing, { selectors: selectors, updatedAt: timestamp })
      : existing;
    var afterRemove = normalized.slice();
    afterRemove[index] = updated;
    return { ok: true, reason: null, configs: normalizeConfigs(afterRemove, limits), config: updated, changed: removed };
  }

  var maxSelectors = positiveLimit(limits && limits.maxSelectorsPerSite, 50);
  var current = index >= 0 ? normalized[index] : {
    urlPattern: urlPattern,
    side: mutation.side === 'left' ? 'left' : 'right',
    selectors: [],
    updatedAt: 0
  };
  var nextSelectors = current.selectors.filter(function(item) {
    return !(item.type === selector.type && item.expr === selector.expr);
  });
  nextSelectors.unshift(selector);
  nextSelectors = nextSelectors.slice(0, maxSelectors);
  var nextConfig = Object.assign({}, current, {
    urlPattern: urlPattern,
    side: current.side === 'left' ? 'left' : 'right',
    selectors: nextSelectors,
    updatedAt: timestamp
  });
  var afterAdd = normalized.slice();
  if (index >= 0) afterAdd[index] = nextConfig;
  else afterAdd.push(nextConfig);
  var finalConfigs = normalizeConfigs(afterAdd, limits);
  var finalConfig = finalConfigs.find(function(cfg) { return cfg.urlPattern === urlPattern; }) || null;
  return { ok: true, reason: null, configs: finalConfigs, config: finalConfig, changed: true };
}
