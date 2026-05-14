define('toc-builder', ['dom-utils', 'toc-constants'],
  function(domUtils, constants) {
    'use strict';

    var collectBySelector = domUtils.collectBySelector;
    var uniqueInDocumentOrder = domUtils.uniqueInDocumentOrder;
    var uiConst = constants.uiConst;

    var TOC_TEXT_MAX_LEN = (typeof uiConst === 'function') ? uiConst('TOC_TEXT_MAX_LEN', 200) : 200;
    var TOC_MAX_ITEMS = (typeof uiConst === 'function') ? uiConst('TOC_MAX_ITEMS', 400) : 400;
    var TOC_MAX_CANDIDATES = (typeof uiConst === 'function') ? uiConst('TOC_MAX_CANDIDATES', 1200) : 1200;

    function getTrimmedText(el) {
      var rawText = '';
      if (el) {
        rawText = (el.textContent || '').trim();
      }
      rawText = rawText.replace(/\s+/g, ' ');
      return rawText.length > TOC_TEXT_MAX_LEN ? rawText.substring(0, TOC_TEXT_MAX_LEN) + '...' : rawText;
    }

    function buildTocItemsFromSelectors(selectors, cfg) {
      var elements = [];
      var list = Array.isArray(selectors) ? selectors : [];
      var perSelectorLimit = Math.max(100, Math.floor(TOC_MAX_CANDIDATES / Math.max(1, list.length)));

      for (var i = 0; i < list.length; i++) {
        var sel = list[i];
        try {
          var nodes = collectBySelector(sel);
          var limit = Math.min(nodes.length, perSelectorLimit);
          for (var k = 0; k < limit; k++) {
            elements.push(nodes[k]);
          }
        } catch (_) {}
      }

      var keepEmpty = !!(cfg && cfg.keepEmptyText);
      var allUniq = uniqueInDocumentOrder(elements);
      var truncated = false;

      var candidates = allUniq;
      if (candidates.length > TOC_MAX_CANDIDATES) {
        candidates = candidates.slice(0, TOC_MAX_CANDIDATES);
        truncated = true;
      }

      var items = [];
      for (var m = 0; m < candidates.length; m++) {
        var el = candidates[m];

        // Phase 1: cheap checks (no layout reads)
        if (!el || !el.isConnected) continue;

        var text = getTrimmedText(el);
        if (!keepEmpty && (!text || text.length === 0)) continue;

        // Phase 2: style + geometry checks (one layout read batch per element)
        var style;
        try { style = window.getComputedStyle(el); } catch (_) { continue; }
        if (!style) continue;
        if (style.display === 'none') continue;

        var offsetParent;
        try { offsetParent = el.offsetParent; } catch (_) { continue; }
        if (offsetParent === null && style.position !== 'fixed') continue;

        var ow, oh;
        try { ow = el.offsetWidth; oh = el.offsetHeight; } catch (_) { continue; }
        if (ow === 0 || oh === 0) continue;

        if (style.visibility === 'hidden' || style.visibility === 'collapse') continue;
        var opacity = parseFloat(style.opacity);
        if (Number.isFinite(opacity) && opacity <= 0) continue;

        var rect;
        try { rect = el.getBoundingClientRect(); } catch (_) { continue; }
        if (!rect || rect.width === 0 || rect.height === 0) continue;

        // Phase 3: parent clipping check (only for phase 2 survivors)
        var clipped = false;
        var parent = el.parentElement;
        var depth = 0;
        while (parent && depth < 3) {
          var parentStyle;
          try { parentStyle = window.getComputedStyle(parent); } catch (_) { break; }
          if (parentStyle) {
            var overflowVal = parentStyle.overflow;
            var overflowX = parentStyle.overflowX;
            var overflowY = parentStyle.overflowY;
            var clips = overflowVal === 'hidden' || overflowVal === 'clip'
              || overflowX === 'hidden' || overflowX === 'clip'
              || overflowY === 'hidden' || overflowY === 'clip';
            if (clips) {
              var parentRect;
              try { parentRect = parent.getBoundingClientRect(); } catch (_) { break; }
              if (rect.right <= parentRect.left || rect.left >= parentRect.right
                  || rect.bottom <= parentRect.top || rect.top >= parentRect.bottom) {
                clipped = true;
                break;
              }
            }
          }
          parent = parent.parentElement;
          depth++;
        }
        if (clipped) continue;

        items.push({ id: 'toc-item-' + items.length, el: el, text: text });
        if (items.length >= TOC_MAX_ITEMS) {
          truncated = true;
          break;
        }
      }

      return {
        items: items,
        meta: {
          truncated: truncated,
          maxItems: TOC_MAX_ITEMS,
          totalCandidates: allUniq.length
        }
      };
    }

    function buildTocItems(cfg, extraSelectors) {
      var base = Array.isArray(cfg.selectors) ? cfg.selectors : [];
      var combined = (Array.isArray(extraSelectors) ? extraSelectors : []).concat(base);

      if (combined.length === 0) {
        combined = [{ type: 'css', expr: 'h1, h2, h3, h4, h5, h6' }];
      }

      return buildTocItemsFromSelectors(combined, cfg);
    }

    var api = {
      buildTocItems: buildTocItems,
      buildTocItemsFromSelectors: buildTocItemsFromSelectors
    };

    try { window.TOC_BUILDER = api; } catch (_) {}

    return api;
  }
);
