'use strict';

import { getBadgePosMap, saveBadgePosMap } from './storage.js';
import { serializedWrite, touchObjectKey, pruneObjectToLimit } from '../shared/primitives.js';

export function getBadgePosByHost(host) {
  return getBadgePosMap().then(function(map) {
    return (map && map[host]) || null;
  });
}

export function setBadgePosByHost(host, pos) {
  if (!host || !pos) return Promise.resolve(null);

  var enriched = {
    x: Number(pos.x),
    y: Number(pos.y),
    updatedAt: typeof pos.updatedAt === 'number' ? pos.updatedAt : Date.now()
  };
  if (pos.anchorX === 'left' || pos.anchorX === 'right') enriched.anchorX = pos.anchorX;

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
