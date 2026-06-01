/**
 * Storage keys
 */
export var STORAGE_KEYS = {
  TOC_CONFIGS: 'tocConfigs',
  SITE_ENABLE_MAP: 'tocSiteEnabledMap',
  PANEL_STATE_MAP: 'tocPanelExpandedMap',
  BADGE_POS_MAP: 'tocBadgePosMap'
};

/**
 * UI constants shared across modules.
 */
export var UI_CONSTANTS = {
  // Builder
  TOC_TEXT_MAX_LEN: 200,
  TOC_MAX_ITEMS: 400,
  TOC_MAX_CANDIDATES: 1200,

  // Badge defaults
  BADGE_DEFAULT_RIGHT_PX: 16,
  BADGE_DEFAULT_TOP_MIN_PX: 120,
  DOCK_CLOSE_DELAY_MS: 250,
  DOCK_SAFE_MARGIN_PX: 12,
  DOCK_DEFAULT_HEIGHT: 104,

  PANEL_WIDTH: 280,
  PANEL_HEIGHT: 400,
  BADGE_WIDTH: 80,
  BADGE_HEIGHT: 32,
  DRAG_THRESHOLD_PX: 3,
  UNLOCK_AFTER_MS: 1000,
  SCROLL_STOP_MS: 500,
  PENDING_REBUILD_RECHECK_MS: 100,
  PICKER_TIMEOUT_MS: 20000,
  EXPAND_ANIM_MS: 300,
  MUTATION_DEBOUNCE_MS: 400,

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
  WARN_ONCE_MAX_KEYS: 200,

  CLEANUP_SELECTOR: '.toc-edge-dock[data-toc-owner], .toc-collapsed-badge[data-toc-owner], .toc-floating[data-toc-owner], .toc-overlay[data-toc-owner], .toc-toast-container[data-toc-owner]'
};

export function uiConst(name, fallback) {
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
