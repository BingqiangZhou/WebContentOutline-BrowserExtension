
'use strict';

import { collectBySelector, uniqueInDocumentOrder } from './dom-utils.js';
import { getBoundedText } from './bounded-text.js';
import { detectContentRegion } from './content-region.js';
import { tryBuildChatbotTocItems, getChatbotSentinelSelector, getChatbotConfidence } from './chatbot-detector.js';
import { TOC_TEXT_MAX_LEN, TOC_MAX_ITEMS, TOC_MAX_CANDIDATES } from './constants.js';

    var COLLAPSE_WS_RE = /\s+/g;

    function getTrimmedText(el: Element) {
      var rawText = getBoundedText(el, { maxChars: TOC_TEXT_MAX_LEN * 4, maxNodes: 160, maxDepth: 8 });
      rawText = rawText.trim();
      rawText = rawText.replace(COLLAPSE_WS_RE, ' ');
      return rawText.length > TOC_TEXT_MAX_LEN ? rawText.substring(0, TOC_TEXT_MAX_LEN) + '...' : rawText;
    }

function getTocItemLevel(el: Element) {
      if (el) {
        // Honor explicit ARIA heading levels (role="heading" aria-level="N")
        // before falling back to the tag name.
        try {
          var ariaLevel = el.getAttribute && el.getAttribute('aria-level');
          var ariaParsed = ariaLevel ? parseInt(ariaLevel, 10) : NaN;
          if (ariaParsed >= 1 && ariaParsed <= 6) return ariaParsed;
        } catch (_) {}
        var match = /^H([1-6])$/.exec(el.tagName || '');
        if (match) return parseInt(match[1], 10);
      }
      return 2;
    }

    // Two headings are treated as the same visual location only when their
    // rects nearly coincide — this catches mirrored copies (e.g. a sticky
    // duplicate) without dropping legitimately repeated section titles such as
    // multiple "References" / "Notes" sections elsewhere on the page.
    function rectsOverlap(a: { left: number; top: number }, b: { left: number; top: number }) {
      return Math.abs(a.left - b.left) < 24 && Math.abs(a.top - b.top) < 24;
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

      // Note: a previous "keep top-3 heading levels" proportionality filter
      // lived here. It was removed because it amputated legitimate deep levels
      // (h4/h5/h6) on documents that use all six levels. Nav/footer noise is
      // now handled upstream by content-region scoping (buildTocItems) plus the
      // visibility/geometry filter below.
      var candidates = allUniq;
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
      var items: Array<{ id: string; el: Element; text: string; level: number; source?: string; _pos?: { left: number; top: number; right: number; bottom: number } }> = [];
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
        // Drop icon/glyph-only headings (e.g. a lone "#" anchor or "¶ copy link")
        // that contain no letters or digits — a common source of nav noise.
        if (!keepEmpty && !/[\p{L}\p{N}]/u.test(text)) continue;

        items.push({ id: 'toc-item-' + items.length, el: el2, text: text, level: getTocItemLevel(el2), source: undefined as string | undefined, _pos: { left: rect2.left, top: rect2.top, right: rect2.right, bottom: rect2.bottom } });
        if (items.length >= TOC_MAX_ITEMS) {
          truncated = true;
          break;
        }
      }

      // Deduplicate mirror copies: identical-text headings that sit at the same
      // visual position (e.g. a sticky duplicate). Repeated section titles at
      // different positions are intentionally preserved.
      if (items.length > 1) {
        var byText: Map<string, Array<{ id: string; el: Element; text: string; level: number; source?: string; _pos?: { left: number; top: number; right: number; bottom: number } }>> = new Map();
        var deduped: Array<{ id: string; el: Element; text: string; level: number; source?: string; _pos?: { left: number; top: number; right: number; bottom: number } }> = [];
        for (var d = 0; d < items.length; d++) {
          var cur = items[d];
          var same = byText.get(cur.text);
          if (same) {
            var isMirror = false;
            for (var sm = 0; sm < same.length; sm++) {
              if (same[sm]._pos && cur._pos && rectsOverlap(same[sm]._pos as { left: number; top: number }, cur._pos as { left: number; top: number })) {
                isMirror = true;
                break;
              }
            }
            if (isMirror) continue;
            same.push(cur);
          } else {
            byText.set(cur.text, [cur]);
          }
          deduped.push(cur);
        }
        if (deduped.length < items.length) {
          items = deduped;
        }
      }
      // Strip the internal position marker so it does not leak into the UI/storage.
      for (var sp = 0; sp < items.length; sp++) {
        delete (items[sp] as any)._pos;
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
      var base = Array.isArray(cfg.selectors) ? cfg.selectors : [];
      // "Custom" = the USER configured selectors. The chatbot sentinel we inject
      // ourselves (see below) is marked _tocSentinel and excluded, otherwise it
      // would persist across rebuilds and permanently disable the chatbot path.
      var isCustom = false;
      for (var bi = 0; bi < base.length; bi++) {
        if (base[bi] && !(base[bi] as any)._tocSentinel) { isCustom = true; break; }
      }
      var combined: Array<{ type: string; expr: string; _root?: Element | Document }> = (Array.isArray(extraSelectors) ? extraSelectors : []).concat(base);

      // Detect the content region once. A non-fallback root scopes selectors so
      // nav/footer headings do not leak into the TOC.
      var region: { root?: Element | null; source?: string } | null = null;
      try { region = detectContentRegion(); } catch (_) {}
      var regionRoot = (region && region.root && region.source !== 'fallback') ? region.root : null;

      // User-defined selectors take priority: when the user has explicitly
      // configured selectors, do NOT let high-confidence chatbot detection
      // override them.
      if (!isCustom) {
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
          // Inject the chatbot sentinel selector (marked) so the DOM watcher
          // monitors message mutations on subsequent rebuilds. Idempotent: only
          // push when not already present.
          if (cfg && Array.isArray(cfg.selectors)) {
            try {
              var hasSentinel = false;
              for (var hs = 0; hs < cfg.selectors.length; hs++) {
                if (cfg.selectors[hs] && (cfg.selectors[hs] as any)._tocSentinel) { hasSentinel = true; break; }
              }
              if (!hasSentinel) {
                var sentinel = getChatbotSentinelSelector();
                if (sentinel) cfg.selectors.push({ type: 'css', expr: sentinel, _tocSentinel: true } as any);
              }
            } catch (_) {}
          }
          return chatbotResult;
        }
      }

      if (combined.length === 0) {
        // Auto path: default heading selector, including ARIA headings.
        combined = [{ type: 'css', expr: 'h1, h2, h3, h4, h5, h6, [role="heading"]', _root: regionRoot || undefined }];
      } else if (regionRoot) {
        // Custom path: scope each selector to the content region (copy so the
        // user's stored config objects are not mutated).
        for (var ci = 0; ci < combined.length; ci++) {
          if (!combined[ci]._root) {
            combined[ci] = { type: combined[ci].type, expr: combined[ci].expr, _root: regionRoot };
          }
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
