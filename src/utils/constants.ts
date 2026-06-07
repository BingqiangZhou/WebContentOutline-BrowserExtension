
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
 * Scroll-to-element: minimum gap (px) above the target element.
 */
export var SCROLL_TOP_PADDING = 80;

/**
 * Fixed-header height cache TTL (ms).
 */
export var HEADER_CACHE_TTL = 5000;

/**
 * Heading level weights for noise filtering when all 6 levels are present.
 * Higher weight = more likely to be kept.
 */
export var HEADING_LEVEL_WEIGHTS: Record<string, number> = {
  H1: 40, H2: 100, H3: 80, H4: 60, H5: 20, H6: 10
};
