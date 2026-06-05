// @ts-nocheck
'use strict';

  var _locked = false;
  var _timer = null;

  var lock = function(durationMs) {
    _locked = true;
    if (_timer != null) clearTimeout(_timer);
    if (durationMs && durationMs > 0) {
      _timer = setTimeout(function() {
        _timer = null;
        _locked = false;
      }, durationMs);
    } else {
      // Default 3s failsafe
      _timer = setTimeout(function() {
        _timer = null;
        _locked = false;
      }, 3000);
    }
  };

  var unlock = function() {
    _locked = false;
    if (_timer != null) { clearTimeout(_timer); _timer = null; }
  };

  var isLocked = function() { return _locked; };

  var destroy = function() { unlock(); };

export { lock, unlock, isLocked, destroy };
