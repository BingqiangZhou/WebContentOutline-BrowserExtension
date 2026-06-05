
'use strict';

import { collectBySelector, uniqueInDocumentOrder } from './dom-utils.js';
import { getBoundedText } from './bounded-text.js';
import { detectContentRegion } from './content-region.js';
import { tryBuildChatbotTocItems, getChatbotSentinelSelector } from './chatbot-detector.js';

    var TOC_TEXT_MAX_LEN = 200;
    var TOC_MAX_ITEMS = 400;
    var TOC_MAX_CANDIDATES = 1200;
    var COLLAPSE_WS_RE = /\s+/g;

    function getTrimmedText(el) {
      var rawText = '';
      if (typeof getBoundedText === 'function') {
        rawText = getBoundedText(el, { maxChars: TOC_TEXT_MAX_LEN * 4, maxNodes: 160, maxDepth: 8 });
      } else {
        try { rawText = String(el && el.textContent || '').slice(0, TOC_TEXT_MAX_LEN * 4); } catch (_) { rawText = ''; }
      }
      rawText = rawText.trim();
      rawText = rawText.replace(COLLAPSE_WS_RE, ' ');
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
      // Order: cheap property reads first, expensive getComputedStyle last
      var geoData = [];
      var docEl = document.documentElement;
      var docScrollW = (docEl && docEl.scrollWidth) || 0;
      var docScrollH = (docEl && docEl.scrollHeight) || 0;
      for (var m = 0; m < candidates.length; m++) {
        var el = candidates[m];
        if (!el || !el.isConnected) { geoData.push(null); continue; }
        // aria-hidden="true" — element is semantically hidden
        try { if (el.getAttribute('aria-hidden') === 'true') { geoData.push(null); continue; } } catch (_) {}
        // Cheap dimension check — eliminates most hidden elements without getComputedStyle
        var ow, oh;
        try { ow = el.offsetWidth; oh = el.offsetHeight; } catch (_) { geoData.push(null); continue; }
        if (ow === 0 || oh === 0) { geoData.push(null); continue; }
        // Cheap offsetParent check — catches display:none ancestors in most cases
        var offsetParent;
        try { offsetParent = el.offsetParent; } catch (_) { geoData.push(null); continue; }
        // Now do the expensive style recalculation only for survivors
        var style;
        try { style = window.getComputedStyle(el); } catch (_) { geoData.push(null); continue; }
        if (!style || style.display === 'none') { geoData.push(null); continue; }
        if (offsetParent === null && style.position !== 'fixed') { geoData.push(null); continue; }
        if (style.visibility === 'hidden' || style.visibility === 'collapse') { geoData.push(null); continue; }
        var opacity = parseFloat(style.opacity);
        if (Number.isFinite(opacity) && opacity <= 0) { geoData.push(null); continue; }
        // clip-path hiding (clip-path: inset(100%), polygon(0…), etc.)
        var clipPath = style.clipPath;
        if (clipPath && clipPath !== 'none') { geoData.push(null); continue; }
        var rect;
        try { rect = el.getBoundingClientRect(); } catch (_) { geoData.push(null); continue; }
        if (!rect || rect.width === 0 || rect.height === 0) { geoData.push(null); continue; }
        // Too small to be a visible heading — catches .sr-only (1×1 px) tricks
        if (rect.width < 2 || rect.height < 2) { geoData.push(null); continue; }
        // Far off-screen — catches position:left:-9999px, transform:translate(-9999px)
        var farOffscreen = rect.right < -1000 || rect.left > (docScrollW + 1000)
                        || rect.bottom < -1000 || rect.top > (docScrollH + 1000);
        if (farOffscreen) { geoData.push(null); continue; }
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
        // Single-pass ancestor scan: build chain once, then scan linearly
        // instead of nested while-loops with O(depth²) getComputedStyle calls.
        var clipped = false;
        var ancestors = [];
        var ancNode = el.parentElement;
        for (var ai = 0; ai < 6 && ancNode; ai++) {
          ancestors.push(ancNode);
          ancNode = ancNode.parentElement;
        }
        // Track if any ancestor between el and a clipping parent is scrollable
        var scrollableBelow = false;
        for (var ai2 = 0; ai2 < ancestors.length; ai2++) {
          var ancestor = ancestors[ai2];
          var ancStyle;
          try { ancStyle = window.getComputedStyle(ancestor); } catch (_) { break; }
          if (!ancStyle) continue;
          // Check if this ancestor is scrollable (with actual overflow)
          var ancOv = ancStyle.overflow || ancStyle.overflowY;
          if (ancOv === 'auto' || ancOv === 'scroll') {
            try {
              if (ancestor.scrollHeight > ancestor.clientHeight + 2) {
                scrollableBelow = true;
              }
            } catch (_) {}
          }
          // Check if this ancestor clips
          var clips = ancStyle.overflow === 'hidden' || ancStyle.overflow === 'clip'
            || ancStyle.overflowX === 'hidden' || ancStyle.overflowX === 'clip'
            || ancStyle.overflowY === 'hidden' || ancStyle.overflowY === 'clip';
          if (clips) {
            // Only clip if no scrollable ancestor sits between el and this clipping parent
            if (!scrollableBelow) {
              var parentRect;
              try { parentRect = ancestor.getBoundingClientRect(); } catch (_) { break; }
              // Only clip if heading is completely outside AND the clipping parent
              // has negligible height (collapsed/tab) — not a full-height layout container
              var isCollapsed = ancestor.clientHeight < 10 || ancestor.offsetWidth < 10;
              if (isCollapsed && (rect.right <= parentRect.left || rect.left >= parentRect.right
                  || rect.bottom <= parentRect.top || rect.top >= parentRect.bottom)) {
                clipped = true;
                break;
              }
            }
            // If scrollable ancestor exists, the heading can be scrolled into view — skip clip
            scrollableBelow = false; // reset for next potential clipping ancestor
          }
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

      // Deduplicate items with identical text that point to the same visual
      // position (e.g. headings duplicated in sidebar + main content via
      // aria-hidden or SR-only mirrors that survived the filter above).
      if (items.length > 1) {
        var seenTexts = new Set();
        var deduped = [];
        for (var d = 0; d < items.length; d++) {
          var key = items[d].text;
          if (!seenTexts.has(key)) {
            seenTexts.add(key);
            deduped.push(items[d]);
          }
        }
        if (deduped.length < items.length) {
          items = deduped;
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
      // Chatbot pages: build conversation-aware TOC (user prompts as level-1)
      var chatbotResult = null;
      try { chatbotResult = tryBuildChatbotTocItems(); } catch (_) {}
      if (chatbotResult !== null) {
        // Inject sentinel selector so DOM watcher monitors all mutations
        // (not heading-only) on subsequent rebuilds
        if (cfg && Array.isArray(cfg.selectors) && cfg.selectors.length === 0) {
          try {
            var sentinel = getChatbotSentinelSelector();
            if (sentinel) cfg.selectors.push({ type: 'css', expr: sentinel });
          } catch (_) {}
        }
        return chatbotResult;
      }

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
