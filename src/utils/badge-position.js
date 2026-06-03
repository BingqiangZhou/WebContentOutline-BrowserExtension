'use strict';

import { getBadgePosMap, saveBadgePosMap } from './storage.js';
import { getFiniteNumber } from './core-utils.js';
import { serializedWrite, touchObjectKey, pruneObjectToLimit } from '../shared/primitives.js';

export function resolveBadgePosForViewport(pos) {
  if (!pos) return null;
  // Legacy compat: {left, top} -> {x, y} using default badge size.
  if (!Number.isFinite(pos.x) && Number.isFinite(pos.left)) {
    pos = Object.assign({}, pos, { x: pos.left + 40 });
  }
  if (!Number.isFinite(pos.y) && Number.isFinite(pos.top)) {
    pos = Object.assign({}, pos, { y: pos.top + 16 });
  }
  return pos;
}

export function getBadgePosByHost(host) {
  return getBadgePosMap().then(function(map) {
    var pos = (map && map[host]) || null;
    return resolveBadgePosForViewport(pos);
  });
}

export function setBadgePosByHost(host, pos) {
  if (!host) return Promise.resolve(null);

  var enriched = pos;
  try {
    var x = pos && getFiniteNumber(pos.x);
    var y = pos && getFiniteNumber(pos.y);
    if (x != null && y != null) {
      enriched = Object.assign({}, pos, {
        x: x,
        y: y,
        updatedAt: (typeof pos.updatedAt === 'number') ? pos.updatedAt : Date.now()
      });
    }
  } catch (_) {
    enriched = pos;
  }

  // Try background message first for cross-tab consistency
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      return new Promise(function(resolve) {
        chrome.runtime.sendMessage({
          type: 'toc:mutateUiState',
          operation: 'set-badge-position',
          key: host,
          value: enriched
        }, function(response) {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(response && response.ok ? response.value : null);
        });
      });
    }
  } catch (_) {}

  // Fallback: direct storage write
  return serializedWrite('tocBadgePosMap', function() {
    return getBadgePosMap().then(function(map) {
      map = map || {};
      touchObjectKey(map, host, enriched);
      pruneObjectToLimit(map, 400);
      return saveBadgePosMap(map).then(function(ok) { return ok ? (map[host] || null) : null; });
    });
  });
}
