// TOC构建相关工具函数
(() => {
  'use strict';

  const { collectBySelector, uniqueInDocumentOrder } = window.TOC_UTILS || {};

  /**
   * 从选择器构建TOC项目
   */
  function buildTocItemsFromSelectors(selectors, cfg) {
    const elements = [];
    const list = Array.isArray(selectors) ? selectors : [];
    
    for (const sel of list) {
      try {
        const nodes = collectBySelector(sel);
        for (const node of nodes) {
          elements.push(node);
        }
      } catch (e) {
        // ignore selector error
      }
    }
    
    const keepEmpty = !!(cfg && cfg.keepEmptyText);
    const uniq = uniqueInDocumentOrder(elements)
      .map((el, i) => {
        // 提取文本，限制最大长度为200字符
        let rawText = el.innerText || el.textContent || '';
        rawText = rawText.trim().replace(/\s+/g, ' ');
        const maxLength = 200;
        const text = rawText.length > maxLength
          ? rawText.substring(0, maxLength) + '...'
          : rawText;
        return {
          id: 'toc-item-' + i,
          el,
          text
        };
      })
      .filter(item => {
        if (keepEmpty) return true;
        
        // 检查文本内容是否为空
        if (!item.text || item.text.length === 0) return false;
        
        // 检查元素是否被隐藏
        const el = item.el;
        if (!el) return false;
        
        // 检查CSS显示属性
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return false;
        }
        
        // 检查元素尺寸（宽度或高度为0可能表示隐藏）
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          return false;
        }

        // 检查是否在视口外且被裁剪（overflow为hidden时额外检查）
        if (style.overflow === 'hidden') {
          // 已经在上面检查过尺寸为0的情况，这里检查其他可能的隐藏情况
          const parent = el.parentElement;
          if (parent) {
            const parentRect = parent.getBoundingClientRect();
            // 如果元素完全被父元素裁剪（元素在父元素范围外且父元素overflow:hidden）
            if (rect.right < parentRect.left || rect.left > parentRect.right ||
                rect.bottom < parentRect.top || rect.top > parentRect.bottom) {
              return false;
            }
          }
        }
        
        return true;
      });
    
    return uniq;
  }

  /**
   * 构建TOC项目（向后兼容包装器）
   */
  function buildTocItems(cfg, extraSelectors = []) {
    const base = Array.isArray(cfg.selectors) ? cfg.selectors : [];
    let combined = (Array.isArray(extraSelectors) ? extraSelectors : []).concat(base);
    
    // 如果没有任何选择器，使用默认的标题选择器
    if (combined.length === 0) {
      combined = [{ type: 'css', expr: 'h1, h2, h3, h4, h5, h6' }];
    }
    
    return buildTocItemsFromSelectors(combined, cfg);
  }

  // 导出到全局
  window.TOC_BUILDER = {
    buildTocItemsFromSelectors,
    buildTocItems
  };
})();