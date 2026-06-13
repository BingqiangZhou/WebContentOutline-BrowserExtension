
'use strict';

import { getFocusableWithin } from '../utils/toc-utils.js';
import { createFocusTrap } from '../utils/focus-trap.js';
import { getTocShadowHost, getDeepActiveElement } from './shadow-root.js';

/**
 * Build the shared `.toc-overlay` dialog skeleton used by the element-picker
 * result view and the site-config editor: capture previous focus, remove any
 * existing overlay, create the wrap/header/body/actions containers with the
 * a11y attributes (role=dialog, aria-modal, aria-labelledby), and wire up the
 * focus-trap + restore-focus teardown.
 *
 * The caller fills `body` and `actions`, attaches its own click handler to
 * `wrap`, then calls `mount(focusTarget)` to append into the shadow root and
 * focus the target on the next animation frame.
 */
export function createOverlayDialog(opts: { owner: string; title: string }): {
  wrap: HTMLDivElement;
  body: HTMLDivElement;
  actions: HTMLDivElement;
  close: () => void;
  mount: (focusTarget: HTMLElement) => void;
} {
  var prevFocus = getDeepActiveElement();
  var existing = (getTocShadowHost()?.shadowRoot ?? document).querySelector('.toc-overlay[data-toc-owner="' + opts.owner + '"]');
  if (existing) existing.remove();

  var wrap = document.createElement('div');
  wrap.className = 'toc-overlay';
  wrap.setAttribute('data-toc-owner', opts.owner);
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.tabIndex = -1;

  var header = document.createElement('div');
  header.className = 'toc-overlay-header';
  header.textContent = opts.title;
  header.id = 'toc-overlay-title-' + Math.random().toString(36).slice(2);
  wrap.setAttribute('aria-labelledby', header.id);
  wrap.appendChild(header);

  var body = document.createElement('div');
  body.className = 'toc-overlay-body';
  wrap.appendChild(body);

  var actions = document.createElement('div');
  actions.className = 'toc-overlay-actions';

  var restoreFocus = function() {
    if (prevFocus && (prevFocus as HTMLElement).focus && document.contains(prevFocus)) {
      (prevFocus as HTMLElement).focus({ preventScroll: true });
    }
  };
  var focusRaf: number | null = null;
  var close = function() {
    removeFocusTrap();
    removeFocusTrap = function() {};
    if (focusRaf) {
      cancelAnimationFrame(focusRaf);
      focusRaf = null;
    }
    wrap.remove();
    restoreFocus();
  };
  var removeFocusTrap: (() => void) = createFocusTrap(wrap, { onClose: close, getFocusableWithin: getFocusableWithin });

  var mount = function(focusTarget: HTMLElement) {
    wrap.appendChild(actions);
    (getTocShadowHost()?.shadowRoot ?? document.documentElement).appendChild(wrap);
    focusRaf = requestAnimationFrame(function() {
      focusRaf = null;
      if (!wrap || !wrap.isConnected) return;
      focusTarget.focus({ preventScroll: true });
    });
  };

  return { wrap: wrap, body: body, actions: actions, close: close, mount: mount };
}
