// CSS选择器生成工具
(() => {
  'use strict';

  /**
   * 转义CSS类名中的特殊字符
   * @param {string} className
   * @returns {string}
   */
  function escapeCssClass(className) {
    // 需要转义的特殊字符：.!#$%&*+./=?^`{|}~等
    // 根据CSS规范，类名中的特殊字符需要用反斜杠转义
    return className.replace(/([.!#$%&*+\/=?^`{|}~\[\]\\()])/g, '\\$1');
  }

  /**
   * 构建类选择器
   */
  function buildClassSelector(el) {
    if (!el || !el.classList || el.classList.length === 0) return '';
    const classes = Array.from(el.classList).slice(0, 3); // limit to first 3
    if (classes.length === 0) return '';
    // 转义每个类名中的特殊字符
    const escaped = classes.map(escapeCssClass);
    return '.' + escaped.join('.');
  }

  /**
   * 为元素生成CSS路径
   */
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

  // 导出到全局
  window.CSS_SELECTOR = {
    buildClassSelector,
    cssPathFor
  };
})();