
'use strict';

/**
 * Chatbot page detection and conversation-aware TOC building.
 *
 * On chatbot sites (ChatGPT, DeepSeek, Gemini, Claude, etc.), user messages
 * and assistant responses alternate. This module detects such pages and builds
 * TOC items where user prompts serve as virtual level-1 headings, with
 * assistant response headings nested beneath them (level + 1).
 *
 * Returns null for non-chatbot pages, so existing heading detection is unaffected.
 */

// ---------------------------------------------------------------------------
// Site configuration
// ---------------------------------------------------------------------------

/** @type {Array<{ match: function(string): boolean, userSelector: string, assistantSelector: string, headingContainer: string, sentinelSelector: string }>} */
var CHATBOT_SITES = [
  {
    // ChatGPT / chatgpt.com
    match: function(hostname) {
      return hostname === 'chatgpt.com' || hostname.endsWith('.chatgpt.com')
        || hostname === 'chat.openai.com' || hostname.endsWith('.chat.openai.com');
    },
    userSelector: '[data-message-author-role="user"]',
    assistantSelector: '[data-message-author-role="assistant"]',
    headingContainer: '.markdown-body, .prose, [class*="markdown"]',
    sentinelSelector: '[data-message-author-role]',
  },
  {
    // DeepSeek chat.deepseek.com
    match: function(hostname) {
      return hostname === 'chat.deepseek.com' || hostname.endsWith('.chat.deepseek.com');
    },
    userSelector: '.fbb737a4',
    assistantSelector: '.fbb737a4:not(:first-child)',
    headingContainer: '.markdown-body, .ds-markdown--block, [class*="markdown"]',
    sentinelSelector: '.fbb737a4',
  },
  {
    // Claude web claude.ai
    match: function(hostname) {
      return hostname === 'claude.ai' || hostname.endsWith('.claude.ai');
    },
    userSelector: '[data-testid="human-message"]',
    assistantSelector: '[data-testid="assistant-message"]',
    headingContainer: '.prose, [class*="markdown"]',
    sentinelSelector: '[data-testid="human-message"], [data-testid="assistant-message"]',
  },
  {
    // Gemini gemini.google.com
    match: function(hostname) {
      return hostname === 'gemini.google.com' || hostname.endsWith('.gemini.google.com');
    },
    userSelector: '.query-content, [data-turn-role="user"]',
    assistantSelector: '.response-container, [data-turn-role="model"]',
    headingContainer: '.markdown-body, [class*="markdown"]',
    sentinelSelector: '.query-content, .response-container, [data-turn-role]',
  },
  {
    // Kimi kimi.moonshot.cn
    match: function(hostname) {
      return hostname === 'kimi.moonshot.cn' || hostname.endsWith('.kimi.moonshot.cn')
        || hostname === 'kimi.ai' || hostname.endsWith('.kimi.ai');
    },
    userSelector: '.message-user, [class*="user-message"]',
    assistantSelector: '.message-assistant, [class*="assistant-message"]',
    headingContainer: '.markdown-body, [class*="markdown"]',
    sentinelSelector: '.message-user, .message-assistant',
  },
];

/** Maximum number of conversation turns to process */
var MAX_TURNS = 50;

/** Maximum text length for user prompt items */
var PROMPT_MAX_LEN = 120;

/** Maximum total TOC items */
var MAX_ITEMS = 400;

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect if the current page is a known chatbot site.
 * Returns the site configuration object, or null.
 */
function detectChatbotSite() {
  var hostname = '';
  try { hostname = location.hostname; } catch (_) { return null; }
  for (var i = 0; i < CHATBOT_SITES.length; i++) {
    if (CHATBOT_SITES[i].match(hostname)) return CHATBOT_SITES[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

/**
 * Extract display text from a user message element.
 * Tries to get the actual text content, trimmed to PROMPT_MAX_LEN.
 */
function extractUserText(el) {
  var text = '';
  try {
    // Try to find the main text block within the message
    // Many chatbot sites nest the text in a child element
    var textEl = el.querySelector('p, .whitespace-pre-wrap, [class*="text"]') || el;
    text = (textEl.textContent || '').trim();
  } catch (_) {
    try { text = (el.textContent || '').trim(); } catch (_2) { text = ''; }
  }
  // Normalize whitespace
  text = text.replace(/\s+/g, ' ');
  if (text.length > PROMPT_MAX_LEN) {
    text = text.substring(0, PROMPT_MAX_LEN) + '...';
  }
  return text;
}

/**
 * Check if an element is visible (lightweight check).
 */
function isVisible(el) {
  if (!el || !el.isConnected) return false;
  try {
    var w = el.offsetWidth;
    var h = el.offsetHeight;
    if (w === 0 || h === 0) return false;
    var style = window.getComputedStyle(el);
    if (!style || style.display === 'none') return false;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    var opacity = parseFloat(style.opacity);
    if (Number.isFinite(opacity) && opacity <= 0) return false;
  } catch (_) { return false; }
  return true;
}

/**
 * Get heading level from an element's tag name (1-6), default 2.
 */
function getHeadingLevel(el) {
  var match = el && /^H([1-6])$/.exec(el.tagName || '');
  return match ? parseInt(match[1], 10) : 2;
}

/**
 * Extract trimmed text from a heading element.
 */
function getHeadingText(el) {
  var text = '';
  try { text = (el.textContent || '').trim(); } catch (_) { return ''; }
  text = text.replace(/\s+/g, ' ');
  if (text.length > 200) text = text.substring(0, 200) + '...';
  return text;
}

// ---------------------------------------------------------------------------
// TOC building
// ---------------------------------------------------------------------------

/**
 * Build TOC items for a detected chatbot page.
 * User prompts become level-1 items, assistant headings get level + 1.
 */
function buildChatbotTocItems(site) {
  var userMessages = [];
  try { userMessages = Array.from(document.querySelectorAll(site.userSelector)); } catch (_) { return null; }

  if (userMessages.length === 0) return null;

  // Limit to most recent turns
  if (userMessages.length > MAX_TURNS) {
    userMessages = userMessages.slice(userMessages.length - MAX_TURNS);
  }

  var items = [];
  var itemId = 0;

  for (var i = 0; i < userMessages.length && items.length < MAX_ITEMS; i++) {
    var userEl = userMessages[i];
    if (!isVisible(userEl)) continue;

    var promptText = extractUserText(userEl);
    if (!promptText) continue;

    // Add user prompt as level-1 item
    items.push({
      id: 'toc-item-' + (itemId++),
      el: userEl,
      text: promptText,
      level: 1,
    });

    // Find headings in the nearest following assistant response
    var assistantEl = null;

    // Strategy 1: Look for the next sibling assistant element in document order
    // Walk forward from userEl through the DOM to find the next assistant message
    try {
      var allAssistants = document.querySelectorAll(site.assistantSelector);
      for (var a = 0; a < allAssistants.length; a++) {
        var cand = allAssistants[a];
        // Must come after userEl in document order
        var pos = userEl.compareDocumentPosition(cand);
        if (pos & 4) { // Node.DOCUMENT_POSITION_FOLLOWING
          if (!assistantEl) {
            assistantEl = cand;
          } else {
            // Pick the closest one
            var pos2 = assistantEl.compareDocumentPosition(cand);
            if (pos2 & 4) {
              // cand comes after current assistantEl, but might be closer
              // Check if cand is before current assistantEl
              // Actually we want the first assistant after userEl
              // assistantEl is already set to the first one, keep it
            }
          }
          break;
        }
      }
    } catch (_) {}

    if (!assistantEl) continue;

    // Find headings within the assistant response
    var headings = [];
    try {
      // First try to find headings within markdown containers
      var containers = assistantEl.querySelectorAll(site.headingContainer);
      if (containers.length > 0) {
        for (var c = 0; c < containers.length; c++) {
          var hList = containers[c].querySelectorAll('h1, h2, h3, h4, h5, h6');
          for (var h = 0; h < hList.length; h++) headings.push(hList[h]);
        }
      }
      // Fallback: search the whole assistant element
      if (headings.length === 0) {
        headings = Array.from(assistantEl.querySelectorAll('h1, h2, h3, h4, h5, h6'));
      }
    } catch (_) {}

    for (var j = 0; j < headings.length && items.length < MAX_ITEMS; j++) {
      var hEl = headings[j];
      if (!isVisible(hEl)) continue;

      var hText = getHeadingText(hEl);
      if (!hText) continue;

      var hLevel = getHeadingLevel(hEl);
      // Shift heading level: h2→level2, h3→level3, etc.
      // Since user prompt is level 1, headings become level 2+
      // h1 → level 2, h2 → level 3, h3 → level 4, etc.
      var itemLevel = Math.min(hLevel + 1, 6);

      items.push({
        id: 'toc-item-' + (itemId++),
        el: hEl,
        text: hText,
        level: itemLevel,
      });
    }
  }

  if (items.length === 0) return null;

  return {
    items: items,
    meta: {
      truncated: false,
      maxItems: MAX_ITEMS,
      totalCandidates: items.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * If the current page is a known chatbot site, build conversation-aware
 * TOC items. Returns null for non-chatbot pages (fall through to standard
 * heading detection).
 */
export function tryBuildChatbotTocItems() {
  var site = detectChatbotSite();
  if (!site) return null;
  return buildChatbotTocItems(site);
}

/**
 * Check if the current page is a known chatbot site.
 * Used by the DOM watcher to decide whether to use heading-only filtering.
 */
export function isChatbotPage() {
  return detectChatbotSite() !== null;
}

/**
 * Get the sentinel selector for the detected chatbot site.
 * Returns a CSS selector that matches chat message elements, used to
 * ensure the DOM watcher triggers rebuilds for non-heading mutations.
 */
export function getChatbotSentinelSelector() {
  var site = detectChatbotSite();
  return site ? site.sentinelSelector : null;
}
