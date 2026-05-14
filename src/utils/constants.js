define('toc-constants', [], function() {
 /**
  * Storage keys
  */
 var STORAGE_KEYS = {
   TOC_CONFIGS: 'tocConfigs',
   SITE_ENABLE_MAP: 'tocSiteEnabledMap',
   PANEL_STATE_MAP: 'tocPanelExpandedMap',
   BADGE_POS_MAP: 'tocBadgePosMap'
 };

 /**
  * UI constants shared across modules.
  */
 var UI_CONSTANTS = {
   // Builder
   TOC_TEXT_MAX_LEN: 200,
   TOC_MAX_ITEMS: 400,
   TOC_MAX_CANDIDATES: 1200,

   // Badge defaults
   BADGE_DEFAULT_RIGHT_PX: 16,
   BADGE_DEFAULT_TOP_MIN_PX: 120,

   PANEL_WIDTH: 280,
   PANEL_HEIGHT: 400,
   BADGE_WIDTH: 80,
   BADGE_HEIGHT: 32,
   BUTTON_OFFSET: 20,
   DRAG_THRESHOLD_PX: 3,
   UNLOCK_AFTER_MS: 1000,
   SCROLL_STOP_MS: 500,
   PENDING_REBUILD_RECHECK_MS: 100,
   CLEAR_USER_SELECTED_DELAY_MS: 200,
   PICKER_TIMEOUT_MS: 20000,
   EXPAND_ANIM_MS: 300,
   MUTATION_DEBOUNCE_MS: 500,
   MUTATION_UNLOCK_POLL_MS: 200,

   // Polling & URL monitoring timing
   POLL_INTERVAL_MS: 3000,
   POLL_INTERVAL_THROTTLED_MS: 10000,
   URL_CHANGE_DEDUP_MS: 500,
   NAV_LOCK_FAILSAFE_MS: 3000,
   REBUILD_COOLDOWN_MS: 5000,

   CSS_SELECTOR_MAX_LENGTH: 2000,
   XPATH_MAX_LENGTH: 2000,
   MAX_Z_INDEX: 2147483647,
   TOAST_DURATION_MS: 3000,
   DRAG_MARGIN_PX: 4,

   // Storage limits (best-effort quota management)
   STORAGE_MAX_SITES: 200,
   STORAGE_MAX_SELECTORS_PER_SITE: 50,
   STORAGE_MAX_MAP_KEYS: 400,
   STORAGE_ERROR_ONCE_MAX_KEYS: 200,

   CLEANUP_SELECTOR: '.toc-collapsed-badge[data-toc-owner], .toc-floating[data-toc-owner], .toc-overlay[data-toc-owner], .toc-toast-container[data-toc-owner]',
 };

 function uiConst(name, fallback) {
   try {
     if (!name) return fallback;
     var hasOwn = Object.prototype.hasOwnProperty.call(UI_CONSTANTS, name);
     var value = hasOwn ? UI_CONSTANTS[name] : undefined;
     if (typeof fallback === 'number') {
       return Number.isFinite(value) ? value : fallback;
     }
     return (value !== undefined && value !== null) ? value : fallback;
   } catch (_) {
     return fallback;
   }
 }

 var api = { STORAGE_KEYS: STORAGE_KEYS, UI_CONSTANTS: UI_CONSTANTS, uiConst: uiConst };
 // Backward compat
 try {
   var ROOT = typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : self);
   if (!ROOT.TOC_UTILS) ROOT.TOC_UTILS = api;
 } catch (_) {}
 return api;
});
