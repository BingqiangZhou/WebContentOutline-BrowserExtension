(() => {
  const T = globalThis.TOC_UTILS;
  if (!T) return;

  /**
   * Check if the extension context is invalidated (e.g., after extension reload).
   * @returns {boolean}
   */
  function isExtensionContextInvalidated() {
    try {
      if (typeof chrome === 'undefined') return false;
      return !chrome.runtime?.id;
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
  function msg(key, substitutions) {
    try {
      return chrome.i18n.getMessage(key, substitutions) || key;
    } catch (_) {
      return key;
    }
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  }

  function isContextInvalidatedError(e) {
    try {
      if (!e) return false;
      const text = String(e && (e.message || (e.toString && e.toString()) || e) || '');
      const lowered = text.toLowerCase();
      return lowered.includes('extension context invalidated') || lowered.includes('context invalidated');
    } catch (_) {
      return false;
    }
  }

  function getFocusableWithin(rootEl) {
    const root = rootEl && rootEl.querySelectorAll ? rootEl : null;
    if (!root) return [];
    const selector = [
      'button:not([disabled])',
      'textarea:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'a[href]',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');
    try {
      return Array.from(root.querySelectorAll(selector)).filter(el => {
        if (!el || !el.focus) return false;
        const style = window.getComputedStyle(el);
        return style && style.visibility !== 'hidden' && style.display !== 'none';
      });
    } catch (_) {
      return [];
    }
  }

  function safeJsonParse(raw) {
    if (typeof raw !== 'string') return null;
    if (raw.length > 20000) {
      try { console.warn('[toc] safeJsonParse: input too large, skip parse:', raw.length); } catch (_) {}
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function getFiniteNumber(value) {
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) ? num : null;
  }

  function isSafeXPathExpression(expr) {
    if (typeof expr !== 'string') return false;
    const trimmed = expr.trim();
    if (!trimmed) return false;
    if (trimmed.length > uiConst('XPATH_MAX_LENGTH', 2000)) return false;

    // Avoid extremely broad document scans that are likely to be slow.
    if (trimmed.startsWith('//*') || /^\/\/(node|text|comment)\s*\(/i.test(trimmed)) return false;

    // Disallow control characters.
    for (let i = 0; i < trimmed.length; i++) {
      const code = trimmed.charCodeAt(i);
      if ((code >= 0x0000 && code <= 0x001F) || code === 0x007F) return false;
    }

    // Basic structural checks: balanced quotes/brackets/parentheses, and avoid extreme nesting.
    let inSingle = false;
    let inDouble = false;
    let parenDepth = 0;
    let bracketDepth = 0;
    const MAX_NESTING = 64;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
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
    let nsInSingle = false;
    let nsInDouble = false;
    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (!nsInDouble && ch === "'") { nsInSingle = !nsInSingle; continue; }
      if (!nsInSingle && ch === '"') { nsInDouble = !nsInDouble; continue; }
      if (nsInSingle || nsInDouble) continue;
      if (ch === ':') {
        const prev = trimmed[i - 1] || '';
        const next = trimmed[i + 1] || '';
        if (prev !== ':' && next !== ':') return false;
      }
    }

    // Browser XPath support is limited, but reject common external-document/function patterns anyway.
    const forbiddenFn = /(^|[^A-Za-z0-9_-])(document|doc|doc-available|collection|unparsed-text|unparsed-text-available)\s*\(/i;
    if (forbiddenFn.test(trimmed)) return false;

    return true;
  }

  function isValidCssSelector(expr) {
    if (typeof expr !== 'string') return false;
    if (typeof document === 'undefined' || !document) return false;
    const trimmed = expr.trim();
    if (!trimmed) return false;
    // Disallow control chars
    for (let i = 0; i < trimmed.length; i++) {
      const code = trimmed.charCodeAt(i);
      if ((code >= 0x0000 && code <= 0x001F) || code === 0x007F) return false;
    }
    const maxLen = uiConst('CSS_SELECTOR_MAX_LENGTH', 2000);
    if (trimmed.length > maxLen) return false;
    try {
      // Syntax validation without querying the page DOM.
      const frag = document.createDocumentFragment ? document.createDocumentFragment() : null;
      if (frag && frag.querySelector) {
        frag.querySelector(trimmed);
        return true;
      }
      // Fallback: use @supports selector() if available.
      if (typeof CSS !== 'undefined' && CSS && typeof CSS.supports === 'function') {
        if (CSS.supports(`selector(${trimmed})`)) return true;
      }
      // No validation method available — trust the selector syntax.
      return true;
    } catch (_) {
      return false;
    }
  }

  function validateSelectorExpression(type, expr) {
    try {
      if (type === 'xpath') return isSafeXPathExpression(expr);
      if (type === 'css') return isValidCssSelector(expr);
      const trackOnceFn = T.trackOnce;
      if (typeof trackOnceFn === 'function') {
        const onceKey = `selectorType:${String(type)}`;
        if (trackOnceFn(onceKey, uiConst('WARN_ONCE_MAX_KEYS', 200))) {
          console.warn('[toc] validateSelectorExpression: unsupported selector type:', type);
        }
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  Object.assign(T, {
    isExtensionContextInvalidated,
    msg,
    isPlainObject,
    isContextInvalidatedError,
    getFocusableWithin,
    safeJsonParse,
    getFiniteNumber,
    isSafeXPathExpression,
    isValidCssSelector,
    validateSelectorExpression
  });
})();
