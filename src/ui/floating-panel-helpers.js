export function createTimerBag(keys) {
  var timers = {};
  keys.forEach(function(key) { timers[key] = null; });
  timers.clearAll = function() {
    keys.forEach(function(key) {
      if (timers[key]) {
        clearTimeout(timers[key]);
        timers[key] = null;
      }
    });
  };
  return timers;
}

export function createWindowListenerAdder(signal) {
  return function addWindowListener(type, handler, options) {
    var capture = (typeof options === 'boolean') ? options : !!(options && options.capture);
    var attached = false;
    try {
      if (signal) {
        window.addEventListener(type, handler, { ...(options || {}), signal: signal });
        attached = true;
      }
    } catch (_) {}
    if (!attached) {
      window.addEventListener(type, handler, options);
    }
    return function removeWindowListener() {
      try { window.removeEventListener(type, handler, capture); } catch (_) {}
    };
  };
}

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
