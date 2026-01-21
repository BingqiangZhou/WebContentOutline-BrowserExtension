// 元素拾取器组件
(() => {
  'use strict';

  /**
   * 获取本地化消息
   */
  function msg(key) {
    return chrome.i18n.getMessage(key) || key;
  }

  /**
   * 显示拾取结果对话框
   */
  function showPickerResult(selector, saveCb) {
    const wrap = document.createElement('div');
    wrap.className = 'toc-overlay';
    wrap.innerHTML = `
      <div class="toc-overlay-header">${msg('pickerResultTitle')}</div>
      <div class="toc-overlay-body">
        <textarea class="toc-overlay-textarea" readonly>${selector}</textarea>
      </div>
      <div class="toc-overlay-actions">
        <button class="toc-btn toc-btn-primary" data-act="save">${msg('buttonSaveAsConfig')}</button>
        <button class="toc-btn" data-act="close">${msg('buttonClose')}</button>
      </div>
    `;
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'close') close();
      if (act === 'save') saveCb && saveCb(selector, close);
    });
    document.documentElement.appendChild(wrap);
    return { close };
  }

  /**
   * 创建元素拾取器
   */
  function createElementPicker(onPicked, onCancel) {
    // 检查 DOM 是否准备好
    if (!document.body) {
      console.warn('[目录助手] DOM 未准备好，无法启动元素拾取器');
      onCancel && onCancel();
      return { cleanup: () => {} };
    }

    // highlighter box that never captures events
    const highlight = document.createElement('div');
    highlight.style.cssText = 'position:absolute;border:2px solid #2f6feb;background:rgba(47,111,235,0.08);pointer-events:none;z-index:2147483647;left:0;top:0;width:0;height:0;';
    document.documentElement.appendChild(highlight);

    // set cursor crosshair without overlay
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'crosshair';

    // 获取实际的元素节点（处理文本节点情况）
    function getElementNode(node) {
      if (!node) return null;
      // 如果是文本节点，返回其父元素
      if (node.nodeType === Node.TEXT_NODE) {
        return node.parentElement;
      }
      // 如果是元素节点，直接返回
      if (node.nodeType === Node.ELEMENT_NODE) {
        return node;
      }
      return null;
    }

    function isUiElement(el) {
      // avoid highlighting our own panel or badge
      if (!el) return false;
      return el.closest && (el.closest('.toc-floating') || el.closest('.toc-collapsed-badge'));
    }

    function box(el) {
      if (!el) return;
      const r = el.getBoundingClientRect();
      // account for scroll position
      const left = r.left + window.scrollX;
      const top = r.top + window.scrollY;
      highlight.style.left = `${left}px`;
      highlight.style.top = `${top}px`;
      highlight.style.width = `${Math.max(0, r.width)}px`;
      highlight.style.height = `${Math.max(0, r.height)}px`;
    }

    function move(e) {
      // 获取实际的元素节点（处理文本节点）
      let el = getElementNode(e.target);
      if (isUiElement(el)) {
        el = getElementNode(document.elementFromPoint(e.clientX, e.clientY));
        if (isUiElement(el)) return; // still UI, skip
      }
      if (el && el !== highlight) box(el);
    }

    function click(e) {
      e.preventDefault();
      // 获取实际的元素节点（处理文本节点）
      let el = getElementNode(e.target);
      if (isUiElement(el)) {
        el = getElementNode(document.elementFromPoint(e.clientX, e.clientY));
        if (isUiElement(el)) {
          // click on UI; ignore
          return;
        }
      }
      cleanup();
      if (el && onPicked) onPicked(el);
    }

    function key(e) {
      if (e.key === 'Escape') {
        cleanup();
        onCancel && onCancel();
      }
    }

    document.addEventListener('mousemove', move, true);
    document.addEventListener('click', click, true);
    // 右键取消拾取
    const onCtx = (e) => { e.preventDefault(); cleanup(); onCancel && onCancel(); };
    document.addEventListener('contextmenu', onCtx, true);
    document.addEventListener('keydown', key, true);

    // 20s 超时自动取消，避免遗留状态
    let timeoutId = setTimeout(() => { cleanup(); onCancel && onCancel(); }, 20000);

    function cleanup() {
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('contextmenu', onCtx, true);
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
      if (highlight && highlight.parentNode) highlight.parentNode.removeChild(highlight);
      document.body.style.cursor = prevCursor || '';
    }

    return { cleanup };
  }

  // 导出到全局
  window.TOC_UI = window.TOC_UI || {};
  window.TOC_UI.showPickerResult = showPickerResult;
  window.TOC_UI.createElementPicker = createElementPicker;
})();
