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

  /**
   * Creates a MutationObserver-based DOM watcher that detects meaningful
   * changes in the document and invokes a callback. Ignores changes
   * originating from extension-owned elements.
   *
   * @param {function} onMutation - Called with no args when a meaningful DOM change is detected.
   * @returns {object}
   */
export function createDomWatcher(onMutation) {
    var observerRef = null;
    var isContextValid = true;

    function hasMeaningfulChange(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        try {
          var t = m.target;
          if (t && t.nodeType === 1 && t.closest) {
            if (t.closest('.toc-floating, .toc-collapsed-badge, .toc-overlay, .toc-toast-container')) {
              continue;
            }
          }
          // Filter characterData: ignore text changes inside extension-owned elements
          if (m.type === 'characterData' && t && t.nodeType === 3 && t.parentElement) {
            var parent = t.parentElement;
            if (parent.closest && parent.closest('.toc-floating, .toc-collapsed-badge, .toc-overlay, .toc-toast-container')) {
              continue;
            }
          }
        } catch (_) {}

        if (m.type === 'childList') {
          if ((m.addedNodes && m.addedNodes.length) || (m.removedNodes && m.removedNodes.length)) return true;
        }
        if (m.type === 'attributes') {
          var name = m.attributeName || '';
          if (OBSERVED_ATTR_SET.has(name)) {
            return true;
          }
        }
        if (m.type === 'characterData') {
          return true;
        }
      }
      return false;
    }

    function disconnect() {
      var obs = observerRef;
      observerRef = null;
      if (obs && typeof obs.disconnect === 'function') {
        try { obs.disconnect(); } catch (_) {}
      }
    }

    function checkAndReconnect() {
      if (!observerRef) return;
      try {
        var root = document.documentElement || document.body;
        if (!root) return;
        observerRef.takeRecords();
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

export default { createDomWatcher: createDomWatcher };
