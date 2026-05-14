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

  Object.assign(T, {
    isExtensionContextInvalidated,
    msg,
    isPlainObject,
    isContextInvalidatedError,
    getFocusableWithin,
    safeJsonParse,
    getFiniteNumber
  });
})();
