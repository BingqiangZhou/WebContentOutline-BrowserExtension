
'use strict';

import { getEnabledMap } from './storage.js';
import { isHighRiskBroadCssSelector, isSafeXPathExpression } from './core-utils.js';
import { TOC_MAX_CANDIDATES, SCROLL_TOP_PADDING, HEADER_CACHE_TTL, EXTENSION_OWNER } from './constants.js';

    /**
     * Simple wildcard matcher: supports * as any chars
     * @param {string} pattern e.g., https://example.com/articles/* or *://*.example.com/*
     * @param {string} text URL to test
     */
function matchWildcard(pattern: string, text: string) {
      if (typeof pattern !== 'string' || typeof text !== 'string') return false;
      if (pattern === '*') return true;
      var parts = pattern.split('*');
      if (parts.length === 1) return pattern === text;

      var startIndex = 0;
      var endLimit = text.length;

      if (!pattern.startsWith('*')) {
        var first = parts.shift() || '';
        if (!text.startsWith(first)) return false;
        startIndex = first.length;
      }

      if (!pattern.endsWith('*')) {
        var last = parts.pop() || '';
        if (!text.endsWith(last)) return false;
        endLimit = text.length - last.length;
      }

      var hay = text.slice(0, endLimit);
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        if (!part) continue;
        var idx = hay.indexOf(part, startIndex);
        if (idx < 0) return false;
        startIndex = idx + part.length;
      }
      return true;
    }

    /**
     * Find the first matching site config for current URL
     * @param {Array} configs
     * @param {string} url
     */
export function findMatchingConfig(configs: Array<{ urlPattern?: string; selectors?: Array<{ type: string; expr: string }>; side?: string }>, url: string) {
      return configs.find(function(cfg) {
        if (!cfg || !cfg.urlPattern) return false;
        return matchWildcard(cfg.urlPattern, url);
      }) || null;
    }

    function originKey(origin?: string) {
      return origin || (typeof location !== 'undefined' ? location.origin : '');
    }

    /**
     * Whether current origin (or provided origin) is enabled. Default: disabled (false)
     * @param {string} [origin]
     * @returns {Promise<boolean>}
     */
    export async function getSiteEnabledByOrigin(origin?: string) {
      var map: Record<string, boolean> = await getEnabledMap();
      var key = originKey(origin);
      return !!(key && map[key]);
    }

    // Depth/count caps for shadow-DOM + iframe traversal. Bounded so a huge
    // page cannot make collection walk unbounded nested roots.
    var SHADOW_ROOT_MAX_DEPTH = 3;
    var SHADOW_ROOT_MAX_ROOTS = 50;

    /**
     * Collect every queryable root reachable from `root`: the root itself plus
     * open shadow roots and same-origin iframe documents (recursively, bounded).
     * Closed shadow roots and cross-origin iframes are inaccessible and skipped.
     * querySelectorAll / document.evaluate do not cross these boundaries on
     * their own, so callers must query each returned root.
     */
function gatherQueryRoots(root: Element | Document | DocumentFragment | ShadowRoot): Array<Element | Document | DocumentFragment | ShadowRoot> {
      var roots: Array<Element | Document | DocumentFragment | ShadowRoot> = [];
      if (!root) return roots;
      var queue: Array<{ node: Element | Document | DocumentFragment | ShadowRoot; depth: number }> = [{ node: root, depth: 0 }];
      while (queue.length && roots.length < SHADOW_ROOT_MAX_ROOTS) {
        var item = queue.shift();
        if (!item) continue;
        var node = item.node;
        roots.push(node);
        if (item.depth >= SHADOW_ROOT_MAX_DEPTH) continue;
        var descendants: NodeListOf<Element> | null = null;
        try {
          var qa = (node as any).querySelectorAll;
          if (typeof qa === 'function') descendants = qa.call(node, '*');
        } catch (_) {}
        if (!descendants) continue;
        for (var i = 0; i < descendants.length && roots.length < SHADOW_ROOT_MAX_ROOTS; i++) {
          var el = descendants[i] as any;
          // Open shadow root (closed shadow roots expose null and are skipped).
          try {
            var sr = el.shadowRoot;
            if (sr) queue.push({ node: sr, depth: item.depth + 1 });
          } catch (_) {}
          // Same-origin iframe document (cross-origin access throws / returns null).
          // Only descend into rendered iframes: a hidden / zero-size iframe's
          // inner document is still laid out, so its headings would otherwise
          // pass the visibility filter and leak in as invisible content.
          if (el.tagName === 'IFRAME') {
            var iframeRendered = true;
            try {
              if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') iframeRendered = false;
              else if (el.offsetWidth === 0 || el.offsetHeight === 0) iframeRendered = false;
            } catch (_) {}
            if (iframeRendered) {
              try {
                var cd = el.contentDocument;
                if (cd) queue.push({ node: cd, depth: item.depth + 1 });
              } catch (_) {}
            }
          }
        }
      }
      return roots;
    }

    /**
     * Collect nodes by a selector config
     * @param {{type: 'css'|'xpath', expr: string}} selector
     * @returns {Element[]}
     */
export function collectBySelector(selector: { type: string; expr: string; _root?: Element | Document }, maxCandidates: number) {
      if (!selector || !selector.expr) return [];
      var limit = TOC_MAX_CANDIDATES;
      if (Number.isFinite(maxCandidates) && maxCandidates > 0) limit = Math.min(limit, Math.floor(maxCandidates));
      var queryRoot: Element | Document = selector._root || document;
      if (selector.type === 'xpath') {
        if (!isSafeXPathExpression(selector.expr)) return [];
        try {
          var contextNode: Document = (selector._root && (selector._root as Element).ownerDocument) || document;
          var iterator = contextNode.evaluate(selector.expr, queryRoot, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
          var nodes: Element[] = [];
          for (var i = 0; i < limit; i++) {
            var node = iterator.iterateNext();
            if (!node) break;
            if (node.nodeType === 1) nodes.push(node as Element);
          }
          return nodes;
        } catch (e) {
          return [];
        }
      }
      try {
        if (isHighRiskBroadCssSelector(selector.expr)) {
          // Surface the rejection (debug level) so an over-broad user selector
          // isn't a completely silent empty TOC.
          console.debug('[toc] selector rejected as too broad:', selector.expr);
          return [];
        }
        // Query every reachable root (light DOM + open shadow roots + same-origin
        // iframes) so component-based pages yield headings too.
        var roots = gatherQueryRoots(queryRoot);
        var result: Element[] = [];
        for (var ri = 0; ri < roots.length && result.length < limit; ri++) {
          var nodeList: NodeListOf<Element> | null = null;
          try {
            var qa = (roots[ri] as any).querySelectorAll;
            if (typeof qa === 'function') nodeList = qa.call(roots[ri], selector.expr);
          } catch (_) { continue; }
          if (!nodeList) continue;
          for (var j = 0; j < nodeList.length && result.length < limit; j++) {
            result.push(nodeList[j]);
          }
        }
        return result;
      } catch (e) {
        return [];
      }
    }

    /**
     * Deduplicate elements preserving first-occurrence order
     * @param {Element[]} list
     */
export function uniqueInDocumentOrder(list: Element[]) {
      var seen = new Set<Element>();
      var result: Element[] = [];
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        if (el && !seen.has(el)) {
          seen.add(el);
          result.push(el);
        }
      }
      // Tag each element with its source index so disconnected/error pairs
      // (e.g. elements from different shadow/iframe roots, where
      // compareDocumentPosition returns DOCUMENT_POSITION_DISCONNECTED) get a
      // deterministic, transitive order instead of relying on sort stability.
      for (var t = 0; t < result.length; t++) (result[t] as any).__tocSrcOrder = t;
      result.sort(function(a, b) {
        if (a === b) return 0;
        try {
          var pos = a.compareDocumentPosition(b);
          // Only order by document position when the nodes are connected
          // (same document tree). Bit 1 = DOCUMENT_POSITION_DISCONNECTED.
          if (!(pos & 1)) {
            if (pos & 2) return 1;
            if (pos & 4) return -1;
          }
        } catch (_) {}
        // Disconnected or unavailable: fall back to stable source order.
        return ((a as any).__tocSrcOrder || 0) - ((b as any).__tocSrcOrder || 0);
      });
      for (var c = 0; c < result.length; c++) delete (result[c] as any).__tocSrcOrder;
      return result;
    }

    // Cached fixed-header height: recomputed at most once per HEADER_CACHE_TTL ms.
    // Header height rarely changes between clicks, so this avoids a
    // querySelectorAll + getComputedStyle per scroll-to-item click.
    var _cachedHeaderHeight = 0;
    var _cachedHeaderTime = 0;
    var _reduceMotion: boolean | null = null; // cached boolean

    /**
     * Invalidate the cached fixed-header height (call after DOM rebuilds).
     */
    export function invalidateScrollCaches() {
      _cachedHeaderHeight = 0;
      _cachedHeaderTime = 0;
    }

    /**
     * Find the nearest ancestor (or self) that is a scrollable container.
     * A scrollable container has overflow:auto/scroll AND content that overflows
     * (scrollHeight > clientHeight or scrollWidth > clientWidth).
     * Returns null if the document root is the scroll container (normal pages).
     */
    function findScrollableAncestor(el: HTMLElement) {
      var node: HTMLElement | null = el.parentElement;
      while (node && node !== document.documentElement && node !== document.body) {
        try {
          var style = window.getComputedStyle(node);
          if (style) {
            var overflowY = style.overflowY;
            if (overflowY === 'auto' || overflowY === 'scroll') {
              if (node.scrollHeight > node.clientHeight + 1) {
                return node;
              }
            }
          }
        } catch (_) {}
        node = node.parentElement;
      }
      return null;
    }

    /**
     * Detect the combined height of fixed/sticky elements at the top of the page.
     * Returns 0 if no such elements are found.
     * Results are cached for HEADER_CACHE_TTL ms.
     */
    function detectFixedHeaderHeight() {
      var now = Date.now();
      if (now - _cachedHeaderTime < HEADER_CACHE_TTL) return _cachedHeaderHeight;
      var maxHeight = 0;
      try {
        var els = document.querySelectorAll('header, [role="banner"], nav, [role="navigation"]');
        for (var i = 0; i < els.length; i++) {
          var el = els[i];
          var style = window.getComputedStyle(el);
          if (!style) continue;
          var pos = style.position;
          if (pos !== 'fixed' && pos !== 'sticky') continue;
          // Only count elements that are anchored near the top of the viewport
          var rect = el.getBoundingClientRect();
          if (rect.top > 10) continue;
          var bottom = rect.bottom;
          if (bottom > maxHeight) maxHeight = bottom;
        }
      } catch (_) {}
      _cachedHeaderHeight = maxHeight;
      _cachedHeaderTime = now;
      return maxHeight;
    }

    /**
     * Measure the height of fixed/sticky elements that overlay the top of the
     * scroll area (or viewport) by sampling what is actually painted there via
     * elementsFromPoint. More robust than selector-based detection: catches
     * non-semantic sticky headers (common in IDE-style UIs) and headers nested
     * inside the scroll container that a `header`/`nav` selector query misses.
     * Returns the offset relative to the scroll area's top.
     */
    function computeOverlayOffset(scrollContainer: HTMLElement | null): number {
      try {
        var rect = scrollContainer
          ? scrollContainer.getBoundingClientRect()
          : { top: 0, left: 0, right: 0, width: window.innerWidth, height: 0, bottom: 0 };
        var width = Number.isFinite((rect as DOMRect).width) ? (rect as DOMRect).width : window.innerWidth;
        var x = (rect as DOMRect).left + width / 2;
        var y = (rect as DOMRect).top + 1;
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return 0;
        var stack = document.elementsFromPoint(x, y);
        if (!stack || !stack.length) return 0;
        var maxBottom = 0;
        for (var i = 0; i < stack.length; i++) {
          var painted = stack[i];
          // Stop once we reach the scroll container itself: anything beneath it
          // in paint order is content, not an overlay.
          if (painted === scrollContainer) break;
          var st = window.getComputedStyle(painted);
          if (st && (st.position === 'fixed' || st.position === 'sticky')) {
            var b = painted.getBoundingClientRect().bottom;
            if (Number.isFinite(b) && b > maxBottom) maxBottom = b;
          }
        }
        return Math.max(0, maxBottom - (rect as DOMRect).top);
      } catch (_) {
        return 0;
      }
    }

    /**
     * Smooth scroll to element, positioning it below the top of the viewport
     * with padding for fixed/sticky headers and a comfortable reading gap.
     *
     * Handles both traditional document-scrolled pages and modern SPAs that use
     * an internal scrollable container (e.g. ChatGPT, Claude, Gemini).
     * @param {Element} el
     */
export function scrollToElement(el: HTMLElement) {
      try {
        // Cache prefers-reduced-motion — it doesn't change during a session
        if (_reduceMotion == null) {
          try {
            _reduceMotion = !!(window && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
          } catch (_) { _reduceMotion = false; }
        }
        var behavior = (_reduceMotion ? 'auto' : 'smooth') as ScrollBehavior;

        // Find the actual scrollable container — many modern sites (ChatGPT, Claude,
        // Gemini) use an internal div with overflow:auto instead of document scroll.
        var scrollContainer = findScrollableAncestor(el);

        // Offset = overlay covering the scroll-area top (most robust), falling
        // back to cached semantic-header detection, plus a small gap so the
        // heading text sits just below the edge.
        var overlay = computeOverlayOffset(scrollContainer);
        var headerH = overlay > 0 ? overlay : detectFixedHeaderHeight();
        var offset = headerH + SCROLL_TOP_PADDING;

        if (scrollContainer) {
          // Internal scroll container: calculate position relative to it
          var containerRect = scrollContainer.getBoundingClientRect();
          var elRect = el.getBoundingClientRect();
          var targetTop = scrollContainer.scrollTop + (elRect.top - containerRect.top) - offset;
          if (targetTop < 0) targetTop = 0;
          scrollContainer.scrollTo({ top: targetTop, behavior: behavior });
        } else {
          // Document-level scroll: use window.scrollTo
          var rect = el.getBoundingClientRect();
          var scrollY: number = window.scrollY;
          if (typeof scrollY !== 'number' || !Number.isFinite(scrollY)) {
            scrollY = window.pageYOffset || 0;
          }
          var targetY = scrollY + rect.top - offset;
          if (typeof targetY !== 'number' || !Number.isFinite(targetY) || targetY < 0) targetY = 0;
          window.scrollTo({ top: targetY, behavior: behavior });
        }
      } catch (e) {
        try { el.scrollIntoView(true); } catch (_2) {}
      }
    }

export function cleanupOwnedElements(selectorFallback?: string) {
      var selector = selectorFallback || '.toc-edge-dock[data-toc-owner="' + EXTENSION_OWNER + '"], .toc-floating[data-toc-owner="' + EXTENSION_OWNER + '"], .toc-overlay[data-toc-owner="' + EXTENSION_OWNER + '"], .toc-toast-container[data-toc-owner="' + EXTENSION_OWNER + '"]';
      try {
        document.querySelectorAll(selector).forEach(function(el) {
          try {
            var cleanup = (el as any).__TOC_CLEANUP__;
            if (typeof cleanup === 'function') cleanup();
          } catch (_) {}
          el.remove();
        });
      } catch (_) {}
    }
