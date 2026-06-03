import { uiConst } from './constants.js';

  /**
   * Check if the extension context is invalidated (e.g., after extension reload).
   * @returns {boolean}
   */
export function isExtensionContextInvalidated() {
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
export function msg(key, substitutions) {
    try {
      return chrome.i18n.getMessage(key, substitutions) || key;
    } catch (_) {
      return key;
    }
  }

export function isPlainObject(value) {
    if (!value || typeof value !== 'object') return false;
    var proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

export function isContextInvalidatedError(e) {
    try {
      if (!e) return false;
      var text = String(e && (e.message || (e.toString && e.toString()) || e) || '');
      var lowered = text.toLowerCase();
      return lowered.indexOf('extension context invalidated') !== -1 || lowered.indexOf('context invalidated') !== -1;
    } catch (_) {
      return false;
    }
  }

export function getFocusableWithin(rootEl) {
    var root = rootEl && rootEl.querySelectorAll ? rootEl : null;
    if (!root) return [];
    var selector = [
      'button:not([disabled])',
      'textarea:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'a[href]',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');
    try {
      return Array.from(root.querySelectorAll(selector)).filter(function(el) {
        if (!el || !el.focus) return false;
        var style = window.getComputedStyle(el);
        return style && style.visibility !== 'hidden' && style.display !== 'none';
      });
    } catch (_) {
      return [];
    }
  }

export function safeJsonParse(raw) {
    if (typeof raw !== 'string') return null;
    if (raw.length > 20000) {
      try { console.warn('[toc] safeJsonParse: input too large, skip parse:', raw.length); } catch (_) {}
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

export function getFiniteNumber(value) {
    var num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) ? num : null;
  }

export function isSafeXPathExpression(expr) {
    if (typeof expr !== 'string') return false;
    var trimmed = expr.trim();
    if (!trimmed) return false;
    if (trimmed.length > 2000) return false;

    // Avoid extremely broad document scans that are likely to be slow.
    if (isHighRiskBroadXPathExpression(trimmed)) return false;

    // Disallow control characters.
    if (/[\x00-\x1F\x7F]/.test(trimmed)) return false;

    // Reject external document/function patterns.
    if (/(?:^|[^A-Za-z0-9_-])(?:document|doc|doc-available|collection|unparsed-text|unparsed-text-available)\s*\(/i.test(trimmed)) return false;

    return true;
  }

export function isHighRiskBroadXPathExpression(expr) {
    if (typeof expr !== 'string') return false;
    var normalized = expr.trim().replace(/\s+/g, '').toLowerCase();
    if (!normalized) return false;

    if (normalized.indexOf('//*') === 0) return true;
    if (normalized.indexOf('.//*') === 0) return true;
    if (normalized.indexOf('//html//*') === 0) return true;
    if (normalized.indexOf('//body//*') === 0) return true;
    if (normalized.indexOf('//html/descendant::*') === 0) return true;
    if (normalized.indexOf('//body/descendant::*') === 0) return true;
    if (normalized.indexOf('descendant::*') === 0) return true;

    return false;
  }

export function isValidCssSelector(expr) {
    if (typeof expr !== 'string') return false;
    if (typeof document === 'undefined' || !document) return false;
    var trimmed = expr.trim();
    if (!trimmed) return false;
    // Disallow control chars
    if (/[\x00-\x1F\x7F]/.test(trimmed)) return false;
    if (trimmed.length > 2000) return false;
    if (isHighRiskBroadCssSelector(trimmed)) return false;
    try {
      // Syntax validation without querying the page DOM.
      var frag = document.createDocumentFragment ? document.createDocumentFragment() : null;
      if (frag && frag.querySelector) {
        frag.querySelector(trimmed);
        return true;
      }
      // Fallback: use @supports selector() if available.
      if (typeof CSS !== 'undefined' && CSS && typeof CSS.supports === 'function') {
        if (CSS.supports('selector(' + trimmed + ')')) return true;
      }
      // No validation method available — trust the selector syntax.
      return true;
    } catch (_) {
      return false;
    }
  }

export function isHighRiskBroadCssSelector(expr) {
    if (typeof expr !== 'string') return false;
    // Check each comma-separated part for overly broad patterns.
    // Broad patterns like *, html *, body *, :root * don't contain commas inside quotes/brackets,
    // so a simple split is sufficient for this safety check.
    var parts = expr.split(',');
    for (var i = 0; i < parts.length; i++) {
      var normalized = String(parts[i] || '').trim().replace(/\s+/g, ' ').toLowerCase();
      if (normalized === '*' || normalized === 'html *' || normalized === 'body *' || normalized === ':root *') return true;
    }
    return false;
  }

export function validateSelectorExpression(type, expr) {
    try {
      if (type === 'xpath') return isSafeXPathExpression(expr);
      if (type === 'css') return isValidCssSelector(expr);
      console.warn('[toc] validateSelectorExpression: unsupported selector type:', type);
      return false;
    } catch (_) {
      return false;
    }
  }

export function originFromUrl(url) {
    try {
      return new URL(url).origin;
    } catch (e) {
      try {
        return location.origin;
      } catch (_) {
        return '';
      }
    }
  }
