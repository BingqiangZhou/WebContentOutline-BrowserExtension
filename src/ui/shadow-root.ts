
'use strict';

// src/ui/shadow-root.ts — single shared Shadow DOM root for all injected UI.
//
// All of the extension's UI (edge dock, floating panel, toast, dialogs) mounts
// inside ONE shadow root so host-page CSS cannot reach it (true isolation,
// replacing the old `data-toc-owner` + `all: unset !important` light-DOM
// defense). The shadow HOST element itself stays in the host document and
// carries `data-toc-owner` so that:
//   - the element picker classifies it as own-UI (closest('[data-toc-owner="..."]')),
//   - computeOverlayOffset can skip it in the elementsFromPoint stack.
//
// The root is CLOSED: page scripts cannot reach it through `host.shadowRoot`, so
// they can neither read the extension's UI nor click its buttons. Extension code
// cannot either — every reader goes through getTocShadowRootSync().
//
// Imported DIRECTLY (not via the toc-utils barrel) so the vm-eval test surface
// does not grow.

import { EXTENSION_OWNER, MAX_Z_INDEX } from '../utils/constants.js';

var TOC_CSS_PATH = 'content-scripts/toc.css';

var _shadowHost: HTMLElement | null = null;
var _shadowRoot: ShadowRoot | null = null;
var _initPromise: Promise<ShadowRoot | null> | null = null;

/**
 * The shared shadow root (null until getTocShadowRoot() resolves). The only way
 * to reach the extension's UI tree: the root is closed, so `host.shadowRoot`
 * returns null even for the code that attached it.
 */
export function getTocShadowRootSync(): ShadowRoot | null {
  return _shadowRoot;
}

/**
 * The truly-focused element, descending into shadow roots. `document.
 * activeElement` returns the shadow HOST when focus is inside a shadow tree;
 * this walks down to the real focused element so focus can be restored to it.
 */
export function getDeepActiveElement(): Element | null {
  var el: Element | null = null;
  try {
    el = document.activeElement;
    for (var guard = 0; el && guard < 10; guard++) {
      // Our own root is closed (`host.shadowRoot` is null), so it is reachable
      // only through the module reference; the page's open roots expose theirs.
      var root: any = (el === _shadowHost && _shadowRoot) ? _shadowRoot : (el as any).shadowRoot;
      if (!root || !root.activeElement) break;
      el = root.activeElement;
    }
  } catch (_) {}
  return el;
}

/**
 * Tear down the shared shadow host entirely (full disable / reinjection).
 * Removes the host (and thus its whole shadow tree) and resets module state so
 * the next getTocShadowRoot() recreates it. Inner elements' __TOC_CLEANUP__
 * hooks should be run first via cleanupOwnedElements() for listener/timer
 * teardown — this is the host-level disposal.
 */
export function disposeTocShadowRoot() {
  if (_shadowHost && _shadowHost.isConnected) {
    try { _shadowHost.remove(); } catch (_) {}
  }
  _shadowHost = null;
  _shadowRoot = null;
  _initPromise = null;
}

/**
 * Lazily create and memoize the single shared shadow root. Loads the CSS once
 * (fetched from the WAR-exposed toc.css) into the shadow BEFORE the host is
 * attached to the document, so there is no unstyled flash. Returns null on
 * failure (callers fall back gracefully).
 */
export function getTocShadowRoot(): Promise<ShadowRoot | null> {
  if (_shadowRoot) return Promise.resolve(_shadowRoot);
  if (_initPromise) return _initPromise;
  _initPromise = (async function (): Promise<ShadowRoot | null> {
    try {
      var host = document.createElement('div');
      host.className = 'toc-shadow-host';
      host.setAttribute('data-toc-owner', EXTENSION_OWNER);
      // Keep the host itself inert and out of the host page's layout flow: it
      // holds no light-DOM children (all UI is in the shadow), and the shadow
      // content is position:fixed so it is positioned relative to the viewport
      // regardless of this host's box.
      host.style.position = 'fixed';
      host.style.top = '0';
      host.style.left = '0';
      host.style.width = '0';
      host.style.height = '0';
      // Top-level z-index on the HOST itself (not just the shadow-internal UI).
      // The dock/panel set z-index: var(--toc-z-index), but that only orders them
      // WITHIN this host's stacking context. The host is position:fixed with no
      // z-index otherwise, so it stacks at z-index:auto in the page root — meaning
      // a high-z-index page overlay (translate/reader extensions at ~2.1e9, modal
      // libraries) paints OVER the whole extension UI and swallows pointer events,
      // making the dock appear frozen (hover does nothing). Inline !important beats
      // page CSS that might target .toc-shadow-host.
      host.style.setProperty('z-index', String(MAX_Z_INDEX), 'important');

      // Closed (see the file header): the page must not be able to reach the UI.
      var root = host.attachShadow({ mode: 'closed' });
      await injectStylesheet(root);
      document.documentElement.appendChild(host);
      _shadowHost = host;
      _shadowRoot = root;
      return root;
    } catch (e) {
      console.warn('[toc] shadow root init failed:', e);
      _initPromise = null;
      return null;
    }
  })();
  return _initPromise;
}

async function injectStylesheet(root: ShadowRoot): Promise<void> {
  var cssText = '';
  try {
    cssText = await fetchCss();
  } catch (e) {
    console.warn('[toc] shadow CSS fetch failed:', e);
  }
  if (!cssText) return;
  // Preferred: constructable stylesheet (Chrome 101+; minimum_chrome_version is 102).
  try {
    var sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
    (root as any).adoptedStyleSheets = [sheet];
    return;
  } catch (e) {
    // Fall through to <style> fallback.
  }
  try {
    var style = document.createElement('style');
    style.textContent = cssText;
    root.appendChild(style);
  } catch (e) {}
}

async function fetchCss(): Promise<string> {
  var url = TOC_CSS_PATH;
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      url = chrome.runtime.getURL(TOC_CSS_PATH);
    }
  } catch (_) {}
  var res = await fetch(url);
  return await res.text();
}
