# 聊天机器人页面检测与内容区域检测 — 技术文档

> 本文档讲解 Web TOC Assistant v1.3.0 中两个核心智能检测功能的设计原理与实现细节。

---

## 1. 概述

### 1.1 要解决的问题

传统的 TOC（目录）生成扩展通常只做一件事：在页面中查找 `<h1>` ~ `<h6>` 标签，然后生成目录。但真实网页中存在两类典型问题：

**问题一：聊天机器人页面没有传统的标题层级**

在 ChatGPT、Claude、Gemini 等 AI 对话页面中，页面结构是"用户提问 → AI 回复"的交替序列，而不是 `h1 > h2 > h3` 的文章层级。如果直接查找 `<h2>` 等标签，只能拿到 AI 回复中的零散标题，丢失了对话的结构信息。

**问题二：页面标题散布在正文、侧边栏、页脚等区域中**

一篇博客页面的 `<h2>` 可能出现在文章正文、评论区、侧边栏"相关文章"、页脚"友情链接"等多个位置。如果全部纳入目录，用户会看到大量无关条目。

### 1.2 两个检测系统的设计目标

| 系统 | 目标 |
|------|------|
| **聊天机器人页面检测** | 自动识别 AI 对话页面，生成以"用户提问"为一级目录、"AI 回复中的标题"为子级的对话式目录 |
| **内容区域检测** | 自动识别网页的主要内容区域，将 TOC 的标题查找范围限定在正文区域内 |

### 1.3 检测原理浅析

如果你只想快速了解"这个扩展是怎么判断一个页面是不是聊天机器人页面"以及"是怎么从杂乱的网页中找到正文区域的"，这一节用大白话把核心思路讲清楚。后面的章节才是深入的源码级分析。

#### 聊天机器人页面检测 —— 像"看房间猜功能"一样分析网页

想象你走进一个房间，怎么判断它是不是聊天室？你不会去看门牌号（URL），而是**看房间里的陈设**：

1. **有没有"聊天记录墙"？**（ARIA 语义检测）
   W3C 标准规定，聊天界面的消息列表应该用 `role="log"` 标记——就像聊天室里那面贴满对话的墙。ChatGPT、Claude 等主流聊天产品都遵循了这个标准。所以只要找到这面"墙"，就能初步判断。

2. **墙上有没有"发言者标签"？**（数据属性检测）
   如果没有 `role="log"`，就看消息元素上有没有标记"谁说的"——比如 `data-message-author-role="user"` 表示用户发的、`data-message-author-role="assistant"` 表示 AI 回复的。只要能找到两三个这样的标签，就能确认是聊天页面。

3. **有没有"输入框 + 发送按钮 + 消息列表"的组合？**（结构启发式）
   如果前两种都找不到，就看页面的"家具组合"：一个文本输入框、一个发送按钮、再加上一排排类似的消息块——这就像看到了键盘、回车键和聊天记录，即使没有明确的标签，也能推断出这是个聊天页面。

确认是聊天页面后，接下来要做的是**搞清楚"哪些是用户说的、哪些是 AI 说的"**。思路也不复杂：

- 先看元素上有没有明确的"角色标签"（如 `data-role="user"`）
- 没有就看测试 ID（如 `data-testid="user-message"`）
- 还没有就看 class 名里有没有 `user-message`、`assistant-message` 之类的关键词
- 再没有就去看 `[role="log"]` 容器的直接子元素，逐个分析它们的属性来归类
- 以上全失败了？最后掏出一份"已知站点速查表"，根据域名硬查选择器

有了用户消息和 AI 消息的选择器后，就可以构建一个"对话式目录"：每个用户提问是一级条目（就像章节标题），AI 回复中的标题（`<h2>`、`<h3>` 等）作为二级、三级子条目（就像小节标题）。这样在 ChatGPT 里翻看长对话时，目录就像一份"对话大纲"，一目了然。

#### 内容区域检测 —— 像"在一栋楼里找主展厅"一样定位正文

一个网页就像一栋大楼，里面有主展厅（正文）、前台大厅（导航栏）、走廊（侧边栏）、办公室（评论区）、储藏室（页脚）……你要找的是**主展厅**。

检测器用了四步，从最可靠的方法开始，一步步往下试：

1. **看建筑图纸上的标注**（语义地标）
   HTML5 给了网页"地标标签"：`<main>` 表示主要内容区、`<article>` 表示文章。就像大楼图纸上标着"主展厅"的房间——只要它存在，直接用就行。不过 `<main>` 里可能还混着评论区等内容，所以还会进一步"往里钻"，找到最核心的那个子区域。

2. **看门牌和招牌**（类名/ID 启发式）
   如果大楼没有标准标注，就看门牌号和招牌：写着 `#content`、`.post-body`、`.article-content` 的，大概率是正文区域。扩展维护了 29 个常见的"正文标识"，逐个查找并按标题数量评分，选出得分最高的那个。

3. **看标题的"聚集地"**（祖先计分法）
   如果连门牌都没有，就换个思路：先找到页面上所有的 `<h2>`、`<h3>`、`<h4>` 标题，然后顺着每个标题往上找祖先。哪个祖先元素"聚集"了最多的标题，它就很可能是正文区域——就像统计"哪间房里挂的展板最多"来判断主展厅。

   评分还会考虑更多线索：
   - 名字里带"sidebar"、"comment"的一律扣分（负向词汇惩罚）
   - 名字里带"content"、"article"的加分（正向词汇奖励）
   - 太窄的元素扣分（侧边栏通常很窄）
   - 链接太多的扣分（导航栏链接密集）
   - `<body>` 和 `<html>` 大幅扣分（不能选整栋楼作为"主展厅"）

4. **实在找不到？就用整栋楼**（全页兜底）
   以上三层都没找到明确的正文区域时，就不做过滤，从整个页面中查找标题。这种情况很少见，但确保了扩展在所有网页上都不会失效。

#### 一句话总结

| 检测系统 | 核心思路 |
|---------|---------|
| 聊天机器人检测 | 不看 URL 看结构——通过 ARIA 角色、数据属性、UI 组件组合来判断是否是聊天页面，再通过元素属性自动发现用户/AI 消息的选择器 |
| 内容区域检测 | 不靠配置靠分析——通过语义标签、class/id 关键词、标题分布反推，四层策略逐步逼近正文区域 |

两个检测系统在 `buildTocItems()` 中按**聊天机器人 → 内容区域 → 全页**的优先级依次执行，任一环节命中即短路返回。具体的调度流程和代码见[第 4 章：集成调度逻辑](#4-集成调度逻辑)。

---

## 2. 聊天机器人页面检测

> 源文件：`src/utils/chatbot-detector.ts`（1101 行）
> 测试文件：`checks/chatbot-detector.test.mjs`（961 行）

### 2.1 设计思路：基于 DOM 分析而非硬编码 URL

最直接的做法是维护一个已知聊天站点的 URL 列表（`chatgpt.com`、`claude.ai`、`gemini.google.com`...），但这种方式有两个致命缺陷：

1. **无法覆盖未知站点** — 新的 AI 聊天产品不断涌现，硬编码永远追不上
2. **站点 UI 更新会破坏选择器** — 站点前端重构后，硬编码的 CSS 选择器可能失效

因此，检测器采用了**三层 DOM 分析流水线**：通过分析页面的 DOM 结构特征来判断是否为聊天页面，不依赖 URL。只有在自动检测失败时，才回退到基于 hostname 的 Hint 表。

### 2.2 三层检测流水线

`detectChatPage()`（第 784 行）依次执行三层检测，任何一层命中即确认：

```
detectChatPage()
  │
  ├─ Layer 1: detectByAria()        — ARIA 语义信号
  │     命中 → 返回容器元素
  │
  ├─ Layer 2: detectByDataAttrs()   — 数据属性信号
  │     命中 → 返回容器元素
  │
  └─ Layer 3: detectByStructure()   — 结构启发式
        命中 → 返回检测结果
        未命中 → 不是聊天页面，返回 null
```

#### Layer 1: ARIA 语义信号 — `detectByAria()`（第 123 行）

W3C ARIA 规范为聊天界面定义了标准的语义角色。本层检查三种 ARIA 信号：

| 信号 | 说明 |
|------|------|
| `[role="log"]` | W3C ARIA23 标准为聊天界面定义的角色，ChatGPT、Claude 等均使用 |
| `[role="feed"]` | 某些聊天平台用于消息流的语义角色，要求有 ≥ 2 个子元素 |
| `aria-label` 包含 chat/conversation/message | 通过 `aria-label` 属性文本识别聊天区域，要求有 ≥ 2 个子元素 |

这一层速度最快（单个 `querySelector`），且基于 W3C 标准，覆盖面广。

#### Layer 2: 数据属性信号 — `detectByDataAttrs()`（第 176 行）

前端框架（React、Next.js 等）常在 DOM 元素上添加 `data-*` 属性用于测试或标识。本层检查 10 个已知的数据属性选择器（定义于 `DATA_ATTR_SIGNALS`，第 158 行）：

```typescript
var DATA_ATTR_SIGNALS = [
  '[data-message-author-role]',          // ChatGPT 消息角色标识
  '[data-testid^="conversation-turn"]',  // 对话轮次（ChatGPT）
  '[data-testid^="conversation"]',       // 对话容器
  '[data-turn-role]',                    // 轮次角色（Gemini）
  'ms-chat-turn',                        // Gemini 自定义 Web Component
  '[data-testid*="chat-turn"]',          // 通用聊天轮次
  '[data-testid*="message-turn"]',       // 消息轮次
  '[data-role="user"]',                  // 用户角色
  '[data-role="assistant"]',             // 助手角色
  '[data-author-role]',                  // 作者角色
  '[data-chat-role]',                    // 聊天角色
];
```

匹配规则：任何一个选择器在页面中找到 ≥ 2 个元素即认为命中。命中后，通过 `findCommonAncestor()` 找到这些元素的公共祖先作为聊天容器。

#### Layer 3: 结构启发式 — `detectByStructure()`（第 202 行）

当前两层都未命中时，通过分析页面的宏观结构特征来判断。对四个维度进行评分：

| 维度 | 检测内容 |
|------|---------|
| 消息容器 | 查找 `role="log"/"feed"` 或 class/id 包含 chat/message/conversation 的元素（≥ 2 个子元素） |
| 重复消息块 | 查找 `data-message-author-role`、`data-turn-role`、`role="article"` 等选择器匹配 ≥ 3 个元素 |
| 输入区域 | 查找 `textarea`、`contenteditable`、或带有聊天信号的 `input[type="text"]` |
| 发送按钮 | 查找 `button[aria-label*="Send"]`、`[data-testid*="send"]`、`button[type="submit"]` 等 |

两个判定阈值：

```
score ≥ 3（高置信度）    → 确认为聊天页面（已有消息内容）
score ≥ 2 且有输入+发送  → 判定为"聊天落地页"（空对话，但 UI 结构明确是聊天）
```

其中，对输入区域的检测还额外检查了"聊天信号"（`hasChatSignalsNearby()`，第 289 行）：查看 `input` 的 `placeholder`、`aria-label` 或 3 层祖先的 class 中是否包含 message/ask/chat/prompt 等关键词，以避免将普通搜索框误判为聊天输入。

### 2.3 选择器发现：六种策略

页面检测确认是聊天页面后，需要找出"哪些 DOM 元素是用户消息、哪些是 AI 消息"——这就是**选择器发现**。`discoverSelectors()`（第 683 行）依次尝试六种策略（A → F），任何一种成功即返回：

```
discoverSelectors()
  │
  ├─ 策略 A: discoverByExplicitRole()          — 显式角色属性
  ├─ 策略 B: discoverByTestId()                — testid 模式匹配
  ├─ 策略 C: discoverByGeminiWebComponent()     — Gemini Web Component
  ├─ 策略 D: discoverByDeepSeekMarkdown()       — DeepSeek Markdown
  ├─ 策略 E: discoverByClassPattern()           — 类名模式匹配
  └─ 策略 F: discoverByAriaLogAnalysis()        — ARIA Log 子元素分析
```

#### 策略 A: 显式角色属性 — `discoverByExplicitRole()`（第 330 行）

按优先级检查四组数据属性，每组要求同时存在 ≥ 1 个用户元素和 ≥ 1 个助手元素：

| 属性 | 适用站点 |
|------|---------|
| `data-message-author-role="user"/"assistant"` | ChatGPT 等 |
| `data-turn-role="user"/"model"` | Gemini |
| `data-role="user"/"assistant"` | 通用框架 |
| `data-author-role="user"/"assistant"` | 变体属性名 |

#### 策略 B: testid 模式匹配 — `discoverByTestId()`（第 390 行）

查找 `data-testid` 属性值包含特定子串的元素：

- 用户：`*="user-message"`、`*="human-message"`、`*="conversation-turn-user"`
- 助手：`*="assistant-message"`、`*="model-message"`、`*="conversation-turn-assistant"`

Claude 使用 `data-testid="user-message"` / `data-testid="assistant-message"`，就是通过这一策略发现的。

#### 策略 C: Gemini Web Component — `discoverByGeminiWebComponent()`（第 489 行）

Gemini 使用自定义 HTML 元素 `<ms-chat-turn>`，配合 `.chat-turn-container.user` / `.chat-turn-container.model` 类名标识角色。此策略专门处理这一特殊结构。

#### 策略 D: DeepSeek Markdown — `discoverByDeepSeekMarkdown()`（第 520 行）

DeepSeek 的前端使用哈希化的 class 名（每次构建都会变），无法用稳定的 CSS 选择器匹配。但 DeepSeek 的助手回复中始终使用 `.ds-markdown` 类名包裹 Markdown 内容——这是一个相对稳定的标识。

此策略找到 `.ds-markdown` 元素后，向上遍历最多 4 层找到助手消息容器。但它无法独立发现用户消息选择器（返回 `_needsUserSelectorHint: true`），需要由 Hint 表补充。

#### 策略 E: 类名模式匹配 — `discoverByClassPattern()`（第 436 行）

查找 class 名包含 user-message、assistant-message、message-user 等模式的元素。这是通用性最强的策略，适用于使用语义化 class 命名的站点。

#### 策略 F: ARIA Log 子元素分析 — `discoverByAriaLogAnalysis()`（第 552 行）

对于使用 `[role="log"]` 的聊天页面，分析其直接子元素，依次通过 `data-message-author-role`、`data-testid`、`data-role`、class 名进行分类，将子元素归入"用户组"或"助手组"。

分类成功后，通过 `deriveSelectorFromElements()`（第 628 行）从元素组中推导出通用 CSS 选择器（按优先级尝试 `data-message-author-role` → `data-testid` → `data-turn-role` → `data-role` → class 子串）。

### 2.4 Hint 表兜底

当自动检测失败或返回不完整结果时，回退到基于 hostname 的 Hint 表（`CHATBOT_HINTS`，第 61 行）：

| 站点 | hostname 匹配 | 用户选择器 | 助手选择器 |
|------|--------------|-----------|-----------|
| **ChatGPT** | `chatgpt.com`, `chat.openai.com` | `[data-message-author-role="user"]` | `[data-message-author-role="assistant"]` |
| **DeepSeek** | `chat.deepseek.com` | `.ds-chat-user-message, [data-role="user"]` | `.ds-chat-assistant-message, [data-role="assistant"]` |
| **Claude** | `claude.ai` | `[data-testid="user-message"], [data-testid="human-message"]` | `[data-testid="assistant-message"], .row-start-2` |
| **Gemini** | `gemini.google.com` | `.query-content, [data-turn-role="user"]` | `.response-container, [data-turn-role="model"]` |
| **Kimi** | `kimi.moonshot.cn`, `kimi.ai` | `.message-user, [class*="user-message"]` | `.message-assistant, [class*="assistant-message"]` |

Hint 表有两个使用场景：
1. **全量兜底**：自动检测完全失败时，通过 hostname 匹配获取完整选择器
2. **部分补充**：自动检测发现了助手选择器但缺少用户选择器时（如 DeepSeek 场景），只补充缺失部分

每个 Hint 条目提供多个候选选择器（逗号分隔），以便站点更新后某个选择器失效时，其他选择器仍然有效。

### 2.5 对话式 TOC 构建

`buildChatbotTocItems()`（第 930 行）将检测到的对话结构转化为 TOC 条目。

#### 目录层级规则

```
用户提问 1          → level 1
  AI 回复中的 h2     → level 3 (min(h2_level + 1, 6))
  AI 回复中的 h3     → level 4
用户提问 2          → level 1
  AI 回复中的 h2     → level 3
```

用户提问始终作为 **level 1** 顶层条目，AI 回复中的标题级别为 `min(原标题级别 + 1, 6)`。这种设计让目录呈现出清晰的对话结构。

#### 前向游标 O(N+M) 匹配算法

需要将每个用户消息与其后的第一条助手消息配对。朴素做法是对每个用户消息都遍历所有助手消息，复杂度 O(N×M)。实际实现使用**前向游标**（第 959-998 行）：

```typescript
var allAssistants = document.querySelectorAll(profile.assistantSelector);
var assistantIdx = 0;  // 前向游标

for (var i = 0; i < userMessages.length; i++) {
  // 利用 compareDocumentPosition 比较文档顺序
  while (assistantIdx < allAssistants.length) {
    var pos = userEl.compareDocumentPosition(cand);
    if (pos & 2) { assistantIdx++; continue; }      // 助手在用户前面，跳过
    if (pos & 4) { assistantEl = cand; break; }      // 找到下一条助手消息
  }
}
```

`assistantIdx` 只前进不后退，总复杂度为 **O(N+M)**。

#### Markdown 容器内标题提取

AI 回复中的标题通常包裹在 Markdown 渲染容器内。检测器使用一组通用选择器（`GENERIC_HEADING_CONTAINER`，第 113 行）来定位这些容器：

```typescript
var GENERIC_HEADING_CONTAINER =
  '.markdown-body, .prose, [class*="markdown"], [class*="ds-markdown"], ' +
  '.standard-markdown, .progressive-markdown, message-content';
```

优先在 Markdown 容器内查找标题（`h1`~`h6`）。如果找不到容器，才回退到在整个助手消息元素中查找。

#### 去重与限制

- **用户消息去重**：通过 `Set` 按元素引用去重（同一 DOM 元素可能匹配多个选择器路径）
- **标题文本去重**：对相同文本的 TOC 条目只保留第一个
- **数量限制**：最多处理 50 轮对话（`MAX_TURNS`），最多 400 个 TOC 条目（`MAX_ITEMS`），用户提问文本截断至 120 字符（`PROMPT_MAX_LEN`）

### 2.6 URL 感知缓存机制

检测结果按 URL 缓存（第 37-48 行），避免在 DOM 重建时重复检测：

```typescript
var _cachedProfile = null;   // 缓存的检测档案
var _cachedUrl = '';          // 缓存对应的 URL
```

**缓存命中条件**：
1. 当前 `location.href` 与 `_cachedUrl` 相同
2. 缓存的根元素仍然在 DOM 中（`_rootEl.isConnected`）

**缓存失效时机**：
- URL 变化（SPA 导航）时，由 `rebuild-scheduler.ts` 调用 `invalidateChatbotCache()` 主动清除
- 缓存的根元素脱离 DOM（SPA 全量替换）时，下次调用自动检测到并清除

### 2.7 DOM Watcher 集成（哨兵选择器）

在普通页面中，DOM Watcher 只关注涉及标题元素的 DOM 变化（ Mutation 过滤），以减少不必要的 TOC 重建。但在聊天页面中，新的消息出现不涉及标题变化——用户发送一条新消息只是添加了一个新的 DOM 节点。

为了解决这个问题，`buildTocItems()` 在返回聊天机器人 TOC 时，会向 `cfg.selectors` 注入一个**哨兵选择器**（sentinel selector）（`toc-builder.ts:204-209`）：

```typescript
var sentinel = getChatbotSentinelSelector();
if (sentinel) cfg.selectors.push({ type: 'css', expr: sentinel });
```

哨兵选择器匹配页面上的聊天消息元素（如 `[data-message-author-role]`），使 DOM Watcher 能够检测到新消息的添加并触发 TOC 重建。

---

## 3. 内容区域检测

> 源文件：`src/utils/content-region.ts`（479 行）
> 测试文件：`checks/content-region.test.mjs`（442 行）

### 3.1 设计思路

内容区域检测的核心问题是：在一个可能包含导航栏、侧边栏、评论区、页脚等多种区域的网页中，如何准确找到"正文"所在的 DOM 元素？

设计原则是**四层递进策略**——从最快最准确的语义化 HTML 标签开始，逐步回退到更通用但更慢的方法：

```
detectContentRegion()
  │
  ├─ Layer 1: detectByLandmark()         — 语义地标（main, article）
  │     快速、准确，覆盖大部分现代网站
  │
  ├─ Layer 2: detectByClassHeuristic()   — 类名/ID 启发式
  │     覆盖使用传统 class/id 命名的网站
  │
  ├─ Layer 3: detectByAncestorScoring()  — 祖先计分法
  │     基于标题分布反推内容容器
  │
  └─ Layer 4: 全页兜底
        返回 null，由调用方在整个 document 中查找
```

### 3.2 Layer 1: 语义地标 — `detectByLandmark()`（第 206 行）

HTML5 提供了语义化的地标标签，现代网站普遍使用。本层按优先级检查四个选择器（`LANDMARK_SELECTORS`，第 30 行）：

```typescript
var LANDMARK_SELECTORS = [
  'main',              // <main> 标签
  '[role="main"]',     // ARIA main 角色
  'article',           // <article> 标签
  '[role="article"]',  // ARIA article 角色
];
```

#### `<main>` 的向下钻取 — `drillToPrimaryContent()`（第 165 行）

`<main>` 标签通常包含正文区域，但也可能同时包含评论区、相关推荐等非核心内容。如果直接把整个 `<main>` 作为内容区域，目录中会混入评论区的标题。

`drillToPrimaryContent()` 解决这个问题——从 `<main>` 的直接子元素中，找到"最核心"的那个内容子元素：

```
<main>
  ├─ <nav>...</nav>                    ← 跳过（NAV 标签）
  ├─ <div class="article-content">     ← 候选 1（含 h2×5, h3×3 → score=21）
  ├─ <aside>...</aside>                ← 跳过（ASIDE 标签）
  ├─ <div class="comments">            ← 跳过（负模式匹配）
  └─ <div class="related-posts">       ← 跳过（负模式匹配）
```

筛选规则：
1. 跳过 `NAV`、`ASIDE`、`FOOTER`、`HEADER` 标签
2. 跳过 class/id 匹配负模式的元素（sidebar、comment、related 等）
3. 跳过不包含任何标题的元素
4. 按标题数量计分：`h2 × 3 + h3 × 2 + h4`
5. 如果得分最高的候选 ≥ 第二名的 2 倍，使用它；否则保留整个 `<main>`

"2 倍阈值"的设计意图：如果多个子元素得分接近，说明 `<main>` 下确实有多个并重的内容区域，此时不应该偏袒某一个。

#### `<article>` 的多元素选择

页面中可能存在多个 `<article>` 元素（如博客首页）。此时选择标题数量最多的那个：

```
<article>   h2×2, h3×1 → score=8    ← 选中
<article>   h2×0, h3×1 → score=2
<article>   h2×1, h3×0 → score=3
```

### 3.3 Layer 2: 类名/ID 启发式 — `detectByClassHeuristic()`（第 255 行)

当页面没有使用语义化 HTML 标签时，回退到基于 class/id 的模式匹配。本层维护了 29 个候选选择器（`CONTENT_SELECTORS`，第 38 行）：

```typescript
var CONTENT_SELECTORS = [
  // ID 选择器
  '#content', '#main-content', '#maincontent', '#page-content',
  '#post-content', '#article-content', '#entry-content', '#primary',
  // Class 选择器
  '.content', '.main-content', '.page-content', '.post-content',
  '.article-content', '.entry-content', '.post-body',
  '.article-body', '.story-body', '.markdown-body',
  '.prose', '.rich-text', '.text-block',
  '.primary', '.site-content', '.post-entry',
  '.blog-content', '.news-body', '.doc-content',
];
```

**评分逻辑**：

1. 每个候选元素必须：可见、在 DOM 中、包含标题
2. 按标题数量计分：`h2 × 3 + h3 × 2 + h4`
3. **祖先惩罚**：如果候选元素的 2 层祖先内有匹配负模式的元素，扣 50 分
4. 选择得分最高的候选

```
<div class="sidebar">                          ← 负模式
  <div>                                        ← 2 层祖先内
    <div class="content" id="content">         ← 惩罚 -50 分
      <h2>Title 1</h2>
    </div>
  </div>
</div>
```

### 3.4 Layer 3: 祖先计分法 — `detectByAncestorScoring()`（第 300 行）

> 此方法的思路借鉴自 Smart TOC 扩展。

当前两层都未命中时，使用"从标题反推容器"的方法：收集页面中的 h2~h4 标题，然后沿着 DOM 树向上遍历，为每个祖先元素计分。得分最高的祖先即为最可能的内容容器。

#### 步骤一：收集标题

查找页面中所有 `h2`、`h3`、`h4` 标签。如果超过 200 个，均匀采样 100 个（`MAX_SAMPLED_HEADINGS`）以保证性能。

#### 步骤二：向上遍历并计分

对每个标题，向上最多遍历 6 层（`MAX_ANCESTOR_DEPTH`），为沿途的每个祖先累加分数：

**标题权重**（`HEADING_WEIGHTS`）：

| 标签 | 权重 |
|------|------|
| H2 | 100 |
| H3 | 80 |
| H4 | 60 |

**标签加成**（`TAG_BONUSES`，仅加一次）：

| 标签 | 加成 |
|------|------|
| ARTICLE | +200 |
| MAIN | +200 |
| SECTION | +50 |
| DIV | +10 |

**正/负词汇评分**（`evaluatePatterns()`）：

检查祖先的 class 和 id 中是否包含特定词汇（子串匹配）：

| 正向词汇 (+150) | 负向词汇 (-300) |
|-----------------|-----------------|
| content, article, post, entry, story, body, prose, main, primary, markdown, richtext, blog, news, doc | sidebar, nav, footer, header, comment, aside, widget, ad, promo, related, breadcrumb, share, social, banner, sponsor, pagination, shoutbox, skyscraper, menu, toolbar |

设计意图：负向词汇的惩罚（-300）远大于正向词汇的奖励（+150），确保包含 "sidebar"、"comment" 等关键词的元素即使拥有大量标题，也会被排除。

#### 步骤三：二次评分

取得分最高的 5 个候选，加入结构信号进行二次评分：

| 信号 | 加分 | 说明 |
|------|------|------|
| 宽度 > 400px | +100 | 内容区域通常较宽 |
| 宽度 > 60% 视口 | +50 | 内容区域占据页面主体宽度 |
| 标题密度 0.5%~15% | +50 | 合理的标题密度 |
| 链接密度 > 40% | -200 | 导航/侧边栏链接密集 |
| 高度 > 30% 视口 | +50 | 内容区域通常纵向延伸 |
| 是 `<body>` 或 `<html>` | -500 | 避免选中整个页面 |

#### 步骤四：返回最佳候选

按二次评分排序，返回得分最高且 > 0 的候选。如果所有候选得分 ≤ 0，返回 null（进入 Layer 4 兜底）。

### 3.5 Layer 4: 全页兜底

如果前三层都未能找到内容区域，返回：

```typescript
{ root: null, source: 'fallback' }
```

`root` 为 `null` 表示不限定范围，由调用方（`toc-builder.ts`）在整个 `document` 中查找标题。

### 3.6 缓存机制

与聊天机器人检测类似，内容区域检测结果也按 URL 缓存（第 21-23 行）：

```typescript
var _cachedResult = null;   // { root: Element|null, source: string }
var _cachedUrl = '';        // 缓存对应的 URL
```

**缓存命中条件**：
1. `location.href` 与缓存 URL 相同
2. 缓存的根元素仍在 DOM 中（`root.isConnected`）

**自动失效**：
- URL 变化：下次调用时 URL 不匹配，自动重新检测
- DOM 替换：缓存根元素脱离 DOM，自动清除

**手动失效**：`invalidateContentRegionCache()`（第 475 行），用于页面发生不触发 URL 变化的大规模结构变更。

> 注意：聊天机器人缓存由 `rebuild-scheduler.ts` 在 URL 变化时主动调用 `invalidateChatbotCache()` 清除，而内容区域缓存是**被动检测**——只在下次调用 `detectContentRegion()` 时检查 URL 是否匹配。

---

## 4. 集成调度逻辑

### 4.1 buildTocItems 中的优先级

```
用户访问页面
  │
  └→ buildTocItems(cfg)
       │
       ├─ tryBuildChatbotTocItems()
       │    │
       │    ├─ detectChatPage()           三层 DOM 分析 + Hint 兜底
       │    │    命中 → discoverSelectors()  六种策略自动提取选择器
       │    │    未命中 → 返回 null
       │    │
       │    ├─ buildChatbotTocItems()     构建对话式 TOC
       │    └─ 注入哨兵选择器到 DOM Watcher
       │
       ├─ detectContentRegion()           四层策略检测正文区域
       │    │
       │    ├─ 命中 → 限定标题查找范围
       │    └─ 未命中 → 全页查找
       │
       └─ buildTocItemsFromSelectors()    通用标题收集与过滤
```

### 4.2 缓存失效的触发

`rebuild-scheduler.ts`（第 128-131 行）在检测到 URL 变化时，主动清除聊天机器人缓存：

```typescript
function onUrlChange() {
  invalidateChatbotCache();       // 主动清除聊天机器人缓存
  // 内容区域缓存由被动 URL 检查自动失效
  scheduleRebuild('url-change');
}
```

---

## 5. 扩展与调试指南

### 5.1 如何让检测器支持一个新的 AI 聊天站点

假设有一个新站点 `chat.newbot.ai`，你希望扩展能自动识别它。按照以下步骤操作：

#### 第一步：检查自动检测是否已经覆盖

很多情况下，自动检测的三层流水线可能已经足够，不需要写任何代码。先在浏览器中打开目标站点，按 F12 打开开发者工具，检查以下 DOM 特征：

- 是否有 `[role="log"]` 元素？（Layer 1）
- 消息元素上是否有 `data-message-author-role`、`data-turn-role`、`data-role` 等属性？（Layer 2）
- 页面是否有文本输入框 + 发送按钮 + 重复的消息块？（Layer 3）

如果以上任一条件成立，自动检测大概率已经能识别该站点。

#### 第二步：检查选择器发现是否能自动提取

如果页面被识别为聊天页面，但 TOC 为空，说明选择器发现失败了。在开发者工具中检查：

- 消息元素上有没有 `data-message-author-role`、`data-testid`、`data-role` 等属性能区分用户和 AI？
- class 名中有没有 `user-message`、`assistant-message` 等模式？

如果有，六种选择器发现策略之一应该能自动提取。

#### 第三步：添加 Hint 条目（仅在自动检测失败时）

只有当自动检测完全失败时，才需要在 `CHATBOT_HINTS` 数组（`chatbot-detector.ts:61`）末尾添加一个新条目：

```typescript
{
  match: function(hostname) {
    return hostname === 'chat.newbot.ai' || hostname.endsWith('.chat.newbot.ai');
  },
  userSelector: '[data-role="user"]',      // 在开发者工具中找到的用户消息选择器
  assistantSelector: '[data-role="assistant"]', // AI 消息选择器
  sentinelSelector: '[data-role]',         // 用于 DOM Watcher 监听的选择器
},
```

**如何确定选择器？** 在开发者工具的 Elements 面板中，右键点击用户消息元素 → Copy → Copy selector，然后化简为最稳定的属性选择器。优先使用 `data-*` 属性（比 class 名更稳定）。

#### 第四步：添加测试

在 `checks/chatbot-detector.test.mjs` 中添加一个测试用例：

```javascript
test('hint fallback: NewBot site', () => {
  const { tryBuildChatbotTocItems } = loadModule(
    { hostname: 'chat.newbot.ai', href: 'https://chat.newbot.ai/chat' },
    /* 构造包含用户消息和AI消息的 mock document */
  );
  const result = tryBuildChatbotTocItems();
  assert.notEqual(result, null);
  // 进一步断言 TOC 条目的内容...
});
```

#### 第五步：验证

1. 运行 `npm run test` 确保测试通过
2. 运行 `npm run build`，在浏览器中加载扩展并访问目标站点
3. 确认目录正确显示用户提问和 AI 回复中的标题

### 5.2 检测出问题时的排查方法

#### 问题：普通网页被误判为聊天页面（假阳性）

可能原因：
- 页面使用了 `[role="log"]` 或类似 ARIA 角色（如某些实时日志面板）
- 页面的 `data-*` 属性恰好匹配了 `DATA_ATTR_SIGNALS` 中的选择器
- 页面结构恰好有输入框 + 提交按钮 + 重复列表（如某些后台管理界面）

**排查方法**：在开发者工具 Console 中手动调用检测函数，观察返回结果：

```javascript
// 检查是哪一层命中
document.querySelector('[role="log"]');                    // Layer 1
document.querySelectorAll('[data-message-author-role]');   // Layer 2
```

**修复方式**：如果某个 `DATA_ATTR_SIGNALS` 选择器过于宽泛导致误判，可以在该选择器的匹配逻辑中增加更严格的条件（如要求更多匹配元素）。

#### 问题：聊天页面没有被检测到（假阴性）

可能原因：
- 站点使用了完全自定义的 DOM 结构，没有标准的 ARIA 角色或 `data-*` 属性
- 消息元素数量 < 2（空对话或刚打开页面）
- 站点使用了 Shadow DOM，`document.querySelector` 无法穿透

**排查方法**：
1. 先用 `isChatbotPage()` 确认检测是否完全失败
2. 如果失败，逐层检查 DOM 特征（参见 5.1 第一步）
3. 检查是否有 Shadow DOM 阻止了查询

#### 问题：目录中混入了无关标题

对于非聊天页面，如果目录中出现了侧边栏、评论区等区域的标题，说明内容区域检测没有正确识别正文区域。

**排查方法**：在 Console 中手动调用检测，观察返回的 `source`：

```javascript
// 内容区域检测结果
// source 取值: 'landmark' | 'heuristic-class' | 'ancestor-score' | 'fallback'
// 'fallback' 说明四层策略都失败了
```

### 5.3 已知局限与设计权衡

#### 聊天机器人检测的局限

| 局限 | 原因 | 缓解措施 |
|------|------|---------|
| **Shadow DOM 内部无法检测** | `document.querySelector` 无法穿透 Shadow DOM 边界 | 目前无解；需要站点将消息放在 light DOM 中 |
| **空对话页面可能检测失败** | 结构启发式至少需要 `score ≥ 2`，空页面消息块不足 | "聊天落地页"判定（输入+发送即可）部分覆盖此场景 |
| **非标准聊天气泡（如邮件、评论）可能误判** | 评论区的 DOM 结构可能类似聊天 | 结构启发式对"输入+发送"有较严格的聊天信号检查 |
| **对话轮次超过 50 轮时截断** | 出于性能考虑（`MAX_TURNS = 50`） | 保留最近的 50 轮，通常够用 |
| **DeepSeek 哈希 class 名不稳定** | DeepSeek 前端每次构建生成新的哈希 class | 依赖 `.ds-markdown` 这个相对稳定的标识 + Hint 表兜底 |
| **用户消息和 AI 消息的匹配依赖文档顺序** | 前向游标算法假设消息按文档顺序排列 | 适用于目前所有已知聊天站点的 DOM 结构 |

#### 内容区域检测的局限

| 局限 | 原因 | 缓解措施 |
|------|------|---------|
| **SPA 全 DOM 替换后需要重新检测** | 缓存的根元素脱离 DOM | 自动检测 `root.isConnected` 并失效 |
| **`<main>` 内有多个平级内容区域时难以取舍** | `drillToPrimaryContent()` 的 "2 倍阈值" 是启发式规则 | 无完美解；如果多个子元素得分接近，保留整个 `<main>` |
| **祖先计分法对极端 DOM 深度/广度有性能开销** | 遍历每个标题的所有祖先 | 采样上限 100 个标题、最多 6 层祖先，控制复杂度 |
| **纯 JavaScript 渲染的页面可能检测失败** | 初始加载时 DOM 不完整 | DOM Watcher 会在内容变化后触发重建，间接补偿 |
| **自定义选择器配置优先于内容区域检测** | 用户显式配置时不应被覆盖 | 设计决策：用户意图优先 |

#### 设计权衡总结

| 权衡 | 选择 | 理由 |
|------|------|------|
| URL 硬编码 vs DOM 分析 | DOM 分析优先 | 新站点无需更新代码；硬编码只在自动失败时兜底 |
| 检测精度 vs 检测速度 | 分层短路 | Layer 1 只需一个 `querySelector`，命中即返回；只有在前面都失败时才执行昂贵的 Layer 3 |
| 通用性 vs 特化 | 通用优先 | 六种选择器发现策略覆盖大多数站点，Hint 表只作为最后手段 |
| 缓存一致性 vs 实时性 | URL 感知 + 连接检测 | 同一 URL 复用缓存避免重复检测，但 DOM 元素脱离时自动失效 |

### 5.4 测试方法

两个检测系统的测试都使用 **VM 沙箱 + DOM Mock** 的方式，不依赖真实浏览器环境。

#### 测试架构

```
测试文件（checks/*.test.mjs）
  │
  ├─ makeElement(tag, opts)     — 创建 mock DOM 元素
  │    支持: tagName, children, attributes, className,
  │          isConnected, offsetWidth/Height, querySelector(All)
  │
  ├─ loadModule(location, doc)  — 将 TypeScript 源码加载到 VM 沙箱
  │    注入 mock 的 location、document、window、Map、Set 等全局对象
  │
  └─ test('描述', () => { ... }) — Vitest 测试用例
       构造 mock DOM → 调用检测函数 → 断言结果
```

核心思路：将 TypeScript 源码读入 Node.js VM 沙箱，注入模拟的 `document` 和 `location` 对象，然后在沙箱中调用导出的函数并断言返回值。

#### 测试覆盖的场景

**聊天机器人检测**（`chatbot-detector.test.mjs`，~17 个用例）：

| 场景类别 | 测试内容 |
|---------|---------|
| 基本否定 | 非聊天页面返回 `null` / `false` |
| Layer 1 | `[role="log"]` 检测、`[role="feed"]` 检测 |
| Layer 2 | `data-message-author-role`、`data-role`、`data-turn-role`、`data-author-role` 属性检测 |
| Hint 兜底 | ChatGPT、Claude、DeepSeek、Gemini 的 hostname 匹配 |
| 完整流程 | 多轮对话的 TOC 构建（用户→level 1，AI 标题→level+1） |
| 缓存 | URL 变化后缓存失效、强制重新检测 |
| 边界 | 空对话页面、未知站点的自动检测、哨兵选择器提取 |

**内容区域检测**（`content-region.test.mjs`，~11 个用例）：

| 场景类别 | 测试内容 |
|---------|---------|
| Layer 1 | `<main>` 检测、`[role="main"]` 检测、`<article>` 检测 |
| 向下钻取 | `<main>` 中有多个子元素时的最佳候选选择 |
| Layer 2 | `.content`、`.post-content` 等 class/id 匹配 |
| 祖先惩罚 | 祖先匹配负模式时的扣分 |
| 缓存 | URL 相同命中缓存、URL 不同重新检测、根元素断连失效、手动清除 |
| 兜底 | 四层全部失败时返回 `{ root: null, source: 'fallback' }` |
| 空页面 | 没有标题的元素被跳过 |

#### 如何运行和扩展测试

```bash
# 运行全部测试
npm run test

# 只运行检测相关测试
npx vitest run checks/chatbot-detector.test.mjs
npx vitest run checks/content-region.test.mjs
```

添加新测试时，使用 `makeElement()` 构造 mock DOM，用 `loadModule()` 加载模块，然后断言函数返回值：

```javascript
test('my new scenario', () => {
  const userMsg = makeElement('div', {
    attributes: { 'data-role': 'user' },
    children: [addTextContent(makeElement('p'), 'Hello')], 
  });
  const aiMsg = makeElement('div', {
    attributes: { 'data-role': 'assistant' },
    children: [makeHeading('h2', 'Response Title', { docOrder: 3 })],
  });

  const { tryBuildChatbotTocItems } = loadModule(
    { hostname: 'example.com', href: 'https://example.com' },
    { /* mock document 返回上面构造的元素 */ }
  );

  const result = tryBuildChatbotTocItems();
  assert.notEqual(result, null);
  assert.equal(result.items.length, 2); // 1 user + 1 heading
});
```

---

## 6. 关键源文件索引

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/utils/chatbot-detector.ts` | 1101 | 聊天机器人页面检测、选择器发现、对话式 TOC 构建 |
| `src/utils/content-region.ts` | 479 | 内容区域检测（四层策略） |
| `src/utils/toc-builder.ts` | 228 | TOC 构建调度入口，协调两个检测系统 |
| `src/utils/toc-utils.ts` | — | 桶式重导出（barrel re-export），统一暴露工具函数 |
| `src/utils/dom-utils.ts` | — | DOM 操作工具（`collectBySelector`、`uniqueInDocumentOrder`、滚动） |
| `src/core/rebuild-scheduler.ts` | — | 重建调度器，URL 变化时触发缓存失效 |
| `src/core/dom-watcher.ts` | — | MutationObserver DOM 变化监听，使用哨兵选择器扩展监听范围 |
| `checks/chatbot-detector.test.mjs` | 961 | 聊天机器人检测的全面测试（~17 个测试用例） |
| `checks/content-region.test.mjs` | 442 | 内容区域检测的全面测试（~11 个测试用例） |

### 聊天机器人检测核心函数索引

| 函数 | 行号 | 说明 |
|------|------|------|
| `detectChatPage()` | 784 | 核心入口：三层检测 + 选择器发现 + Hint 兜底 |
| `detectByAria()` | 123 | Layer 1: ARIA 语义信号 |
| `detectByDataAttrs()` | 176 | Layer 2: 数据属性信号 |
| `detectByStructure()` | 202 | Layer 3: 结构启发式 |
| `discoverSelectors()` | 683 | 选择器发现入口（六种策略级联） |
| `discoverByExplicitRole()` | 330 | 策略 A: data-message-author-role 等 |
| `discoverByTestId()` | 390 | 策略 B: data-testid 模式匹配 |
| `discoverByGeminiWebComponent()` | 489 | 策略 C: ms-chat-turn Web Component |
| `discoverByDeepSeekMarkdown()` | 520 | 策略 D: .ds-markdown 启发式 |
| `discoverByClassPattern()` | 436 | 策略 E: 类名模式匹配 |
| `discoverByAriaLogAnalysis()` | 552 | 策略 F: role="log" 子元素分析 |
| `tryHintFallback()` | 715 | Hint 表兜底 |
| `buildChatbotTocItems()` | 930 | 对话式 TOC 构建 |
| `tryBuildChatbotTocItems()` | 1078 | 公共 API：检测 + 构建 |
| `isChatbotPage()` | 1088 | 公共 API：是否聊天页面 |
| `getChatbotSentinelSelector()` | 1097 | 公共 API：获取哨兵选择器 |
| `invalidateChatbotCache()` | 45 | 公共 API：清除缓存 |

### 内容区域检测核心函数索引

| 函数 | 行号 | 说明 |
|------|------|------|
| `detectContentRegion()` | 426 | 核心入口：四层策略级联 + 缓存 |
| `detectByLandmark()` | 206 | Layer 1: 语义地标 |
| `drillToPrimaryContent()` | 165 | 从 `<main>` 向下钻取最核心内容子元素 |
| `detectByClassHeuristic()` | 255 | Layer 2: 类名/ID 启发式 |
| `detectByAncestorScoring()` | 300 | Layer 3: 祖先计分法 |
| `evaluatePatterns()` | 119 | 正/负词汇评分 |
| `countHeadings()` | 142 | 标题计数（用于评分） |
| `invalidateContentRegionCache()` | 475 | 公共 API：清除缓存 |
