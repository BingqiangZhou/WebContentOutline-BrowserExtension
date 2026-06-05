
'use strict';

/**
 * Find the visible item closest to the viewport top using a linear scan.
 * O(n) instead of sort + pick — avoids O(n log n) and intermediate allocations.
 */
function selectActiveItem(visibleTops) {
  var bestItem = null;
  var bestTop = Infinity;
  visibleTops.forEach(function(top, item) {
    if (top < bestTop) {
      bestTop = top;
      bestItem = item;
    }
  });
  return bestItem;
}

export function createActiveItemTracker(options) {
  options = options || {};
  var items = [];
  var onChange = options.onChange;
  var observer = null;
  var observeRaf = null;
  var processRaf = null;
  var pendingEntries = [];
  var visibleTops = new Map();
  var itemByElement = new Map();
  var activeItem = null;
  var destroyed = false;

  function cancelRaf(id) {
    if (id == null) return;
    try { cancelAnimationFrame(id); } catch (_) {}
  }

  function notify(nextItem) {
    if (nextItem === activeItem) return;
    activeItem = nextItem;
    try { onChange && onChange(nextItem, nextItem ? items.indexOf(nextItem) : -1); } catch (_) {}
  }

  function disconnectObserver() {
    if (observer) {
      try { observer.disconnect(); } catch (_) {}
      observer = null;
    }
    cancelRaf(observeRaf);
    cancelRaf(processRaf);
    observeRaf = null;
    processRaf = null;
    pendingEntries = [];
    visibleTops.clear();
    itemByElement.clear();
  }

  function processEntries(entries) {
    if (destroyed) return;
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      var item = entry && itemByElement.get(entry.target);
      if (!item) continue;
      var isConnected = true;
      try { isConnected = !document || !document.contains || document.contains(entry.target); } catch (_) {}
      if (entry.isIntersecting && isConnected) {
        var top = entry.boundingClientRect && entry.boundingClientRect.top;
        visibleTops.set(item, Number.isFinite(top) ? top : 0);
      } else {
        visibleTops.delete(item);
      }
    }
    // Linear scan for minimum-top item — no array allocation, no sort
    var nextItem = selectActiveItem(visibleTops);
    if (nextItem) notify(nextItem);
  }

  function observeItems(newEls) {
    if (destroyed || typeof IntersectionObserver === 'undefined') return;
    if (!observer) {
      observer = new IntersectionObserver(function(entries) {
        if (destroyed) return;
        // Use for-loop instead of push.apply to avoid argument length limits
        for (var i = 0; i < entries.length; i++) {
          pendingEntries.push(entries[i]);
        }
        if (processRaf != null) return;
        processRaf = requestAnimationFrame(function() {
          processRaf = null;
          var batch = pendingEntries;
          pendingEntries = [];
          processEntries(batch);
        });
      }, { root: null, rootMargin: '0px 0px -65% 0px', threshold: 0.1 });
    }

    // If caller provided specific new elements, only observe those (incremental update)
    if (newEls) {
      for (var j = 0; j < newEls.length; j++) {
        var el = newEls[j];
        try {
          if (el && (!document || !document.contains || document.contains(el))) observer.observe(el);
        } catch (_) {}
      }
      return;
    }

    // Full observe — batch into rAF
    observeRaf = requestAnimationFrame(function() {
      observeRaf = null;
      if (destroyed || !observer) return;
      for (var k = 0; k < items.length; k++) {
        var item = items[k];
        if (!item || !item.el) continue;
        try {
          if (!document || !document.contains || document.contains(item.el)) observer.observe(item.el);
        } catch (_) {}
      }
    });
  }

  function setItems(nextItems) {
    var previousActiveEl = activeItem && activeItem.el;
    cancelRaf(observeRaf);
    observeRaf = null;
    // Don't clear processRaf — let in-flight processing finish

    var newItems = Array.isArray(nextItems) ? nextItems : [];

    // Diff-based update: unobserve removed elements, observe added ones
    if (observer) {
      var oldElementsByItem = itemByElement;
      var newElementsByItem = new Map();
      for (var i = 0; i < newItems.length; i++) {
        if (newItems[i] && newItems[i].el) newElementsByItem.set(newItems[i].el, newItems[i]);
      }

      // Unobserve elements that are no longer in the new set
      oldElementsByItem.forEach(function(_item, el) {
        if (!newElementsByItem.has(el)) {
          try { observer.unobserve(el); } catch (_) {}
        }
      });

      // Clear stale visible entries for removed items
      visibleTops.forEach(function(_top, item) {
        if (item && item.el && !newElementsByItem.has(item.el)) {
          visibleTops.delete(item);
        }
      });

      itemByElement = newElementsByItem;
      items = newItems;

      // Observe newly added elements incrementally
      var addedEls = [];
      newElementsByItem.forEach(function(_item, el) {
        if (!oldElementsByItem.has(el)) addedEls.push(el);
      });
      if (addedEls.length > 0) {
        observeItems(addedEls);
      }
    } else {
      // No observer yet — full setup
      items = newItems;
      itemByElement.clear();
      visibleTops.clear();
      pendingEntries = [];
      for (var j = 0; j < items.length; j++) {
        if (items[j] && items[j].el) itemByElement.set(items[j].el, items[j]);
      }
    }

    // Try to preserve the active item across rebuilds to avoid highlight flicker
    if (previousActiveEl) {
      var preserved = itemByElement.get(previousActiveEl);
      if (preserved) {
        activeItem = preserved;
        if (!observer) observeItems(items.map(function(it) { return it && it.el; }).filter(Boolean));
        return;
      }
    }
    activeItem = null;
    try { onChange && onChange(null, -1); } catch (_) {}
    if (!observer) observeItems(items.map(function(it) { return it && it.el; }).filter(Boolean));
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    disconnectObserver();
    items = [];
    activeItem = null;
  }

  setItems(options.items);

  return {
    destroy: destroy,
    setItems: setItems
  };
}
