// 折叠状态的浮动按钮组件
(() => {
  'use strict';

  /**
   * 渲染折叠状态的浮动按钮
   */
  function renderCollapsedBadge(side, onExpand) {
    const badge = document.createElement('div');
    badge.className = `toc-collapsed-badge ${side === 'left' ? 'left' : 'right'}`;
    badge.textContent = '目录';
    badge.title = '展开目录';

    // 读取保存位置（每个域名记忆）
    const posKey = `tocBadgePos::${location.host}`;
    try {
      const saved = localStorage.getItem(posKey);
      if (saved) {
        const { left, top } = JSON.parse(saved);
        if (typeof left === 'number' && typeof top === 'number') {
          // 保存/应用均使用视口坐标（position:fixed）
          const bw = 80; // 预估badge宽度
          const bh = 32; // 预估badge高度
          const maxLeft = window.innerWidth - bw - 4;
          const maxTop = window.innerHeight - bh - 4;
          if (left >= 4 && left <= maxLeft && top >= 4 && top <= maxTop) {
            badge.style.setProperty('left', left + 'px', 'important');
            badge.style.setProperty('top', top + 'px', 'important');
            badge.classList.remove('left', 'right');
          }
        }
      }
    } catch {}

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
          console.warn('[目录助手] 保存位置失败:', err);
        }
      }
      
      e.preventDefault();
      e.stopPropagation();
    }
    
    badge.addEventListener('mousedown', onMouseDown, true);
    document.documentElement.appendChild(badge);

    return {
      remove() { badge.remove(); }
    };
  }

  // 导出到全局
  window.TOC_UI = window.TOC_UI || {};
  window.TOC_UI.renderCollapsedBadge = renderCollapsedBadge;
})();