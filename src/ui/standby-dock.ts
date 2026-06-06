
'use strict';

import { msg, getBadgePosByHost, setBadgePosByHost, cleanupOwnedElements } from '../utils/toc-utils.js';
import { createDragController } from '../utils/drag-helper.js';

var SVG_NS = 'http://www.w3.org/2000/svg';

var CFG = {
  SAFE_MARGIN_PX: 12,
  DEFAULT_TOP_MIN: 120,
  DEFAULT_HEIGHT: 48
};

interface BadgePos {
  x: number;
  y: number;
  anchorX?: string;
}

function resolveDockSide(pos: BadgePos | null, viewportWidth: number, fallbackSide: string): string {
  if (pos && (pos.anchorX === 'left' || pos.anchorX === 'right')) return pos.anchorX;
  if (pos && Number.isFinite(pos.x)) return pos.x <= viewportWidth / 2 ? 'left' : 'right';
  return fallbackSide === 'left' ? 'left' : 'right';
}

function clampTop(top: number, viewportHeight: number, height: number, safeMargin: number): number {
  var max = Math.max(safeMargin, viewportHeight - height - safeMargin);
  return Math.max(safeMargin, Math.min(max, top));
}

function createTocIcon(): SVGSVGElement {
  // Simplified TOC list icon — three rows with bullet + line
  var svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  // Use stroke-based lines for a cleaner look matching the extension icon style
  var svgContent = '<rect x="4" y="5" width="3" height="3" rx="0.5"/>'
    + '<rect x="4" y="10.5" width="3" height="3" rx="0.5"/>'
    + '<rect x="4" y="16" width="3" height="3" rx="0.5"/>'
    + '<line x1="10" y1="6.5" x2="20" y2="6.5" stroke-linecap="round"/>'
    + '<line x1="10" y1="12" x2="18" y2="12" stroke-linecap="round"/>'
    + '<line x1="10" y1="17.5" x2="20" y2="17.5" stroke-linecap="round"/>';

  svg.innerHTML = svgContent;
  return svg as SVGSVGElement;
}

interface StandbyDockOptions {
  side?: string;
  onActivate?: () => void;
}

export function renderStandbyDock(options: StandbyDockOptions) {
  options = options || {};
  var side: string = options.side === 'left' ? 'left' : 'right';
  var destroyed = false;
  var suppressClick = false;
  var persistTimer: ReturnType<typeof setTimeout> | null = null;
  var resizeRaf: number | null = null;

  if (cleanupOwnedElements) {
    cleanupOwnedElements('.toc-standby-dock[data-toc-owner="web-toc-assistant"]');
  }

  var root = document.createElement('aside');
  var ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  root.className = 'toc-standby-dock toc-standby-dock-' + side;
  root.setAttribute('data-toc-owner', 'web-toc-assistant');
  root.setAttribute('role', 'button');
  root.setAttribute('tabindex', '0');
  var tooltip = msg('standbyTooltip') || 'Click to activate TOC';
  root.setAttribute('aria-label', tooltip);
  root.title = tooltip;
  root.style.setProperty('visibility', 'hidden', 'important');

  var button = document.createElement('div');
  button.className = 'toc-standby-dock-button';
  button.appendChild(createTocIcon());
  root.appendChild(button);
  document.documentElement.appendChild(root);

  function dockHeight(): number {
    return root.offsetHeight || CFG.DEFAULT_HEIGHT;
  }

  function clampAndSet(top: number): void {
    var clamped = clampTop(top, window.innerHeight, dockHeight(), CFG.SAFE_MARGIN_PX);
    root.style.setProperty('top', clamped + 'px', 'important');
  }

  function centerY(): number {
    var rect = root.getBoundingClientRect();
    return rect.top + rect.height / 2;
  }

  function persistPosition(): void {
    if (!setBadgePosByHost) return;
    var y = centerY();
    var x = side === 'left' ? 0 : window.innerWidth;
    try { setBadgePosByHost(location.host, { x: x, y: y, anchorX: side }); } catch (_) {}
  }

  async function restorePosition(): Promise<void> {
    var fallbackTop = Math.max(CFG.DEFAULT_TOP_MIN, window.innerHeight / 4);
    clampAndSet(fallbackTop);
    if (!getBadgePosByHost) {
      root.style.removeProperty('visibility');
      return;
    }
    try {
      var pos = await getBadgePosByHost(location.host);
      if (destroyed || !root.isConnected) return;
      updateSide(resolveDockSide(pos, window.innerWidth, side), false);
      if (pos && Number.isFinite(pos.y)) clampAndSet(pos.y - dockHeight() / 2);
      root.style.removeProperty('visibility');
    } catch (_) {
      if (!destroyed && root.isConnected) root.style.removeProperty('visibility');
    }
  }

  function updateSide(nextSide: string, persist: boolean): void {
    side = nextSide === 'left' ? 'left' : 'right';
    root.classList.toggle('toc-standby-dock-left', side === 'left');
    root.classList.toggle('toc-standby-dock-right', side === 'right');
    if (persist) persistPosition();
  }

  updateSide(side, false);
  restorePosition();

  // Drag support — reuse the same drag controller pattern as edge-dock
  var dragController = createDragController ? createDragController({
    element: root,
    getRect: function() { return root.getBoundingClientRect(); },
    onStart: function() {
      root.classList.add('toc-standby-dock-dragging');
    },
    onMove: function(drag: any, e: PointerEvent): void {
      clampAndSet(e.clientY - drag.offsetY);
    },
    onEnd: function(drag: any): void {
      root.classList.remove('toc-standby-dock-dragging');
      if (!drag.moved || drag.cancelled) return;
      suppressClick = true;
      setTimeout(function() { suppressClick = false; }, 0);
      persistPosition();
    }
  }) : null;

  function onClick(): void {
    if (suppressClick || destroyed) return;
    try { options.onActivate && options.onActivate(); } catch (_) {}
  }

  function onKeydown(e: KeyboardEvent): void {
    if (destroyed) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  }

  function onResize(): void {
    if (resizeRaf != null) return;
    resizeRaf = requestAnimationFrame(function() {
      resizeRaf = null;
      if (destroyed || !root.isConnected) return;
      clampAndSet(parseFloat(root.style.top) || CFG.DEFAULT_TOP_MIN);
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(function() {
        persistTimer = null;
        persistPosition();
      }, 160);
    });
  }

  root.addEventListener('click', onClick, ac ? { signal: ac.signal } : undefined);
  root.addEventListener('keydown', onKeydown, ac ? { signal: ac.signal } : undefined);
  window.addEventListener('resize', onResize, ac ? { passive: true, signal: ac.signal } : { passive: true });

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    try { dragController && dragController.destroy && dragController.destroy(); } catch (_) {}
    if (persistTimer) clearTimeout(persistTimer);
    if (resizeRaf != null) cancelAnimationFrame(resizeRaf);
    try { ac && ac.abort && ac.abort(); } catch (_) {}
    try { root.remove(); } catch (_) {}
  }

  root.__TOC_CLEANUP__ = destroy;

  return {
    destroy: destroy,
    getSide: function() { return side; }
  };
}
