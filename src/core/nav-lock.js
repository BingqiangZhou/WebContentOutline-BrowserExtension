'use strict';

import { uiConst } from '../utils/constants.js';

  var _locked = false;
  var _setAt = 0;
  var _failsafeTimer = null;
  var _unlockTimer = null;
  var _onUnlockCallbacks = [];

  var FAILSAFE_MS = uiConst ? uiConst('NAV_LOCK_FAILSAFE_MS', 3000) : 3000;

  var clearFailsafe = function() {
    if (_failsafeTimer != null) {
      clearTimeout(_failsafeTimer);
      _failsafeTimer = null;
    }
  };

  var armFailsafe = function() {
    clearFailsafe();
    _failsafeTimer = setTimeout(function() {
      if (_locked) {
        _locked = false;
        _setAt = 0;
        var cbs = _onUnlockCallbacks.slice();
        _onUnlockCallbacks = [];
        cbs.forEach(function(cb) { try { cb(); } catch (_) {} });
      }
    }, FAILSAFE_MS);
  };

  var lock = function(durationMs) {
    _locked = true;
    _setAt = Date.now();
    clearFailsafe();
    armFailsafe();

    if (durationMs && durationMs > 0) {
      if (_unlockTimer != null) clearTimeout(_unlockTimer);
      _unlockTimer = setTimeout(function() {
        unlock();
      }, durationMs);
    }
  };

  var unlock = function() {
    var wasLocked = _locked;
    _locked = false;
    _setAt = 0;
    if (_unlockTimer != null) { clearTimeout(_unlockTimer); _unlockTimer = null; }
    clearFailsafe();

    if (wasLocked) {
      var cbs = _onUnlockCallbacks.slice();
      _onUnlockCallbacks = [];
      cbs.forEach(function(cb) { try { cb(); } catch (_) {} });
    }
  };

  var isLocked = function() { return _locked; };

  var onUnlock = function(callback) {
    if (!_locked) {
      try { callback(); } catch (_) {}
      return;
    }
    _onUnlockCallbacks.push(callback);
  };

  var destroy = function() {
    unlock();
    _onUnlockCallbacks = [];
  };

export { lock, unlock, isLocked, onUnlock, destroy };
