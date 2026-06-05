// @ts-nocheck
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
   */
export function createDomWatcher(onMutation, cfg) {
    var observerRef = null;
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

    function isOwnedNode(node) {
      try {
        var element = node && node.nodeType === 3 ? node.parentElement : node;
        if (!element) return false;
        if (ownedRoots.has(element)) return true;
        return !!(element.closest && element.closest(OWNED_SELECTOR));
      } catch (_) {
        return false;
      }
    }

    function touchesDefaultHeading(node, scanDescendants) {
      try {
        var element = node && node.nodeType === 3 ? node.parentElement : node;
        if (!element) return false;
        if (element.closest && element.closest(DEFAULT_HEADING_SELECTOR)) return true;
        return !!(scanDescendants && element.querySelector && element.querySelector(DEFAULT_HEADING_SELECTOR));
      } catch (_) {
        return false;
      }
    }

    function childListTouchesDefaultHeading(mutation) {
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

    function hasMeaningfulChange(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        var t = m.target;
        if (isOwnedNode(t)) continue;

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
      if (obs) { try { obs.disconnect(); } catch (_) {} }
    }

    function checkAndReconnect() {
      if (!observerRef) return;
      try {
        // Drain pending mutations to keep the observer fresh
        observerRef.takeRecords();
      } catch (_) {}
    }

    function start() {
      disconnect();
      isContextValid = true;
      ownedRoots = new WeakSet();
      scanOwnedRoots();

      if (typeof MutationObserver === 'undefined') return false;

      var root = document.documentElement || document.body;
      if (!root) return false;

      var observer = new MutationObserver(function(mutations) {
        if (!isContextValid) {
          observer.disconnect();
          return;
        }
        if (!hasMeaningfulChange(mutations)) return;
        if (typeof onMutation === 'function') onMutation();
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
        try { observer.disconnect(); } catch (_2) {}
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
