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
   * @param {function} onMutation - Called with no args when a meaningful DOM change is detected.
   * @param {object} [cfg] - Active site configuration
   * @returns {object}
   */
export function createDomWatcher(onMutation, cfg) {
    var observerRef = null;
    var observedRoot = null;
    var isContextValid = true;

    function isDefaultHeadingMode() {
      return !cfg || !Array.isArray(cfg.selectors) || cfg.selectors.length === 0;
    }

    function isOwnedNode(node) {
      try {
        var element = node && node.nodeType === 3 ? node.parentElement : node;
        return !!(element && element.closest && element.closest(OWNED_SELECTOR));
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
      observedRoot = null;
      if (obs && typeof obs.disconnect === 'function') {
        try { obs.disconnect(); } catch (_) {}
      }
    }

    function checkAndReconnect() {
      if (!observerRef) return;
      try {
        var root = document.documentElement || document.body;
        if (!root) return;
        if (root !== observedRoot || observedRoot.isConnected === false) {
          observerRef.disconnect();
          observerRef.observe(root, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: OBSERVED_ATTRIBUTES
          });
          observedRoot = root;
        } else {
          observerRef.takeRecords();
        }
      } catch (_) {
        try {
          observerRef.disconnect();
          observerRef.observe(document.documentElement || document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: OBSERVED_ATTRIBUTES
          });
          observedRoot = document.documentElement || document.body;
          console.debug('[toc] reconnected MutationObserver');
        } catch (e) {
          console.warn('[toc] failed to reconnect MutationObserver:', e);
        }
      }
    }

    function start() {
      disconnect();
      isContextValid = true;

      if (typeof MutationObserver === 'undefined') {
        return false;
      }

      var resolveObserveRoot = function() {
        try {
          return document.documentElement || document.body;
        } catch (_) {
          return document.documentElement;
        }
      };

      var observer = new MutationObserver(function(mutations) {
        if (!isContextValid) {
          observer.disconnect();
          return;
        }
        if (!hasMeaningfulChange(mutations)) return;
        if (typeof onMutation === 'function') {
          onMutation();
        }
      });
      observerRef = observer;

      var root = (function() {
        var r = resolveObserveRoot();
        if (r && r.nodeType === Node.ELEMENT_NODE) return r;
        return document.documentElement || document.body || null;
      })();

      if (!root) {
        observerRef = null;
        try { observer.disconnect(); } catch (_) {}
        return false;
      }

      try {
        observer.observe(root, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: OBSERVED_ATTRIBUTES
        });
        observedRoot = root;
        return true;
      } catch (_) {
        observerRef = null;
        try { observer.disconnect(); } catch (_) {}
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
      disconnect: disconnect,
      checkAndReconnect: checkAndReconnect,
      invalidate: invalidate
    };
  }
