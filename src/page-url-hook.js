(function() {
  'use strict';

  var win = typeof window !== 'undefined' ? window : null;
  if (!win || !win.history) return;
  if (win.__TOC_URL_HOOK_INSTALLED__) return;
  win.__TOC_URL_HOOK_INSTALLED__ = true;

  var EVENT_NAME = 'toc:urlchange';

  function emitUrlChange(kind) {
    try {
      var detail = { kind: kind, href: String(win.location && win.location.href || '') };
      win.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: detail }));
    } catch (_) {
      try {
        win.dispatchEvent(new Event(EVENT_NAME));
      } catch (_2) {}
    }
  }

  function wrapHistoryMethod(name) {
    var original = win.history && win.history[name];
    if (typeof original !== 'function') return;
    if (original.__TOC_URL_HOOK_WRAPPED__) return;

    var wrapped = function() {
      var result = original.apply(this, arguments);
      emitUrlChange(name);
      return result;
    };

    try {
      Object.defineProperty(wrapped, '__TOC_URL_HOOK_WRAPPED__', {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false
      });
    } catch (_) {
      wrapped.__TOC_URL_HOOK_WRAPPED__ = true;
    }

    try {
      win.history[name] = wrapped;
    } catch (_) {}
  }

  wrapHistoryMethod('pushState');
  wrapHistoryMethod('replaceState');
})();
