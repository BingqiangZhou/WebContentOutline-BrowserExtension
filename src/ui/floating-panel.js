'use strict';

import {
  msg,
  scrollToElement,
  cleanupOwnedElements
} from '../utils/toc-utils.js';
import { uiConst } from '../utils/constants.js';
import * as NL from '../core/nav-lock.js';
import {
  createTimerBag,
  createWindowListenerAdder,
  clearChildren
} from './floating-panel-helpers.js';

  var CFG = (function() {
    var get = function(name, fallback) { return (typeof uiConst === 'function') ? uiConst(name, fallback) : fallback; };
    return {
      UNLOCK_AFTER_MS: get('UNLOCK_AFTER_MS', 1000),
      SCROLL_STOP_MS: get('SCROLL_STOP_MS', 500),
      EXPAND_ANIM_MS: get('EXPAND_ANIM_MS', 300),
      PENDING_REBUILD_RECHECK_MS: get('PENDING_REBUILD_RECHECK_MS', 100),
      CLEAR_USER_SELECTED_DELAY_MS: get('CLEAR_USER_SELECTED_DELAY_MS', 200),
    };
  })();

export function renderFloatingPanel(opts) {
    var items = opts.items;
    var side = opts.side;
    var onCollapse = opts.onCollapse;
    var onRefresh = opts.onRefresh;
    var mountTarget = opts.mountTarget;
    var getPendingRebuild = opts.getPendingRebuild;
    var setPendingRebuild = opts.setPendingRebuild;
    var tocMeta = opts.tocMeta;
    var skipAnimation = opts.skipAnimation;
    var getIsRebuilding = opts.getIsRebuilding || function() { return false; };

    // Remove any existing panel to prevent duplicates
    if (cleanupOwnedElements) cleanupOwnedElements('.toc-floating[data-toc-owner]');

    var panel = document.createElement('div');
    var listenersController = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var listenerSignal = listenersController ? listenersController.signal : null;
    var addWindowListener = createWindowListenerAdder(listenerSignal);

    var resolveShown = null;
    var whenShown = new Promise(function(resolve) { resolveShown = resolve; });

    // Unified timer management for better cleanup and resource management
    var timers = createTimerBag([
      'unlock',
      'scrollStop',
      'pendingRebuildRecheck',
      'clearUserSelected',
      'expandAnim',
      'removal'
    ]);

    var intersectionObserver = null;
    var showRaf = null;
    var observeRaf = null;
    var ioRaf = null; // RAF for IntersectionObserver throttling
    var pendingIoEntries = [];
    var removalObserver = null;
    var cleanedUp = false;
    var userSelectedItem = null;
    var onPanelKeydown = null;
    var onListClick = null;
    var onListKeydown = null;
    var onBtnCollapseClick = null;

    panel.style.setProperty('visibility', 'hidden', 'important');
    var SCROLL_LISTENER_OPTS = { passive: true };

    var unlockLater = function(scrollDistance) {
      if (timers.unlock) clearTimeout(timers.unlock);
      var MIN_UNLOCK_MS = 500;
      var MAX_UNLOCK_MS = CFG.UNLOCK_AFTER_MS;
      var DISTANCE_THRESHOLD = 1000;
      var ratio = Math.min(1, (scrollDistance || 0) / DISTANCE_THRESHOLD);
      var duration = Math.round(MIN_UNLOCK_MS + ratio * (MAX_UNLOCK_MS - MIN_UNLOCK_MS));

      timers.unlock = setTimeout(function() {
        timers.unlock = null;
        NL.unlock();

        if (getPendingRebuild && getPendingRebuild()) {
          if (timers.pendingRebuildRecheck) clearTimeout(timers.pendingRebuildRecheck);
          timers.pendingRebuildRecheck = setTimeout(function() {
            timers.pendingRebuildRecheck = null;
            if (getPendingRebuild && getPendingRebuild()) {
              setPendingRebuild && setPendingRebuild(false);
              try {
                onRefresh();
              } catch (e) {
                console.warn('[toc] refresh after unlock failed', e);
              }
            }
          }, CFG.PENDING_REBUILD_RECHECK_MS);
        }

        if (timers.clearUserSelected) clearTimeout(timers.clearUserSelected);
        timers.clearUserSelected = setTimeout(function() {
          timers.clearUserSelected = null;
          items.forEach(function(it) {
            it._userSelected = false;
          });
          userSelectedItem = null;
        }, CFG.CLEAR_USER_SELECTED_DELAY_MS);
      }, duration);
    };

    var onScroll = function() {
      if (!NL.isLocked()) return;
      if (timers.scrollStop) clearTimeout(timers.scrollStop);
      timers.scrollStop = setTimeout(function() {
        timers.scrollStop = null;
        NL.unlock();
      }, CFG.SCROLL_STOP_MS);
    };

    var removeScrollListener = addWindowListener('scroll', onScroll, SCROLL_LISTENER_OPTS);

    var cleanupLock = function() {
      try { NL.unlock(); } catch (_) {}
      if (timers.unlock) { clearTimeout(timers.unlock); timers.unlock = null; }
      if (timers.scrollStop) { clearTimeout(timers.scrollStop); timers.scrollStop = null; }
      if (timers.pendingRebuildRecheck) { clearTimeout(timers.pendingRebuildRecheck); timers.pendingRebuildRecheck = null; }
      if (timers.clearUserSelected) { clearTimeout(timers.clearUserSelected); timers.clearUserSelected = null; }
      if (intersectionObserver) {
        intersectionObserver.disconnect();
        intersectionObserver = null;
      }
      if (observeRaf != null) {
        cancelAnimationFrame(observeRaf);
        observeRaf = null;
      }
      if (ioRaf != null) {
        cancelAnimationFrame(ioRaf);
        ioRaf = null;
      }
      pendingIoEntries = [];
    };

    panel.className = 'toc-floating toc-floating-docked toc-floating-' + (side === 'left' ? 'left' : 'right') + (skipAnimation ? '' : ' toc-floating-expand');
    panel.setAttribute('data-toc-owner', 'web-toc-assistant');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    onPanelKeydown = function(e) {
      if (!e) return;
      if (e.key === 'Escape') {
        try { e.preventDefault(); } catch (_) {}
        onCollapse && onCollapse();
      }
    };
    panel.addEventListener('keydown', onPanelKeydown, true);

    var header = document.createElement('div');
    header.className = 'toc-header';

    var headerRow = document.createElement('div');
    headerRow.className = 'toc-header-row';

    var titleSpan = document.createElement('span');
    titleSpan.className = 'toc-title';
    titleSpan.textContent = msg('tocTitle');
    titleSpan.id = 'toc-panel-title-' + Math.random().toString(36).slice(2);
    panel.setAttribute('aria-labelledby', titleSpan.id);

    var btnCollapse = document.createElement('button');
    btnCollapse.type = 'button';
    btnCollapse.className = 'toc-btn';
    btnCollapse.textContent = msg('buttonCollapse');
    btnCollapse.title = msg('buttonCollapseTitle');
    btnCollapse.setAttribute('aria-label', msg('buttonCollapseTitle') || msg('buttonCollapse'));
    btnCollapse.setAttribute('data-role', 'collapse');
    onBtnCollapseClick = function() { try { onCollapse && onCollapse(); } catch (_) {} };
    btnCollapse.addEventListener('click', onBtnCollapseClick);

    headerRow.appendChild(titleSpan);
    headerRow.appendChild(btnCollapse);

    header.appendChild(headerRow);

    var list = document.createElement('div');
    list.className = 'toc-list';
    list.setAttribute('role', 'menu');
    list.setAttribute('aria-orientation', 'vertical');
    list.setAttribute('aria-label', msg('tocTitle'));

    // --- Incremental update helpers ---
    var currentTocMeta = tocMeta || null;

    var renderListItems = function() {
      clearChildren(list);

      if (currentTocMeta && currentTocMeta.truncated) {
        var note = document.createElement('div');
        note.className = 'toc-empty';
        note.setAttribute('role', 'note');
        note.setAttribute('aria-live', 'polite');
        var max = currentTocMeta.maxItems || 400;
        var msgWithMax = msg('truncatedNoticeWithMax', String(max));
        if (msgWithMax && msgWithMax !== 'truncatedNoticeWithMax') {
          note.textContent = msgWithMax;
        } else {
          var msgText = msg('truncatedNotice');
          note.textContent = (msgText && msgText !== 'truncatedNotice') ? msgText : '';
        }
        list.appendChild(note);
      }

      if (!items.length) {
        var empty = document.createElement('div');
        empty.className = 'toc-empty';
        empty.setAttribute('role', 'status');
        empty.textContent = msg('emptyTocMessage');
        list.appendChild(empty);
      }
    };

    var renderItemButtons = function() {
      items.forEach(function(item) { item._userSelected = false; });
      userSelectedItem = null;
      items.forEach(function(item, index) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toc-item';
        btn.setAttribute('role', 'menuitem');
        btn.tabIndex = index === 0 ? 0 : -1;
        btn.textContent = item.text;
        btn.dataset.index = String(index);
        item._node = btn;
        list.appendChild(btn);
      });
    };

    var handleItemClick = function(item, node, e) {
      if (e && e.preventDefault) e.preventDefault();
      NL.lock();
      items.forEach(function(it) {
        it._userSelected = false;
        if (it._node) {
          it._node.classList.remove('active');
          try { it._node.removeAttribute('aria-current'); } catch (_) {}
          try { it._node.tabIndex = -1; } catch (_) {}
        }
      });
      item._userSelected = true;
      userSelectedItem = item;
      node.classList.add('active');
      try { node.setAttribute('aria-current', 'location'); } catch (_) {}
      try { node.tabIndex = 0; } catch (_) {}

      // Compute approximate scroll distance for dynamic lock duration
      var scrollDistance = 0;
      try {
        var elRect = item.el.getBoundingClientRect();
        scrollDistance = Math.abs(elRect.top);
      } catch (_) {}

      try {
        if (scrollToElement) {
          scrollToElement(item.el);
        } else {
          item.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } catch (_) {
        try { item.el.scrollIntoView({ behavior: 'auto', block: 'start' }); } catch (_2) {
          try { item.el.scrollIntoView(true); } catch (_3) {}
        }
      }
      unlockLater(scrollDistance);
    };

    var teardownIntersectionObserver = function() {
      if (intersectionObserver) {
        try { intersectionObserver.disconnect(); } catch (_) {}
        intersectionObserver = null;
      }
      if (observeRaf != null) {
        cancelAnimationFrame(observeRaf);
        observeRaf = null;
      }
      if (ioRaf != null) {
        cancelAnimationFrame(ioRaf);
        ioRaf = null;
      }
    };

    var setupIntersectionObserver = function() {
      teardownIntersectionObserver();
      if (!items.length || !('IntersectionObserver' in window)) return;

      var map = new Map();
      var topByEl = new Map();
      items.forEach(function(it) { if (it.el) map.set(it.el, it); });
      var active;
      var intersecting = new Set();

      var clearAllActive = function() {
        items.forEach(function(item) {
          if (item._node) {
            item._node.classList.remove('active');
            try { item._node.removeAttribute('aria-current'); } catch (_) {}
            try { item._node.tabIndex = -1; } catch (_) {}
          }
        });
        active = null;
        userSelectedItem = null;
      };

      var processIntersections = function(entries) {
        if (cleanedUp) return;
        if (!panel || !panel.isConnected) {
          try { intersectionObserver && intersectionObserver.disconnect(); } catch (_) {}
          intersectionObserver = null;
          return;
        }
        if (NL.isLocked()) return;
        if (getIsRebuilding()) return;

        var _sel = userSelectedItem;
        if (_sel) {
          clearAllActive();
          if (_sel._node && !_sel._node.classList.contains('active')) {
            _sel._node.classList.add('active');
            try { _sel._node.setAttribute('aria-current', 'location'); } catch (_) {}
            active = _sel;
          }
          return;
        }

        entries.forEach(function(entry) {
          try {
            if (entry && entry.target && !document.contains(entry.target)) {
              intersectionObserver && intersectionObserver.unobserve && intersectionObserver.unobserve(entry.target);
              var it = map.get(entry.target);
              if (it) { intersecting.delete(it); try { topByEl.delete(it.el); } catch (_) {} }
              return;
            }
          } catch (_) {}
          var it = map.get(entry.target);
          if (!it || !it._node) return;
          if (entry.isIntersecting) {
            intersecting.add(it);
            try {
              if (entry.boundingClientRect && Number.isFinite(entry.boundingClientRect.top)) {
                topByEl.set(it.el, entry.boundingClientRect.top);
              }
            } catch (_) {}
          } else {
            intersecting.delete(it);
            try { topByEl.delete(it.el); } catch (_) {}
          }
        });

        var visibleItems = Array.from(intersecting).filter(function(it) { return it.el && document.contains(it.el); });
        visibleItems.sort(function(a, b) {
          var ta = topByEl.has(a.el) ? topByEl.get(a.el) : 0;
          var tb = topByEl.has(b.el) ? topByEl.get(b.el) : 0;
          return ta - tb;
        });

        if (visibleItems.length > 0) {
          var newActive = visibleItems[0];
          if (active !== newActive) {
            clearAllActive();
            newActive._node.classList.add('active');
            try { newActive._node.setAttribute('aria-current', 'location'); } catch (_) {}
            active = newActive;
          }
        }
      };

      intersectionObserver = new IntersectionObserver(function(entries) {
        if (cleanedUp) return;
        if (pendingIoEntries) {
          for (var i = 0; i < entries.length; i++) pendingIoEntries.push(entries[i]);
        }
        if (ioRaf) return;
        ioRaf = requestAnimationFrame(function() {
          ioRaf = null;
          if (cleanedUp) return;
          var batch = pendingIoEntries;
          pendingIoEntries = [];
          processIntersections(batch);
        });
      }, { root: null, rootMargin: '0px 0px -65% 0px', threshold: 0.1 });

      observeRaf = requestAnimationFrame(function() {
        observeRaf = null;
        if (cleanedUp) return;
        if (!panel || !panel.isConnected) return;
        if (!intersectionObserver) return;
        items.forEach(function(it) {
          if (it.el && document.contains(it.el)) {
            intersectionObserver.observe(it.el);
          }
        });
      });
    };

    renderListItems();
    if (items.length > 0) {
      renderItemButtons();
    }

    onListClick = function(e) {
      var target = e && e.target;
      var node = target && target.closest ? target.closest('.toc-item') : null;
      if (!node || !list.contains(node)) return;
      var idx = parseInt(node.dataset.index, 10);
      var item = items[idx];
      if (!item) return;
      handleItemClick(item, node, e);
    };
    list.addEventListener('click', onListClick);

    onListKeydown = function(e) {
      if (!e) return;
      var key = e.key;
      var node = e.target && e.target.closest ? e.target.closest('.toc-item') : null;
      var nodes = Array.from(list.querySelectorAll('.toc-item'));
      var currentIndex = node ? nodes.indexOf(node) : -1;

      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
        if (!nodes.length) return;
        e.preventDefault();
        var nextIndex = currentIndex >= 0 ? currentIndex : 0;
        if (key === 'ArrowDown') nextIndex = Math.min(nodes.length - 1, nextIndex + 1);
        if (key === 'ArrowUp') nextIndex = Math.max(0, nextIndex - 1);
        if (key === 'Home') nextIndex = 0;
        if (key === 'End') nextIndex = nodes.length - 1;
        try {
          nodes.forEach(function(n, idx) { n.tabIndex = idx === nextIndex ? 0 : -1; });
        } catch (_) {}
        try { nodes[nextIndex].focus({ preventScroll: false }); } catch (_) { nodes[nextIndex].focus(); }
        return;
      }

      if (key !== 'Enter' && key !== ' ') return;
      if (!node || !list.contains(node)) return;
      var idx = parseInt(node.dataset.index, 10);
      var item = items[idx];
      if (!item) return;
      e.preventDefault();
      handleItemClick(item, node, e);
    };
    list.addEventListener('keydown', onListKeydown);

    panel.appendChild(header);

    panel.appendChild(list);
    (mountTarget || document.documentElement).appendChild(panel);

    // Show panel — optionally skip expand animation
    showRaf = requestAnimationFrame(function() {
      showRaf = null;
      if (cleanedUp) return;
      if (!panel || !panel.isConnected) return;
      panel.style.removeProperty('visibility');
      if (skipAnimation) {
        try { resolveShown && resolveShown(); } catch (_) {}
      } else {
        panel.classList.add('toc-expanded');
        try { resolveShown && resolveShown(); } catch (_) {}
        if (timers.expandAnim) clearTimeout(timers.expandAnim);
        timers.expandAnim = setTimeout(function() {
          timers.expandAnim = null;
          if (cleanedUp) return;
          if (!panel || !panel.isConnected) return;
          panel.classList.remove('toc-floating-expand', 'toc-expanded');
        }, CFG.EXPAND_ANIM_MS);
      }
    });

    var origRemove = panel.remove.bind(panel);

    var stopRemovalWatch = function() {
      if (removalObserver) {
        try { removalObserver.disconnect(); } catch (_) {}
        removalObserver = null;
      }
      if (timers.removal != null) {
        clearTimeout(timers.removal);
        timers.removal = null;
      }
    };

    var cleanup = function(opts) {
      opts = opts || {};
      var removedExternally = opts.removedExternally;
      if (cleanedUp) return;
      cleanedUp = true;
      stopRemovalWatch();
      try { if (onListClick) list.removeEventListener('click', onListClick); } catch (_) {}
      try { if (onListKeydown) list.removeEventListener('keydown', onListKeydown); } catch (_) {}
      onListClick = null;
      onListKeydown = null;
      try { if (onBtnCollapseClick) btnCollapse.removeEventListener('click', onBtnCollapseClick); } catch (_) {}
      onBtnCollapseClick = null;
      try { if (onPanelKeydown) panel.removeEventListener('keydown', onPanelKeydown, true); } catch (_) {}
      onPanelKeydown = null;
      try { resolveShown && resolveShown(); } catch (_) {}
      try { removeScrollListener && removeScrollListener(); } catch (_) {}
      try { listenersController && listenersController.abort && listenersController.abort(); } catch (_) {}
      cleanupLock();
      timers.clearAll();
      try {
        if (showRaf != null) cancelAnimationFrame(showRaf);
      } catch (_) {}
      showRaf = null;

      if (!removedExternally) {
        try {
          if (panel && panel.isConnected) origRemove();
        } catch (_) {}
      }
    };

    try {
      panel.__TOC_CLEANUP__ = function() { cleanup({ removedExternally: true }); };
    } catch (_) {}

    var startRemovalWatch = function() {
      stopRemovalWatch();
      if (typeof MutationObserver !== 'undefined' && document && document.documentElement) {
        try {
          removalObserver = new MutationObserver(function() {
            if (cleanedUp) return;
            if (panel && panel.isConnected) return;
            cleanup({ removedExternally: true });
          });
          removalObserver.observe(document.documentElement, { childList: true, subtree: true });
          return;
        } catch (_) {
          removalObserver = null;
        }
      }

      var tick = function() {
        timers.removal = null;
        if (cleanedUp) return;
        if (panel && panel.isConnected) {
          // MutationObserver isn't available; poll at a low frequency to avoid per-frame CPU use.
          try { timers.removal = setTimeout(tick, 1000); } catch (_) {}
          return;
        }
        cleanup({ removedExternally: true });
      };
      try { timers.removal = setTimeout(tick, 1000); } catch (_) {}
    };

    startRemovalWatch();

    panel.remove = function() { cleanup({ removedExternally: false }); };

    setupIntersectionObserver();

    var updateItems = function(newItems, newTocMeta) {
      if (cleanedUp) return false;
      if (!panel || !panel.isConnected) return false;

      // Check for identical content — no-op if nothing changed
      if (items.length === newItems.length && items.length > 0) {
        var identical = true;
        for (var i = 0; i < items.length; i++) {
          if (items[i].text !== newItems[i].text || items[i].el !== newItems[i].el) {
            identical = false;
            break;
          }
        }
        if (identical) return false;
      }

      // Both empty — nothing to do
      if (items.length === 0 && newItems.length === 0) {
        if ((!currentTocMeta || !currentTocMeta.truncated) && (!newTocMeta || !newTocMeta.truncated)) {
          return false;
        }
      }

      // Swap the items array — all existing closures will see the new value
      items = newItems;
      currentTocMeta = newTocMeta || null;

      // Re-render list content (clears old items, adds new buttons)
      renderListItems();
      if (items.length > 0) {
        renderItemButtons();
      }

      // Teardown and recreate IntersectionObserver for new item elements
      setupIntersectionObserver();

      return true;
    };

    return {
      remove() { panel.remove(); },
      whenShown,
      updateItems
    };
  }
