
'use strict';

import {
  msg,
  scrollToElement,
  cleanupOwnedElements
} from '../utils/toc-utils.js';
import * as NL from '../core/nav-lock.js';
import { clearChildren } from './floating-panel-helpers.js';

  var CFG = {
    UNLOCK_AFTER_MS: 800,
    SCROLL_STOP_MS: 500,
    EXPAND_ANIM_MS: 300,
    PENDING_REBUILD_RECHECK_MS: 100,
  };

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
    var activeIndex = opts.activeIndex;
    var onNavigate = opts.onNavigate;
    var embedded = !!opts.embedded;

    // Remove any existing panel to prevent duplicates
    if (!embedded && cleanupOwnedElements) cleanupOwnedElements('.toc-floating[data-toc-owner="web-toc-assistant"]');

    var panel = document.createElement('div');
    var listenersController = (typeof AbortController !== 'undefined') ? new AbortController() : null;

    // Simple timer IDs for cleanup
    var unlockTimer = null;
    var scrollStopTimer = null;
    var pendingRebuildTimer = null;
    var expandAnimTimer = null;

    var showRaf = null;
    var cleanedUp = false;
    var onPanelKeydown = null;
    var onListClick = null;
    var onListKeydown = null;
    var removeScrollListener = null;

    panel.style.setProperty('visibility', 'hidden', 'important');
    var SCROLL_LISTENER_OPTS: { passive: boolean; capture?: boolean } = { passive: true };

    var unlockLater = function() {
      if (unlockTimer) clearTimeout(unlockTimer);
      unlockTimer = setTimeout(function() {
        unlockTimer = null;
        NL.unlock();

        if (getPendingRebuild && getPendingRebuild()) {
          if (pendingRebuildTimer) clearTimeout(pendingRebuildTimer);
          pendingRebuildTimer = setTimeout(function() {
            pendingRebuildTimer = null;
            if (getPendingRebuild && getPendingRebuild()) {
              setPendingRebuild && setPendingRebuild(false);
              try { onRefresh(); } catch (e) { console.warn('[toc] refresh after unlock failed', e); }
            }
          }, CFG.PENDING_REBUILD_RECHECK_MS);
        }
      }, CFG.UNLOCK_AFTER_MS);
    };

    var onScroll = function() {
      if (!NL.isLocked()) return;
      if (scrollStopTimer) clearTimeout(scrollStopTimer);
      scrollStopTimer = setTimeout(function() {
        scrollStopTimer = null;
        NL.unlock();
      }, CFG.SCROLL_STOP_MS);
    };

    // Set up scroll listener with AbortController if available
    try {
      if (listenersController) {
        window.addEventListener('scroll', onScroll, { ...SCROLL_LISTENER_OPTS, signal: listenersController.signal });
      } else {
        window.addEventListener('scroll', onScroll, SCROLL_LISTENER_OPTS);
      }
      removeScrollListener = function() {
        try { window.removeEventListener('scroll', onScroll, SCROLL_LISTENER_OPTS.capture || false); } catch (_) {}
      };
    } catch (_) {
      removeScrollListener = function() {};
    }

    var cleanupLock = function() {
      try { NL.unlock(); } catch (_) {}
      if (unlockTimer) { clearTimeout(unlockTimer); unlockTimer = null; }
      if (scrollStopTimer) { clearTimeout(scrollStopTimer); scrollStopTimer = null; }
      if (pendingRebuildTimer) { clearTimeout(pendingRebuildTimer); pendingRebuildTimer = null; }
    };

    panel.className = embedded
      ? 'toc-floating-embedded'
      : 'toc-floating toc-floating-docked toc-floating-' + (side === 'left' ? 'left' : 'right') + (skipAnimation ? '' : ' toc-floating-expand');
    if (!embedded) panel.setAttribute('data-toc-owner', 'web-toc-assistant');
    panel.setAttribute('role', embedded ? 'presentation' : 'dialog');
    if (!embedded) {
      panel.setAttribute('aria-modal', 'false');
      panel.setAttribute('aria-label', msg('tocTitle'));
    }
    onPanelKeydown = function(e) {
      if (!e) return;
      if (e.key === 'Escape') {
        try { e.preventDefault(); } catch (_) {}
        onCollapse && onCollapse();
      }
    };
    panel.addEventListener('keydown', onPanelKeydown, true);

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
      var frag = document.createDocumentFragment();
      items.forEach(function(item, index) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toc-item';
        btn.setAttribute('role', 'menuitem');
        btn.tabIndex = index === activeIndex || (activeIndex < 0 && index === 0) ? 0 : -1;
        btn.textContent = item.text;
        btn.dataset.index = String(index);
        btn.dataset.level = String(item.level || 2);
        if (index === activeIndex) {
          btn.classList.add('active');
          btn.setAttribute('aria-current', 'location');
        }
        item._node = btn;
        frag.appendChild(btn);
      });
      list.appendChild(frag);
    };

    var setActiveIndex = function(nextIndex) {
      activeIndex = Number.isFinite(nextIndex) ? nextIndex : -1;
      items.forEach(function(item, index) {
        if (!item._node) return;
        var isActive = index === activeIndex;
        item._node.classList.toggle('active', isActive);
        try {
          if (isActive) item._node.setAttribute('aria-current', 'location');
          else item._node.removeAttribute('aria-current');
          item._node.tabIndex = isActive || (activeIndex < 0 && index === 0) ? 0 : -1;
        } catch (_) {}
      });
    };

    var handleItemClick = function(item, node, index, e) {
      if (e && e.preventDefault) e.preventDefault();
      NL.lock(undefined!);
      setActiveIndex(index);
      try { onNavigate && onNavigate(item, index); } catch (_) {}

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
      unlockLater();
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
      handleItemClick(item, node, idx, e);
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
          nodes.forEach(function(n, idx) { (n as HTMLElement).tabIndex = idx === nextIndex ? 0 : -1; });
        } catch (_) {}
        try { (nodes[nextIndex] as HTMLElement).focus({ preventScroll: false }); } catch (_) { (nodes[nextIndex] as HTMLElement).focus(); }
        return;
      }

      if (key !== 'Enter' && key !== ' ') return;
      if (!node || !list.contains(node)) return;
      var idx = parseInt(node.dataset.index, 10);
      var item = items[idx];
      if (!item) return;
      e.preventDefault();
      handleItemClick(item, node, idx, e);
    };
    list.addEventListener('keydown', onListKeydown);

    panel.appendChild(list);
    (mountTarget || document.documentElement).appendChild(panel);

    // Show panel — optionally skip expand animation
    showRaf = requestAnimationFrame(function() {
      showRaf = null;
      if (cleanedUp) return;
      if (!panel || !panel.isConnected) return;
      panel.style.removeProperty('visibility');
      if (skipAnimation) {
        // no animation needed
      } else {
        panel.classList.add('toc-expanded');
        if (expandAnimTimer) clearTimeout(expandAnimTimer);
        expandAnimTimer = setTimeout(function() {
          expandAnimTimer = null;
          if (cleanedUp) return;
          if (!panel || !panel.isConnected) return;
          panel.classList.remove('toc-floating-expand', 'toc-expanded');
        }, CFG.EXPAND_ANIM_MS);
      }
    });

    var origRemove = panel.remove.bind(panel);

    var cleanup = function() {
      if (cleanedUp) return;
      cleanedUp = true;
      try { if (onListClick) list.removeEventListener('click', onListClick); } catch (_) {}
      try { if (onListKeydown) list.removeEventListener('keydown', onListKeydown); } catch (_) {}
      onListClick = null;
      onListKeydown = null;
      try { if (onPanelKeydown) panel.removeEventListener('keydown', onPanelKeydown, true); } catch (_) {}
      onPanelKeydown = null;
      try { removeScrollListener && removeScrollListener(); } catch (_) {}
      try { listenersController && listenersController.abort && listenersController.abort(); } catch (_) {}
      cleanupLock();
      if (expandAnimTimer) { clearTimeout(expandAnimTimer); expandAnimTimer = null; }
      try {
        if (showRaf != null) cancelAnimationFrame(showRaf);
      } catch (_) {}
      showRaf = null;
    };

    panel.remove = function() {
      cleanup();
      try {
        if (panel && panel.isConnected) origRemove();
      } catch (_) {}
    };

    // Used by cleanupOwnedElements() for teardown
    panel.__TOC_CLEANUP__ = function() { cleanup(); };

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

      return true;
    };

    return {
      remove() { panel.remove(); },
      setActiveIndex,
      updateItems
    };
  }
