(() => {
  'use strict';

  const { collectBySelector, uniqueInDocumentOrder, uiConst } = window.TOC_UTILS || {};
  const CFG = (() => {
    const get = (name, fallback) => (typeof uiConst === 'function') ? uiConst(name, fallback) : fallback;
    return {
      TOC_TEXT_MAX_LEN: get('TOC_TEXT_MAX_LEN', 200),
      TOC_MAX_ITEMS: get('TOC_MAX_ITEMS', 400),
      TOC_MAX_CANDIDATES: get('TOC_MAX_CANDIDATES', 1200),
    };
  })();

  function getTrimmedText(el) {
    let rawText = '';
    if (el) {
      rawText = (el.textContent || '').trim();
    }
    rawText = rawText.replace(/\s+/g, ' ');
    return rawText.length > CFG.TOC_TEXT_MAX_LEN ? rawText.substring(0, CFG.TOC_TEXT_MAX_LEN) + '...' : rawText;
  }

  /**
   * Batch-read layout data for all elements in one synchronous pass,
   * then filter visibility using the cached data.
   */
  function batchCollectVisibility(elements) {
    const len = elements.length;
    const styles = new Array(len);
    const rects = new Array(len);
    const offsetParents = new Array(len);
    const offsetWidths = new Array(len);
    const offsetHeights = new Array(len);

    // Phase 1: Batch all layout-triggering reads in one synchronous block.
    for (let i = 0; i < len; i++) {
      const el = elements[i];
      try {
        styles[i] = window.getComputedStyle(el);
        rects[i] = el.getBoundingClientRect();
        offsetParents[i] = el.offsetParent;
        offsetWidths[i] = el.offsetWidth;
        offsetHeights[i] = el.offsetHeight;
      } catch (_) {
        styles[i] = null;
        rects[i] = null;
        offsetParents[i] = null;
        offsetWidths[i] = 0;
        offsetHeights[i] = 0;
      }
    }

    // Phase 2: Filter based on cached layout data.
    const visible = new Array(len);
    for (let i = 0; i < len; i++) {
      const el = elements[i];
      const style = styles[i];
      const rect = rects[i];

      if (!el || !el.isConnected) { visible[i] = false; continue; }
      if (!style) { visible[i] = false; continue; }
      if (style.display === 'none') { visible[i] = false; continue; }
      if (offsetParents[i] === null && style.position !== 'fixed') { visible[i] = false; continue; }
      if (offsetWidths[i] === 0 || offsetHeights[i] === 0) { visible[i] = false; continue; }
      if (style.visibility === 'hidden' || style.visibility === 'collapse') { visible[i] = false; continue; }
      const opacity = parseFloat(style.opacity);
      if (Number.isFinite(opacity) && opacity <= 0) { visible[i] = false; continue; }
      if (!rect || rect.width === 0 || rect.height === 0) { visible[i] = false; continue; }

      // Check parent clipping (uses cached rect from phase 1)
      let clipped = false;
      let parent = el.parentElement;
      let depth = 0;
      while (parent && depth < 3) {
        let parentStyle;
        try { parentStyle = window.getComputedStyle(parent); } catch (_) { break; }
        if (parentStyle) {
          const overflowVal = parentStyle.overflow;
          const overflowX = parentStyle.overflowX;
          const overflowY = parentStyle.overflowY;
          const clips = overflowVal === 'hidden' || overflowVal === 'clip'
            || overflowX === 'hidden' || overflowX === 'clip'
            || overflowY === 'hidden' || overflowY === 'clip';
          if (clips) {
            let parentRect;
            try { parentRect = parent.getBoundingClientRect(); } catch (_) { break; }
            if (rect.right <= parentRect.left || rect.left >= parentRect.right ||
                rect.bottom <= parentRect.top || rect.top >= parentRect.bottom) {
              clipped = true;
              break;
            }
          }
        }
        parent = parent.parentElement;
        depth++;
      }
      visible[i] = !clipped;
    }

    return visible;
  }

  function buildTocItemsFromSelectors(selectors, cfg) {
    const elements = [];
    const list = Array.isArray(selectors) ? selectors : [];
    const perSelectorLimit = Math.max(100, Math.floor(CFG.TOC_MAX_CANDIDATES / Math.max(1, list.length)));

    for (const sel of list) {
      try {
        const nodes = collectBySelector(sel);
        const limit = Math.min(nodes.length, perSelectorLimit);
        for (let i = 0; i < limit; i++) {
          elements.push(nodes[i]);
        }
      } catch (_) {}
    }

    const keepEmpty = !!(cfg && cfg.keepEmptyText);
    const allUniq = uniqueInDocumentOrder(elements);
    let truncated = false;

    let candidates = allUniq;
    if (candidates.length > CFG.TOC_MAX_CANDIDATES) {
      candidates = candidates.slice(0, CFG.TOC_MAX_CANDIDATES);
      truncated = true;
    }

    // Batch visibility check — one synchronous layout pass for all candidates
    const visibility = batchCollectVisibility(candidates);

    const items = [];
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (!el) continue;

      const text = getTrimmedText(el);
      if (!keepEmpty && (!text || text.length === 0)) continue;
      if (!visibility[i]) continue;

      items.push({ id: 'toc-item-' + items.length, el, text });
      if (items.length >= CFG.TOC_MAX_ITEMS) {
        truncated = true;
        break;
      }
    }

    return {
      items,
      meta: {
        truncated,
        maxItems: CFG.TOC_MAX_ITEMS,
        totalCandidates: allUniq.length
      }
    };
  }

  function buildTocItems(cfg, extraSelectors = []) {
    const base = Array.isArray(cfg.selectors) ? cfg.selectors : [];
    let combined = (Array.isArray(extraSelectors) ? extraSelectors : []).concat(base);

    if (combined.length === 0) {
      combined = [{ type: 'css', expr: 'h1, h2, h3, h4, h5, h6' }];
    }

    return buildTocItemsFromSelectors(combined, cfg);
  }

  window.TOC_BUILDER = {
    buildTocItemsFromSelectors,
    buildTocItems
  };
})();

