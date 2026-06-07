
'use strict';

import { collectBySelector, uniqueInDocumentOrder } from './dom-utils.js';
import { getBoundedText } from './bounded-text.js';
import { detectContentRegion } from './content-region.js';
import { tryBuildChatbotTocItems, getChatbotSentinelSelector, getChatbotConfidence } from './chatbot-detector.js';
import { TOC_TEXT_MAX_LEN, TOC_MAX_ITEMS, TOC_MAX_CANDIDATES, HEADING_LEVEL_WEIGHTS } from './constants.js';

    var COLLAPSE_WS_RE = /\s+/g;

    function getTrimmedText(el: Element) {
      var rawText = getBoundedText(el, { maxChars: TOC_TEXT_MAX_LEN * 4, maxNodes: 160, maxDepth: 8 });
      rawText = rawText.trim();
      rawText = rawText.replace(COLLAPSE_WS_RE, ' ');
      return rawText.length > TOC_TEXT_MAX_LEN ? rawText.substring(0, TOC_TEXT_MAX_LEN) + '...' : rawText;
    }

function getTocItemLevel(el: Element) {
      var match = el && /^H([1-6])$/.exec(el.tagName || '');
      return match ? parseInt(match[1], 10) : 2;
    }

function buildTocItemsFromSelectors(selectors: Array<{ type: string; expr: string; _root?: Element | Document }>, cfg: { keepEmptyText?: boolean }) {
      var elements: Element[] = [];
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

      // Heading level selection: when all 6 heading levels are present on the page,
      // keep only the 3 most representative levels (adapted from Smart TOC).
      // This filters out noise like site-wide h1s, rarely-used h5/h6, etc.
      // Only activates for standard heading selectors (not chatbot or custom selectors).
      var candidates = allUniq;
      if (candidates.length > 0) {
        var levelCounts: Record<string, number> = { H1: 0, H2: 0, H3: 0, H4: 0, H5: 0, H6: 0 };
        var levelWeights = HEADING_LEVEL_WEIGHTS;
        for (var lc = 0; lc < candidates.length; lc++) {
          var tag = candidates[lc].tagName;
          if (levelCounts[tag] !== undefined) levelCounts[tag]++;
        }
        // Count how many distinct heading levels are present
        var presentLevels = 0;
        for (var lv in levelCounts) {
          if (levelCounts[lv] > 0) presentLevels++;
        }
        // Only filter when 5+ levels are present (strong signal of noise headings)
        if (presentLevels >= 5) {
          // Score each level: count × weight, pick top 3
          var levelScores: Array<{ level: string; score: number }> = [];
          for (var ls in levelCounts) {
            if (levelCounts[ls] > 0) {
              levelScores.push({ level: ls, score: levelCounts[ls] * (levelWeights[ls] || 0) });
            }
          }
          levelScores.sort(function(a, b) { return b.score - a.score; });
          var keepLevels = new Set<string>();
          for (var kl = 0; kl < Math.min(3, levelScores.length); kl++) {
            keepLevels.add(levelScores[kl].level);
          }
          // Filter candidates to only include selected levels
          var filtered: Element[] = [];
          for (var fc = 0; fc < candidates.length; fc++) {
            if (keepLevels.has(candidates[fc].tagName)) {
              filtered.push(candidates[fc]);
            }
          }
          if (filtered.length > 0) candidates = filtered;
        }
      }
      if (candidates.length > TOC_MAX_CANDIDATES) {
        candidates = candidates.slice(0, TOC_MAX_CANDIDATES);
        truncated = true;
      }

      // Phase 1: Batch-read all geometry in a tight loop (avoids forced reflows)
      // Order: cheap property reads first, expensive getComputedStyle last
      var geoData: Array<{ el: Element; rect: DOMRect } | null> = [];
      var docEl = document.documentElement;
      var docScrollW = (docEl && docEl.scrollWidth) || 0;
      var docScrollH = (docEl && docEl.scrollHeight) || 0;
      for (var m = 0; m < candidates.length; m++) {
        var el = candidates[m] as HTMLElement;
        if (!el || !el.isConnected) { geoData.push(null); continue; }
        // aria-hidden="true" — element is semantically hidden
        try { if (el.getAttribute('aria-hidden') === 'true') { geoData.push(null); continue; } } catch (_) {}
        // Cheap dimension check — eliminates most hidden elements without getComputedStyle
        var ow: number, oh: number;
        try { ow = el.offsetWidth; oh = el.offsetHeight; } catch (_) { geoData.push(null); continue; }
        if (ow === 0 || oh === 0) { geoData.push(null); continue; }
        // Cheap offsetParent check — catches display:none ancestors in most cases
        var offsetParent: Element | null;
        try { offsetParent = el.offsetParent; } catch (_) { geoData.push(null); continue; }
        // Now do the expensive style recalculation only for survivors
        var style: CSSStyleDeclaration;
        try { style = window.getComputedStyle(el); } catch (_) { geoData.push(null); continue; }
        if (!style || style.display === 'none') { geoData.push(null); continue; }
        if (offsetParent === null && style.position !== 'fixed') { geoData.push(null); continue; }
        if (style.visibility === 'hidden' || style.visibility === 'collapse') { geoData.push(null); continue; }
        var opacity = parseFloat(style.opacity);
        if (Number.isFinite(opacity) && opacity <= 0) { geoData.push(null); continue; }
        // clip-path hiding (clip-path: inset(100%), polygon(0…), etc.)
        var clipPath = style.clipPath;
        if (clipPath && clipPath !== 'none') { geoData.push(null); continue; }
        var rect: DOMRect;
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
      var items: Array<{ id: string; el: Element; text: string; level: number; source?: string }> = [];
      for (var g = 0; g < geoData.length; g++) {
        var entry = geoData[g];
        if (!entry) continue;
        var el2 = entry.el;
        var rect2 = entry.rect;

        // Parent clipping check (only for survivors that passed cheap checks)
        // Excludes headings truly hidden by collapsed/zero-size containers,
        // but preserves headings that are simply below the fold in a scrollable page.
        // Single-pass ancestor scan: build chain once, then scan linearly
        // instead of nested while-loops with O(depth²) getComputedStyle calls.
        var clipped = false;
        var ancestors: Element[] = [];
        var ancNode = el2.parentElement;
        for (var ai = 0; ai < 6 && ancNode; ai++) {
          ancestors.push(ancNode);
          ancNode = ancNode.parentElement;
        }
        // Track if any ancestor between el and a clipping parent is scrollable
        var scrollableBelow = false;
        for (var ai2 = 0; ai2 < ancestors.length; ai2++) {
          var ancestor = ancestors[ai2] as HTMLElement;
          var ancStyle: CSSStyleDeclaration;
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
              var parentRect: DOMRect;
              try { parentRect = ancestor.getBoundingClientRect(); } catch (_) { break; }
              // Only clip if heading is completely outside AND the clipping parent
              // has negligible height (collapsed/tab) — not a full-height layout container
              var isCollapsed = ancestor.clientHeight < 10 || ancestor.offsetWidth < 10;
              if (isCollapsed && (rect2.right <= parentRect.left || rect2.left >= parentRect.right
                  || rect2.bottom <= parentRect.top || rect2.top >= parentRect.bottom)) {
                clipped = true;
                break;
              }
            }
            // If scrollable ancestor exists, the heading can be scrolled into view — skip clip
            scrollableBelow = false; // reset for next potential clipping ancestor
          }
        }
        if (clipped) continue;

        var text = getTrimmedText(el2);
        if (!keepEmpty && (!text || text.length === 0)) continue;

        items.push({ id: 'toc-item-' + items.length, el: el2, text: text, level: getTocItemLevel(el2), source: undefined as string | undefined });
        if (items.length >= TOC_MAX_ITEMS) {
          truncated = true;
          break;
        }
      }

      // Deduplicate items with identical text that point to the same visual
      // position (e.g. headings duplicated in sidebar + main content via
      // aria-hidden or SR-only mirrors that survived the filter above).
      if (items.length > 1) {
        var seenTexts = new Set<string>();
        var deduped: Array<{ id: string; el: Element; text: string; level: number; source?: string }> = [];
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

export function buildTocItems(cfg: { selectors: Array<{ type: string; expr: string; _root?: Element | Document }>; keepEmptyText?: boolean }, extraSelectors?: Array<{ type: string; expr: string }>) {
      // Chatbot pages: build conversation-aware TOC (user prompts as level-1)
      var chatbotResult = null;
      try {
        var chatConfidence = getChatbotConfidence();
        // Only use chatbot TOC for high-confidence detections (>= 0.7).
        // Lower scores may be embedded chat widgets (Intercom, Crisp, Drift)
        // on otherwise regular pages.
        if (chatConfidence >= 0.7) {
          chatbotResult = tryBuildChatbotTocItems();
        }
      } catch (_) {}
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
      var isCustom = base.length > 0;
      var combined: Array<{ type: string; expr: string; _root?: Element | Document }> = (Array.isArray(extraSelectors) ? extraSelectors : []).concat(base);

      if (combined.length === 0) {
        var region: { root?: Element | null } | null = null;
        try { region = detectContentRegion(); } catch (_) {}
        if (region && region.root) {
          combined = [{ type: 'css', expr: 'h1, h2, h3, h4, h5, h6', _root: region.root }];
        } else {
          combined = [{ type: 'css', expr: 'h1, h2, h3, h4, h5, h6' }];
        }
      }

      var result = buildTocItemsFromSelectors(combined, cfg);
      // Mark items from user-configured selectors
      if (isCustom && result.items) {
        for (var si = 0; si < result.items.length; si++) {
          result.items[si].source = 'custom';
        }
      }
      return result;
    }
