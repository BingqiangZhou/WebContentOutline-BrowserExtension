
'use strict';

/**
 * Automatic content region detection for TOC generation.
 *
 * Four-layer detection strategy (fast -> slow, high accuracy -> fallback):
 *   Layer 1: Semantic HTML landmarks (main, article, [role="main"])
 *   Layer 2: Class/ID heuristics (.content, .post-body, etc.)
 *   Layer 3: Ancestor scoring from headings (adapted from Smart TOC)
 *   Layer 4: Full-page fallback (null — use document)
 *
 * URL-aware cache: reuses result across DOM rebuilds on the same URL,
 * auto-invalidates on SPA navigation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContentRegionResult {
  root: Element | null;
  source: string;
}

interface CandidateEntry {
  el: Element;
  score: number;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

var _cachedResult: ContentRegionResult | null = null;
var _cachedUrl = '';

// ---------------------------------------------------------------------------
// Pattern tables
// ---------------------------------------------------------------------------

/** Layer 1 — Semantic landmark selectors (ordered by priority) */
var LANDMARK_SELECTORS = [
  'main',
  '[role="main"]',
  'article',
  '[role="article"]',
];

/** Layer 2 — Positive class/id patterns that indicate content containers */
var CONTENT_SELECTORS = [
  // IDs
  '#content', '#main-content', '#maincontent', '#page-content',
  '#post-content', '#article-content', '#entry-content',
  '#primary',
  // Classes
  '.content', '.main-content', '.page-content', '.post-content',
  '.article-content', '.entry-content', '.post-body',
  '.article-body', '.story-body', '.markdown-body',
  '.prose', '.rich-text', '.text-block',
  '.primary', '.site-content', '.post-entry',
  '.blog-content', '.news-body', '.doc-content',
];

/** Words that signal content when found in class or id (substring match) */
var POSITIVE_WORDS = [
  'content', 'article', 'post', 'entry', 'story', 'body', 'prose',
  'main', 'primary', 'markdown', 'richtext', 'blog', 'news', 'doc',
];

/** Words that signal non-content when found in class or id (substring match) */
var NEGATIVE_WORDS = [
  'sidebar', 'nav', 'footer', 'header', 'comment', 'aside', 'widget',
  'ad', 'promo', 'related', 'breadcrumb', 'share', 'social', 'banner',
  'sponsor', 'pagination', 'shoutbox', 'skyscraper', 'menu', 'toolbar',
];

/** Heading weights for ancestor scoring (H1 weighted lower — often site-wide) */
var HEADING_WEIGHTS: Record<string, number> = {
  H1: 40,
  H2: 100,
  H3: 80,
  H4: 60,
};

/** Tag bonuses for ancestor scoring */
var TAG_BONUSES: Record<string, number> = {
  ARTICLE: 200,
  MAIN: 200,
  SECTION: 50,
  DIV: 10,
};

/** Maximum ancestor depth to walk during scoring */
var MAX_ANCESTOR_DEPTH = 6;

/** Maximum headings to sample for ancestor scoring (performance cap) */
var MAX_SAMPLED_HEADINGS = 100;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if an element is visible (has non-zero dimensions and is in the document).
 */
function isVisibleElement(el: Element): boolean {
  if (!el || !el.isConnected) return false;
  try {
    var w = (el as HTMLElement).offsetWidth;
    var h = (el as HTMLElement).offsetHeight;
    return w > 0 && h > 0;
  } catch (_) {
    return false;
  }
}

/**
 * Check if an element contains any heading (h1-h6).
 */
function containsHeading(el: Element): boolean {
  try {
    return el.querySelector('h1, h2, h3, h4, h5, h6') !== null;
  } catch (_) {
    return false;
  }
}

/**
 * Evaluate class/id patterns on an element.
 * Returns a positive score for content-like names, negative for non-content.
 */
function evaluatePatterns(el: Element): number {
  var classStr = ' ' + (el.getAttribute('class') || '') + ' ';
  var idStr = ' ' + (el.id || '') + ' ';
  var combined = classStr.toLowerCase() + ' ' + idStr.toLowerCase();

  for (var i = 0; i < POSITIVE_WORDS.length; i++) {
    if (combined.indexOf(POSITIVE_WORDS[i]) !== -1) {
      return 150;
    }
  }

  for (var j = 0; j < NEGATIVE_WORDS.length; j++) {
    if (combined.indexOf(NEGATIVE_WORDS[j]) !== -1) {
      return -300;
    }
  }

  return 0;
}

/**
 * Count h2-h4 headings inside an element (used for scoring).
 */
function countHeadings(el: Element): { h2: number; h3: number; h4: number } {
  var counts = { h2: 0, h3: 0, h4: 0 };
  try {
    var headings = el.querySelectorAll('h2, h3, h4');
    for (var i = 0; i < headings.length; i++) {
      var tag = headings[i].tagName;
      if (tag === 'H2') counts.h2++;
      else if (tag === 'H3') counts.h3++;
      else if (tag === 'H4') counts.h4++;
    }
  } catch (_) {}
  return counts;
}

// ---------------------------------------------------------------------------
// Layer 1: Semantic landmarks
// ---------------------------------------------------------------------------

/**
 * From a broad container (like <main>), drill down to find the single
 * most relevant content child. Avoids mixing headings from the main
 * article, comments, sidebar, and related sections into one TOC.
 */
function drillToPrimaryContent(container: Element): Element {
  // Collect direct children that look like content areas
  var children = container.children;
  if (!children || children.length === 0) return container;

  var candidates: CandidateEntry[] = [];
  for (var i = 0; i < children.length; i++) {
    var child = children[i];
    if (!child.isConnected || !isVisibleElement(child)) continue;

    var tag = child.tagName;
    // Only consider content-like children; skip navigation, sidebars, etc.
    if (tag === 'NAV' || tag === 'ASIDE' || tag === 'FOOTER' || tag === 'HEADER') continue;

    // Skip elements with negative pattern names (sidebar, comment, related, etc.)
    if (evaluatePatterns(child) < 0) continue;

    // Must contain headings to be a content candidate
    if (!containsHeading(child)) continue;

    var counts = countHeadings(child);
    var score = counts.h2 * 3 + counts.h3 * 2 + counts.h4;
    if (score > 0) {
      candidates.push({ el: child, score: score });
    }
  }

  if (candidates.length === 0) return container;

  // Sort by score descending
  candidates.sort(function(a, b) { return b.score - a.score; });

  // If one candidate dominates (score >= 2x the second best), use it
  if (candidates.length === 1 || candidates[0].score >= candidates[1].score * 2) {
    return candidates[0].el;
  }

  // No clear winner — keep the broad container
  return container;
}

function detectByLandmark(): ContentRegionResult | null {
  for (var i = 0; i < LANDMARK_SELECTORS.length; i++) {
    try {
      var el = document.querySelector(LANDMARK_SELECTORS[i]);
      if (el && el.isConnected && containsHeading(el) && isVisibleElement(el)) {
        // For <main> and [role="main"], drill down to find the primary content child
        if (LANDMARK_SELECTORS[i] === 'main' || LANDMARK_SELECTORS[i] === '[role="main"]') {
          var primary = drillToPrimaryContent(el);
          if (primary !== el) {
            return { root: primary, source: 'landmark' };
          }
          // No clear primary child — use the main element itself
          return { root: el, source: 'landmark' };
        }

        // For <article> elements
        if (LANDMARK_SELECTORS[i] === 'article' || LANDMARK_SELECTORS[i] === '[role="article"]') {
          var allArticles = document.querySelectorAll(LANDMARK_SELECTORS[i]);
          if (allArticles.length > 1) {
            // Pick the article with the most h2-h4 headings
            var bestArticle: Element | null = null;
            var bestCount = 0;
            for (var a = 0; a < allArticles.length; a++) {
              var c = countHeadings(allArticles[a]);
              var total = c.h2 * 3 + c.h3 * 2 + c.h4;
              if (total > bestCount) {
                bestCount = total;
                bestArticle = allArticles[a];
              }
            }
            if (bestArticle && bestCount > 0) {
              return { root: bestArticle, source: 'landmark' };
            }
            // Multiple equal articles — fall through to Layer 2
            continue;
          }
        }

        return { root: el, source: 'landmark' };
      }
    } catch (_) { /* selector error, skip */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Layer 2: Class/ID heuristics
// ---------------------------------------------------------------------------

function detectByClassHeuristic(): ContentRegionResult | null {
  var best: Element | null = null;
  var bestScore = 0;

  for (var i = 0; i < CONTENT_SELECTORS.length; i++) {
    try {
      var candidates = document.querySelectorAll(CONTENT_SELECTORS[i]);
      for (var j = 0; j < candidates.length; j++) {
        var el = candidates[j];
        if (!el.isConnected || !containsHeading(el) || !isVisibleElement(el)) continue;

        // Score by heading weights
        var counts = countHeadings(el);
        var score = counts.h2 * 3 + counts.h3 * 2 + counts.h4;

        // Penalize if ancestor matches negative pattern
        var ancestor = el.parentElement;
        var depth = 0;
        while (ancestor && depth < 2) {
          if (evaluatePatterns(ancestor) < 0) {
            score -= 50;
            break;
          }
          ancestor = ancestor.parentElement;
          depth++;
        }

        if (score > bestScore) {
          bestScore = score;
          best = el;
        }
      }
    } catch (_) { /* selector error, skip */ }
  }

  if (best && bestScore > 0) {
    return { root: best, source: 'heuristic-class' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Layer 3: Ancestor scoring from headings (adapted from Smart TOC)
// ---------------------------------------------------------------------------

function detectByAncestorScoring(): ContentRegionResult | null {
  // Step 1: Collect headings
  var headings: Element[];
  try {
    headings = Array.from(document.querySelectorAll('h2, h3, h4'));
  } catch (_) {
    return null;
  }

  if (headings.length === 0) return null;

  // Sample if too many
  if (headings.length > 200) {
    var step = headings.length / MAX_SAMPLED_HEADINGS;
    var sampled: Element[] = [];
    for (var s = 0; s < MAX_SAMPLED_HEADINGS; s++) {
      sampled.push(headings[Math.floor(s * step)]);
    }
    headings = sampled;
  }

  // Step 2: Score ancestors with distance-based weight decay
  var ancestorScores = new Map<Element, number>();
  var patternCache = new Map<Element, number>();

  for (var i = 0; i < headings.length; i++) {
    var heading = headings[i];
    var weight = HEADING_WEIGHTS[heading.tagName] || 0;
    if (weight === 0) continue;

    var ancestor = heading.parentElement;
    var depth = 0;

    while (ancestor && ancestor !== document.body && ancestor !== document.documentElement && depth < MAX_ANCESTOR_DEPTH) {
      var score = ancestorScores.get(ancestor) || 0;
      // Distance-based decay: 100% at parent, 85% at grandparent, 70% at great-grandparent, etc.
      var decayedWeight = weight * (1 - depth * 0.15);
      if (decayedWeight > 0) score += decayedWeight;

      // Tag bonus (applied once per ancestor)
      var tagBonus = TAG_BONUSES[ancestor.tagName] || 0;
      if (tagBonus) score += tagBonus;

      // Pattern score (cached per ancestor)
      if (!patternCache.has(ancestor)) {
        patternCache.set(ancestor, evaluatePatterns(ancestor));
      }
      score += patternCache.get(ancestor) || 0;

      ancestorScores.set(ancestor, score);
      ancestor = ancestor.parentElement;
      depth++;
    }
  }

  // Step 3: Get top candidates
  var candidates: CandidateEntry[] = [];
  ancestorScores.forEach(function(score, el) {
    if (score > 100) {
      candidates.push({ el: el, score: score });
    }
  });

  if (candidates.length === 0) return null;

  candidates.sort(function(a, b) { return b.score - a.score; });
  candidates = candidates.slice(0, 5);

  // Step 4: Re-score with structural signals
  var viewportWidth = window.innerWidth;
  var viewportHeight = window.innerHeight;

  for (var c = 0; c < candidates.length; c++) {
    var entry = candidates[c];
    var el = entry.el;
    var baseScore = entry.score;

    try {
      // Width: continuous scoring based on viewport coverage ratio
      var width = (el as HTMLElement).offsetWidth;
      if (width > 0 && viewportWidth > 0) {
        var widthRatio = width / viewportWidth;
        if (widthRatio > 0.3) baseScore += Math.round(widthRatio * 80);  // Up to ~80 at 100%
        if (widthRatio > 0.6) baseScore += 40;  // Bonus for majority-width
      } else if (width > 400) {
        baseScore += 60;  // Fallback for fixed-width containers
      }

      // Heading density
      var childCount = el.querySelectorAll('*').length;
      var headingCount = el.querySelectorAll('h2, h3, h4').length;
      if (childCount > 0) {
        var density = headingCount / childCount;
        if (density > 0.005 && density < 0.15) baseScore += 50;
      }

      // Link density scaling (graduated penalty instead of hard cutoff)
      var linkCount = el.querySelectorAll('a').length;
      if (childCount > 0) {
        var linkDensity = linkCount / childCount;
        baseScore *= Math.max(0.1, 1 - linkDensity);
      }

      // Text density scoring (from Boilerpipe research: TD < 10.5 = boilerplate)
      var textLength = 0;
      try { textLength = (el.textContent || '').length; } catch (_) {}
      var tagCount = Math.max(1, childCount);
      var textDensity = textLength / tagCount;
      if (textDensity > 10) baseScore += 50;   // Content-rich region
      if (textDensity < 3) baseScore -= 100;   // Tag-heavy, likely navigation/boilerplate

      // Vertical space: continuous scoring based on viewport coverage
      var height = (el as HTMLElement).offsetHeight;
      if (height > 0 && viewportHeight > 0) {
        var heightRatio = height / viewportHeight;
        if (heightRatio > 0.2) baseScore += Math.round(Math.min(heightRatio, 1.0) * 50);
      }

      // Horizontal position: penalize elements far from center (likely sidebars)
      if (width > 0 && viewportWidth > 0) {
        try {
          var rect = el.getBoundingClientRect();
          var centerX = rect.left + rect.width / 2;
          var pageCenter = viewportWidth / 2;
          var deviation = Math.abs(centerX - pageCenter) / viewportWidth;
          if (deviation > 0.35) baseScore -= 50;  // Far from center
        } catch (_) {}
      }

      // Penalize body/html
      if (el === document.body || el === document.documentElement) {
        baseScore -= 500;
      }
    } catch (_) { /* ignore property access errors */ }

    entry.score = baseScore;
  }

  // Step 5: Return best candidate
  candidates.sort(function(a, b) { return b.score - a.score; });
  if (candidates[0] && candidates[0].score > 0) {
    return { root: candidates[0].el, source: 'ancestor-score' };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect the main content region on the current page.
 * Returns { root, source } where root is the content container, or null for full-page fallback.
 * Result is cached by URL — free on repeated calls with the same location.href.
 */
export function detectContentRegion(): ContentRegionResult {
  var url = '';
  try { url = location.href; } catch (_) {}

  // Cache hit (same URL)
  if (url === _cachedUrl && _cachedResult) {
    // Verify cached root is still in the DOM (handles SPA full replacement)
    if (_cachedResult.root && !_cachedResult.root.isConnected) {
      _cachedResult = null;
      _cachedUrl = '';
    } else {
      return _cachedResult;
    }
  }

  // Layer 1: Semantic landmarks
  var result = detectByLandmark();
  if (result) {
    _cachedResult = { root: result.root, source: result.source };
    _cachedUrl = url;
    return _cachedResult;
  }

  // Layer 2: Class/ID heuristics
  result = detectByClassHeuristic();
  if (result) {
    _cachedResult = { root: result.root, source: result.source };
    _cachedUrl = url;
    return _cachedResult;
  }

  // Layer 3: Ancestor scoring
  result = detectByAncestorScoring();
  if (result) {
    _cachedResult = { root: result.root, source: result.source };
    _cachedUrl = url;
    return _cachedResult;
  }

  // Layer 4: Full-page fallback
  _cachedResult = { root: null, source: 'fallback' };
  _cachedUrl = url;
  return _cachedResult;
}

/**
 * Explicitly invalidate the content region cache.
 * Call this when the page undergoes a major structural change not triggered by URL change.
 */
export function invalidateContentRegionCache() {
  _cachedResult = null;
  _cachedUrl = '';
}
