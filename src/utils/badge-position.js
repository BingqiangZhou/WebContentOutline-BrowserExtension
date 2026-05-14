(() => {
  const T = globalThis.TOC_UTILS;
  if (!T) return;

  const {
    getBadgePosMap,
    saveBadgePosMap,
    getStorage,
    STORAGE_KEYS,
    getFiniteNumber,
    uiConst,
    serializedWrite,
    touchObjectKey,
    pruneObjectToLimit
  } = T;

  let __badgePosCache = null;
  let __badgePosCacheReady = false;

function resolveBadgePosForViewport(pos) {
  try {
    if (!pos) return null;

    // Legacy compat: {left, top} -> {x, y} using default badge size.
    if (!Number.isFinite(pos.x) && Number.isFinite(pos.left)) {
      const bw = (typeof uiConst === 'function') ? uiConst('BADGE_WIDTH', 80) : 80;
      pos = { ...pos, x: pos.left + bw / 2 };
    }
    if (!Number.isFinite(pos.y) && Number.isFinite(pos.top)) {
      const bh = (typeof uiConst === 'function') ? uiConst('BADGE_HEIGHT', 32) : 32;
      pos = { ...pos, y: pos.top + bh / 2 };
    }

    const x = getFiniteNumber(pos.x);
    const y = getFiniteNumber(pos.y);
    if (x == null && y == null) return pos;

    const vwNow = (typeof window !== 'undefined') ? getFiniteNumber(window.innerWidth) : null;
    const vhNow = (typeof window !== 'undefined') ? getFiniteNumber(window.innerHeight) : null;
    if (!vwNow || !vhNow) return pos;

    const anchorX = (pos.anchorX === 'left' || pos.anchorX === 'right') ? pos.anchorX : null;
    const marginX = getFiniteNumber(pos.marginX);
    const vhSaved = getFiniteNumber(pos.vh);

    let resolvedX = x;
    if (anchorX && marginX != null) {
      // Keep anchored edge preference even if the viewport is too small.
      const bw = (typeof uiConst === 'function') ? uiConst('BADGE_WIDTH', 80) : 80;
      const dragMargin = (typeof uiConst === 'function') ? uiConst('DRAG_MARGIN_PX', 4) : 4;
      const minX = dragMargin + bw / 2;
      const maxX = vwNow - dragMargin - bw / 2;
      const hasRoom = (Number.isFinite(minX) && Number.isFinite(maxX) && maxX >= minX);
      const rawX = (anchorX === 'right') ? (vwNow - marginX) : marginX;
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

    let resolvedY = y;
    if (vhSaved && y != null) {
      resolvedY = y * (vhNow / vhSaved);
    }

    return { ...pos, x: resolvedX, y: resolvedY };
  } catch (_) {
    return pos || null;
  }
}

async function getBadgePosByHost(host) {
  if (!__badgePosCacheReady) {
    __badgePosCache = await getBadgePosMap();
    __badgePosCacheReady = true;
  }
  const pos = (__badgePosCache && __badgePosCache[host]) || null;
  return resolveBadgePosForViewport(pos);
}

  async function setBadgePosByHost(host, pos) {
    if (!host) return null;

    // Update cache synchronously so subsequent reads are instant
    if (!__badgePosCacheReady) {
      try { __badgePosCache = await getBadgePosMap(); } catch (_) { __badgePosCache = {}; }
      __badgePosCacheReady = true;
    }

    let enriched = pos;
    try {
      const x = pos && getFiniteNumber(pos.x);
      const y = pos && getFiniteNumber(pos.y);
      const vw = (typeof window !== 'undefined') ? getFiniteNumber(window.innerWidth) : null;
      const vh = (typeof window !== 'undefined') ? getFiniteNumber(window.innerHeight) : null;
      if (x != null && y != null && vw && vh) {
        const anchorX = (pos.anchorX === 'left' || pos.anchorX === 'right')
          ? pos.anchorX
          : (x > (vw / 2) ? 'right' : 'left');
        const marginX = (anchorX === 'right') ? (vw - x) : x;
        enriched = {
          ...pos,
          x,
          y,
          vw,
          vh,
          anchorX,
          marginX,
          updatedAt: (typeof pos.updatedAt === 'number') ? pos.updatedAt : Date.now()
        };
      }
    } catch (_) {
      enriched = pos;
    }

    touchObjectKey(__badgePosCache, host, enriched);
    pruneObjectToLimit(__badgePosCache, uiConst('STORAGE_MAX_MAP_KEYS', 400));

    // Fire-and-forget: serialize the write but do not await it on the hot path.
    // The caller can still await if it needs confirmation (e.g. pagehide).
    return serializedWrite('tocBadgePosMap', async () => {
      const ok = await saveBadgePosMap(__badgePosCache);
      return ok ? (__badgePosCache[host] || null) : null;
    });
  }

  Object.assign(T, {
    getBadgePosByHost,
    setBadgePosByHost
  });
})();
