
// Shared primitives for storage, config, and UI state mutations.
// WXT bundles this ESM module into the background and content script entrypoints.

import { SELECTOR_EXPR_MAX_LENGTH } from '../utils/constants.js';

// --- Storage primitives ---

var writeQueues: Record<string, Promise<void>> = {};

function serializedWrite(key: string, asyncFn: () => Promise<unknown>): Promise<unknown> {
  var prev: Promise<void> = writeQueues[key] || Promise.resolve();
  var run = function() { return asyncFn(); };
  var next = prev.then(run, run) as Promise<unknown>;
  var stored = next.catch(function() {}) as Promise<void>;
  writeQueues[key] = stored;
  stored.finally(function() {
    if (writeQueues[key] === stored) delete writeQueues[key];
  });
  return next;
}

function isQuotaExceededError(err: unknown): boolean {
  try {
    if (!err) return false;
    if ((err as { name?: string }).name === 'QuotaExceededError') return true;
    var text = String(err && ((err as { message?: string }).message || (err as { toString?: () => string }).toString && (err as { toString: () => string }).toString() || err) || '');
    return /quota/i.test(text) || /QUOTA_BYTES/i.test(text) || /MAX_WRITE_OPERATIONS/i.test(text);
  } catch (_) {
    return false;
  }
}

function touchObjectKey(map: Record<string, unknown>, key: string, value: unknown): void {
  try {
    if (!map || !key) return;
    if (Object.prototype.hasOwnProperty.call(map, key)) {
      try { delete map[key]; } catch (_) {}
    }
    map[key] = value;
  } catch (_) {}
}

function pruneObjectToLimit(map: Record<string, unknown>, maxKeys: number): Record<string, unknown> {
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

function isPlainObject(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  var proto = Object.getPrototypeOf(value);
  return proto === null || Object.prototype.toString.call(value) === '[object Object]';
}

function positiveLimit(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : fallback;
}

function isHighRiskBroadCssSelector(expr: string): boolean {
  if (typeof expr !== 'string') return false;
  var parts = expr.split(',');
  for (var i = 0; i < parts.length; i++) {
    var normalized = String(parts[i] || '').trim().replace(/\s+/g, ' ').toLowerCase();
    if (normalized === '*' || normalized === 'html *' || normalized === 'body *' || normalized === ':root *') return true;
  }
  return false;
}

function isHighRiskBroadXPathExpression(expr: string): boolean {
  var normalized = String(expr || '').trim().replace(/\s+/g, '').toLowerCase();
  if (!normalized) return false;
  if (/^\/\/*\*/.test(normalized) || /^\.\/\*/.test(normalized)) return true;
  if (/^\/\/(html|body)\/(descendant-or-self::)?\*/.test(normalized)) return true;
  if (/^descendant(-or-self)?::\*/.test(normalized)) return true;
  return false;
}

interface NormalizedSelector {
  type: string;
  expr: string;
}

function normalizeSelector(selector: unknown): NormalizedSelector | null {
  if (!isPlainObject(selector)) return null;
  var sel = selector as Record<string, unknown>;
  var type = sel.type === 'css' || sel.type === 'xpath' ? sel.type as string : null;
  var expr = String(sel.expr || '').trim();
  if (!type || !expr || expr.length > SELECTOR_EXPR_MAX_LENGTH) return null;
  if (type === 'css' && isHighRiskBroadCssSelector(expr)) return null;
  if (type === 'xpath' && isHighRiskBroadXPathExpression(expr)) return null;
  return Object.assign({}, sel, { type: type, expr: expr }) as NormalizedSelector;
}

function normalizeSelectors(selectors: unknown, maxSelectors: number): NormalizedSelector[] {
  var list = Array.isArray(selectors) ? selectors : [];
  var seen = new Set<string>();
  var out: NormalizedSelector[] = [];
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

interface ConfigLimits {
  maxSites?: number;
  maxSelectorsPerSite?: number;
}

interface NormalizedConfig {
  urlPattern: string;
  side: string;
  selectors: NormalizedSelector[];
  updatedAt: number;
  [key: string]: unknown;
}

function normalizeConfigs(configs: unknown, limits: ConfigLimits | null): NormalizedConfig[] {
  var maxSites = positiveLimit(limits ? limits.maxSites as number : 0, 200);
  var maxSels = positiveLimit(limits ? limits.maxSelectorsPerSite as number : 0, 50);
  var list = Array.isArray(configs) ? configs : [];
  var byPattern = new Map<string, { cfg: NormalizedConfig; index: number }>();
  for (var i = 0; i < list.length; i++) {
    var raw = list[i] as Record<string, unknown>;
    if (!isPlainObject(raw)) continue;
    var urlPattern = String(raw.urlPattern || '').trim();
    if (!urlPattern) continue;
    var cfg = Object.assign({}, raw, {
      urlPattern: urlPattern,
      side: raw.side === 'left' ? 'left' : 'right',
      selectors: normalizeSelectors(raw.selectors, maxSels),
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
    }) as NormalizedConfig;
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

interface ConfigMutationResult {
  ok: boolean;
  reason: string | null;
  configs: NormalizedConfig[];
  config: NormalizedConfig | null;
  changed: boolean;
}

function applyTocConfigMutation(configs: unknown, mutation: unknown, now: number, limits: ConfigLimits | null): ConfigMutationResult {
  var original = Array.isArray(configs) ? configs as NormalizedConfig[] : [];
  var normalized = normalizeConfigs(configs, limits);
  var unchanged = function(reason: string): ConfigMutationResult {
    return { ok: false, reason: reason, configs: original, config: null, changed: false };
  };
  if (!isPlainObject(mutation)) return unchanged('invalid-mutation');

  var mut = mutation as Record<string, unknown>;
  var operation = mut.operation as string;
  var urlPattern = String(mut.urlPattern || '').trim();
  if (!urlPattern) return unchanged('invalid-url-pattern');
  if (operation !== 'add-selector' && operation !== 'remove-selector' && operation !== 'clear-site') {
    return unchanged('invalid-operation');
  }

  var timestamp = Number.isFinite(now) ? now : Date.now();
  if (operation === 'clear-site') {
    var cleared = normalized.filter(function(cfg) { return cfg.urlPattern !== urlPattern; });
    return { ok: true, reason: null, configs: cleared, config: null, changed: cleared.length !== normalized.length };
  }

  var selector = normalizeSelector(mut.selector);
  if (!selector) return unchanged('invalid-selector');
  var index = normalized.findIndex(function(cfg) { return cfg.urlPattern === urlPattern; });

  if (operation === 'remove-selector') {
    if (index < 0) return { ok: true, reason: null, configs: normalized, config: null, changed: false };
    var existing = normalized[index];
    var sels = existing.selectors.filter(function(item: NormalizedSelector) {
      return !(item.type === selector!.type && item.expr === selector!.expr);
    });
    var removed = sels.length !== existing.selectors.length;
    var updated = removed
      ? Object.assign({}, existing, { selectors: sels, updatedAt: timestamp }) as NormalizedConfig
      : existing;
    var afterRemove = normalized.slice();
    afterRemove[index] = updated;
    return { ok: true, reason: null, configs: normalizeConfigs(afterRemove, limits), config: updated, changed: removed };
  }

  var maxSels = positiveLimit(limits ? limits.maxSelectorsPerSite as number : 0, 50);
  var current: NormalizedConfig = index >= 0 ? normalized[index] : {
    urlPattern: urlPattern,
    side: mut.side === 'left' ? 'left' : 'right',
    selectors: [],
    updatedAt: 0
  };
  var nextSels = current.selectors.filter(function(item: NormalizedSelector) {
    return !(item.type === selector!.type && item.expr === selector!.expr);
  });
  nextSels.unshift(selector);
  nextSels = nextSels.slice(0, maxSels);
  var nextConfig = Object.assign({}, current, {
    urlPattern: urlPattern,
    side: current.side === 'left' ? 'left' : 'right',
    selectors: nextSels,
    updatedAt: timestamp
  }) as NormalizedConfig;
  var afterAdd = normalized.slice();
  if (index >= 0) afterAdd[index] = nextConfig;
  else afterAdd.push(nextConfig);
  var finalConfigs = normalizeConfigs(afterAdd, limits);
  var finalConfig = finalConfigs.find(function(cfg) { return cfg.urlPattern === urlPattern; }) || null;
  return { ok: true, reason: null, configs: finalConfigs, config: finalConfig, changed: true };
}

// --- UI state primitives ---

interface NormalizedPosition {
  x: number;
  y: number;
  updatedAt?: number;
  anchorX?: string;
}

function normalizePosition(value: unknown): NormalizedPosition | null {
  if (!isPlainObject(value)) return null;
  var val = value as Record<string, unknown>;
  var x = Number(val.x);
  var y = Number(val.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  var result: NormalizedPosition = { x: x, y: y };
  var updatedAt = Number(val.updatedAt);
  if (Number.isFinite(updatedAt)) result.updatedAt = updatedAt;
  if (val.anchorX === 'left' || val.anchorX === 'right') result.anchorX = val.anchorX as string;
  return result;
}

interface UiStateValidationResult {
  ok: boolean;
  reason: string | null;
}

function validateUiStateMutationSource(mutation: unknown, senderUrl: string): UiStateValidationResult {
  if (!isPlainObject(mutation)) return { ok: false, reason: 'bad-site' };
  var mut = mutation as Record<string, unknown>;
  try {
    var parsed = new URL(senderUrl);
    if (!/^https?:$/.test(parsed.protocol)) return { ok: false, reason: 'bad-site' };
    var expectedKey = mut.operation === 'set-badge-position'
      ? parsed.host
      : mut.operation === 'set-panel-expanded'
        ? parsed.origin
        : '';
    return expectedKey && String(mut.key || '').trim() === expectedKey
      ? { ok: true, reason: null }
      : { ok: false, reason: 'bad-site' };
  } catch (_) {
    return { ok: false, reason: 'bad-site' };
  }
}

interface UiStateMutationResult {
  ok: boolean;
  reason: string | null;
  map: Record<string, unknown>;
  value?: unknown;
}

function applyUiStateMutation(currentMap: unknown, mutation: unknown, maxKeys: number): UiStateMutationResult {
  var map = isPlainObject(currentMap) ? Object.assign({}, currentMap) as Record<string, unknown> : {} as Record<string, unknown>;
  if (!isPlainObject(mutation)) return { ok: false, reason: 'invalid-mutation', map: map };
  var mut = mutation as Record<string, unknown>;
  var operation = mut.operation as string;
  var key = String(mut.key || '').trim();
  if (!key || key.length > 2048) return { ok: false, reason: 'invalid-key', map: map };

  var value: unknown;
  if (operation === 'set-badge-position') {
    value = normalizePosition(mut.value);
    if (!value) return { ok: false, reason: 'invalid-position', map: map };
  } else if (operation === 'set-panel-expanded') {
    if (typeof mut.value !== 'boolean') return { ok: false, reason: 'invalid-expanded', map: map };
    value = mut.value;
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
  isPlainObject, isHighRiskBroadCssSelector,
  applyTocConfigMutation,
  validateUiStateMutationSource, applyUiStateMutation
};
