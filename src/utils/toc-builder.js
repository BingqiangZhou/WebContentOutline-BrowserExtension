(() => {
  'use strict';

  const { collectBySelector, uniqueInDocumentOrder } = window.TOC_UTILS || {};

  function getTrimmedText(el) {
    let rawText = '';
    if (el) {
      rawText = (el.textContent || '').trim();
      if (!rawText && el.innerText) {
        rawText = el.innerText.trim();
      }
    }
    rawText = rawText.replace(/\s+/g, ' ');
    const maxLength = 200;
    return rawText.length > maxLength ? rawText.substring(0, maxLength) + '...' : rawText;
  }

  function isElementVisible(el) {
    if (!el) return false;
    const rects = el.getClientRects();
    if (!rects || rects.length === 0) return false;

    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    if (el.offsetParent === null && style.position !== 'fixed') {
      return false;
    }

    const rect = rects[0];
    if (rect.width === 0 || rect.height === 0) return false;

    if (style.overflow === 'hidden') {
      const parent = el.parentElement;
      if (parent) {
        const parentRect = parent.getBoundingClientRect();
        if (rect.right < parentRect.left || rect.left > parentRect.right ||
            rect.bottom < parentRect.top || rect.top > parentRect.bottom) {
          return false;
        }
      }
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
    const uniq = uniqueInDocumentOrder(elements)
      .map((el, i) => {
        const text = getTrimmedText(el);
        return { id: 'toc-item-' + i, el, text };
      })
      .filter(item => {
        if (!keepEmpty && (!item.text || item.text.length === 0)) return false;
        return isElementVisible(item.el);
      });

    return uniq;
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

