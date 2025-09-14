// 元素拾取器组件
(() => {
  'use strict';

  /**
   * 显示拾取结果对话框
   */
  function showPickerResult(selector, saveCb) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;z-index:2147483647;bottom:20px;right:20px;background:#111;color:#fff;padding:10px;border-radius:8px;box-shadow:0 6px 16px rgba(0,0,0,.3);max-width:60vw;';
    wrap.innerHTML = `
      <div style="font-size:13px;margin-bottom:6px;color:#fff;">已生成选择器：</div>
      <textarea style="width:420px;max-width:58vw;height:68px;font-size:12px;border-radius:6px;border:1px solid #444;padding:8px;background:#fff;color:#222;resize:vertical;" readonly>${selector}</textarea>
      <div style="margin-top:8px;display:flex;gap:8px;justify-content:flex-end">
        <button data-act="save" style="padding:6px 10px;border-radius:6px;border:0;background:#059669;color:#fff;cursor:pointer;">保存为站点配置</button>
        <button data-act="close" style="padding:6px 10px;border-radius:6px;border:1px solid #444;background:#222;color:#fff;cursor:pointer;">关闭</button>
      </div>
    `;
    const close = () => wrap.remove();
    wrap.addEventListener('click', (e) => {
      const t = e.target;
      if (!t || !t.dataset) return;
      if (t.dataset.act === 'close') close();
      if (t.dataset.act === 'save') saveCb && saveCb(selector, close);
    });
    document.documentElement.appendChild(wrap);
    return { close };
  }

  /**
   * 创建元素拾取器
   */
  function createElementPicker(onPicked, onCancel) {
    // highlighter box that never captures events
    const highlight = document.createElement('div');
    highlight.style.cssText = 'position:absolute;border:2px solid #2f6feb;background:rgba(47,111,235,0.08);pointer-events:none;z-index:2147483647;left:0;top:0;width:0;height:0;';
    document.documentElement.appendChild(highlight);

    // set cursor crosshair without overlay
    const prevCursor = document.body.style.cursor;
    document.body.style.cursor = 'crosshair';

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
      // Use target directly; if it's UI element, find underlying elementFromPoint ignoring our highlight (pointer-events:none)
      let el = e.target;
      if (isUiElement(el)) {
        el = document.elementFromPoint(e.clientX, e.clientY);
        if (isUiElement(el)) return; // still UI, skip
      }
      if (el && el !== highlight) box(el);
    }

    function click(e) {
      e.preventDefault();
      let el = e.target;
      if (isUiElement(el)) {
        el = document.elementFromPoint(e.clientX, e.clientY);
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