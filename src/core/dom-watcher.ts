
'use strict';

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
  var DEFAULT_HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6';
  var OWNED_SELECTOR = '[data-toc-owner="web-toc-assistant"]';

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

    function hasMeaningfulChange(mutations: MutationRecord[]) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        var t = m.target;
        if (isOwnedNode(t)) continue;

        // Scope check: if a scope selector is configured, only trigger for
        // mutations inside the scoped container
        if (cfg && cfg.scopeSelector) {
          try {
            var scopedContainer = document.querySelector(cfg.scopeSelector);
            if (scopedContainer && !scopedContainer.contains(t as Node)) continue;
          } catch (_) {} // Invalid selector — skip scope check
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
      invalidate: invalidate
    };
  }
