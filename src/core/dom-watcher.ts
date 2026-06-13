
'use strict';

  import { OWNED_SELECTOR } from '../utils/constants.js';

  var OBSERVED_ATTRIBUTES = [
    'hidden',
    'style',
    'class',
    'id',
    'aria-hidden',
    'aria-expanded',
    'open'
  ];
  var OBSERVED_ATTR_SET = new Set(OBSERVED_ATTRIBUTES);
  // Max mutation records scanned per observer callback. A single mutation burst
  // on a streaming SPA can carry thousands of records, and this callback runs on
  // the main thread — bounding the scan keeps the callback itself cheap. A
  // meaningful change beyond the cap is durable and surfaces again in the next
  // batch, so capping defers (never loses) detection.
  var RECORD_SCAN_CAP = 500;
  var DEFAULT_HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';

  /**
   * Creates a MutationObserver-based DOM watcher that detects meaningful
   * changes in the document and invokes a callback. Ignores changes
   * originating from extension-owned elements.
   *
   * When scopeSelector is provided, only mutations inside elements matching
   * that selector are considered meaningful. This reduces noise from
   * unrelated page elements (notifications, tooltips, etc.).
   */
export function createDomWatcher(onMutation: () => void, cfg: { selectors?: Array<{ type: string; expr: string }>; scopeSelector?: string | null }) {
    var observerRef: MutationObserver | null = null;
    var isContextValid = true;
    var ownedRoots = new WeakSet();
    // Cached scope container. hasMeaningfulChange previously called
    // document.querySelector(scopeSelector) once PER mutation record; on a
    // chatbot page a single mutation burst can carry hundreds/thousands of
    // records. The scope element changes rarely (only on SPA nav via
    // updateScope or page restructuring), so cache it and invalidate via
    // selector match + isConnected.
    var _scopeCacheSel: string | null = null;
    var _scopeCacheEl: Element | null = null;

    function scanOwnedRoots() {
      try {
        var roots = document.querySelectorAll(OWNED_SELECTOR);
        for (var i = 0; i < roots.length; i++) {
          ownedRoots.add(roots[i]);
        }
      } catch (_) {}
    }

    function isDefaultHeadingMode() {
      return !cfg || !Array.isArray(cfg.selectors) || cfg.selectors.length === 0;
    }

    function isOwnedNode(node: Node) {
      try {
        var element: Element | null = node && node.nodeType === 3 ? (node as Text).parentElement : node as Element;
        if (!element) return false;
        if (ownedRoots.has(element)) return true;
        return !!(element.closest && element.closest(OWNED_SELECTOR));
      } catch (_) {
        return false;
      }
    }

    function touchesDefaultHeading(node: Node, scanDescendants: boolean) {
      try {
        var element: Element | null = node && node.nodeType === 3 ? (node as Text).parentElement : node as Element;
        if (!element) return false;
        if (element.closest && element.closest(DEFAULT_HEADING_SELECTOR)) return true;
        return !!(scanDescendants && element.querySelector && element.querySelector(DEFAULT_HEADING_SELECTOR));
      } catch (_) {
        return false;
      }
    }

    function childListTouchesDefaultHeading(mutation: MutationRecord) {
      if (touchesDefaultHeading(mutation.target, false)) return true;
      var lists = [mutation.addedNodes, mutation.removedNodes];
      for (var i = 0; i < lists.length; i++) {
        var nodes = lists[i] || [];
        for (var j = 0; j < nodes.length; j++) {
          if (touchesDefaultHeading(nodes[j], true)) return true;
        }
      }
      return false;
    }

    function getScopedContainer(): Element | null {
      var sel = cfg && cfg.scopeSelector;
      if (!sel) return null;
      // Cache hit: same selector AND element still mounted. isConnected is a
      // cheap boolean read (no layout), so per-record cost drops from a full
      // selector evaluation to a property read. If the element was detached
      // (or a fake test element without isConnected), it misses and re-queries.
      if (_scopeCacheSel === sel && _scopeCacheEl && _scopeCacheEl.isConnected) {
        return _scopeCacheEl;
      }
      var el: Element | null = null;
      try { el = document.querySelector(sel); } catch (_) { return null; }
      _scopeCacheSel = sel;
      _scopeCacheEl = el;
      return el;
    }

    function hasMeaningfulChange(mutations: MutationRecord[]) {
      var scanLimit = mutations.length;
      if (scanLimit > RECORD_SCAN_CAP) scanLimit = RECORD_SCAN_CAP;
      for (var i = 0; i < scanLimit; i++) {
        var m = mutations[i];
        var t = m.target;
        if (isOwnedNode(t)) continue;

        // Scope check: if a scope selector is configured, only trigger for
        // mutations inside the scoped container (cached; see getScopedContainer)
        if (cfg && cfg.scopeSelector) {
          var scopedContainer = getScopedContainer();
          if (scopedContainer && !scopedContainer.contains(t as Node)) continue;
        }

        if (m.type === 'childList') {
          var hasNodes = (m.addedNodes && m.addedNodes.length) || (m.removedNodes && m.removedNodes.length);
          if (hasNodes && (!isDefaultHeadingMode() || childListTouchesDefaultHeading(m))) return true;
        }
        if (m.type === 'attributes') {
          var name = m.attributeName || '';
          if (OBSERVED_ATTR_SET.has(name) && (!isDefaultHeadingMode() || touchesDefaultHeading(t, true))) {
            return true;
          }
        }
        if (m.type === 'characterData') {
          if (!isDefaultHeadingMode() || touchesDefaultHeading(t, false)) return true;
        }
      }
      return false;
    }

    function disconnect() {
      var obs = observerRef;
      observerRef = null;
      if (obs) { obs.disconnect(); }
    }

    function checkAndReconnect() {
      if (!observerRef) return;
      try {
        var records = observerRef.takeRecords();
        if (records && records.length && hasMeaningfulChange(records)) {
          onMutation();
        }
      } catch (_) {}
    }

    function start() {
      disconnect();
      isContextValid = true;
      ownedRoots = new WeakSet();
      _scopeCacheSel = null;
      _scopeCacheEl = null;
      scanOwnedRoots();

      var root = document.documentElement;
      if (!root) return false;

      var observer = new MutationObserver(function(mutations) {
        if (!isContextValid) {
          observer.disconnect();
          return;
        }
        if (!hasMeaningfulChange(mutations)) return;
        if (onMutation) onMutation();
      });
      observerRef = observer;

      try {
        observer.observe(root, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: OBSERVED_ATTRIBUTES
        });
        return true;
      } catch (_) {
        observerRef = null;
        observer.disconnect();
        return false;
      }
    }

    function invalidate() {
      isContextValid = false;
      disconnect();
    }

    return {
      start: start,
      stop: disconnect,
      checkAndReconnect: checkAndReconnect,
      invalidate: invalidate,
      // Update the scope selector at runtime (used on SPA navigation, where the
      // page may switch between chatbot and non-chatbot contexts).
      updateScope: function(scopeSelector: string | null) {
        cfg.scopeSelector = scopeSelector || null;
      }
    };
  }
