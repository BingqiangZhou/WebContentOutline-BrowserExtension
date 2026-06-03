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

export function isSafeXPathExpression(expr) {
    if (typeof expr !== 'string') return false;
    var trimmed = expr.trim();
    if (!trimmed || trimmed.length > 2000) return false;
    // Block extremely broad document scans
    var normalized = trimmed.replace(/\s+/g, '').toLowerCase();
    if (normalized.indexOf('//*') === 0 || normalized.indexOf('.//*') === 0) return false;
    // Reject external document/function patterns
    if (/(?:^|[^A-Za-z0-9_-])(?:document|collection|unparsed-text)\s*\(/i.test(trimmed)) return false;
    return true;
  }

export function isValidCssSelector(expr) {
    if (typeof expr !== 'string') return false;
    if (typeof document === 'undefined' || !document) return false;
    var trimmed = expr.trim();
    if (!trimmed || trimmed.length > 2000) return false;
    if (isHighRiskBroadCssSelector(expr)) return false;
    try {
      var frag = document.createDocumentFragment();
      if (frag && frag.querySelector) {
        frag.querySelector(trimmed);
        return true;
      }
      return true;
    } catch (_) {
      return false;
    }
  }

export function isHighRiskBroadCssSelector(expr) {
    if (typeof expr !== 'string') return false;
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
      return false;
    } catch (_) {
      return false;
    }
  }

