
'use strict';

import { collectBySelector, uniqueInDocumentOrder } from './dom-utils.js';
import { getBoundedText } from './bounded-text.js';
import { detectContentRegion } from './content-region.js';

    var TOC_TEXT_MAX_LEN = 200;
    var TOC_MAX_ITEMS = 400;
    var TOC_MAX_CANDIDATES = 1200;

    function getTrimmedText(el) {
      var rawText = '';
      if (typeof getBoundedText === 'function') {
        rawText = getBoundedText(el, { maxChars: TOC_TEXT_MAX_LEN * 4, maxNodes: 160, maxDepth: 8 });
      } else {
        try { rawText = String(el && el.textContent || '').slice(0, TOC_TEXT_MAX_LEN * 4); } catch (_) { rawText = ''; }
      }
      rawText = rawText.trim();
      rawText = rawText.replace(/\s+/g, ' ');
      return rawText.length > TOC_TEXT_MAX_LEN ? rawText.substring(0, TOC_TEXT_MAX_LEN) + '...' : rawText;
    }

function getTocItemLevel(el) {
      var match = el && /^H([1-6])$/.exec(el.tagName || '');
      return match ? parseInt(match[1], 10) : 2;
    }

function buildTocItemsFromSelectors(selectors, cfg) {
      var elements = [];
      var list = Array.isArray(selectors) ? selectors : [];
      var perSelectorLimit = Math.max(1, Math.floor(TOC_MAX_CANDIDATES / Math.max(1, list.length)));

      for (var i = 0; i < list.length && elements.length < TOC_MAX_CANDIDATES; i++) {
        var sel = list[i];
        try {
          var selectorBudget = Math.min(perSelectorLimit, TOC_MAX_CANDIDATES - elements.length);
          var nodes = collectBySelector(sel, selectorBudget);
          var limit = Math.min(nodes.length, selectorBudget);
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

      // Phase 1: Batch-read all geometry in a tight loop (avoids forced reflows)
      var geoData = [];
      for (var m = 0; m < candidates.length; m++) {
        var el = candidates[m];
        if (!el || !el.isConnected) { geoData.push(null); continue; }
        var style;
        try { style = window.getComputedStyle(el); } catch (_) { geoData.push(null); continue; }
        if (!style || style.display === 'none') { geoData.push(null); continue; }
        var offsetParent;
        try { offsetParent = el.offsetParent; } catch (_) { geoData.push(null); continue; }
        if (offsetParent === null && style.position !== 'fixed') { geoData.push(null); continue; }
        var ow, oh;
        try { ow = el.offsetWidth; oh = el.offsetHeight; } catch (_) { geoData.push(null); continue; }
        if (ow === 0 || oh === 0) { geoData.push(null); continue; }
        if (style.visibility === 'hidden' || style.visibility === 'collapse') { geoData.push(null); continue; }
        var opacity = parseFloat(style.opacity);
        if (Number.isFinite(opacity) && opacity <= 0) { geoData.push(null); continue; }
        var rect;
        try { rect = el.getBoundingClientRect(); } catch (_) { geoData.push(null); continue; }
        if (!rect || rect.width === 0 || rect.height === 0) { geoData.push(null); continue; }
        geoData.push({ el: el, rect: rect });
      }

      // Phase 2: Filter using cached geometry — parent clipping + text extraction only for survivors
      var items = [];
      for (var g = 0; g < geoData.length; g++) {
        var entry = geoData[g];
        if (!entry) continue;
        var el = entry.el;
        var rect = entry.rect;

        // Parent clipping check (only for survivors that passed cheap checks)
        // Excludes headings truly hidden by collapsed/zero-size containers,
        // but preserves headings that are simply below the fold in a scrollable page.
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
              // Skip clipping check if a scrollable ancestor sits between the
              // heading and this clipping parent — the heading can be scrolled into view.
              var hasScrollableAncestor = false;
              var between = el.parentElement;
              while (between && between !== parent) {
                var bs;
                try { bs = window.getComputedStyle(between); } catch (_) { bs = null; }
                if (bs) {
                  var bo = bs.overflow || bs.overflowY;
                  if (bo === 'auto' || bo === 'scroll') {
                    try {
                      if (between.scrollHeight > between.clientHeight + 2) {
                        hasScrollableAncestor = true;
                        break;
                      }
                    } catch (_) {}
                  }
                }
                between = between.parentElement;
              }
              if (!hasScrollableAncestor) {
                var parentRect;
                try { parentRect = parent.getBoundingClientRect(); } catch (_) { break; }
                // Only clip if heading is completely outside AND the clipping parent
                // has negligible height (collapsed/tab) — not a full-height layout container
                var isCollapsed = parent.clientHeight < 10 || parent.offsetWidth < 10;
                if (isCollapsed && (rect.right <= parentRect.left || rect.left >= parentRect.right
                    || rect.bottom <= parentRect.top || rect.top >= parentRect.bottom)) {
                  clipped = true;
                  break;
                }
              }
            }
          }
          parent = parent.parentElement;
          depth++;
        }
        if (clipped) continue;

        var text = getTrimmedText(el);
        if (!keepEmpty && (!text || text.length === 0)) continue;

        items.push({ id: 'toc-item-' + items.length, el: el, text: text, level: getTocItemLevel(el) });
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

export function buildTocItems(cfg, extraSelectors) {
      var base = Array.isArray(cfg.selectors) ? cfg.selectors : [];
      var combined = (Array.isArray(extraSelectors) ? extraSelectors : []).concat(base);

      if (combined.length === 0) {
        var region = null;
        try { region = detectContentRegion(); } catch (_) {}
        if (region && region.root) {
          combined = [{ type: 'css', expr: 'h1, h2, h3, h4, h5, h6', _root: region.root }];
        } else {
          combined = [{ type: 'css', expr: 'h1, h2, h3, h4, h5, h6' }];
        }
      }

      return buildTocItemsFromSelectors(combined, cfg);
    }
