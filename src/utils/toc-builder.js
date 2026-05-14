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

    /**
     * Batch-read layout data for all elements in one synchronous pass,
     * then filter visibility using the cached data.
     */
    function batchCollectVisibility(elements) {
      var len = elements.length;
      var styles = new Array(len);
      var rects = new Array(len);
      var offsetParents = new Array(len);
      var offsetWidths = new Array(len);
      var offsetHeights = new Array(len);

      // Phase 1: Batch all layout-triggering reads in one synchronous block.
      for (var i = 0; i < len; i++) {
        var el = elements[i];
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
      var visible = new Array(len);
      for (var j = 0; j < len; j++) {
        var el2 = elements[j];
        var style = styles[j];
        var rect = rects[j];

        if (!el2 || !el2.isConnected) { visible[j] = false; continue; }
        if (!style) { visible[j] = false; continue; }
        if (style.display === 'none') { visible[j] = false; continue; }
        if (offsetParents[j] === null && style.position !== 'fixed') { visible[j] = false; continue; }
        if (offsetWidths[j] === 0 || offsetHeights[j] === 0) { visible[j] = false; continue; }
        if (style.visibility === 'hidden' || style.visibility === 'collapse') { visible[j] = false; continue; }
        var opacity = parseFloat(style.opacity);
        if (Number.isFinite(opacity) && opacity <= 0) { visible[j] = false; continue; }
        if (!rect || rect.width === 0 || rect.height === 0) { visible[j] = false; continue; }

        // Check parent clipping (uses cached rect from phase 1)
        var clipped = false;
        var parent = el2.parentElement;
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
        visible[j] = !clipped;
      }

      return visible;
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

      // Batch visibility check — one synchronous layout pass for all candidates
      var visibility = batchCollectVisibility(candidates);

      var items = [];
      for (var m = 0; m < candidates.length; m++) {
        var el = candidates[m];
        if (!el) continue;

        var text = getTrimmedText(el);
        if (!keepEmpty && (!text || text.length === 0)) continue;
        if (!visibility[m]) continue;

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
