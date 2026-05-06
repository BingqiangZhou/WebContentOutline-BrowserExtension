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

  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;

    // Batch all layout-triggering reads together to minimize forced reflows.
    let style, offsetParentVal, offsetWidthVal, offsetHeightVal, rect;
    try {
      style = window.getComputedStyle(el);
      offsetParentVal = el.offsetParent;
      offsetWidthVal = el.offsetWidth;
      offsetHeightVal = el.offsetHeight;
      rect = el.getBoundingClientRect();
    } catch (_) {
      return false;
    }

    if (!style) return false;
    if (style.display === 'none') return false;
    if (offsetParentVal === null && style.position !== 'fixed') return false;
    if (offsetWidthVal === 0 || offsetHeightVal === 0) return false;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    const opacity = parseFloat(style.opacity);
    if (Number.isFinite(opacity) && opacity <= 0) return false;
    if (!rect || rect.width === 0 || rect.height === 0) return false;

    let parent = el.parentElement;
    let depth = 0;
    while (parent && depth < 3) {
      let parentStyle;
      try {
        parentStyle = window.getComputedStyle(parent);
      } catch (_) {
        break;
      }
      if (parentStyle) {
        const overflowVal = parentStyle.overflow;
        const overflowX = parentStyle.overflowX;
        const overflowY = parentStyle.overflowY;
        const clips = overflowVal === 'hidden' || overflowVal === 'clip'
          || overflowX === 'hidden' || overflowX === 'clip'
          || overflowY === 'hidden' || overflowY === 'clip';
        if (clips) {
          let parentRect;
          try {
            parentRect = parent.getBoundingClientRect();
          } catch (_) {
            break;
          }
          if (rect.right <= parentRect.left || rect.left >= parentRect.right ||
              rect.bottom <= parentRect.top || rect.top >= parentRect.bottom) {
            return false;
          }
        }
      }
      parent = parent.parentElement;
      depth++;
    }

    return true;
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
    const totalCandidates = allUniq.length;
    let truncated = false;

    let candidates = allUniq;
    if (candidates.length > CFG.TOC_MAX_CANDIDATES) {
      candidates = candidates.slice(0, CFG.TOC_MAX_CANDIDATES);
      truncated = true;
    }

    const items = [];
    for (let i = 0; i < candidates.length; i++) {
      const el = candidates[i];
      if (!el) continue;

      const text = getTrimmedText(el);
      if (!keepEmpty && (!text || text.length === 0)) continue;
      if (!isElementVisible(el)) continue;

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
        totalCandidates
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

