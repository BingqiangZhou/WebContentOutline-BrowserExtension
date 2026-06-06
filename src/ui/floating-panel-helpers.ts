
export function clearChildren(el: HTMLElement): void {
  if (!el) return;
  // replaceChildren() is a single native clear — much faster than N removeChild calls.
  // Available since Chrome 86 / Firefox 78 / Safari 14.
  if (typeof el.replaceChildren === 'function') {
    try { el.replaceChildren(); return; } catch (_) {}
  }
  // Fallback for ancient browsers
  while (el.firstChild) {
    try { el.removeChild(el.firstChild); } catch (_) { break; }
  }
}

export function setFixedPosition(el: HTMLElement, left: number, top: number): void {
  el.style.setProperty('left', left + 'px', 'important');
  el.style.setProperty('top', top + 'px', 'important');
  el.style.setProperty('right', 'auto', 'important');
  el.style.setProperty('bottom', 'auto', 'important');
}

export function clampPanelPosition(left: number, top: number, width: number, height: number, margin: number): { left: number; top: number } {
  var maxLeft = window.innerWidth - width - margin;
  var maxTop = window.innerHeight - height - margin;
  return {
    left: Math.max(margin, Math.min(maxLeft, left)),
    top: Math.max(margin, Math.min(maxTop, top))
  };
}
