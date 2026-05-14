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
    if (trimmed.length > uiConst('XPATH_MAX_LENGTH', 2000)) return false;

    // Avoid extremely broad document scans that are likely to be slow.
    if (trimmed.indexOf('//*') === 0 || /^\/\/(node|text|comment)\s*\(/i.test(trimmed)) return false;

    // Disallow control characters.
    for (var i = 0; i < trimmed.length; i++) {
      var code = trimmed.charCodeAt(i);
      if ((code >= 0x0000 && code <= 0x001F) || code === 0x007F) return false;
    }

    // Basic structural checks: balanced quotes/brackets/parentheses, and avoid extreme nesting.
    var inSingle = false;
    var inDouble = false;
    var parenDepth = 0;
    var bracketDepth = 0;
    var MAX_NESTING = 64;
    for (var i = 0; i < trimmed.length; i++) {
      var ch = trimmed[i];
      if (!inDouble && ch === "'") {
        inSingle = !inSingle;
        continue;
      }
      if (!inSingle && ch === '"') {
        inDouble = !inDouble;
        continue;
      }
      if (inSingle || inDouble) continue;
      if (ch === '(') parenDepth++;
      if (ch === ')') parenDepth--;
      if (ch === '[') bracketDepth++;
      if (ch === ']') bracketDepth--;
      if (parenDepth < 0 || bracketDepth < 0) return false;
      if (parenDepth > MAX_NESTING || bracketDepth > MAX_NESTING) return false;
    }
    if (inSingle || inDouble) return false;
    if (parenDepth !== 0 || bracketDepth !== 0) return false;

    // Reject namespace prefixes (e.g. ns:div) because we evaluate without a namespace resolver.
    // Allow axis specifiers like following-sibling::.
    var nsInSingle = false;
    var nsInDouble = false;
    for (var i = 0; i < trimmed.length; i++) {
      var ch = trimmed[i];
      if (!nsInDouble && ch === "'") { nsInSingle = !nsInSingle; continue; }
      if (!nsInSingle && ch === '"') { nsInDouble = !nsInDouble; continue; }
      if (nsInSingle || nsInDouble) continue;
      if (ch === ':') {
        var prev = trimmed[i - 1] || '';
        var next = trimmed[i + 1] || '';
        if (prev !== ':' && next !== ':') return false;
      }
    }

    // Browser XPath support is limited, but reject common external-document/function patterns anyway.
    var forbiddenFn = /(^|[^A-Za-z0-9_-])(document|doc|doc-available|collection|unparsed-text|unparsed-text-available)\s*\(/i;
    if (forbiddenFn.test(trimmed)) return false;

    return true;
  }

export function isValidCssSelector(expr) {
    if (typeof expr !== 'string') return false;
    if (typeof document === 'undefined' || !document) return false;
    var trimmed = expr.trim();
    if (!trimmed) return false;
    // Disallow control chars
    for (var i = 0; i < trimmed.length; i++) {
      var code = trimmed.charCodeAt(i);
      if ((code >= 0x0000 && code <= 0x001F) || code === 0x007F) return false;
    }
    var maxLen = uiConst('CSS_SELECTOR_MAX_LENGTH', 2000);
    if (trimmed.length > maxLen) return false;
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
