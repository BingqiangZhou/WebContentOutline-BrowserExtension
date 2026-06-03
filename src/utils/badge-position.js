'use strict';

import { getBadgePosMap, saveBadgePosMap } from './storage.js';
import { serializedWrite, touchObjectKey, pruneObjectToLimit } from '../shared/primitives.js';

export async function getBadgePosByHost(host) {
  var map = await getBadgePosMap();
  return (map && map[host]) || null;
}

export async function setBadgePosByHost(host, pos) {
  if (!host || !pos) return null;

  var enriched = {
    x: Number(pos.x),
    y: Number(pos.y),
    updatedAt: typeof pos.updatedAt === 'number' ? pos.updatedAt : Date.now()
  };
  if (pos.anchorX === 'left' || pos.anchorX === 'right') enriched.anchorX = pos.anchorX;

  // Try background message first for cross-tab consistency
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      return await new Promise(function(resolve) {
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
  return serializedWrite('tocBadgePosMap', async function() {
    var map = await getBadgePosMap();
    map = map || {};
    touchObjectKey(map, host, enriched);
    pruneObjectToLimit(map, 400);
    var ok = await saveBadgePosMap(map);
    return ok ? (map[host] || null) : null;
  });
}
