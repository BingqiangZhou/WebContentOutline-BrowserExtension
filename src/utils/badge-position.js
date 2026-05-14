'use strict';

import { getBadgePosMap, saveBadgePosMap } from './storage.js';
import { uiConst } from './constants.js';
import { getFiniteNumber } from './core-utils.js';
import { serializedWrite, touchObjectKey, pruneObjectToLimit } from '../shared/storage-primitives.js';

export function resolveBadgePosForViewport(pos) {
      try {
        if (!pos) return null;

        // Legacy compat: {left, top} -> {x, y} using default badge size.
        if (!Number.isFinite(pos.x) && Number.isFinite(pos.left)) {
          var bw = (typeof uiConst === 'function') ? uiConst('BADGE_WIDTH', 80) : 80;
          pos = Object.assign({}, pos, { x: pos.left + bw / 2 });
        }
        if (!Number.isFinite(pos.y) && Number.isFinite(pos.top)) {
          var bh = (typeof uiConst === 'function') ? uiConst('BADGE_HEIGHT', 32) : 32;
          pos = Object.assign({}, pos, { y: pos.top + bh / 2 });
        }

        var x = getFiniteNumber(pos.x);
        var y = getFiniteNumber(pos.y);
        if (x == null && y == null) return pos;

        var vwNow = (typeof window !== 'undefined') ? getFiniteNumber(window.innerWidth) : null;
        var vhNow = (typeof window !== 'undefined') ? getFiniteNumber(window.innerHeight) : null;
        if (!vwNow || !vhNow) return pos;

        var anchorX = (pos.anchorX === 'left' || pos.anchorX === 'right') ? pos.anchorX : null;
        var marginX = getFiniteNumber(pos.marginX);
        var vhSaved = getFiniteNumber(pos.vh);

        var resolvedX = x;
        if (anchorX && marginX != null) {
          // Keep anchored edge preference even if the viewport is too small.
          var bw2 = (typeof uiConst === 'function') ? uiConst('BADGE_WIDTH', 80) : 80;
          var dragMargin = (typeof uiConst === 'function') ? uiConst('DRAG_MARGIN_PX', 4) : 4;
          var minX = dragMargin + bw2 / 2;
          var maxX = vwNow - dragMargin - bw2 / 2;
          var hasRoom = (Number.isFinite(minX) && Number.isFinite(maxX) && maxX >= minX);
          var rawX = (anchorX === 'right') ? (vwNow - marginX) : marginX;
          if (!hasRoom) {
            resolvedX = Math.max(0, Math.min(vwNow, rawX));
          } else if (anchorX === 'right') {
            // If raw would push off the left side, stick to the rightmost visible position instead of flipping left.
            if (rawX < minX) resolvedX = maxX;
            else resolvedX = Math.min(maxX, Math.max(minX, rawX));
          } else {
            // anchorX === 'left'
            // If raw would push off the right side, stick to the leftmost visible position instead of flipping right.
            if (rawX > maxX) resolvedX = minX;
            else resolvedX = Math.min(maxX, Math.max(minX, rawX));
          }
        }

        var resolvedY = y;
        if (vhSaved && y != null) {
          resolvedY = y * (vhNow / vhSaved);
        }

        return Object.assign({}, pos, { x: resolvedX, y: resolvedY });
      } catch (_) {
        return pos || null;
      }
    }

export function getBadgePosByHost(host) {
      return getBadgePosMap().then(function(map) {
        var pos = (map && map[host]) || null;
        return resolveBadgePosForViewport(pos);
      });
    }

export function setBadgePosByHost(host, pos) {
      if (!host) return Promise.resolve(null);

      var enrichAndSave = function(map) {
        var enriched = pos;
        try {
          var x = pos && getFiniteNumber(pos.x);
          var y = pos && getFiniteNumber(pos.y);
          var vw = (typeof window !== 'undefined') ? getFiniteNumber(window.innerWidth) : null;
          var vh = (typeof window !== 'undefined') ? getFiniteNumber(window.innerHeight) : null;
          if (x != null && y != null && vw && vh) {
            var anchorX = (pos.anchorX === 'left' || pos.anchorX === 'right')
              ? pos.anchorX
              : (x > (vw / 2) ? 'right' : 'left');
            var marginX = (anchorX === 'right') ? (vw - x) : x;
            enriched = Object.assign({}, pos, {
              x: x,
              y: y,
              vw: vw,
              vh: vh,
              anchorX: anchorX,
              marginX: marginX,
              updatedAt: (typeof pos.updatedAt === 'number') ? pos.updatedAt : Date.now()
            });
          }
        } catch (_) {
          enriched = pos;
        }

        map = map || {};
        touchObjectKey(map, host, enriched);
        pruneObjectToLimit(map, uiConst('STORAGE_MAX_MAP_KEYS', 400));

        return saveBadgePosMap(map).then(function(ok) {
          return ok ? (map[host] || null) : null;
        });
      };

      return serializedWrite('tocBadgePosMap', function() {
        return getBadgePosMap().then(function(map) {
          return enrichAndSave(map || {});
        }).catch(function() {
          return enrichAndSave({});
        });
      });
    }
