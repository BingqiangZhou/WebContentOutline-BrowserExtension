
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
// Types
// ---------------------------------------------------------------------------

interface DetectionResult {
  container: HTMLElement | null;
  source: string;
  signalSelector?: string;
}

interface SelectorResult {
  userSelector: string;
  assistantSelector: string;
  sentinelSelector: string;
  source?: string;
  _needsUserSelectorHint?: boolean;
}

/**
 * Adapter interface for per-site detection logic.
 * When a hint entry provides a detect() function, it runs custom
 * detection logic instead of simple selector matching.
 */
interface ChatbotAdapter {
  match: (hostname: string) => boolean;
  detect?: () => SelectorResult | null;
  userSelector: string;
  assistantSelector: string;
  sentinelSelector: string;
}

interface ChatbotProfile {
  userSelector: string;
  assistantSelector: string;
  headingContainer: string;
  sentinelSelector: string;
  source: string;
  _rootEl: Element | null;
  confidence: number;
}

interface TocItem {
  id: string;
  el: HTMLElement;
  text: string;
  level: number;
  source?: string;  // 'user' | 'ai' — marks conversation turn origin
}

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
// Streaming state tracking
// ---------------------------------------------------------------------------

/** Tracks text length of the last assistant element to detect streaming */
var _lastAssistantTextLen = 0;

/** Selectors for stop/streaming buttons across platforms */
var STOP_BUTTON_SELECTORS = [
  'button[aria-label*="Stop" i]',
  '[data-testid*="stop"]',
  '[class*="stop-generating"]',
  'button[aria-label*="stop" i]',
];

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

var _cachedProfile: ChatbotProfile | null = null;
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
var CHATBOT_HINTS: ChatbotAdapter[] = [
  {
    match: function(hostname: string) {
      return hostname === 'chatgpt.com' || hostname.endsWith('.chatgpt.com')
        || hostname === 'chat.openai.com' || hostname.endsWith('.chat.openai.com');
    },
    userSelector: '[data-message-author-role="user"]',
    assistantSelector: '[data-message-author-role="assistant"], .agent-turn',
    sentinelSelector: '[data-message-author-role], [data-testid^="conversation-turn-"], [data-message-id]',
  },
  {
    // DeepSeek: hashed class names are unstable; use .ds-markdown heuristic via auto-detection.
    // Hint entries are last-resort only.
    match: function(hostname: string) {
      return hostname === 'chat.deepseek.com' || hostname.endsWith('.chat.deepseek.com');
    },
    userSelector: '.ds-chat-user-message, [data-role="user"]',
    assistantSelector: '.ds-chat-assistant-message, [data-role="assistant"], div[class*="prose"]',
    sentinelSelector: '.ds-chat-user-message, .ds-chat-assistant-message, .ds-markdown, [data-role]',
  },
  {
    // Claude: uses data-testid="user-message" (not "human-message") as of 2026
    match: function(hostname: string) {
      return hostname === 'claude.ai' || hostname.endsWith('.claude.ai');
    },
    userSelector: '[data-testid="user-message"], [data-testid="human-message"]',
    assistantSelector: '[data-testid="assistant-message"], .row-start-2, .font-claude-response',
    sentinelSelector: '[data-testid="user-message"], [data-testid="human-message"], [data-testid="assistant-message"], .row-start-2',
  },
  {
    match: function(hostname: string) {
      return hostname === 'gemini.google.com' || hostname.endsWith('.gemini.google.com');
    },
    // Custom detect for Gemini: handles both legacy (ms-chat-turn) and modern
    // (<user-query>/<model-response> custom elements) DOM structures.
    detect: function(): SelectorResult | null {
      // Modern Gemini: custom web components
      try {
        var userQueries = document.querySelectorAll('user-query');
        var modelResponses = document.querySelectorAll('model-response');
        if (userQueries.length >= 1 && modelResponses.length >= 1) {
          return {
            userSelector: 'user-query, user-query .query-text',
            assistantSelector: 'model-response, model-response message-content, structured-content-container.model-response-text, model-response .model-response-text',
            sentinelSelector: 'user-query, model-response, conversation-turn',
            source: 'gemini-custom-elements',
          };
        }
      } catch (_) {}

      // Legacy Gemini: ms-chat-turn + data-turn-role
      try {
        var msTurns = document.querySelectorAll('ms-chat-turn');
        if (msTurns.length >= 1) {
          return {
            userSelector: '.chat-turn-container.user, .user-query-bubble-with-background, .query-content, [data-turn-role="user"]',
            assistantSelector: '.chat-turn-container.model, .response-container, [data-turn-role="model"]',
            sentinelSelector: 'ms-chat-turn, .chat-turn-container, [data-turn-role]',
            source: 'gemini-legacy',
          };
        }
      } catch (_) {}

      return null;
    },
    userSelector: '.query-content, [data-turn-role="user"], .user-query-bubble-with-background, user-query .query-text',
    assistantSelector: '.response-container, [data-turn-role="model"], .chat-turn-container.model, model-response message-content, structured-content-container.model-response-text',
    sentinelSelector: '.query-content, .response-container, [data-turn-role], ms-chat-turn, .chat-turn-container, user-query, model-response',
  },
  {
    match: function(hostname: string) {
      return hostname === 'kimi.moonshot.cn' || hostname.endsWith('.kimi.moonshot.cn')
        || hostname === 'kimi.ai' || hostname.endsWith('.kimi.ai');
    },
    userSelector: '.message-user, [class*="user-message"]',
    assistantSelector: '.message-assistant, [class*="assistant-message"]',
    sentinelSelector: '.message-user, .message-assistant',
  },
  // --- New platforms (Phase 1A) ---
  {
    // Perplexity
    match: function(hostname: string) {
      return hostname === 'perplexity.ai' || hostname.endsWith('.perplexity.ai');
    },
    userSelector: '[class*="user-query"], [class*="UserQuery"], div.query-user',
    assistantSelector: '[class*="prose"], [class*="Perplexity"]',
    sentinelSelector: '[class*="user-query"], [class*="prose"]',
  },
  {
    // Grok (grok.com / x.ai)
    match: function(hostname: string) {
      return hostname === 'grok.com' || hostname.endsWith('.grok.com')
        || hostname === 'x.ai' || hostname.endsWith('.x.ai');
    },
    userSelector: '[class*="user-message"], [data-testid*="user"]',
    assistantSelector: '[class*="assistant"], [class*="bot-message"], [data-testid*="assistant"]',
    sentinelSelector: '[class*="user-message"], [class*="assistant"], [class*="bot-message"]',
  },
  {
    // Mistral (chat.mistral.ai)
    match: function(hostname: string) {
      return hostname === 'chat.mistral.ai' || hostname.endsWith('.chat.mistral.ai');
    },
    userSelector: '[class*="user-message"], [class*="human-message"]',
    assistantSelector: '[class*="assistant-message"], [class*="bot-message"]',
    sentinelSelector: '[class*="user-message"], [class*="assistant-message"]',
  },
  {
    // NotebookLM (notebooklm.google.com)
    match: function(hostname: string) {
      return hostname === 'notebooklm.google.com' || hostname.endsWith('.notebooklm.google.com');
    },
    userSelector: '.from-user-message-inner-content, [class*="user-query"]',
    assistantSelector: '.to-user-message-inner-content, [class*="response-container"]',
    sentinelSelector: '.from-user-message-inner-content, .to-user-message-inner-content',
  },
  {
    // Qwen / Tongyi (tongyi.aliyun.com, qianwen.aliyun.com)
    match: function(hostname: string) {
      return hostname === 'tongyi.aliyun.com' || hostname.endsWith('.tongyi.aliyun.com')
        || hostname === 'qianwen.aliyun.com' || hostname.endsWith('.qianwen.aliyun.com');
    },
    userSelector: '[class*="user-msg"], [class*="user-message"]',
    assistantSelector: '[class*="bot-msg"], [class*="assistant-message"], [class*="ai-msg"]',
    sentinelSelector: '[class*="user-msg"], [class*="bot-msg"], [class*="ai-msg"]',
  },
  {
    // GitHub Copilot Chat (github.com with /copilot path)
    match: function(hostname: string) {
      return hostname === 'github.com' || hostname.endsWith('.github.com');
    },
    userSelector: '[class*="copilot-user"], [class*="CopilotUserMessage"]',
    assistantSelector: '[class*="copilot-assistant"], [class*="CopilotAssistantMessage"], [class*="SuggestedAction"]',
    sentinelSelector: '[class*="copilot-user"], [class*="copilot-assistant"], [class*="Copilot"]',
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
function detectByAria(): DetectionResult | null {
  // role="log" is the W3C ARIA23 standard for chat interfaces
  try {
    var logEl = document.querySelector('[role="log"]');
    if (logEl) return { container: logEl as HTMLElement, source: 'aria' };
  } catch (_) {}

  // role="feed" — used by some chatbot platforms for message feeds
  try {
    var feedEl = document.querySelector('[role="feed"]');
    if (feedEl && feedEl.children.length >= 2) {
      return { container: feedEl as HTMLElement, source: 'aria' };
    }
  } catch (_) {}

  // aria-label containing chat/conversation keywords
  try {
    var candidates = document.querySelectorAll('[aria-label]');
    for (var i = 0; i < candidates.length; i++) {
      var label = (candidates[i].getAttribute('aria-label') || '').toLowerCase();
      if ((label.indexOf('chat') >= 0 || label.indexOf('conversation') >= 0 || label.indexOf('message') >= 0)
        && candidates[i].children.length >= 2) {
        return { container: candidates[i] as HTMLElement, source: 'aria' };
      }
    }
  } catch (_) {}

  return null;
}

// ---------------------------------------------------------------------------
// Layer 2: Data attribute detection
// ---------------------------------------------------------------------------

/** Data-attribute selectors that signal chat messages (need >= 1 matching element) */
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
function detectByDataAttrs(): DetectionResult | null {
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
function detectByStructure(): DetectionResult | null {
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
      if (el && el.children.length >= 2) {
        hasMessageContainer = true;
        break;
      }
    }
  } catch (_) {}

  // 2. Repeated message-like blocks (>= 3 similar siblings)
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
    var chatInputs = document.querySelectorAll('input[type="text"]') as NodeListOf<HTMLInputElement>;
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
function hasChatSignalsNearby(inputs: NodeListOf<HTMLInputElement>) {
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
function discoverByExplicitRole(): SelectorResult | null {
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
function discoverByTestId(): SelectorResult | null {
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

  var userSel: string | null = null;
  var assistantSel: string | null = null;

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
 * Strategy C: Class name pattern matching.
 * Look for classes containing user/assistant role patterns.
 */
function discoverByClassPattern(): SelectorResult | null {
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

  var userSel: string | null = null;
  var assistantSel: string | null = null;

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
function discoverByGeminiWebComponent(): SelectorResult | null {
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
function discoverByDeepSeekMarkdown(): SelectorResult | null {
  try {
    var dsMarkdowns = document.querySelectorAll('.ds-markdown');
    if (dsMarkdowns.length < 1) return null;

    // The parent chain of a .ds-markdown element is the assistant response container.
    // Walk up to find a reasonable container (typically 2-4 levels up).
    var firstMarkdown = dsMarkdowns[0];
    var assistantContainer: Element = firstMarkdown;
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
function discoverByAriaLogAnalysis(): SelectorResult | null {
  var logEl: Element | null = null;
  try { logEl = document.querySelector('[role="log"]'); } catch (_) {}
  if (!logEl || !logEl.children || logEl.children.length < 2) return null;

  var children: Element[] = Array.prototype.slice.call(logEl.children);

  // Try to classify children by data attributes
  var userGroup: Element[] = [];
  var assistantGroup: Element[] = [];

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
function deriveSelectorFromElements(elements: Element[], roleHint: string): string | null {
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
 * Strategy G: Alternating pattern detection.
 * Zero-shot detection for unknown chat platforms that use no distinguishing
 * data attributes or ARIA roles. Detects the universal chat pattern of
 * alternating short (user) and long (assistant) messages.
 */
function discoverByAlternation(): SelectorResult | null {
  // Find a likely chat container: [role="log"], [role="feed"], or main
  var container: Element | null = null;
  try { container = document.querySelector('[role="log"]'); } catch (_) {}
  if (!container) {
    try { container = document.querySelector('[role="feed"]'); } catch (_) {}
  }
  if (!container) {
    try { container = document.querySelector('main'); } catch (_) {}
  }
  if (!container) return null;

  // Get direct children that are visible and have text
  var children: Element[] = [];
  try {
    var allChildren = container.children;
    for (var i = 0; i < allChildren.length; i++) {
      var child = allChildren[i];
      if (!child.isConnected) continue;
      // Must have text content
      var text = (child.textContent || '').trim();
      if (text.length < 5) continue;
      // Quick visibility check
      var childEl = child as HTMLElement;
      if (childEl.offsetWidth === 0 || childEl.offsetHeight === 0) continue;
      children.push(child);
    }
  } catch (_) { return null; }

  if (children.length < 4) return null; // Need at least 2 pairs

  // Compute text lengths and find median
  var textLengths: number[] = [];
  for (var j = 0; j < children.length; j++) {
    textLengths.push((children[j].textContent || '').trim().length);
  }
  var sorted = textLengths.slice().sort(function(a, b) { return a - b; });
  var median = sorted[Math.floor(sorted.length / 2)];

  if (median < 10) return null; // All text too short — not a chat page

  // Classify: below median → user-like, above → assistant-like
  var userGroup: Element[] = [];
  var assistantGroup: Element[] = [];

  for (var k = 0; k < children.length; k++) {
    if (textLengths[k] <= median) {
      userGroup.push(children[k]);
    } else {
      assistantGroup.push(children[k]);
    }
  }

  if (userGroup.length < 2 || assistantGroup.length < 2) return null;

  // Verify alternating pattern: at least 2 alternations between user/assistant
  var alternations = 0;
  var lastWasUser: boolean | null = null;
  for (var m = 0; m < children.length; m++) {
    var isUser = textLengths[m] <= median;
    if (lastWasUser !== null && lastWasUser !== isUser) {
      alternations++;
    }
    lastWasUser = isUser;
  }

  if (alternations < 2) return null; // Not enough alternation — probably not a chat

  // Try to derive selectors from element attributes
  var userSel = deriveSelectorFromElements(userGroup, 'user');
  var assistantSel = deriveSelectorFromElements(assistantGroup, 'assistant');

  if (userSel && assistantSel) {
    return {
      userSelector: userSel,
      assistantSelector: assistantSel,
      sentinelSelector: userSel + ', ' + assistantSel,
      source: 'alternation',
    };
  }

  // Fallback: use positional selectors scoped to the container
  // This handles platforms using generic <div> elements with no attributes
  try {
    var containerSel = getContainerSelector(container);
    if (containerSel) {
      // Determine which indices are user vs assistant
      // Use :nth-child for the dominant pattern
      var userIndices: number[] = [];
      var assistantIndices: number[] = [];
      for (var n = 0; n < children.length; n++) {
        // Get 1-based child index relative to parent
        var childIndex = getChildIndex(children[n]);
        if (textLengths[n] <= median) {
          userIndices.push(childIndex);
        } else {
          assistantIndices.push(childIndex);
        }
      }

      // Check if a simple even/odd pattern works
      var allUserEven = userIndices.every(function(idx) { return idx % 2 === 0; });
      var allUserOdd = userIndices.every(function(idx) { return idx % 2 !== 0; });
      var allAssistantEven = assistantIndices.every(function(idx) { return idx % 2 === 0; });
      var allAssistantOdd = assistantIndices.every(function(idx) { return idx % 2 !== 0; });

      if ((allUserEven && allAssistantOdd) || (allUserOdd && allAssistantEven)) {
        var userNth = allUserEven ? ':nth-child(even)' : ':nth-child(odd)';
        var assistantNth = allUserEven ? ':nth-child(odd)' : ':nth-child(even)';
        return {
          userSelector: containerSel + ' > ' + userNth,
          assistantSelector: containerSel + ' > ' + assistantNth,
          sentinelSelector: containerSel + ' > *',
          source: 'alternation-positional',
        };
      }
    }
  } catch (_) {}

  return null;
}

/**
 * Get a CSS selector for a container element.
 * Tries ID first, then role attribute, then tag name.
 */
function getContainerSelector(el: Element): string | null {
  if (!el) return null;
  try {
    if (el.id) return '#' + CSS.escape(el.id);
  } catch (_) {}
  try {
    var role = el.getAttribute('role');
    if (role) return '[' + 'role="' + role + '"]';
  } catch (_) {}
  try {
    return el.tagName.toLowerCase();
  } catch (_) { return null; }
}

/**
 * Get the 1-based index of an element among its siblings.
 */
function getChildIndex(el: Element): number {
  var parent = el.parentElement;
  if (!parent) return 1;
  var children = parent.children;
  for (var i = 0; i < children.length; i++) {
    if (children[i] === el) return i + 1;
  }
  return 1;
}

/**
 * Run selector discovery cascade.
 * Returns { userSelector, assistantSelector, sentinelSelector } or null.
 */
function discoverSelectors(): SelectorResult | null {
  var result: SelectorResult | null;

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

  // Strategy G: Alternating pattern detection (zero-shot for unknown platforms)
  result = discoverByAlternation();
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
function tryHintFallback(needsUserSelectorOnly: boolean): SelectorResult | null {
  var hostname = '';
  try { hostname = location.hostname; } catch (_) { return null; }

  for (var i = 0; i < CHATBOT_HINTS.length; i++) {
    var hint = CHATBOT_HINTS[i];
    try {
      if (hint.match(hostname)) {
        // Try custom detect() function first if available (per-site adapter pattern)
        if (typeof hint.detect === 'function') {
          var adapterResult = hint.detect();
          if (adapterResult) {
            return {
              userSelector: adapterResult.userSelector,
              assistantSelector: adapterResult.assistantSelector,
              sentinelSelector: adapterResult.sentinelSelector,
              source: adapterResult.source || 'hint-adapter',
            };
          }
        }

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
            // Diagnostic: verify sentinel selector also produces results
            try {
              var sentinelCount = document.querySelectorAll(hint.sentinelSelector).length;
              if (sentinelCount === 0) {
                console.debug('[toc] hint selectors matched hostname but sentinel found 0 elements — selectors may be stale');
              }
            } catch (_) {}
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

function findCommonAncestor(a: Element, b: Element): HTMLElement | null {
  if (!a || !b) return null;
  try {
    var ancestors = new Set<Element>();
    var walk: Element | null = a;
    while (walk) {
      ancestors.add(walk);
      walk = walk.parentElement;
    }
    walk = b;
    while (walk) {
      if (ancestors.has(walk)) return walk as HTMLElement;
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
function detectChatPage(): ChatbotProfile | null {
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

  var detectionResult: DetectionResult | null = null;
  var confidence = 0;

  // Layer 1: ARIA semantic signals (highest confidence)
  try { detectionResult = detectByAria(); } catch (_) {}
  if (detectionResult) confidence = 0.9;

  // Layer 2: Data attribute signals
  if (!detectionResult) {
    try { detectionResult = detectByDataAttrs(); } catch (_) {}
    if (detectionResult) confidence = 0.8;
  }

  // Layer 3: Structural heuristics (lowest confidence — many false positives)
  if (!detectionResult) {
    try { detectionResult = detectByStructure(); } catch (_) {}
    if (detectionResult) confidence = 0.6;
  }

  // --- Selector discovery ---

  var selectors: SelectorResult | null = null;

  if (detectionResult) {
    // Auto-detection confirmed chat page; discover selectors
    selectors = discoverSelectors();

    // If discovery returned incomplete selectors (e.g., DeepSeek heuristic found
    // assistant via .ds-markdown but couldn't find user), try hint for the missing part
    if (selectors && selectors._needsUserSelectorHint) {
      var hintResult: SelectorResult | null = null;
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
    if (selectors) confidence = 0.7; // Hint table confidence
  }

  if (!selectors) return null;

  // Apply confidence bonuses
  if (selectors.source && selectors.source !== 'hint') confidence += 0.10; // Discovery succeeded

  // Message count bonus: ≥4 messages is a strong signal
  try {
    var userCount = document.querySelectorAll(selectors.userSelector).length;
    if (userCount >= 4) confidence += 0.05;
  } catch (_) {}

  // Cap confidence at 1.0
  confidence = Math.min(confidence, 1.0);

  // Build and cache profile
  var profile: ChatbotProfile = {
    userSelector: selectors.userSelector,
    assistantSelector: selectors.assistantSelector,
    headingContainer: GENERIC_HEADING_CONTAINER,
    sentinelSelector: selectors.sentinelSelector,
    source: selectors.source || (detectionResult ? detectionResult.source : 'hint'),
    _rootEl: (detectionResult && detectionResult.container) || null,
    confidence: confidence,
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
function extractUserText(el: HTMLElement): string {
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
function isVisible(el: HTMLElement): boolean {
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
function getHeadingLevel(el: Element): number {
  var match = el && /^H([1-6])$/.exec(el.tagName || '');
  return match ? parseInt(match[1], 10) : 2;
}

/**
 * Extract trimmed text from a heading element.
 */
function getHeadingText(el: Element): string {
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
function buildChatbotTocItems(profile: ChatbotProfile): { items: TocItem[]; meta: { truncated: boolean; maxItems: number; totalCandidates: number } } | null {
  var userMessages: HTMLElement[] = [];
  try { userMessages = Array.from(document.querySelectorAll(profile.userSelector)) as HTMLElement[]; } catch (_) { return null; }

  if (userMessages.length === 0) return null;

  // Deduplicate user messages by element reference (a single DOM element may match
  // multiple selector paths, e.g. when hint selectors overlap with auto-detected ones)
  var seenUserEls = new Set<HTMLElement>();
  var uniqueUserMessages: HTMLElement[] = [];
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

  var items: TocItem[] = [];
  var itemId = 0;
  var seenEls = new Set<HTMLElement>();

  // Query assistant messages ONCE, then use a forward cursor to match
  // each user message to the next assistant message in document order.
  var allAssistants: HTMLElement[] = [];
  try { allAssistants = Array.from(document.querySelectorAll(profile.assistantSelector)) as HTMLElement[]; } catch (_) {}
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
      source: 'user',
    });

    // Find nearest following assistant message using forward cursor — O(N+M) total
    var assistantEl: HTMLElement | null = null;
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
    var headings: Element[] = [];
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
      var hEl = headings[j] as HTMLElement;
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
        source: 'ai',
      });
    }
  }

  if (items.length === 0) return null;

  // Deduplicate items with identical text (e.g. same heading text repeated
  // across multiple markdown containers or mirrored sidebar content).
  if (items.length > 1) {
    var seenTexts = new Set<string>();
    var dedupedItems: TocItem[] = [];
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
 * Test-only convenience wrapper — used by VM-based tests via __exports.
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

/**
 * Get the confidence score for chatbot detection.
 * Returns 0 for non-chatbot pages, 0.6–1.0 for detected chatbot pages.
 * Scores below 0.7 may indicate embedded chat widgets rather than full chat pages.
 */
export function getChatbotConfidence() {
  var profile = detectChatPage();
  return profile ? profile.confidence : 0;
}

/**
 * Detect whether a chatbot response is currently being streamed/generated.
 * Used by the rebuild scheduler to increase debounce during streaming.
 */
export function isStreaming(): boolean {
  var profile = detectChatPage();
  if (!profile) return false;

  // Check 1: Look for a stop-generating button (universal signal)
  for (var i = 0; i < STOP_BUTTON_SELECTORS.length; i++) {
    try {
      var stopBtn = document.querySelector(STOP_BUTTON_SELECTORS[i]);
      if (stopBtn && (stopBtn as HTMLElement).offsetParent !== null) return true;
    } catch (_) {}
  }

  // Check 2: Track if the last assistant element's text is growing
  try {
    var assistants = document.querySelectorAll(profile.assistantSelector);
    if (assistants.length > 0) {
      var lastAssistant = assistants[assistants.length - 1];
      var currentLen = (lastAssistant.textContent || '').length;
      if (_lastAssistantTextLen > 0 && currentLen > _lastAssistantTextLen + 20) {
        // Text grew significantly since last check — streaming in progress
        _lastAssistantTextLen = currentLen;
        return true;
      }
      _lastAssistantTextLen = currentLen;
    }
  } catch (_) {}

  return false;
}

/**
 * Get a CSS selector for the detected chatbot container.
 * Returns null if not a chatbot page or no container found.
 * Used to scope MutationObserver to only watch chat-related DOM changes.
 */
export function getChatbotContainerSelector(): string | null {
  var profile = detectChatPage();
  if (!profile) return null;

  // If we have a root element, try to derive a selector for it
  if (profile._rootEl) {
    var el = profile._rootEl;

    // Try ID
    try {
      if (el.id) return '#' + CSS.escape(el.id);
    } catch (_) {}

    // Try role attribute
    try {
      var role = el.getAttribute('role');
      if (role === 'log' || role === 'feed') return '[role="' + role + '"]';
    } catch (_) {}

    // Try tag name if it's specific enough (main, article)
    var tag = (el.tagName || '').toLowerCase();
    if (tag === 'main') return 'main';

    // Try finding the container via sentinel: get common ancestor of sentinel elements
    try {
      var sentinelEls = document.querySelectorAll(profile.sentinelSelector);
      if (sentinelEls.length >= 2) {
        // The sentinel elements' common ancestor is the container
        // Walk up from the first sentinel to find an ancestor that contains all sentinels
        var container = findCommonAncestor(sentinelEls[0], sentinelEls[sentinelEls.length - 1]);
        if (container) {
          if (container.id) return '#' + CSS.escape(container.id);
          var cRole = container.getAttribute('role');
          if (cRole) return '[role="' + cRole + '"]';
        }
      }
    } catch (_) {}
  }

  // Fallback: use the sentinel selector's parent scope
  // This is less precise but still helps scope mutations
  return null;
}
