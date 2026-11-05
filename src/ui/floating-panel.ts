
'use strict';

import {
  msg,
  scrollToElement,
  cleanupOwnedElements,
  isTocContentIdentical,
  normalizeSide
} from '../utils/toc-utils.js';
import { EXTENSION_OWNER } from '../utils/constants.js';
import { NAV_LOCK_MS } from '../core/nav-lock.js';
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
  /** 'max-turns' — chatbot conversation truncated to recent turns (uses a
   *  dedicated notice); absent — generic item-cap notice. */
  reason?: string;
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
    // listbox/option (not menu/menuitem): this is a navigation outline the
    // user selects from, not a command menu. Roving tabindex + arrow/Home/End
    // keys below already follow the listbox keyboard contract.
    list.setAttribute('role', 'listbox');
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
        if (currentTocMeta.reason === 'max-turns') {
          // Conversation truncated to the most recent turns — the generic
          // "refine your selectors" advice makes no sense on a chat page.
          var turnsMsg = msg('truncatedRecentTurns', String(max));
          note.textContent = (turnsMsg && turnsMsg !== 'truncatedRecentTurns') ? turnsMsg : '';
        } else {
          var msgWithMax = msg('truncatedNoticeWithMax', String(max));
          if (msgWithMax && msgWithMax !== 'truncatedNoticeWithMax') {
            note.textContent = msgWithMax;
          } else {
            var msgText = msg('truncatedNotice');
            note.textContent = (msgText && msgText !== 'truncatedNotice') ? msgText : '';
          }
        }
        if (note.textContent) list.appendChild(note);
      }

      if (!items.length) {
        var empty = document.createElement('div');
        empty.className = 'toc-empty';
        empty.setAttribute('role', 'status');
        empty.textContent = msg('emptyTocMessage');
        list.appendChild(empty);
      }
    };

    var renderItemButtonsFrom = function(startIndex: number): void {
      var frag = document.createDocumentFragment();
      items.forEach(function(item: TocItem, index: number) {
        if (index < startIndex) return;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'toc-item';
        btn.setAttribute('role', 'option');
        btn.tabIndex = index === activeIndex || (activeIndex < 0 && index === 0) ? 0 : -1;
        btn.textContent = item.text;
        btn.dataset.index = String(index);
        btn.dataset.level = String(item.level || 2);
        if (item.source) btn.dataset.source = item.source;
        if (index === activeIndex) {
          btn.classList.add('active');
          btn.setAttribute('aria-selected', 'true');
        }
        item._node = btn;
        frag.appendChild(btn);
      });
      list.appendChild(frag);
    };

    var renderItemButtons = function(): void {
      renderItemButtonsFrom(0);
    };

    // Apply active state to ONE item node (active class + aria-selected +
    // roving tabIndex). Same contract as the render-time stamping in
    // renderItemButtons, including "index 0 is the tab stop when nothing is
    // active".
    function applyActiveNode(index: number, makeActive: boolean): void {
      var item = items[index];
      if (!item || !item._node) return;
      var node = item._node;
      node.classList.toggle('active', makeActive);
      if (makeActive) node.setAttribute('aria-selected', 'true');
      else node.removeAttribute('aria-selected');
      node.tabIndex = makeActive || (activeIndex < 0 && index === 0) ? 0 : -1;
    }

    var setActiveIndex = function(nextIndex: number): void {
      var normalized = Number.isFinite(nextIndex) ? nextIndex : -1;
      if (normalized === activeIndex) return;
      var prev = activeIndex;
      activeIndex = normalized;
      // Two-node update (mirrors edge-dock's updatePreviewActive): scroll
      // batches hit this on every reading-position change, and a full
      // items.forEach over up to 400 buttons per change was wasted work.
      if (prev >= 0 && prev < items.length) applyActiveNode(prev, false);
      // Leaving "no active item" demotes the first item's tab stop.
      if (prev < 0 && items.length > 0 && activeIndex >= 0) applyActiveNode(0, false);
      if (activeIndex >= 0 && activeIndex < items.length) {
        applyActiveNode(activeIndex, true);
      } else {
        // No active item: the first item becomes the roving tab stop.
        applyActiveNode(0, false);
      }
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
      // Same duration as the dock preview click (NAV_LOCK_MS) so both entry
      // points behave identically; the early-unlock timers below usually fire
      // sooner.
      navLock && navLock.lock(NAV_LOCK_MS);
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

    // Same "a truncation notice is shown" state? An append must not skip the
    // full re-render that adds (or removes) the notice row.
    function sameNoticeState(m1: TocMeta | null, m2: TocMeta | null): boolean {
      var t1 = !!(m1 && m1.truncated);
      var t2 = !!(m2 && m2.truncated);
      if (t1 !== t2) return false;
      if (!t1) return true;
      return String((m1 && m1.reason) || '') === String((m2 && m2.reason) || '');
    }

    /** Streaming fast path: the new list extends the old one (identical
     *  prefix — same element, text, level per index), so append only the new
     *  buttons instead of rebuilding the whole list. Chat pages append one
     *  conversation turn at a time; a full rebuild of up to 400 buttons per
     *  debounce tick was the common case there. Any prefix mismatch or a
     *  truncation-notice change falls back to the full re-render. */
    function tryAppendUpdate(newItems: TocItem[], newTocMeta: TocMeta | null): boolean {
      if (items.length === 0 || newItems.length <= items.length) return false;
      if (!sameNoticeState(currentTocMeta, newTocMeta)) return false;
      for (var i = 0; i < items.length; i++) {
        var prev = items[i];
        var next = newItems[i];
        if (!next || next.el !== prev.el || next.text !== prev.text || next.level !== prev.level) return false;
      }
      var prevLen = items.length;
      // Carry the existing button nodes onto the fresh prefix objects:
      // production rebuilds create NEW item objects, so without this the
      // prefix entries of the swapped array have no _node — setActiveIndex,
      // arrow-key focus, and focusActive would silently no-op for the whole
      // pre-existing list until a full re-render.
      for (var c = 0; c < prevLen; c++) {
        (newItems[c] as TocItem)._node = items[c]._node;
      }
      items = newItems;
      currentTocMeta = newTocMeta || null;
      renderItemButtonsFrom(prevLen);
      return true;
    }

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

      // Append-only fast path (streaming chats): identical prefix → append delta.
      if (tryAppendUpdate(newItems, newTocMeta || null)) return true;

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
