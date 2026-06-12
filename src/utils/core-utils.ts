
import { SELECTOR_EXPR_MAX_LENGTH } from './constants.js';
import { isPlainObject, isHighRiskBroadCssSelector, normalizeSide } from '../shared/primitives.js';

export { isPlainObject, isHighRiskBroadCssSelector, normalizeSide };

  /**
   * Check if the extension context is invalidated (e.g., after extension reload).
   * @returns {boolean}
   */
export function isExtensionContextInvalidated(): boolean {
    try {
      if (typeof chrome === 'undefined') return false;
      return !chrome.runtime || !chrome.runtime.id;
    } catch (_) {
      return true;
    }
  }

  /**
   * Get i18n message safely.
   * @param {string} key
   * @param {string|string[]} [substitutions]
   * @returns {string}
   */
export function msg(key: string, substitutions?: string | string[]): string {
    try {
      return chrome.i18n.getMessage(key, substitutions) || key;
    } catch (_) {
      return key;
    }
  }

export function isContextInvalidatedError(e: unknown): boolean {
    try {
      var text = String(e && ((e as { message?: string }).message || ((e as { toString?: () => string }).toString && (e as { toString: () => string }).toString()) || e) || '');
      var lowered = text.toLowerCase();
      return lowered.indexOf('extension context invalidated') !== -1 || lowered.indexOf('context invalidated') !== -1;
    } catch (_) {
      return false;
    }
  }

export function getFocusableWithin(rootEl: Element | null): Element[] {
    if (!rootEl) return [];
    var selector = [
      'button:not([disabled])',
      'textarea:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'a[href]',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');
    try {
      return Array.from(rootEl.querySelectorAll(selector)).filter(function(el) {
        if (!el || !(el as HTMLElement).focus) return false;
        var style = window.getComputedStyle(el as Element);
        return style && style.visibility !== 'hidden' && style.display !== 'none';
      });
    } catch (_) {
      return [];
    }
  }

export function isSafeXPathExpression(expr: string): boolean {
    if (typeof expr !== 'string') return false;
    var trimmed = expr.trim();
    if (!trimmed || trimmed.length > SELECTOR_EXPR_MAX_LENGTH) return false;
    // Block extremely broad document scans
    var normalized = trimmed.replace(/\s+/g, '').toLowerCase();
    if (normalized.indexOf('//*') === 0 || normalized.indexOf('.//*') === 0) return false;
    // Reject external document/function patterns
    if (/(?:^|[^A-Za-z0-9_-])(?:document|collection|unparsed-text)\s*\(/i.test(trimmed)) return false;
    return true;
  }

function isValidCssSelector(expr: string): boolean {
    if (typeof expr !== 'string') return false;
    var trimmed = expr.trim();
    if (!trimmed || trimmed.length > SELECTOR_EXPR_MAX_LENGTH) return false;
    if (isHighRiskBroadCssSelector(expr)) return false;
    try {
      document.createDocumentFragment().querySelector(trimmed);
      return true;
    } catch (_) {
      return false;
    }
  }

export function validateSelectorExpression(type: string, expr: string): boolean {
    try {
      if (type === 'xpath') return isSafeXPathExpression(expr);
      if (type === 'css') return isValidCssSelector(expr);
      return false;
    } catch (_) {
      return false;
    }
  }

export function buildSitePattern(): string {
    return location.protocol + '//' + location.host + '/*';
  }

export function isTocContentIdentical(prevItems: Array<{ text: string; el: Element; level?: number }>, nextItems: Array<{ text: string; el: Element; level?: number }>): boolean {
    if (!prevItems || !nextItems || prevItems.length !== nextItems.length) return false;
    for (var i = 0; i < prevItems.length; i++) {
      if (prevItems[i].text !== nextItems[i].text
        || prevItems[i].el !== nextItems[i].el
        || prevItems[i].level !== nextItems[i].level) return false;
    }
    return true;
  }

  function mirrorRectsOverlap(a: { left: number; top: number }, b: { left: number; top: number }): boolean {
    return Math.abs(a.left - b.left) < 24 && Math.abs(a.top - b.top) < 24;
  }

  /**
   * Deduplicate mirror-copy TOC items: identical-text items that sit at the same
   * visual position (e.g. a sticky duplicate). Repeated section titles at
   * different positions are intentionally preserved. Items without a `_pos`
   * marker are never collapsed. Strips `_pos` from the returned items.
   */
export function dedupeMirrorItems<T extends { text: string; _pos?: { left: number; top: number } }>(items: T[]): T[] {
    if (!items || items.length <= 1) {
      if (items) { for (var i0 = 0; i0 < items.length; i0++) delete (items[i0] as any)._pos; }
      return items || [];
    }
    var byText: Map<string, T[]> = new Map();
    var deduped: T[] = [];
    for (var d = 0; d < items.length; d++) {
      var cur = items[d];
      if (!cur) continue;
      var same = byText.get(cur.text);
      if (same) {
        var isMirror = false;
        for (var sm = 0; sm < same.length; sm++) {
          var aPos = same[sm]._pos;
          var bPos = cur._pos;
          if (aPos && bPos && mirrorRectsOverlap(aPos, bPos)) { isMirror = true; break; }
        }
        if (isMirror) continue;
        same.push(cur);
      } else {
        byText.set(cur.text, [cur]);
      }
      deduped.push(cur);
    }
    for (var sp = 0; sp < deduped.length; sp++) delete (deduped[sp] as any)._pos;
    return deduped;
  }
