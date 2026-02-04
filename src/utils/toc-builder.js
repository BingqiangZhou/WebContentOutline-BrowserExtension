(() => {
  'use strict';

  const { collectBySelector, uniqueInDocumentOrder, uiConst } = window.TOC_UTILS || {};
  const TOC_TEXT_MAX_LEN = typeof uiConst === 'function' ? uiConst('TOC_TEXT_MAX_LEN', 200) : 200;
  const TOC_MAX_ITEMS = typeof uiConst === 'function' ? uiConst('TOC_MAX_ITEMS', 400) : 400;
  const TOC_MAX_CANDIDATES = typeof uiConst === 'function' ? uiConst('TOC_MAX_CANDIDATES', 1200) : 1200;

  function getTrimmedText(el) {
    let rawText = '';
    if (el) {
      rawText = (el.textContent || '').trim();
    }
    rawText = rawText.replace(/\s+/g, ' ');
    return rawText.length > TOC_TEXT_MAX_LEN ? rawText.substring(0, TOC_TEXT_MAX_LEN) + '...' : rawText;
  }

  function isElementVisible(el) {
    if (!el || !el.isConnected) return false;

    let rect;
    try {
      rect = el.getBoundingClientRect();
    } catch (_) {
      return false;
    }
    if (!rect || rect.width === 0 || rect.height === 0) return false;

    let style;
    try {
      style = window.getComputedStyle(el);
    } catch (_) {
      return false;
    }

    if (!style) return false;
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    const opacity = parseFloat(style.opacity);
    if (Number.isFinite(opacity) && opacity <= 0) return false;
    if (el.offsetParent === null && style.position !== 'fixed') return false;

    // Cheap clipping check: walk a few ancestors and reject if fully outside overflow-hidden/clip containers.
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
        const overflowHidden = parentStyle.overflow === 'hidden'
          || parentStyle.overflowX === 'hidden'
          || parentStyle.overflowY === 'hidden'
          || parentStyle.overflow === 'clip'
          || parentStyle.overflowX === 'clip'
          || parentStyle.overflowY === 'clip';
        if (overflowHidden) {
          const parentRect = parent.getBoundingClientRect();
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

    for (const sel of list) {
      try {
        const nodes = collectBySelector(sel);
        for (const node of nodes) {
          elements.push(node);
        }
      } catch (_) {}
    }

    const keepEmpty = !!(cfg && cfg.keepEmptyText);
    const allUniq = uniqueInDocumentOrder(elements);
    const totalCandidates = allUniq.length;
    let truncated = false;

    let candidates = allUniq;
    if (candidates.length > TOC_MAX_CANDIDATES) {
      candidates = candidates.slice(0, TOC_MAX_CANDIDATES);
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
      if (items.length >= TOC_MAX_ITEMS) {
        truncated = true;
        break;
      }
    }

    return {
      items,
      meta: {
        truncated,
        maxItems: TOC_MAX_ITEMS,
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

