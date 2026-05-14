(() => {
  if (globalThis.NAV_LOCK) return;
  const { uiConst } = globalThis.TOC_UTILS || {};

  let _locked = false;
  let _setAt = 0;
  let _failsafeTimer = null;
  let _unlockTimer = null;
  let _onUnlockCallbacks = [];

  const FAILSAFE_MS = uiConst ? uiConst('NAV_LOCK_FAILSAFE_MS', 3000) : 3000;

  const clearFailsafe = () => {
    if (_failsafeTimer != null) {
      clearTimeout(_failsafeTimer);
      _failsafeTimer = null;
    }
  };

  const armFailsafe = () => {
    clearFailsafe();
    _failsafeTimer = setTimeout(() => {
      if (_locked) {
        _locked = false;
        _setAt = 0;
        const cbs = _onUnlockCallbacks.slice();
        _onUnlockCallbacks = [];
        cbs.forEach(cb => { try { cb(); } catch {} });
      }
    }, FAILSAFE_MS);
  };

  const lock = (durationMs) => {
    _locked = true;
    _setAt = Date.now();
    clearFailsafe();
    armFailsafe();

    if (durationMs && durationMs > 0) {
      if (_unlockTimer != null) clearTimeout(_unlockTimer);
      _unlockTimer = setTimeout(() => {
        unlock();
      }, durationMs);
    }
  };

  const unlock = () => {
    const wasLocked = _locked;
    _locked = false;
    _setAt = 0;
    if (_unlockTimer != null) { clearTimeout(_unlockTimer); _unlockTimer = null; }
    clearFailsafe();

    if (wasLocked) {
      const cbs = _onUnlockCallbacks.slice();
      _onUnlockCallbacks = [];
      cbs.forEach(cb => { try { cb(); } catch {} });
    }
  };

  const isLocked = () => _locked;

  const onUnlock = (callback) => {
    if (!_locked) {
      try { callback(); } catch {}
      return;
    }
    _onUnlockCallbacks.push(callback);
  };

  const destroy = () => {
    unlock();
    _onUnlockCallbacks = [];
  };

  globalThis.NAV_LOCK = { lock, unlock, isLocked, onUnlock, destroy };
})();
