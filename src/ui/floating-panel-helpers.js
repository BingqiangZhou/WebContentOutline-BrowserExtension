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
