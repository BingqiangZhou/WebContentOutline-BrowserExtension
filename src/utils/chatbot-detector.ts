
'use strict';

/**
 * Automatic chatbot page detection and conversation-aware TOC building.
 *
 * Uses a three-layer DOM analysis cascade instead of hardcoded URLs:
 *   Layer 1: ARIA semantic signals (role="log"/"feed", aria-label, aria-live)
 *   Layer 2: Data attribute signals (data-message-author-role, data-testid, data-turn-role,
 *            data-role, custom elements like ms-chat-turn)
 *   Layer 3: Structural heuristics (input + send + chat container + message blocks)
 *
 * Selector discovery dynamically extracts user/assistant selectors from detected elements.
 * A hint table provides fallback for known sites when auto-detection fails.
 *
 * URL-aware cache: reuses detection result across DOM rebuilds on the same URL,
 * auto-invalidates on SPA navigation.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of conversation turns to process */
var MAX_TURNS = 50;

/** Maximum text length for user prompt items */
var PROMPT_MAX_LEN = 120;

/** Maximum total TOC items */
var MAX_ITEMS = 400;

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** @type {{ userSelector: string, assistantSelector: string, headingContainer: string, sentinelSelector: string, source: string, _rootEl: Element|null }|null} */
var _cachedProfile = null;
var _cachedUrl = '';

/**
 * Invalidate the chatbot detection cache.
 * Called on URL changes to force re-detection on new pages.
 */
export function invalidateChatbotCache() {
  _cachedProfile = null;
  _cachedUrl = '';
}

// ---------------------------------------------------------------------------
// Hint table (fallback for known sites)
// ---------------------------------------------------------------------------

/**
 * Fallback hint table for sites where auto-detection may fail.
 * Auto-detection runs first; these are only used as a last resort.
 *
 * Each hint provides multiple candidate selectors (comma-separated) so that
 * if one breaks after a site update, others still work.
 */
var CHATBOT_HINTS = [
  {
    match: function(hostname) {
      return hostname === 'chatgpt.com' || hostname.endsWith('.chatgpt.com')
        || hostname === 'chat.openai.com' || hostname.endsWith('.chat.openai.com');
    },
    userSelector: '[data-message-author-role="user"]',
    assistantSelector: '[data-message-author-role="assistant"]',
    sentinelSelector: '[data-message-author-role]',
  },
  {
    // DeepSeek: hashed class names are unstable; use .ds-markdown heuristic via auto-detection.
    // Hint entries are last-resort only.
    match: function(hostname) {
      return hostname === 'chat.deepseek.com' || hostname.endsWith('.chat.deepseek.com');
    },
    userSelector: '.ds-chat-user-message, [data-role="user"]',
    assistantSelector: '.ds-chat-assistant-message, [data-role="assistant"]',
    sentinelSelector: '.ds-chat-user-message, .ds-chat-assistant-message, .ds-markdown',
  },
  {
    // Claude: uses data-testid="user-message" (not "human-message") as of 2026
    match: function(hostname) {
      return hostname === 'claude.ai' || hostname.endsWith('.claude.ai');
    },
    userSelector: '[data-testid="user-message"], [data-testid="human-message"]',
    assistantSelector: '[data-testid="assistant-message"], .row-start-2',
    sentinelSelector: '[data-testid="user-message"], [data-testid="human-message"], [data-testid="assistant-message"], .row-start-2',
  },
  {
    match: function(hostname) {
      return hostname === 'gemini.google.com' || hostname.endsWith('.gemini.google.com');
    },
    userSelector: '.query-content, [data-turn-role="user"], .user-query-bubble-with-background',
    assistantSelector: '.response-container, [data-turn-role="model"], .chat-turn-container.model',
    sentinelSelector: '.query-content, .response-container, [data-turn-role], ms-chat-turn, .chat-turn-container',
  },
  {
    match: function(hostname) {
      return hostname === 'kimi.moonshot.cn' || hostname.endsWith('.kimi.moonshot.cn')
        || hostname === 'kimi.ai' || hostname.endsWith('.kimi.ai');
    },
    userSelector: '.message-user, [class*="user-message"]',
    assistantSelector: '.message-assistant, [class*="assistant-message"]',
    sentinelSelector: '.message-user, .message-assistant',
  },
];

// ---------------------------------------------------------------------------
// Generic heading container selector (no per-site customization needed)
// ---------------------------------------------------------------------------

var GENERIC_HEADING_CONTAINER = '.markdown-body, .prose, [class*="markdown"], [class*="ds-markdown"], .standard-markdown, .progressive-markdown, message-content';

// ---------------------------------------------------------------------------
// Layer 1: ARIA semantic detection
// ---------------------------------------------------------------------------

/**
 * Check for ARIA semantic signals that indicate a chat interface.
 * Returns a chat container element if found, or null.
 */
function detectByAria() {
  // role="log" is the W3C ARIA23 standard for chat interfaces
  try {
    var logEl = document.querySelector('[role="log"]');
    if (logEl) return { container: logEl, source: 'aria' };
  } catch (_) {}

  // role="feed" — used by some chatbot platforms for message feeds
  try {
    var feedEl = document.querySelector('[role="feed"]');
    if (feedEl && feedEl.children && feedEl.children.length >= 2) {
      return { container: feedEl, source: 'aria' };
    }
  } catch (_) {}

  // aria-label containing chat/conversation keywords
  try {
    var candidates = document.querySelectorAll('[aria-label]');
    for (var i = 0; i < candidates.length; i++) {
      var label = (candidates[i].getAttribute('aria-label') || '').toLowerCase();
      if ((label.indexOf('chat') >= 0 || label.indexOf('conversation') >= 0 || label.indexOf('message') >= 0)
        && candidates[i].children && candidates[i].children.length >= 2) {
        return { container: candidates[i], source: 'aria' };
      }
    }
  } catch (_) {}

  return null;
}

// ---------------------------------------------------------------------------
// Layer 2: Data attribute detection
// ---------------------------------------------------------------------------

/** Data-attribute selectors that signal chat messages (need ≥ 1 matching element) */
var DATA_ATTR_SIGNALS = [
  '[data-message-author-role]',
  '[data-testid^="conversation-turn"]',
  '[data-testid^="conversation"]',
  '[data-turn-role]',
  'ms-chat-turn',
  '[data-testid*="chat-turn"]',
  '[data-testid*="message-turn"]',
  '[data-role="user"]',
  '[data-role="assistant"]',
  '[data-author-role]',
  '[data-chat-role]',
];

/**
 * Check for data attribute signals that indicate chat messages.
 * Returns a result object if found, or null.
 */
function detectByDataAttrs() {
  for (var i = 0; i < DATA_ATTR_SIGNALS.length; i++) {
    var sel = DATA_ATTR_SIGNALS[i];
    try {
      var elements = document.querySelectorAll(sel);
      if (elements.length >= 2) {
        var container = findCommonAncestor(elements[0], elements[Math.min(elements.length - 1, 2)]);
        return { container: container, source: 'data-attr', signalSelector: sel };
      }
    } catch (_) {}
  }
  return null;
}

// ---------------------------------------------------------------------------
// Layer 3: Structural heuristics
// ---------------------------------------------------------------------------

/**
 * Structural heuristic scoring for chat page detection.
 * Checks for: message container, repeated message blocks, input area, send button.
 *
 * Two tiers:
 *   - score >= 3: high confidence (full message content exists)
 *   - score >= 2 with input+send: "chat landing page" (no messages yet, but clearly a chat UI)
 */
function detectByStructure() {
  var hasMessageContainer = false;
  var hasRepeatedBlocks = false;
  var hasInputArea = false;
  var hasSendButton = false;

  // 1. Message container: role="log"/"feed" or class/id containing chat/message/conversation
  try {
    var containerSelectors = [
      '[role="log"]', '[role="feed"]',
      '[class*="chat"]', '[class*="message-list"]', '[class*="conversation"]',
      '[class*="virtual-list"]',
      '[id*="chat"]', '[id*="message"]', '[id*="conversation"]',
    ];
    for (var i = 0; i < containerSelectors.length; i++) {
      var el = document.querySelector(containerSelectors[i]);
      if (el && el.children && el.children.length >= 2) {
        hasMessageContainer = true;
        break;
      }
    }
  } catch (_) {}

  // 2. Repeated message-like blocks (≥ 3 similar siblings)
  try {
    var blockSelectors = [
      '[data-message-author-role]',
      '[data-turn-role]',
      '[role="article"]',
      '[class*="message-content"]',
      '[class*="chat-message"]',
      '[class*="ds-markdown"]',
      '.ds-markdown',
      'article',
    ];
    for (var j = 0; j < blockSelectors.length; j++) {
      var blocks = document.querySelectorAll(blockSelectors[j]);
      if (blocks.length >= 3) {
        hasRepeatedBlocks = true;
        break;
      }
    }
  } catch (_) {}

  // 3. Input area: textarea, contenteditable, or text input with chat signals
  try {
    var textareas = document.querySelectorAll('textarea');
    var contentEditables = document.querySelectorAll('[contenteditable="true"], [contenteditable="plaintext-only"]');
    var chatInputs = document.querySelectorAll('input[type="text"]');
    hasInputArea = textareas.length > 0 || contentEditables.length > 0
      || (chatInputs.length > 0 && hasChatSignalsNearby(chatInputs));
  } catch (_) {}

  // 4. Send button: aria-label, data-testid, or class containing "send"
  try {
    var sendButtons = document.querySelectorAll(
      'button[aria-label*="Send" i], button[aria-label*="send" i], ' +
      '[data-testid*="send" i], [class*="send-button"], ' +
      'button[type="submit"]'
    );
    // Filter: only count submit buttons inside or near a chat input area
    if (sendButtons.length > 0) {
      hasSendButton = true;
    }
  } catch (_) {}

  var score = (hasMessageContainer ? 1 : 0)
    + (hasRepeatedBlocks ? 1 : 0)
    + (hasInputArea ? 1 : 0)
    + (hasSendButton ? 1 : 0);

  // High confidence: full message content exists
  if (score >= 3) {
    return { container: null, source: 'structural' };
  }

  // Chat landing page: has input + send but no messages yet
  if (score >= 2 && hasInputArea && hasSendButton) {
    return { container: null, source: 'structural-landing' };
  }

  return null;
}

/**
 * Check if any of the text input elements has chat-related signals nearby.
 */
function hasChatSignalsNearby(inputs) {
  for (var i = 0; i < inputs.length; i++) {
    var el = inputs[i];
    try {
      var placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
      if (placeholder.indexOf('message') >= 0 || placeholder.indexOf('ask') >= 0
        || placeholder.indexOf('chat') >= 0 || placeholder.indexOf('type') >= 0
        || placeholder.indexOf('prompt') >= 0) {
        return true;
      }
    } catch (_) {}
    try {
      var ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      if (ariaLabel.indexOf('message') >= 0 || ariaLabel.indexOf('chat') >= 0
        || ariaLabel.indexOf('prompt') >= 0) {
        return true;
      }
    } catch (_) {}
    try {
      var parent = el.parentElement;
      for (var depth = 0; depth < 3 && parent; depth++) {
        var parentClass = (parent.getAttribute('class') || '').toLowerCase();
        if (parentClass.indexOf('chat') >= 0 || parentClass.indexOf('input') >= 0
          || parentClass.indexOf('prompt') >= 0) {
          return true;
        }
        parent = parent.parentElement;
      }
    } catch (_) {}
  }
  return false;
}

// ---------------------------------------------------------------------------
// Selector discovery
// ---------------------------------------------------------------------------

/**
 * Strategy A: Explicit role attributes.
 * Checks multiple attribute patterns for user/assistant role identification.
 */
function discoverByExplicitRole() {
  // data-message-author-role="user" / "assistant" (ChatGPT, and others)
  try {
    var userEls = document.querySelectorAll('[data-message-author-role="user"]');
    var assistantEls = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (userEls.length >= 1 && assistantEls.length >= 1) {
      return {
        userSelector: '[data-message-author-role="user"]',
        assistantSelector: '[data-message-author-role="assistant"]',
        sentinelSelector: '[data-message-author-role]',
      };
    }
  } catch (_) {}

  // data-turn-role="user" / "model" (Gemini)
  try {
    var turnUser = document.querySelectorAll('[data-turn-role="user"]');
    var turnModel = document.querySelectorAll('[data-turn-role="model"]');
    if (turnUser.length >= 1 && turnModel.length >= 1) {
      return {
        userSelector: '[data-turn-role="user"]',
        assistantSelector: '[data-turn-role="model"]',
        sentinelSelector: '[data-turn-role]',
      };
    }
  } catch (_) {}

  // data-role="user" / "assistant" (some frameworks)
  try {
    var roleUser = document.querySelectorAll('[data-role="user"]');
    var roleAssistant = document.querySelectorAll('[data-role="assistant"]');
    if (roleUser.length >= 1 && roleAssistant.length >= 1) {
      return {
        userSelector: '[data-role="user"]',
        assistantSelector: '[data-role="assistant"]',
        sentinelSelector: '[data-role]',
      };
    }
  } catch (_) {}

  // data-author-role (alternative attribute name)
  try {
    var authorUser = document.querySelectorAll('[data-author-role="user"]');
    var authorAssistant = document.querySelectorAll('[data-author-role="assistant"]');
    if (authorUser.length >= 1 && authorAssistant.length >= 1) {
      return {
        userSelector: '[data-author-role="user"]',
        assistantSelector: '[data-author-role="assistant"]',
        sentinelSelector: '[data-author-role]',
      };
    }
  } catch (_) {}

  return null;
}

/**
 * Strategy B: testid pattern matching.
 * Look for data-testid containing "user"/"human" and "assistant"/"model".
 */
function discoverByTestId() {
  var userPatterns = [
    '[data-testid*="user-message"]',
    '[data-testid*="human-message"]',
    '[data-testid*="conversation-turn-user"]',
  ];
  var assistantPatterns = [
    '[data-testid*="assistant-message"]',
    '[data-testid*="model-message"]',
    '[data-testid*="conversation-turn-assistant"]',
  ];

  var userSel = null;
  var assistantSel = null;

  for (var i = 0; i < userPatterns.length && !userSel; i++) {
    try {
      if (document.querySelector(userPatterns[i])) {
        userSel = userPatterns[i];
      }
    } catch (_) {}
  }

  for (var j = 0; j < assistantPatterns.length && !assistantSel; j++) {
    try {
      if (document.querySelector(assistantPatterns[j])) {
        assistantSel = assistantPatterns[j];
      }
    } catch (_) {}
  }

  if (userSel && assistantSel) {
    return {
      userSelector: userSel,
      assistantSelector: assistantSel,
      sentinelSelector: userSel + ', ' + assistantSel,
    };
  }

  return null;
}

/**
 * Strategy C: class name pattern matching.
 * Look for classes containing user/assistant role patterns.
 */
function discoverByClassPattern() {
  var userPatterns = [
    '[class*="user-message"]',
    '[class*="human-message"]',
    '[class*="message-user"]',
    '[class*="chat-user"]',
    '[class*="msg-user"]',
    '.message-user',
  ];
  var assistantPatterns = [
    '[class*="assistant-message"]',
    '[class*="model-message"]',
    '[class*="message-assistant"]',
    '[class*="chat-assistant"]',
    '[class*="chat-bot"]',
    '[class*="msg-assistant"]',
    '.message-assistant',
  ];

  var userSel = null;
  var assistantSel = null;

  for (var i = 0; i < userPatterns.length && !userSel; i++) {
    try {
      if (document.querySelector(userPatterns[i])) {
        userSel = userPatterns[i];
      }
    } catch (_) {}
  }

  for (var j = 0; j < assistantPatterns.length && !assistantSel; j++) {
    try {
      if (document.querySelector(assistantPatterns[j])) {
        assistantSel = assistantPatterns[j];
      }
    } catch (_) {}
  }

  if (userSel && assistantSel) {
    return {
      userSelector: userSel,
      assistantSelector: assistantSel,
      sentinelSelector: userSel + ', ' + assistantSel,
    };
  }

  return null;
}

/**
 * Strategy D: Gemini web component analysis.
 * Gemini uses custom web components (ms-chat-turn) with .chat-turn-container.model/.user classes.
 */
function discoverByGeminiWebComponent() {
  try {
    var turns = document.querySelectorAll('ms-chat-turn');
    if (turns.length < 1) return null;

    var userTurns = document.querySelectorAll('.chat-turn-container.user, .user-query-bubble-with-background');
    var modelTurns = document.querySelectorAll('.chat-turn-container.model, .response-container');

    if (userTurns.length >= 1 || modelTurns.length >= 1) {
      var userSel = userTurns.length > 0
        ? '.chat-turn-container.user, .user-query-bubble-with-background, .query-content'
        : '.query-content, [data-turn-role="user"]';
      var assistantSel = modelTurns.length > 0
        ? '.chat-turn-container.model, .response-container'
        : '[data-turn-role="model"]';
      return {
        userSelector: userSel,
        assistantSelector: assistantSel,
        sentinelSelector: 'ms-chat-turn, .chat-turn-container, [data-turn-role]',
      };
    }
  } catch (_) {}

  return null;
}

/**
 * Strategy E: DeepSeek .ds-markdown heuristic.
 * DeepSeek uses hashed class names that change with each build.
 * Heuristic: elements containing .ds-markdown children are assistant responses.
 */
function discoverByDeepSeekMarkdown() {
  try {
    var dsMarkdowns = document.querySelectorAll('.ds-markdown');
    if (dsMarkdowns.length < 1) return null;

    // The parent chain of a .ds-markdown element is the assistant response container.
    // Walk up to find a reasonable container (typically 2-4 levels up).
    var firstMarkdown = dsMarkdowns[0];
    var assistantContainer = firstMarkdown;
    for (var up = 0; up < 4 && assistantContainer.parentElement; up++) {
      assistantContainer = assistantContainer.parentElement;
    }

    // For user messages: look for elements in the same parent that do NOT contain .ds-markdown
    // and have visible text content. We can't generate a reliable CSS selector for this,
    // so we return a sentinel-only result that lets the hint table handle selectors.
    // But we CAN detect that this is a DeepSeek-like page and return a minimal signal.
    return {
      userSelector: '',  // Will be filled by hint fallback
      assistantSelector: '.ds-markdown',
      sentinelSelector: '.ds-markdown, .ds-think-content',
      _needsUserSelectorHint: true,
    };
  } catch (_) {}

  return null;
}

/**
 * Strategy F: ARIA log child analysis.
 * For [role="log"] containers, analyze direct children for role indicators.
 */
function discoverByAriaLogAnalysis() {
  var logEl = null;
  try { logEl = document.querySelector('[role="log"]'); } catch (_) {}
  if (!logEl || !logEl.children || logEl.children.length < 2) return null;

  var children = Array.prototype.slice.call(logEl.children);

  // Try to classify children by data attributes
  var userGroup = [];
  var assistantGroup = [];

  for (var i = 0; i < children.length; i++) {
    var child = children[i];
    var classified = false;

    // Check data-message-author-role
    try {
      var role = child.getAttribute('data-message-author-role');
      if (role === 'user' || role === 'human') { userGroup.push(child); classified = true; }
      else if (role === 'assistant' || role === 'model' || role === 'bot') { assistantGroup.push(child); classified = true; }
    } catch (_) {}

    if (classified) continue;

    // Check data-testid
    try {
      var testId = (child.getAttribute('data-testid') || '').toLowerCase();
      if (testId.indexOf('user') >= 0 || testId.indexOf('human') >= 0) {
        userGroup.push(child); classified = true;
      } else if (testId.indexOf('assistant') >= 0 || testId.indexOf('model') >= 0 || testId.indexOf('bot') >= 0) {
        assistantGroup.push(child); classified = true;
      }
    } catch (_) {}

    if (classified) continue;

    // Check data-role
    try {
      var dataRole = (child.getAttribute('data-role') || '').toLowerCase();
      if (dataRole === 'user' || dataRole === 'human') { userGroup.push(child); classified = true; }
      else if (dataRole === 'assistant' || dataRole === 'model' || dataRole === 'bot') { assistantGroup.push(child); classified = true; }
    } catch (_) {}

    if (classified) continue;

    // Check class names
    try {
      var cls = (child.getAttribute('class') || '').toLowerCase();
      if (cls.indexOf('user') >= 0 || cls.indexOf('human') >= 0) {
        userGroup.push(child); classified = true;
      } else if (cls.indexOf('assistant') >= 0 || cls.indexOf('model') >= 0 || cls.indexOf('bot') >= 0) {
        assistantGroup.push(child); classified = true;
      }
    } catch (_) {}
  }

  if (userGroup.length >= 1 && assistantGroup.length >= 1) {
    var userSel = deriveSelectorFromElements(userGroup, 'user');
    var assistantSel = deriveSelectorFromElements(assistantGroup, 'assistant');

    if (userSel && assistantSel) {
      return {
        userSelector: userSel,
        assistantSelector: assistantSel,
        sentinelSelector: userSel + ', ' + assistantSel,
      };
    }
  }

  return null;
}

/**
 * Derive a CSS selector from a group of elements.
 * Tries to find a common attribute pattern.
 */
function deriveSelectorFromElements(elements, roleHint) {
  if (!elements || elements.length === 0) return null;

  var first = elements[0];

  // Try data-message-author-role
  try {
    var role = first.getAttribute('data-message-author-role');
    if (role) return '[data-message-author-role="' + role + '"]';
  } catch (_) {}

  // Try data-testid
  try {
    var testId = first.getAttribute('data-testid');
    if (testId) {
      var allMatch = true;
      for (var t = 1; t < elements.length; t++) {
        if (elements[t].getAttribute('data-testid') !== testId) { allMatch = false; break; }
      }
      if (allMatch) return '[data-testid="' + testId + '"]';
      // Partial match: use substring selector
      if (testId.length > 3) return '[data-testid*="' + testId + '"]';
    }
  } catch (_) {}

  // Try data-turn-role
  try {
    var turnRole = first.getAttribute('data-turn-role');
    if (turnRole) return '[data-turn-role="' + turnRole + '"]';
  } catch (_) {}

  // Try data-role
  try {
    var dataRole = first.getAttribute('data-role');
    if (dataRole) return '[data-role="' + dataRole + '"]';
  } catch (_) {}

  // Fallback: class-based pattern with role hint
  try {
    var cls = first.getAttribute('class') || '';
    var clsParts = cls.split(/\s+/);
    for (var i = 0; i < clsParts.length; i++) {
      if (clsParts[i] && clsParts[i].indexOf(roleHint) >= 0) {
        return '[class*="' + clsParts[i] + '"]';
      }
    }
  } catch (_) {}

  return null;
}

/**
 * Run selector discovery cascade.
 * Returns { userSelector, assistantSelector, sentinelSelector } or null.
 */
function discoverSelectors() {
  var result;

  result = discoverByExplicitRole();
  if (result) return result;

  result = discoverByTestId();
  if (result) return result;

  result = discoverByGeminiWebComponent();
  if (result) return result;

  result = discoverByDeepSeekMarkdown();
  if (result) return result;

  result = discoverByClassPattern();
  if (result) return result;

  result = discoverByAriaLogAnalysis();
  if (result) return result;

  return null;
}

// ---------------------------------------------------------------------------
// Hint table fallback
// ---------------------------------------------------------------------------

/**
 * Try to match current hostname against the hint table and validate selectors.
 * Only used when auto-detection fails or returns incomplete selectors.
 */
function tryHintFallback(needsUserSelectorOnly) {
  var hostname = '';
  try { hostname = location.hostname; } catch (_) { return null; }

  for (var i = 0; i < CHATBOT_HINTS.length; i++) {
    var hint = CHATBOT_HINTS[i];
    try {
      if (hint.match(hostname)) {
        // If we only need a user selector (DeepSeek case), validate differently
        if (needsUserSelectorOnly) {
          var testEl = document.querySelector(hint.userSelector);
          if (testEl) {
            return {
              userSelector: hint.userSelector,
              assistantSelector: hint.assistantSelector,
              sentinelSelector: hint.sentinelSelector,
              source: 'hint',
            };
          }
        } else {
          // Full validation: check that at least one user message exists
          var testEl2 = document.querySelector(hint.userSelector);
          if (testEl2) {
            return {
              userSelector: hint.userSelector,
              assistantSelector: hint.assistantSelector,
              sentinelSelector: hint.sentinelSelector,
              source: 'hint',
            };
          }
        }
      }
    } catch (_) {}
  }

  return null;
}

// ---------------------------------------------------------------------------
// Utility: find common ancestor of two elements
// ---------------------------------------------------------------------------

function findCommonAncestor(a, b) {
  if (!a || !b) return null;
  try {
    var ancestors = new Set();
    var walk = a;
    while (walk) {
      ancestors.add(walk);
      walk = walk.parentElement;
    }
    walk = b;
    while (walk) {
      if (ancestors.has(walk)) return walk;
      walk = walk.parentElement;
    }
  } catch (_) {}
  return document.body;
}

// ---------------------------------------------------------------------------
// Core detection pipeline
// ---------------------------------------------------------------------------

/**
 * Detect chat page and discover selectors.
 * Returns a profile object or null.
 * Uses URL-based cache.
 */
function detectChatPage() {
  // Check cache
  var currentUrl = '';
  try { currentUrl = location.href; } catch (_) {}

  if (_cachedProfile && _cachedUrl === currentUrl) {
    // Validate cached root element is still in the DOM
    if (!_cachedProfile._rootEl || _cachedProfile._rootEl.isConnected) {
      return _cachedProfile;
    }
    // Cache stale — clear
    _cachedProfile = null;
    _cachedUrl = '';
  }

  // --- Page detection cascade ---

  var detectionResult = null;

  // Layer 1: ARIA semantic signals
  try { detectionResult = detectByAria(); } catch (_) {}

  // Layer 2: Data attribute signals
  if (!detectionResult) {
    try { detectionResult = detectByDataAttrs(); } catch (_) {}
  }

  // Layer 3: Structural heuristics
  if (!detectionResult) {
    try { detectionResult = detectByStructure(); } catch (_) {}
  }

  // --- Selector discovery ---

  var selectors = null;

  if (detectionResult) {
    // Auto-detection confirmed chat page; discover selectors
    selectors = discoverSelectors();

    // If discovery returned incomplete selectors (e.g., DeepSeek heuristic found
    // assistant via .ds-markdown but couldn't find user), try hint for the missing part
    if (selectors && selectors._needsUserSelectorHint) {
      var hintResult = null;
      try { hintResult = tryHintFallback(true); } catch (_) {}
      if (hintResult && hintResult.userSelector) {
        selectors.userSelector = hintResult.userSelector;
        selectors.sentinelSelector = selectors.sentinelSelector + ', ' + hintResult.sentinelSelector;
        selectors._needsUserSelectorHint = false;
      } else {
        // Hint also failed — can't build TOC without user selector
        selectors = null;
      }
    }
  }

  // --- Hint fallback (when auto-detection found selectors or failed entirely) ---
  if (!selectors) {
    try { selectors = tryHintFallback(false); } catch (_) {}
  }

  if (!selectors) return null;

  // Build and cache profile
  var profile = {
    userSelector: selectors.userSelector,
    assistantSelector: selectors.assistantSelector,
    headingContainer: GENERIC_HEADING_CONTAINER,
    sentinelSelector: selectors.sentinelSelector,
    source: selectors.source || (detectionResult ? detectionResult.source : 'hint'),
    _rootEl: (detectionResult && detectionResult.container) || null,
  };

  _cachedProfile = profile;
  _cachedUrl = currentUrl;

  return profile;
}

// ---------------------------------------------------------------------------
// Text extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract display text from a user message element.
 */
function extractUserText(el) {
  var text = '';
  try {
    var textEl = el.querySelector('p, .whitespace-pre-wrap, [class*="text"]') || el;
    text = (textEl.textContent || '').trim();
  } catch (_) {
    try { text = (el.textContent || '').trim(); } catch (_2) { text = ''; }
  }
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
function buildChatbotTocItems(profile) {
  var userMessages = [];
  try { userMessages = Array.from(document.querySelectorAll(profile.userSelector)); } catch (_) { return null; }

  if (userMessages.length === 0) return null;

  // Deduplicate user messages by element reference (a single DOM element may match
  // multiple selector paths, e.g. when hint selectors overlap with auto-detected ones)
  var seenUserEls = new Set();
  var uniqueUserMessages = [];
  for (var d = 0; d < userMessages.length; d++) {
    if (!seenUserEls.has(userMessages[d])) {
      seenUserEls.add(userMessages[d]);
      uniqueUserMessages.push(userMessages[d]);
    }
  }
  userMessages = uniqueUserMessages;

  // Limit to most recent turns
  if (userMessages.length > MAX_TURNS) {
    userMessages = userMessages.slice(userMessages.length - MAX_TURNS);
  }

  var items = [];
  var itemId = 0;
  var seenEls = new Set();

  // Query assistant messages ONCE, then use a forward cursor to match
  // each user message to the next assistant message in document order.
  var allAssistants = [];
  try { allAssistants = Array.from(document.querySelectorAll(profile.assistantSelector)); } catch (_) {}
  var assistantIdx = 0; // forward cursor into allAssistants

  for (var i = 0; i < userMessages.length && items.length < MAX_ITEMS; i++) {
    var userEl = userMessages[i];
    if (!isVisible(userEl)) continue;
    if (seenEls.has(userEl)) continue;

    var promptText = extractUserText(userEl);
    if (!promptText) continue;

    // Add user prompt as level-1 item
    seenEls.add(userEl);
    items.push({
      id: 'toc-item-' + (itemId++),
      el: userEl,
      text: promptText,
      level: 1,
    });

    // Find nearest following assistant message using forward cursor — O(N+M) total
    var assistantEl = null;
    while (assistantIdx < allAssistants.length) {
      var cand = allAssistants[assistantIdx];
      // If this assistant is before or at the user message, advance past it
      try {
        var pos = userEl.compareDocumentPosition(cand);
        if (pos & 2) { // DOCUMENT_POSITION_PRECEDING — assistant is before user, skip
          assistantIdx++;
          continue;
        }
        if (pos & 4) { // DOCUMENT_POSITION_FOLLOWING — this is the next assistant
          assistantEl = cand;
          // Don't increment assistantIdx — next user message might also match
          break;
        }
      } catch (_) { assistantIdx++; continue; }
      assistantIdx++;
    }

    if (!assistantEl) continue;

    // Find headings within the assistant response
    var headings = [];
    try {
      // First try to find headings within markdown containers
      var containers = assistantEl.querySelectorAll(profile.headingContainer);
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
      if (seenEls.has(hEl)) continue;

      var hText = getHeadingText(hEl);
      if (!hText) continue;

      var hLevel = getHeadingLevel(hEl);
      var itemLevel = Math.min(hLevel + 1, 6);

      seenEls.add(hEl);
      items.push({
        id: 'toc-item-' + (itemId++),
        el: hEl,
        text: hText,
        level: itemLevel,
      });
    }
  }

  if (items.length === 0) return null;

  // Deduplicate items with identical text (e.g. same heading text repeated
  // across multiple markdown containers or mirrored sidebar content).
  if (items.length > 1) {
    var seenTexts = new Set();
    var dedupedItems = [];
    for (var di = 0; di < items.length; di++) {
      var tKey = items[di].text;
      if (!seenTexts.has(tKey)) {
        seenTexts.add(tKey);
        dedupedItems.push(items[di]);
      }
    }
    if (dedupedItems.length < items.length) {
      items = dedupedItems;
    }
  }

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
 * If the current page is detected as a chatbot page (via DOM analysis),
 * build conversation-aware TOC items.
 * Returns null for non-chatbot pages (fall through to standard heading detection).
 */
export function tryBuildChatbotTocItems() {
  var profile = detectChatPage();
  if (!profile) return null;
  return buildChatbotTocItems(profile);
}

/**
 * Check if the current page is detected as a chatbot page.
 * Used by the DOM watcher to decide whether to use heading-only filtering.
 */
export function isChatbotPage() {
  return detectChatPage() !== null;
}

/**
 * Get the sentinel selector for the detected chatbot page.
 * Returns a CSS selector that matches chat message elements, used to
 * ensure the DOM watcher triggers rebuilds for non-heading mutations.
 */
export function getChatbotSentinelSelector() {
  var profile = detectChatPage();
  return profile ? profile.sentinelSelector : null;
}
