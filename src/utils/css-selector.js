
(() => {
  'use strict';

  function escapeCssIdentifier(value) {
    const ident = String(value ?? '');
    try {
      if (globalThis.CSS && typeof globalThis.CSS.escape === 'function') {
        return globalThis.CSS.escape(ident);
      }
    } catch (_) {}

    // Minimal CSS.escape polyfill based on the CSSOM spec behavior.
    // Escapes control chars, leading digits, and non-identifier chars.
    let result = '';
    const length = ident.length;
    for (let i = 0; i < length; i++) {
      const codeUnit = ident.charCodeAt(i);
      const ch = ident.charAt(i);

      // NULL character
      if (codeUnit === 0x0000) {
        result += '\uFFFD';
        continue;
      }

      const isControl = (codeUnit >= 0x0001 && codeUnit <= 0x001F) || codeUnit === 0x007F;
      const isDigit = codeUnit >= 0x0030 && codeUnit <= 0x0039;
      const isAlpha = (codeUnit >= 0x0041 && codeUnit <= 0x005A) || (codeUnit >= 0x0061 && codeUnit <= 0x007A);
      const isNonAscii = codeUnit >= 0x0080;
      const isHyphen = codeUnit === 0x002D;
      const isUnderscore = codeUnit === 0x005F;

      const isFirst = i === 0;
      const isSecond = i === 1;

      if (isControl) {
        result += '\\' + codeUnit.toString(16) + ' ';
        continue;
      }

      // If the identifier starts with a digit, or second char is digit when first is hyphen.
      if ((isFirst && isDigit) || (isFirst && isHyphen && length > 1 && isSecond && isDigit)) {
        result += '\\' + codeUnit.toString(16) + ' ';
        continue;
      }

      // If identifier is exactly "-" it must be escaped.
      if (isFirst && isHyphen && length === 1) {
        result += '\\-';
        continue;
      }

      // Safe identifier chars
      if (isAlpha || isDigit || isHyphen || isUnderscore || isNonAscii) {
        result += ch;
        continue;
      }

      // Everything else
      result += '\\' + ch;
    }
    return result;
  }

  
  function buildClassSelector(el) {
    if (!el || !el.classList || el.classList.length === 0) return '';
    const classes = Array.from(el.classList).slice(0, 3); // limit to first 3
    if (classes.length === 0) return '';

    const escaped = classes.map(escapeCssIdentifier);
    return '.' + escaped.join('.');
  }

  
  function cssPathFor(el, maxDepth = 4) {
    if (!el || el.nodeType !== 1) return '';
    const parts = [];
    let cur = el, depth = 0;
    
    while (cur && cur.nodeType === 1 && depth < maxDepth && cur !== document.documentElement) {
      let part = cur.tagName.toLowerCase();
      const cls = buildClassSelector(cur);
      
      if (cls) {
        part = part + cls;
      } else {
        // use nth-of-type for uniqueness hint
        const parent = cur.parentElement;
        if (parent) {
          const tag = cur.tagName;
          const siblings = Array.from(parent.children).filter(c => c.tagName === tag);
          if (siblings.length > 1) {
            const idx = siblings.indexOf(cur) + 1;
            part = `${part}:nth-of-type(${idx})`;
          }
        }
      }
      
      parts.unshift(part);
      cur = cur.parentElement;
      depth++;
    }
    
    return parts.join(' > ');
  }

  window.CSS_SELECTOR = {
    buildClassSelector,
    cssPathFor
  };
})();
