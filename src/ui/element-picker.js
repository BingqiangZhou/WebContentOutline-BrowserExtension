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

    // 使用textContent而非innerHTML避免XSS
    const header = document.createElement('div');
    header.className = 'toc-overlay-header';
    header.textContent = msg('pickerResultTitle');

    const body = document.createElement('div');
    body.className = 'toc-overlay-body';
    const textarea = document.createElement('textarea');
    textarea.className = 'toc-overlay-textarea';
    textarea.readOnly = true;
    textarea.textContent = selector; // 使用textContent防止XSS
    body.appendChild(textarea);

    const actions = document.createElement('div');
    actions.className = 'toc-overlay-actions';

    const btnSave = document.createElement('button');
    btnSave.className = 'toc-btn toc-btn-primary';
    btnSave.dataset.act = 'save';
    btnSave.textContent = msg('buttonSaveAsConfig');

    const btnClose = document.createElement('button');
    btnClose.className = 'toc-btn';
    btnClose.dataset.act = 'close';
    btnClose.textContent = msg('buttonClose');

    actions.appendChild(btnSave);
    actions.appendChild(btnClose);

    wrap.appendChild(header);
    wrap.appendChild(body);
    wrap.appendChild(actions);

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
    let timeoutId = setTimeout(() => {
      try {
        cleanup();
      } catch (e) {
        console.warn('[目录助手] cleanup失败，强制取消元素拾取:', e);
      } finally {
        // 确保onCancel总是被调用
        try {
          onCancel && onCancel();
        } catch (e) {
          console.warn('[目录助手] onCancel回调失败:', e);
        }
      }
    }, 20000);

    function cleanup() {
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('contextmenu', onCtx, true);
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
      // 更安全的DOM移除：检查节点仍然在文档中
      if (highlight) {
        try {
          if (highlight.parentNode && document.contains(highlight)) {
            highlight.parentNode.removeChild(highlight);
          }
        } catch (e) {
          // 忽略移除失败，节点可能已被移除
        }
      }
      // 恢复光标（添加存在性检查）
      try {
        if (document.body) {
          document.body.style.cursor = prevCursor || '';
        }
      } catch (e) {
        // 忽略光标恢复失败
      }
    }

    return { cleanup };
  }

  // 导出到全局
  window.TOC_UI = window.TOC_UI || {};
  window.TOC_UI.showPickerResult = showPickerResult;
  window.TOC_UI.createElementPicker = createElementPicker;
})();
