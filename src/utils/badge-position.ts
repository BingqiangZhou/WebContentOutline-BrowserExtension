
'use strict';

import { getBadgePosMap, saveBadgePosMap } from './storage.js';
import { serializedWrite, touchObjectKey, pruneObjectToLimit } from '../shared/primitives.js';
import { MAP_MAX_KEYS } from './constants.js';
import { TOC_MESSAGE, type TocRequest } from '../shared/messages.js';

interface BadgePos {
  x: number;
  y: number;
  anchorX?: string;
  updatedAt?: number;
}

export async function getBadgePosByHost(host: string) {
  var map: Record<string, BadgePos> | null = await getBadgePosMap();
  return (map && map[host]) || null;
}

export async function setBadgePosByHost(host: string, pos: { x: number; y: number; anchorX?: string; updatedAt?: number }) {
  if (!host || !pos) return null;

  var enriched: BadgePos = {
    x: Number(pos.x),
    y: Number(pos.y),
    updatedAt: typeof (pos as Record<string, unknown>).updatedAt === 'number' ? (pos as Record<string, unknown>).updatedAt as number : Date.now()
  };
  if ((pos as Record<string, unknown>).anchorX === 'left' || (pos as Record<string, unknown>).anchorX === 'right') enriched.anchorX = (pos as Record<string, unknown>).anchorX as string;

  // Try background message first for cross-tab consistency
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      return await new Promise<BadgePos | null>(function(resolve) {
        chrome.runtime.sendMessage({
          type: TOC_MESSAGE.MUTATE_UI_STATE,
          operation: 'set-badge-position',
          key: host,
          value: enriched
        } satisfies TocRequest, function(response: { ok?: boolean; value?: BadgePos } | undefined) {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(response && response.ok ? response.value as BadgePos : null);
        });
      });
    }
  } catch (_) {}

  // Fallback: direct storage write
  return serializedWrite('tocBadgePosMap', async function() {
    var map: Record<string, BadgePos> = await getBadgePosMap();
    map = map || {};
    touchObjectKey(map, host, enriched);
    pruneObjectToLimit(map, MAP_MAX_KEYS);
    var ok = await saveBadgePosMap(map);
    return ok ? (map[host] || null) : null;
  });
}
