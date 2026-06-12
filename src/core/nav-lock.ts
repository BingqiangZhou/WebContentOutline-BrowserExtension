
'use strict';

  /** Navigation lock: prevents IntersectionObserver interference during user
   *  scroll/click navigation. Auto-unlocks after a duration and can notify a
   *  listener so a parked rebuild can be retried promptly. */
  export interface NavLock {
    lock: (durationMs?: number) => void;
    unlock: () => void;
    isLocked: () => boolean;
    destroy: () => void;
  }

  export function createNavLock(opts?: { onUnlock?: () => void }): NavLock {
    opts = opts || {};
    var onUnlock: (() => void) | null = typeof opts.onUnlock === 'function' ? opts.onUnlock : null;
    var _locked = false;
    var _timer: ReturnType<typeof setTimeout> | null = null;

    function notify() {
      if (onUnlock) { try { onUnlock(); } catch (_) {} }
    }

    return {
      lock: function(durationMs?: number) {
        _locked = true;
        if (_timer != null) clearTimeout(_timer);
        _timer = setTimeout(function() { _timer = null; _locked = false; notify(); }, durationMs && durationMs > 0 ? durationMs : 3000);
      },
      unlock: function() {
        var wasLocked = _locked;
        _locked = false;
        if (_timer != null) { clearTimeout(_timer); _timer = null; }
        if (wasLocked) notify();
      },
      isLocked: function() { return _locked; },
      destroy: function() { _locked = false; if (_timer != null) { clearTimeout(_timer); _timer = null; } }
    };
  }
