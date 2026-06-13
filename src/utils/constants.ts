
/**
 * Storage keys
 */
export var STORAGE_KEYS = {
  TOC_CONFIGS: 'tocConfigs',
  SITE_ENABLE_MAP: 'tocSiteEnabledMap',
  BADGE_POS_MAP: 'tocBadgePosMap'
};

/**
 * Maximum allowed length for a single selector expression (CSS or XPath).
 */
export var SELECTOR_EXPR_MAX_LENGTH = 2000;

/**
 * Extension owner identifier used for DOM element ownership and cleanup.
 */
export var EXTENSION_OWNER = 'web-toc-assistant';

/**
 * Selector matching all extension-owned elements.
 */
export var OWNED_SELECTOR = '[data-toc-owner="' + EXTENSION_OWNER + '"]';

/**
 * TOC building limits.
 */
export var TOC_TEXT_MAX_LEN = 200;
export var TOC_MAX_ITEMS = 400;
export var TOC_MAX_CANDIDATES = 1200;

/**
 * Maximum entries per storage map before pruning.
 */
export var MAP_MAX_KEYS = 400;

/**
 * Maximum depth when generating a CSS path selector.
 */
export var CSS_PATH_MAX_DEPTH = 20;

/**
 * Scroll-to-element: gap (px) left between the top/header and the target so its
 * text sits just below the edge. Kept small so the heading lands at the top of
 * the visible area rather than far below it.
 */
export var SCROLL_TOP_PADDING = 8;

/**
 * Fixed-header height cache TTL (ms).
 */
export var HEADER_CACHE_TTL = 5000;
