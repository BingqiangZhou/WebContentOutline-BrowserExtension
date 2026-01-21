// 折叠状态的浮动按钮组件
(() => {
  'use strict';

  /**
   * 获取本地化消息
   */
  function msg(key) {
    return chrome.i18n.getMessage(key) || key;
  }

  /**
   * 渲染折叠状态的浮动按钮
   */
  function renderCollapsedBadge(side, onExpand) {
    const badge = document.createElement('div');
    badge.className = `toc-collapsed-badge ${side === 'left' ? 'left' : 'right'}`;
    badge.textContent = msg('tocTitle');
    badge.title = msg('badgeTitle');

    // 读取保存位置（每个域名记忆）
    const posKey = `tocBadgePos::${location.host}`;
    // 先创建badge并添加到DOM以获取实际尺寸
    document.documentElement.appendChild(badge);

    try {
      const saved = localStorage.getItem(posKey);
      if (saved) {
        const { left, top } = JSON.parse(saved);
        if (typeof left === 'number' && typeof top === 'number') {
          // 保存/应用均使用视口坐标（position:fixed）
          // 使用实际badge尺寸而非硬编码值
          // 使用requestAnimationFrame确保DOM已渲染后再读取尺寸
          requestAnimationFrame(() => {
            const bw = badge.offsetWidth || 80;
            const bh = badge.offsetHeight || 32;
            const maxLeft = window.innerWidth - bw - 4;
            const maxTop = window.innerHeight - bh - 4;
            if (left >= 4 && left <= maxLeft && top >= 4 && top <= maxTop) {
              badge.style.setProperty('left', left + 'px', 'important');
              badge.style.setProperty('top', top + 'px', 'important');
              badge.classList.remove('left', 'right');
            }
          });
        }
      }
    } catch (e) {
      console.warn('[目录助手] 读取badge位置失败:', e);
    }

    // 拖拽支持
    let drag = { active: false, startX: 0, startY: 0, offsetX: 0, offsetY: 0, moved: false };

    function onMouseDown(e) {
      // 防止在其他元素上触发拖拽
      if (e.target !== badge) return;

      drag.active = true;
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      drag.moved = false;

      // 计算鼠标相对于badge的偏移
      const rect = badge.getBoundingClientRect();
      drag.offsetX = e.clientX - rect.left;
      drag.offsetY = e.clientY - rect.top;

      // 添加拖拽样式
      badge.style.cursor = 'grabbing';
      badge.style.userSelect = 'none';

      document.addEventListener('mousemove', onMouseMove, true);
      document.addEventListener('mouseup', onMouseUp, true);

      e.preventDefault();
      e.stopPropagation();
    }

    function onMouseMove(e) {
      if (!drag.active) return;

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;

      // 检测是否开始拖拽（移动超过阈值）
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        drag.moved = true;
      }

      // 计算新位置（相对于视口）
      let left = e.clientX - drag.offsetX;
      let top = e.clientY - drag.offsetY;

      // 获取badge尺寸
      const bw = badge.offsetWidth || 80;
      const bh = badge.offsetHeight || 32;

      // 限制在视口内（考虑滚动）
      const minLeft = 4;
      const minTop = 4;
      const maxLeft = window.innerWidth - bw - 4;
      const maxTop = window.innerHeight - bh - 4;

      left = Math.max(minLeft, Math.min(maxLeft, left));
      top = Math.max(minTop, Math.min(maxTop, top));

      badge.style.setProperty('left', left + 'px', 'important');
      badge.style.setProperty('top', top + 'px', 'important');
      badge.style.setProperty('right', 'auto', 'important');
      badge.style.setProperty('bottom', 'auto', 'important');

      // 移除侧位类，使用绝对定位
      badge.classList.remove('left', 'right');

      e.preventDefault();
    }

    function onMouseUp(e) {
      if (!drag.active) return;

      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('mouseup', onMouseUp, true);

      // 恢复样式
      badge.style.cursor = 'pointer';
      badge.style.userSelect = '';

      drag.active = false;

      // 如果没有拖拽，则执行点击展开
      if (!drag.moved) {
        onExpand();
      } else {
        // 保存位置（使用视口坐标）
        try {
          const rect = badge.getBoundingClientRect();
          const left = Math.max(4, Math.min(window.innerWidth - rect.width - 4, rect.left));
          const top = Math.max(4, Math.min(window.innerHeight - rect.height - 4, rect.top));
          localStorage.setItem(posKey, JSON.stringify({ left, top }));
        } catch (err) {
          console.warn(msg('logSavePositionFailed'), err);
        }
      }

      e.preventDefault();
      e.stopPropagation();
    }

    badge.addEventListener('mousedown', onMouseDown, true);
    // badge已在前面添加到DOM

    // 清理函数：移除事件监听器
    function cleanup() {
      badge.removeEventListener('mousedown', onMouseDown, true);
      // 确保拖拽事件也被清理（防止异常情况）
      if (drag.active) {
        document.removeEventListener('mousemove', onMouseMove, true);
        document.removeEventListener('mouseup', onMouseUp, true);
      }
    }

    return {
      remove() {
        cleanup();
        badge.remove();
      }
    };
  }

  // 导出到全局
  window.TOC_UI = window.TOC_UI || {};
  window.TOC_UI.renderCollapsedBadge = renderCollapsedBadge;
})();
