
'use strict';

import { getBadgePosMap, saveBadgePosMap } from './storage.js';
import { serializedWrite, touchObjectKey, pruneObjectToLimit } from '../shared/primitives.js';

export async function getBadgePosByHost(host) {
  var map = await getBadgePosMap();
  return (map && map[host]) || null;
}

export async function setBadgePosByHost(host, pos) {
  if (!host || !pos) return null;

  var enriched: { x: number; y: number; updatedAt?: number; anchorX?: string } = {
    x: Number(pos.x),
    y: Number(pos.y),
    updatedAt: typeof (pos as any).updatedAt === 'number' ? (pos as any).updatedAt : Date.now()
  };
  if ((pos as any).anchorX === 'left' || (pos as any).anchorX === 'right') enriched.anchorX = (pos as any).anchorX;

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
