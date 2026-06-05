
export function clearChildren(el) {
  while (el && el.firstChild) {
    try { el.removeChild(el.firstChild); } catch (_) { break; }
  }
}

export function setFixedPosition(el, left, top) {
  el.style.setProperty('left', left + 'px', 'important');
  el.style.setProperty('top', top + 'px', 'important');
  el.style.setProperty('right', 'auto', 'important');
  el.style.setProperty('bottom', 'auto', 'important');
}

export function clampPanelPosition(left, top, width, height, margin) {
  var maxLeft = window.innerWidth - width - margin;
  var maxTop = window.innerHeight - height - margin;
  return {
    left: Math.max(margin, Math.min(maxLeft, left)),
    top: Math.max(margin, Math.min(maxTop, top))
  };
}
