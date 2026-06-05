
'use strict';

function selectActiveItem(entries) {
  var list = Array.isArray(entries) ? entries.slice() : [];
  list = list.filter(function(entry) {
    return entry && entry.item && Number.isFinite(entry.top);
  });
  list.sort(function(a, b) { return a.top - b.top; });
  return list.length ? list[0].item : null;
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
    entries.forEach(function(entry) {
      var item = entry && itemByElement.get(entry.target);
      if (!item) return;
      var isConnected = true;
      try { isConnected = !document || !document.contains || document.contains(entry.target); } catch (_) {}
      if (entry.isIntersecting && isConnected) {
        var top = entry.boundingClientRect && entry.boundingClientRect.top;
        visibleTops.set(item, Number.isFinite(top) ? top : 0);
      } else {
        visibleTops.delete(item);
      }
    });
    var nextItem = selectActiveItem(Array.from(visibleTops, function(pair) {
      return { item: pair[0], top: pair[1] };
    }));
    if (nextItem) notify(nextItem);
  }

  function observeItems() {
    if (destroyed || typeof IntersectionObserver === 'undefined') return;
    if (!observer) {
      observer = new IntersectionObserver(function(entries) {
        if (destroyed) return;
        pendingEntries.push.apply(pendingEntries, entries);
        if (processRaf != null) return;
        processRaf = requestAnimationFrame(function() {
          processRaf = null;
          var batch = pendingEntries;
          pendingEntries = [];
          processEntries(batch);
        });
      }, { root: null, rootMargin: '0px 0px -65% 0px', threshold: 0.1 });
    }

    observeRaf = requestAnimationFrame(function() {
      observeRaf = null;
      if (destroyed || !observer) return;
      items.forEach(function(item) {
        if (!item || !item.el) return;
        try {
          if (!document || !document.contains || document.contains(item.el)) observer.observe(item.el);
        } catch (_) {}
      });
    });
  }

  function setItems(nextItems) {
    var previousActiveEl = activeItem && activeItem.el;
    cancelRaf(observeRaf);
    cancelRaf(processRaf);
    observeRaf = null;
    processRaf = null;
    pendingEntries = [];
    visibleTops.clear();
    itemByElement.clear();
    if (observer) {
      try { observer.disconnect(); } catch (_) {}
    }
    items = Array.isArray(nextItems) ? nextItems : [];
    items.forEach(function(item) {
      if (item && item.el) itemByElement.set(item.el, item);
    });
    // Try to preserve the active item across rebuilds to avoid highlight flicker
    if (previousActiveEl) {
      var preserved = itemByElement.get(previousActiveEl);
      if (preserved) {
        activeItem = preserved;
        observeItems();
        return;
      }
    }
    activeItem = null;
    try { onChange && onChange(null, -1); } catch (_) {}
    observeItems();
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
