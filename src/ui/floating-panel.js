define('floating-panel', ['toc-utils', 'drag-helper', 'toc-constants'], function(tocUtils, dragHelper, C) {
  'use strict';

  var msg = tocUtils.msg || function(key) { return key; };
  var setBadgePosByHost = tocUtils.setBadgePosByHost;
  var uiConst = C.uiConst;
  var createDragController = dragHelper.createDragController;
  var scrollToElement = tocUtils.scrollToElement;

  var CFG = (function() {
    var get = function(name, fallback) { return (typeof uiConst === 'function') ? uiConst(name, fallback) : fallback; };
    return {
      UNLOCK_AFTER_MS: get('UNLOCK_AFTER_MS', 1000),
      SCROLL_STOP_MS: get('SCROLL_STOP_MS', 500),
      PANEL_WIDTH: get('PANEL_WIDTH', 280),
      PANEL_HEIGHT: get('PANEL_HEIGHT', 400),
      DRAG_MARGIN_PX: get('DRAG_MARGIN_PX', 4),
      EXPAND_ANIM_MS: get('EXPAND_ANIM_MS', 300),
      PENDING_REBUILD_RECHECK_MS: get('PENDING_REBUILD_RECHECK_MS', 100),
      CLEAR_USER_SELECTED_DELAY_MS: get('CLEAR_USER_SELECTED_DELAY_MS', 200),
    };
  })();

  function renderFloatingPanel(opts) {
    var items = opts.items;
    var side = opts.side;
    var onCollapse = opts.onCollapse;
    var onRefresh = opts.onRefresh;
    var onPick = opts.onPick;
    var onSiteConfig = opts.onSiteConfig;
    var getPendingRebuild = opts.getPendingRebuild;
    var setPendingRebuild = opts.setPendingRebuild;
    var panelPos = opts.panelPos;
    var tocMeta = opts.tocMeta;
    var skipAnimation = opts.skipAnimation;
    var getIsRebuilding = opts.getIsRebuilding || function() { return false; };

    var NL = (typeof require === 'function') ? require('nav-lock') : globalThis.NAV_LOCK;
    // Remove any existing panel to prevent duplicates
    try {
      document.querySelectorAll(uiConst('CLEANUP_SELECTOR', '.toc-floating[data-toc-owner]')).forEach(function(el) {
        try {
          var cleanup = el && el.__TOC_CLEANUP__;
          if (typeof cleanup === 'function') cleanup();
        } catch (_) {}
        try { el.remove(); } catch (_) {}
      });
    } catch (_) {}

    var panel = document.createElement('div');
    var listenersController = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var listenerSignal = listenersController ? listenersController.signal : null;
    var addWindowListener = function(type, handler, options) {
      var capture = (typeof options === 'boolean') ? options : !!(options && options.capture);
      var attached = false;
      try {
        if (listenerSignal) {
          window.addEventListener(type, handler, { ...(options || {}), signal: listenerSignal });
          attached = true;
        }
      } catch (_) {}
      if (!attached) {
        window.addEventListener(type, handler, options);
      }
      return function() {
        try { window.removeEventListener(type, handler, capture); } catch (_) {}
      };
    };

    var resolveShown = null;
    var whenShown = new Promise(function(resolve) { resolveShown = resolve; });

    // Unified timer management for better cleanup and resource management
    var timers = {
      unlock: null,
      scrollStop: null,
      pendingRebuildRecheck: null,
      clearUserSelected: null,
      expandAnim: null,
      persist: null,
      removal: null
    };

    var clearAllTimers = function() {
      Object.keys(timers).forEach(function(key) {
        if (timers[key]) {
          clearTimeout(timers[key]);
          timers[key] = null;
        }
      });
    };

    var intersectionObserver = null;
    var showRaf = null;
    var observeRaf = null;
    var ioRaf = null; // RAF for IntersectionObserver throttling
    var pendingIoEntries = [];
    var removalObserver = null;
    var cleanedUp = false;
    var userSelectedItem = null;
    var pickerStartEvent = 'toc-picker-start';
    var pickerEndEvent = 'toc-picker-end';
    var onPanelKeydown = null;
    var onListClick = null;
    var onListKeydown = null;
    var onBtnCollapseClick = null;
    var onBtnPickClick = null;
    var onBtnManageClick = null;
    var onBtnRefreshClick = null;

    panel.style.setProperty('visibility', 'hidden', 'important');

    // Apply saved position
    if (panelPos && Number.isFinite(panelPos.top) && Number.isFinite(panelPos.left)) {
      panel.style.setProperty('top', panelPos.top + 'px', 'important');
      panel.style.setProperty('left', panelPos.left + 'px', 'important');
      panel.style.setProperty('right', 'auto', 'important');
      panel.style.setProperty('bottom', 'auto', 'important');
    }

    var resizeRaf = null;
    var lastViewportW = window.innerWidth;
    var lastViewportH = window.innerHeight;
    var anchorX = (side === 'left') ? 'left' : 'right';
    var pendingPersistCenter = null;

    var constrainCurrentPosition = function() {
      try {
        if (panel.style.getPropertyValue('visibility') === 'hidden') return;

        // === READ PHASE: all layout reads together ===
        var rect = panel.getBoundingClientRect();
        var pw = panel.offsetWidth || CFG.PANEL_WIDTH;
        var ph = panel.offsetHeight || CFG.PANEL_HEIGHT;
        var vw = window.innerWidth;
        var vh = window.innerHeight;
        var prevW = Number.isFinite(lastViewportW) && lastViewportW > 0 ? lastViewportW : vw;
        var prevH = Number.isFinite(lastViewportH) && lastViewportH > 0 ? lastViewportH : vh;

        var refX = rect.left + pw / 2;
        var refY = rect.top + ph / 2;
        var collapseBtnRect = null;
        try {
          var collapseBtn = panel.querySelector('[data-role="collapse"]');
          if (collapseBtn) {
            var btnRect = collapseBtn.getBoundingClientRect();
            if (btnRect.width > 0 && btnRect.height > 0) {
              collapseBtnRect = btnRect;
              refX = btnRect.left + btnRect.width / 2;
              refY = btnRect.top + btnRect.height / 2;
            }
          }
        } catch (_) {}

        // === COMPUTE PHASE: pure calculation, no DOM ===
        if (anchorX !== 'left' && anchorX !== 'right') {
          anchorX = refX > (prevW / 2) ? 'right' : 'left';
        }
        var nextLeftEdge = (anchorX === 'right') ? (vw - pw - CFG.DRAG_MARGIN_PX) : CFG.DRAG_MARGIN_PX;
        var ratioH = prevH ? (vh / prevH) : 1;
        var nextRefY = refY * ratioH;
        var nextLeft = nextLeftEdge;
        var nextTop = rect.top + (nextRefY - refY);
        var maxLeft = vw - pw - CFG.DRAG_MARGIN_PX;
        var maxTop = vh - ph - CFG.DRAG_MARGIN_PX;
        var left = Math.max(CFG.DRAG_MARGIN_PX, Math.min(maxLeft, nextLeft));
        var top = Math.max(CFG.DRAG_MARGIN_PX, Math.min(maxTop, nextTop));

        var persistBtnX = null;
        var persistBtnY = null;
        if (collapseBtnRect) {
          persistBtnX = collapseBtnRect.left + collapseBtnRect.width / 2;
          persistBtnY = collapseBtnRect.top + collapseBtnRect.height / 2;
        }

        // === WRITE PHASE: all style writes together ===
        panel.style.setProperty('left', left + 'px', 'important');
        panel.style.setProperty('top', top + 'px', 'important');
        panel.style.setProperty('right', 'auto', 'important');
        panel.style.setProperty('bottom', 'auto', 'important');

        lastViewportW = vw;
        lastViewportH = vh;

        if (persistBtnX !== null && Number.isFinite(persistBtnX) && Number.isFinite(persistBtnY)) {
          pendingPersistCenter = { x: persistBtnX, y: persistBtnY, anchorX: anchorX };
        }
      } catch (_) {}
    };

    var onResize = function() {
      if (cleanedUp) return;
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(function() {
        resizeRaf = null;
        if (cleanedUp) return;
        if (!panel || !panel.isConnected) return;
        constrainCurrentPosition();
        if (pendingPersistCenter && setBadgePosByHost) {
          if (timers.persist) clearTimeout(timers.persist);
          // Increased from 160ms to 500ms to reduce storage I/O frequency
          timers.persist = setTimeout(function() {
            timers.persist = null;
            var p = pendingPersistCenter;
            pendingPersistCenter = null;
            try {
              if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) {
                setBadgePosByHost(location.host, p);
              }
            } catch (_) {}
          }, 500);
        }
      });
    };

    var RESIZE_LISTENER_OPTS = { passive: true };
    var SCROLL_LISTENER_OPTS = { passive: true };
    var removeResizeListener = addWindowListener('resize', onResize, RESIZE_LISTENER_OPTS);

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

    panel.className = 'toc-floating toc-floating-' + (side === 'left' ? 'left' : 'right') + (skipAnimation ? '' : ' toc-floating-expand');
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
    btnCollapse.className = 'toc-btn';
    btnCollapse.textContent = msg('buttonCollapse');
    btnCollapse.title = msg('buttonCollapseTitle');
    btnCollapse.setAttribute('aria-label', msg('buttonCollapseTitle') || msg('buttonCollapse'));
    btnCollapse.setAttribute('data-role', 'collapse');
    onBtnCollapseClick = function() { try { onCollapse && onCollapse(); } catch (_) {} };
    btnCollapse.addEventListener('click', onBtnCollapseClick);

    headerRow.appendChild(titleSpan);
    headerRow.appendChild(btnCollapse);

    var actions = document.createElement('div');
    actions.className = 'toc-actions';

    var actionsLeft = document.createElement('div');
    actionsLeft.className = 'toc-actions-left';

    var btnPick = document.createElement('button');
    btnPick.className = 'toc-btn';
    btnPick.textContent = msg('buttonPickElement');
    btnPick.title = msg('buttonPickElementTitle');
    btnPick.setAttribute('aria-label', msg('buttonPickElementTitle') || msg('buttonPickElement'));
    btnPick.setAttribute('aria-pressed', 'false');
    onBtnPickClick = function() { try { onPick && onPick(); } catch (_) {} };
    btnPick.addEventListener('click', onBtnPickClick);

    var btnManage = document.createElement('button');
    btnManage.className = 'toc-btn';
    btnManage.textContent = msg('buttonSiteConfig');
    btnManage.title = msg('buttonSiteConfigTitle');
    btnManage.setAttribute('aria-label', msg('buttonSiteConfigTitle') || msg('buttonSiteConfig'));
    onBtnManageClick = function() { try { onSiteConfig && onSiteConfig(); } catch (_) {} };
    btnManage.addEventListener('click', onBtnManageClick);

    var actionsRight = document.createElement('div');
    actionsRight.className = 'toc-actions-right';

    var btnRefresh = document.createElement('button');
    btnRefresh.className = 'toc-btn';
    btnRefresh.textContent = msg('buttonRefresh');
    btnRefresh.title = msg('buttonRefreshTitle');
    btnRefresh.setAttribute('aria-label', msg('buttonRefreshTitle') || msg('buttonRefresh'));
    var refreshing = false;
    onBtnRefreshClick = function() {
      if (refreshing) return;
      refreshing = true;
      try {
        if (onRefresh) {
          onRefresh();
        }
      } catch (e) {
        console.warn('[toc] refresh failed:', e);
      } finally {
        refreshing = false;
      }
    };
    btnRefresh.addEventListener('click', onBtnRefreshClick);

    actionsLeft.appendChild(btnPick);
    actionsLeft.appendChild(btnManage);
    actionsRight.appendChild(btnRefresh);

    actions.appendChild(actionsLeft);
    actions.appendChild(actionsRight);

    header.appendChild(headerRow);
    header.appendChild(actions);

    var list = document.createElement('div');
    list.className = 'toc-list';
    list.setAttribute('role', 'menu');
    list.setAttribute('aria-orientation', 'vertical');
    list.setAttribute('aria-label', msg('tocTitle'));

    // --- Incremental update helpers ---
    var currentTocMeta = tocMeta || null;

    var renderListItems = function() {
      while (list.firstChild) {
        try { list.removeChild(list.firstChild); } catch (_) { break; }
      }

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

        if (userSelectedItem) {
          clearAllActive();
          if (userSelectedItem._node && !userSelectedItem._node.classList.contains('active')) {
            userSelectedItem._node.classList.add('active');
            try { userSelectedItem._node.setAttribute('aria-current', 'location'); } catch (_) {}
            active = userSelectedItem;
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
    document.documentElement.appendChild(panel);

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

    // Make header draggable
    var dragController = createDragController ? createDragController({
      element: panel,
      shouldStart: function(e) {
        if (!e || !e.target || !e.target.closest) return false;
        if (e.target.closest('.toc-btn, button')) return false;
        return !!e.target.closest('.toc-header');
      },
      getRect: function() { return panel.getBoundingClientRect(); },
      onStart: function() {
        panel.style.cursor = 'grabbing';
        panel.style.userSelect = 'none';
      },
      onMove: function(drag, e) {
        var left = e.clientX - drag.offsetX;
        var top = e.clientY - drag.offsetY;

        var pw = panel.offsetWidth || CFG.PANEL_WIDTH;
        var ph = panel.offsetHeight || CFG.PANEL_HEIGHT;
        var maxLeft = window.innerWidth - pw - CFG.DRAG_MARGIN_PX;
        var maxTop = window.innerHeight - ph - CFG.DRAG_MARGIN_PX;

        left = Math.max(CFG.DRAG_MARGIN_PX, Math.min(maxLeft, left));
        top = Math.max(CFG.DRAG_MARGIN_PX, Math.min(maxTop, top));

        panel.style.setProperty('left', left + 'px', 'important');
        panel.style.setProperty('top', top + 'px', 'important');
        panel.style.setProperty('right', 'auto', 'important');
        panel.style.setProperty('bottom', 'auto', 'important');
      },
      onEnd: function(drag) {
        panel.style.cursor = '';
        panel.style.userSelect = '';

        if (!drag.moved) return;
        // Save collapse button center position
        try {
          var collapseBtn = panel.querySelector('[data-role="collapse"]');
          if (collapseBtn && setBadgePosByHost) {
            var btnRect = collapseBtn.getBoundingClientRect();
            var x = btnRect.left + btnRect.width / 2;
            var y = btnRect.top + btnRect.height / 2;
            if (Number.isFinite(x) && Number.isFinite(y)) {
              anchorX = x > (window.innerWidth / 2) ? 'right' : 'left';
              setBadgePosByHost(location.host, { x: x, y: y, anchorX: anchorX });
            }
          }
        } catch (_) {}
      }
    }) : null;

    var origRemove = panel.remove.bind(panel);
    var onPickerStart = function() {
      btnPick.classList.add('toc-btn-active');
      btnPick.setAttribute('aria-pressed', 'true');
    };
    var onPickerEnd = function() {
      btnPick.classList.remove('toc-btn-active');
      btnPick.setAttribute('aria-pressed', 'false');
      if (document.activeElement === btnPick) {
        btnPick.blur();
      }
    };

    var removePickerStartListener = addWindowListener(pickerStartEvent, onPickerStart);
    var removePickerEndListener = addWindowListener(pickerEndEvent, onPickerEnd);

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
      try { if (onBtnPickClick) btnPick.removeEventListener('click', onBtnPickClick); } catch (_) {}
      try { if (onBtnManageClick) btnManage.removeEventListener('click', onBtnManageClick); } catch (_) {}
      try { if (onBtnRefreshClick) btnRefresh.removeEventListener('click', onBtnRefreshClick); } catch (_) {}
      onBtnCollapseClick = null;
      onBtnPickClick = null;
      onBtnManageClick = null;
      onBtnRefreshClick = null;
      try { if (onPanelKeydown) panel.removeEventListener('keydown', onPanelKeydown, true); } catch (_) {}
      onPanelKeydown = null;
      try { resolveShown && resolveShown(); } catch (_) {}
      try { removeResizeListener && removeResizeListener(); } catch (_) {}
      try { removeScrollListener && removeScrollListener(); } catch (_) {}
      try { removePickerStartListener && removePickerStartListener(); } catch (_) {}
      try { removePickerEndListener && removePickerEndListener(); } catch (_) {}
      try { listenersController && listenersController.abort && listenersController.abort(); } catch (_) {}
      cleanupLock();
      clearAllTimers();
      try {
        if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
      } catch (_) {}
      resizeRaf = null;
      try {
        if (showRaf != null) cancelAnimationFrame(showRaf);
      } catch (_) {}
      showRaf = null;
      dragController && dragController.destroy && dragController.destroy();
      dragController = null;

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
          removalObserver.observe(document.documentElement, { childList: true });
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
      measureCollapseButton() {
        var btn = panel.querySelector('[data-role="collapse"]');
        if (!btn) return null;
        var rect = btn.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return null;
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      },
      updateItems
    };
  }

  var api = { renderFloatingPanel: renderFloatingPanel };
  return api;
});
