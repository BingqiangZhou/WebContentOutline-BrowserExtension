
'use strict';

import {
  msg,
  scrollToElement,
  cleanupOwnedElements,
  isTocContentIdentical,
  normalizeSide
} from '../utils/toc-utils.js';
import { EXTENSION_OWNER } from '../utils/constants.js';
import { getTocShadowHost } from './shadow-root.js';

  /** Clear all children of an element using native replaceChildren(). */
  function clearChildren(el: HTMLElement): void {
    if (!el) return;
    el.replaceChildren();
  }

  var CFG = {
    UNLOCK_AFTER_MS: 800,
    SCROLL_STOP_MS: 500,
    EXPAND_ANIM_MS: 300,
    PENDING_REBUILD_RECHECK_MS: 100,
  };

interface TocItem {
  id: string;
  el: Element;
  text: string;
  level: number;
  source?: string;
  _node?: HTMLElement;
}

interface TocMeta {
  truncated: boolean;
  maxItems: number;
  totalCandidates: number;
}

interface FloatingPanelOpts {
  items?: TocItem[];
  side?: string;
  onCollapse?: () => void;
  onRefresh?: () => void;
  mountTarget?: HTMLElement;
  getPendingRebuild?: () => boolean;
  setPendingRebuild?: (v: boolean) => void;
  tocMeta?: TocMeta | null;
  skipAnimation?: boolean;
  activeIndex?: number;
  onNavigate?: (item: TocItem, index: number) => void;
  embedded?: boolean;
  focusOnOpen?: boolean;
  navLock?: { lock: (durationMs?: number) => void; unlock: () => void; isLocked: () => boolean };
  [key: string]: any;
}

export function renderFloatingPanel(opts: FloatingPanelOpts) {
    var items: TocItem[] = opts.items || [];
    var side: string | undefined = opts.side;
    var onCollapse: (() => void) | undefined = opts.onCollapse;
    var onRefresh: (() => void) | undefined = opts.onRefresh;
    var mountTarget: HTMLElement | undefined = opts.mountTarget;
    var getPendingRebuild: (() => boolean) | undefined = opts.getPendingRebuild;
    var setPendingRebuild: ((v: boolean) => void) | undefined = opts.setPendingRebuild;
    var tocMeta: TocMeta | null | undefined = opts.tocMeta;
    var skipAnimation: boolean | undefined = opts.skipAnimation;
    var activeIndex: number = typeof opts.activeIndex === 'number' && Number.isFinite(opts.activeIndex) ? opts.activeIndex : -1;
    var onNavigate: ((item: TocItem, index: number) => void) | undefined = opts.onNavigate;
    var embedded = !!opts.embedded;
    // When true, the panel moves focus to the active (or first) TOC item once
    // shown — used when the dock is expanded via KEYBOARD so keyboard/SR users
    // get an entry point into the panel. Never set for hover expansion (would
    // steal focus from the page).
    var focusOnOpen = !!opts.focusOnOpen && !embedded;
    var navLock = opts.navLock;

    // Remove any existing panel to prevent duplicates
    if (!embedded) cleanupOwnedElements('.toc-floating[data-toc-owner="' + EXTENSION_OWNER + '"]');

    var panel = document.createElement('div');
    var listenersController = new AbortController();

    // Simple timer IDs for cleanup
    var unlockTimer: ReturnType<typeof setTimeout> | null = null;
    var scrollStopTimer: ReturnType<typeof setTimeout> | null = null;
    var pendingRebuildTimer: ReturnType<typeof setTimeout> | null = null;
    var expandAnimTimer: ReturnType<typeof setTimeout> | null = null;

    var showRaf: number | null = null;
    var cleanedUp = false;
    var onPanelKeydown: ((e: KeyboardEvent) => void) | null = null;
    var onListClick: ((e: MouseEvent) => void) | null = null;
    var onListKeydown: ((e: KeyboardEvent) => void) | null = null;

    panel.style.setProperty('visibility', 'hidden', 'important');
    var SCROLL_LISTENER_OPTS: { passive: boolean; capture?: boolean } = { passive: true };

    var unlockLater = function() {
      if (unlockTimer) clearTimeout(unlockTimer);
      unlockTimer = setTimeout(function() {
        unlockTimer = null;
        navLock && navLock.unlock();

        if (getPendingRebuild && getPendingRebuild()) {
          if (pendingRebuildTimer) clearTimeout(pendingRebuildTimer);
          pendingRebuildTimer = setTimeout(function() {
            pendingRebuildTimer = null;
            if (getPendingRebuild && getPendingRebuild()) {
              setPendingRebuild && setPendingRebuild(false);
              try { onRefresh && onRefresh(); } catch (e) { console.warn('[toc] refresh after unlock failed', e); }
            }
          }, CFG.PENDING_REBUILD_RECHECK_MS);
        }
      }, CFG.UNLOCK_AFTER_MS);
    };

    var onScroll = function() {
      if (!navLock || !navLock.isLocked()) return;
      if (scrollStopTimer) clearTimeout(scrollStopTimer);
      scrollStopTimer = setTimeout(function() {
        scrollStopTimer = null;
        navLock && navLock.unlock();
      }, CFG.SCROLL_STOP_MS);
    };

    // Set up scroll listener
    window.addEventListener('scroll', onScroll, { ...SCROLL_LISTENER_OPTS, signal: listenersController.signal });

    var cleanupLock = function() {
      if (navLock) navLock.unlock();
      if (unlockTimer) { clearTimeout(unlockTimer); unlockTimer = null; }
      if (scrollStopTimer) { clearTimeout(scrollStopTimer); scrollStopTimer = null; }
      if (pendingRebuildTimer) { clearTimeout(pendingRebuildTimer); pendingRebuildTimer = null; }
    };

    panel.className = embedded
      ? 'toc-floating-embedded'
      : 'toc-floating toc-floating-docked toc-floating-' + normalizeSide(side) + (skipAnimation ? '' : ' toc-floating-expand');
    if (!embedded) panel.setAttribute('data-toc-owner', EXTENSION_OWNER);
    panel.setAttribute('role', embedded ? 'presentation' : 'dialog');
    if (!embedded) {
      panel.setAttribute('aria-modal', 'false');
      panel.setAttribute('aria-label', msg('tocTitle'));
    }
    onPanelKeydown = function(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCollapse && onCollapse();
      }
    };
    panel.addEventListener('keydown', onPanelKeydown, { capture: true, signal: listenersController.signal });

    var list = document.createElement('div');
    list.className = 'toc-list';
    list.setAttribute('role', 'menu');
    list.setAttribute('aria-orientation', 'vertical');
    list.setAttribute('aria-label', msg('tocTitle'));

    // --- Incremental update helpers ---
    var currentTocMeta = tocMeta || null;

    var renderListItems = function(): void {
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

    var renderItemButtons = function(): void {
      var frag = document.createDocumentFragment();
      items.forEach(function(item: TocItem, index: number) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toc-item';
        btn.setAttribute('role', 'menuitem');
        btn.tabIndex = index === activeIndex || (activeIndex < 0 && index === 0) ? 0 : -1;
        btn.textContent = item.text;
        btn.dataset.index = String(index);
        btn.dataset.level = String(item.level || 2);
        if (item.source) btn.dataset.source = item.source;
        if (index === activeIndex) {
          btn.classList.add('active');
          btn.setAttribute('aria-current', 'location');
        }
        item._node = btn;
        frag.appendChild(btn);
      });
      list.appendChild(frag);
    };

    var setActiveIndex = function(nextIndex: number): void {
      activeIndex = Number.isFinite(nextIndex) ? nextIndex : -1;
      items.forEach(function(item: TocItem, index: number) {
        if (!item._node) return;
        var isActive = index === activeIndex;
        item._node.classList.toggle('active', isActive);
        if (isActive) item._node.setAttribute('aria-current', 'location');
        else item._node.removeAttribute('aria-current');
        item._node.tabIndex = isActive || (activeIndex < 0 && index === 0) ? 0 : -1;
      });
    };

    // Focus the active (or first) TOC item. Used on keyboard-driven open so the
    // panel is operable without a mouse; arrow-key nav then takes over.
    var focusActive = function(): void {
      if (embedded || !items.length) return;
      var targetIdx = activeIndex >= 0 && activeIndex < items.length ? activeIndex : 0;
      var target = items[targetIdx];
      if (target && target._node) {
        try { (target._node as HTMLElement).focus({ preventScroll: false }); } catch (_) {}
      }
    };

    var handleItemClick = function(item: TocItem, node: HTMLElement, index: number, e: MouseEvent | KeyboardEvent) {
      e.preventDefault();
      navLock && navLock.lock();
      setActiveIndex(index);
      onNavigate && onNavigate(item, index);

      try {
        scrollToElement(item.el);
      } catch (_) {
        try { item.el.scrollIntoView({ behavior: 'auto', block: 'start' }); } catch (_2) {}
      }
      unlockLater();
    };

    renderListItems();
    if (items.length > 0) {
      renderItemButtons();
    }

    onListClick = function(e: MouseEvent) {
      var target = e && e.target as HTMLElement | null;
      var node: HTMLElement | null = target && target.closest ? target.closest('.toc-item') as HTMLElement | null : null;
      if (!node || !list.contains(node)) return;
      var idx = parseInt(node.dataset.index || '0', 10);
      var item = items[idx];
      if (!item) return;
      handleItemClick(item, node, idx, e);
    };
    list.addEventListener('click', onListClick, { signal: listenersController.signal });

    onListKeydown = function(e: KeyboardEvent) {
      var key = e.key;
      var node = e.target && (e.target as HTMLElement).closest ? (e.target as HTMLElement).closest('.toc-item') as HTMLElement | null : null;
      // Find current index from dataset instead of querySelectorAll on every keypress
      var currentIndex = node ? parseInt(node.dataset.index || '0', 10) : -1;

      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Home' || key === 'End') {
        if (!items.length) return;
        e.preventDefault();
        var nextIndex = currentIndex >= 0 ? currentIndex : 0;
        if (key === 'ArrowDown') nextIndex = Math.min(items.length - 1, nextIndex + 1);
        if (key === 'ArrowUp') nextIndex = Math.max(0, nextIndex - 1);
        if (key === 'Home') nextIndex = 0;
        if (key === 'End') nextIndex = items.length - 1;
        // Update tabIndex only for old and new items (not all items)
        setActiveIndex(nextIndex);
        var nextItem = items[nextIndex];
        if (nextItem && nextItem._node) {
          (nextItem._node as HTMLElement).focus({ preventScroll: false });
        }
        return;
      }

      if (key !== 'Enter' && key !== ' ') return;
      if (!node || !list.contains(node)) return;
      var idx = parseInt(node.dataset.index || '0', 10);
      var item = items[idx];
      if (!item) return;
      e.preventDefault();
      handleItemClick(item, node, idx, e);
    };
    list.addEventListener('keydown', onListKeydown, { signal: listenersController.signal });

    panel.appendChild(list);
    (mountTarget || getTocShadowHost()?.shadowRoot || document.documentElement).appendChild(panel);

    // Show panel — optionally skip expand animation
    showRaf = requestAnimationFrame(function() {
      showRaf = null;
      if (cleanedUp) return;
      if (!panel || !panel.isConnected) return;
      panel.style.removeProperty('visibility');
      if (focusOnOpen) focusActive();
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
      // All DOM listeners (scroll, panel/list keydown, list click) are registered
      // with listenersController.signal, so a single abort() tears them all down —
      // no manual removeEventListener bookkeeping (matches edge-dock's pattern).
      listenersController.abort();
      cleanupLock();
      if (expandAnimTimer) { clearTimeout(expandAnimTimer); expandAnimTimer = null; }
      if (showRaf != null) cancelAnimationFrame(showRaf);
      showRaf = null;
    };

    panel.remove = function() {
      cleanup();
      if (panel && panel.isConnected) origRemove();
    };

    // Used by cleanupOwnedElements() for teardown
    panel.__TOC_CLEANUP__ = function() { cleanup(); };

    var updateItems = function(newItems: TocItem[], newTocMeta: TocMeta | null): boolean {
      if (cleanedUp) return false;
      if (!panel || !panel.isConnected) return false;

      // Check for identical content — no-op if nothing changed
      if (isTocContentIdentical(items, newItems)) return false;

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
      updateItems,
      focusActive
    };
  }
