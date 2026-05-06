# 更新日志 / Changelog

所有 Web TOC Assistant 扩展的显著更改都将记录在此文件中。

All notable changes to the Web TOC Assistant extension will be documented in this file.

[版本目录 / Table of Contents](#版本目录--table-of-contents) • [最新版本 / Latest](#070---2026-05-07)

---

## 版本目录 / Table of Contents

- [0.7.0](#070---2026-05-07) - 2026-05-07
- [0.6.3](#063---2026-03-15) - 2026-03-15
- [0.6.2](#062---2026-03-14) - 2026-03-14
- [0.6.1](#061---2026-02-05) - 2026-02-05
- [0.6.0](#060---2026-02-05) - 2026-02-05
- [0.5.2](#052---2026-02-03) - 2026-02-03
- [0.5.1](#051---2026-02-03) - 2026-02-03
- [0.5.0](#050---2026-02-03) - 2026-02-03
- [0.4.1](#041---2026-01-23) - 2026-01-23
- [0.4.0](#040---2026-01-22) - 2026-01-22
- [0.3.0](#030---2026-01-15) - 2026-01-15
- [0.2.0](#020---2026-01-15) - 2026-01-15
- [0.1.1](#011---2025-09-15) - 2025-09-15
- [0.1.0](#010---2025-09-14) - 2025-09-14

---

## [0.7.0] - 2026-05-07

### 🚀 新增 / Added
- **触摸/触控笔拖拽支持 / Touch and pen drag support**
  - 拖拽系统从 mouse events 迁移到 pointer events，支持触摸屏和触控笔 / Migrated drag system from mouse events to pointer events for touchscreen and stylus support
  - 折叠徽标添加 `touch-action: none`，防止拖拽时触发页面滚动 / Added `touch-action: none` on collapsed badge to prevent page scroll during drag
- **`data-toc-owner` 命名空间属性 / Namespace attribute for extension elements**
  - 所有扩展 UI 元素添加 `data-toc-owner="web-toc-assistant"` 属性，避免与宿主页面元素冲突 / Added `data-toc-owner` attribute to all extension UI elements to avoid conflicts with host page elements
- **增量面板更新 / Incremental panel updates**
  - 新增 `updateItems` 方法，重建时仅更新变化的 TOC 项，避免完整重新渲染 / Added `updateItems` method to update only changed TOC items during rebuild, avoiding full re-renders
- **写入前日志（write-ahead intent）/ Write-ahead intent log**
  - 后台 service worker 写入前保存意图日志，防止 MV3 休眠导致数据丢失 / Saves intent before storage writes to prevent data loss from MV3 service worker hibernation
- **存储写入序列化 / Serialized storage writes**
  - 所有存储写入通过队列序列化，防止 TOCTOU 竞态条件 / All storage writes serialized through a queue to prevent TOCTOU race conditions
- **重建熔断器 / Rebuild circuit breaker**
  - 追踪连续重建失败次数，超过阈值后冷却，防止无限重建循环 / Tracks consecutive rebuild failures and cools down after threshold to prevent infinite rebuild loops
- **上下文失效刷新链接 / Context invalidated refresh link**
  - 扩展上下文失效通知中添加可点击的"刷新页面"链接 / Added clickable "Refresh Page" link in extension context invalidated notice

### 🔧 更改 / Changed
- **渲染函数重构为选项对象 / Render function refactored to options object**
  - `renderFloatingPanel` 从 14 个位置参数改为选项对象参数 / Changed `renderFloatingPanel` from 14 positional parameters to an options object
- **常量配置整合为 CFG 对象 / Constants consolidated into per-file CFG objects**
  - 所有模块的常量从分散的 `uiConst()` 调用整合为集中的 `CFG` 对象 / Consolidated scattered `uiConst()` calls into centralized `CFG` objects across all modules
- **MutationObserver 无条件启动 / MutationObserver starts unconditionally**
  - 不再检查选择器有效性，始终启动观察，改善 SPA 页面支持 / No longer checks selector validity before starting, always observes for improved SPA support
- **`pendingRebuild` 改为计数器 / `pendingRebuild` changed from boolean to counter**
  - 防止高频 DOM 变更时丢失重建请求 / Prevents lost rebuild requests during high-frequency DOM changes
- **并行标签处理 / Parallel tab processing**
  - `updateIconsForOrigin` 和 `broadcastEnabledToOrigin` 改为 `Promise.allSettled` 并行处理 / Changed to `Promise.allSettled` for parallel tab processing
- **动态防抖参数调优 / Dynamic debounce tuning**
  - 指数从 1.5 降至 1.3，上限从 2000ms 降至 1000ms，活跃页面上 TOC 更新更快 / Reduced exponent from 1.5 to 1.3 and cap from 2000ms to 1000ms for faster TOC updates on active pages
- **新增 `alarms` 权限 / Added `alarms` permission**
  - 使用 `chrome.alarms` 替代 `setInterval` 进行后台定时任务 / Uses `chrome.alarms` instead of `setInterval` for background scheduled tasks
- **CSS 选择器验证不再执行 DOM 查询 / CSS selector validation no longer executes DOM queries**
  - 移除 `querySelector` 回退验证，避免副作用 / Removed `querySelector` fallback validation to avoid side effects

### 🐛 修复 / Fixed
- **元素拾取器 Escape 键不再折叠 TOC 面板 / Escape in element picker no longer collapses TOC panel**
- **折叠徽标位置漂移 / Badge position drift**
  - 移除 `expand()` 中的位置保存，防止累积漂移 / Removed position save from `expand()` to prevent cumulative drift
- **面板头部按钮点击无响应 / Panel header buttons not responding to clicks**
- **元素拾取器高亮使用 `position:fixed` 修正滚动偏移 / Element picker highlight uses `position:fixed` for correct scroll tracking**
- **CSS 转义 polyfill 处理连字符后数字 / CSS escape polyfill handles digit-after-hyphen correctly**
- **浮动面板 roving tabindex、removalObserver、scroll 回退、用户选择追踪 / Floating panel roving tabindex, removalObserver, scroll fallback, user-selected tracking**
- **后台 service worker 双重切换、双击竞态、alarm 重置 / Background service worker double-toggle, double-click race, alarm reset**
- **配置写入错误处理、空值保护、变更防抖重置 / Config write error handling, null guard, mutation debounce reset**
- **toc-app 重建竞态、展开闪烁、活动状态恢复 / toc-app rebuild race, expand flicker, active state restoration**
- **内容脚本清理钩子和去重展开/折叠逻辑 / Content script cleanup hooks and deduplicated expand/collapse logic**
- **`destroy()` 后重建循环正确停止 / Rebuild loop correctly stops after `destroy()`**
- **`addWindowListener` 信号监听器防重复注册 / Prevent double-registration in `addWindowListener` signal fallback**
- **拖拽取消时不再保存位置 / Drag cancel no longer saves position**
- **后台 service worker 重启后可通过 `__TOC_APP_LOADED__` 重置重新启用 / Reset `__TOC_APP_LOADED__` in `destroy()` to allow re-enable without page reload**

### ⚡ 技术改进 / Technical Improvements
- **批量布局读取 / Batch layout reads**
  - `isElementVisible` 重构为 `batchCollectVisibility`，一次同步布局遍历替代逐元素查询 / Refactored `isElementVisible` into `batchCollectVisibility` with one synchronous layout pass instead of per-element queries
- **内存缓存 / In-memory caches**
  - 面板展开状态和徽标位置使用内存缓存，减少存储读取 / Added in-memory caches for panel expanded state and badge position to reduce storage reads
- **removalObserver 优化 / removalObserver optimization**
  - 缩窄为 `document.body` 的 `childList` 监听，替代全子树监听 / Narrowed to `document.body` `childList`-only instead of full subtree observation
- **配置脏标记 / Config dirty flag**
  - 重建时仅在配置变更后读取存储，跳过无变更读取 / Skips config storage reads during rebuild unless config has changed
- **模块依赖校验 / Module dependency validation**
  - 所有模块添加加载时依赖检查，缺失时输出明确错误日志 / Added load-time dependency checks to all modules with clear error logging when missing
- **IntersectionObserver 条目缓冲 / IntersectionObserver entry buffering**
  - RAF 节流期间缓冲条目而非丢弃，避免丢失滚动位置 / Buffers entries during RAF throttle instead of dropping, preventing lost scroll positions
- **每选择器匹配上限 / Per-selector match limit**
  - CSS `querySelectorAll` 结果添加上限，防止宽泛选择器导致页面冻结 / Added limit on `querySelectorAll` results per selector to prevent page freeze on broad selectors
- **i18n 补全 / i18n completion**
  - 新增 `ctxInvalidatedNotice`、`ctxInvalidatedRefresh`、`titleStorageQuotaExceeded`、`titleStorageWriteFailed`、`warningStorageQuotaPruned` 等国际化键 / Added new i18n keys for context invalidation, storage errors, and quota pruning

---

## [0.6.3] - 2026-03-15

### 🐛 修复 / Fixed
- **扩展上下文失效后的静默处理 / Silent handling for invalidated extension context**
  - 扩展重新加载后，旧 content script 的 storage 写入失败不再打印错误日志 / Storage write failures from old content script no longer log errors after extension reload
  - 上下文失效是预期行为，用户刷新页面后即可恢复 / Context invalidation is expected behavior; refreshing the page restores functionality
  - 仅 quota 相关错误仍会输出日志 / Only quota-related errors are still logged

---

## [0.6.2] - 2026-03-14

### 🐛 修复 / Fixed
- **语法错误修复 / Syntax error fixes**
  - 修复 `background.js` 中 `onRemoved` 监听器缺少闭合括号 / Fixed missing closing parenthesis in `background.js` onRemoved listener
  - 修复 `toc-app.js` 中 `Promise.race` 缺少闭合括号 / Fixed missing closing parenthesis in `toc-app.js` Promise.race
- **CSS 注入时序问题 / CSS injection timing issue**
  - 恢复动态 CSS 注入，避免静态注入导致的页面布局问题 / Reverted to dynamic CSS injection to prevent page layout issues caused by static injection
  - CSS 现在仅在扩展启用时注入，而非所有页面 / CSS is now only injected when extension is enabled, not on all pages
- **内容脚本初始化时机 / Content script initialization timing**
  - 添加 DOM 稳定性等待，确保页面渲染完成后再初始化 TOC / Added DOM stability wait to ensure TOC initializes after page rendering is complete

### 🔧 更改 / Changed
- **MutationObserver 优化 / MutationObserver improvements**
  - 添加动态防抖机制，频繁变更时自动增加防抖时间 / Added dynamic debounce mechanism that increases debounce time for frequent changes
  - 重建循环延迟从 0ms 增加到 16ms，减少主线程争用 / Increased rebuild loop delay from 0ms to 16ms to reduce main thread contention
- **计时器管理 / Timer management**
  - 统一计时器管理为 `timers` 对象 / Unified timer management into `timers` object
  - 持久化延迟从 160ms 增加到 500ms，减少存储 I/O 频率 / Increased persist delay from 160ms to 500ms to reduce storage I/O frequency
- **Rebuild 超时保护 / Rebuild timeout protection**
  - 添加 5 秒超时保护，防止 rebuild 无限等待 / Added 5-second timeout protection to prevent rebuild from hanging indefinitely

---

## [0.6.1] - 2026-02-05

### 🔄 改变 / Changed
- **窗口缩放定位策略 / Resize positioning strategy**
  - 窗口尺寸变化时，按钮/面板水平位置自动贴到原侧边（左/右） / On window resize, badge/panel snaps horizontally to anchored edge (left/right)
  - 竖直位置按窗口高度比例缩放 / Vertical position scales with viewport height ratio

### 🛠 修复 / Fixed
- 修复折叠/展开在窗口缩放后的对齐不一致问题 / Fixed collapse/expand alignment mismatch after resize
- 修复部分页面可能报错 `Cannot access 'anchorX' before initialization` / Fixed runtime `anchorX` initialization ReferenceError on some pages
- 修复窗口缩小后右侧按钮可能被挤到最左侧的问题 / Prevented right-anchored badge from jumping to the left edge when shrinking the window

---

## [0.6.0] - 2026-02-05

### 🚀 新增 / Added
- **导航锁定故障保护 / Navigation lock failsafe mechanism**
  - 添加8秒超时自动解锁机制，防止导航锁定卡死 / Added 8-second timeout auto-unlock to prevent navigation lock from getting stuck
  - 改进活动状态恢复逻辑 / Improved active state restoration logic
- **动画帧管理 / Animation frame management**
  - 添加 requestAnimationFrame 调度和清理机制 / Added requestAnimationFrame scheduling and cleanup mechanism
  - 改进组件销毁时的资源清理 / Enhanced resource cleanup on component destruction
- **存储配额管理 / Storage quota management**
  - 添加自动存储配额管理（最大400个键） / Added automatic storage quota management (max 400 keys)
  - 达到存储配额时提示用户确认数据修剪 / Prompts user for confirmation when storage quota is reached
  - 添加配额超出警告消息 / Added quota exceeded warning messages
- **图标更新队列 / Icon update queuing**
  - 添加队列机制防止图标快速更新闪烁 / Added queuing mechanism to prevent icon flicker on rapid updates
  - 改进跨标签图标状态同步 / Enhanced cross-tab icon state synchronization

### 🔧 更改 / Changed
- **错误处理和重试逻辑 / Error handling and retry logic**
  - 重构配置管理器，增强错误处理和重试机制 / Refactored config manager with enhanced error handling and retry logic
  - 添加 `mutateConfigsWithRetry` 用于配置变更验证 / Added `mutateConfigsWithRetry` for configuration mutation verification
  - 添加 `isQuotaExceededError` 和 `pruneObjectToLimit` 工具函数 / Added utility functions for quota detection and pruning
- **拖拽功能增强 / Enhanced drag-and-drop**
  - 改进拖拽状态管理和清理 / Improved drag state management and cleanup
  - 添加元素断开连接时的自动结束拖拽 / Added automatic drag end when element disconnected
- **键盘交互 / Keyboard interaction**
  - 改进徽标组件的键盘交互处理 / Enhanced keyboard interaction handling for badge component
- **元素拾取器 / Element picker**
  - 改进焦点管理和清理逻辑 / Improved focus management and cleanup logic
- **通配符匹配 / Wildcard matching**
  - 优化通配符匹配性能和可靠性 / Optimized wildcard matching performance and reliability

### 🐛 修复 / Fixed
- 修复配置删除时的潜在竞态条件 / Fixed potential race conditions in configuration deletion
- 修复 MutationObserver 的清理逻辑 / Fixed MutationObserver cleanup logic
- 修复浮动面板和元素拾取器的事件监听器泄漏 / Fixed event listener leaks in floating panel and element picker

### ⚡ 技术改进 / Technical Improvements
- 添加导航锁定超时配置常量 `NAV_LOCK_FAILSAFE_MS` (默认8000ms) / Added navigation lock timeout constant
- 添加图标更新状态跟踪（防止并发更新） / Added icon update state tracking to prevent concurrent updates
- 改进事件监听器和动画帧的清理 / Enhanced cleanup of event listeners and animation frames
- 改进 Toast 通知的移除逻辑 / Enhanced toast notification removal logic
- 添加更安全的 JSON 解析和选择器验证 / Added safer JSON parsing and selector validation
- 改进徽标和面板渲染，防止重复 / Enhanced badge and panel rendering to prevent duplicates
- 改进拖拽助手的错误处理 / Improved error handling in drag helper

---

## [0.5.2] - 2026-02-03

### 🐛 修复 / Fixed
- **防止页面跳动 / Fixed page jumping**
  - 修复定时刷新时页面跳动的问题 / Fixed page jumping issue during auto-refresh
  - 修复 TOC 内容为空时仍触发重建导致跳动 / Fixed rebuild triggering when TOC is empty causing page jumps
- **重建优化 / Rebuild optimization**
  - 添加重建中状态标志，防止 IntersectionObserver 干扰 / Added rebuild state flag to prevent IntersectionObserver interference
  - 优化重建逻辑，跳过不必要的重建（空内容、相同内容、badge 模式） / Optimized rebuild logic to skip unnecessary rebuilds (empty content, identical content, badge mode)
  - 确保所有代码路径正确重置重建标志 / Ensured rebuild flag is properly reset in all code paths

### ⚡ 技术改进 / Technical Improvements
- 新增 `window.TOC_APP.isRebuilding()` API 用于检查重建状态 / Added `window.TOC_APP.isRebuilding()` API to check rebuild state
- IntersectionObserver 现在在重建期间跳过 active 状态更新 / IntersectionObserver now skips active state updates during rebuild
- 改进错误处理，确保重建标志在异常情况下也能正确重置 / Improved error handling to ensure rebuild flag resets correctly in exceptional cases

---

## [0.5.1] - 2026-02-03

### 🔧 更改 / Changed
- **渲染逻辑优化 / Rendering logic optimization**
  - 防止重复初始化，提高稳定性 / Prevented duplicate initialization for improved stability
  - 优化状态管理，减少代码冗余 / Optimized state management, reduced code redundancy
- **交互体验增强 / Enhanced interaction experience**
  - 平滑的面板展开/折叠过渡动画 / Smooth panel expand/collapse transition animations
  - 改进TOC按钮和面板位置同步机制 / Improved position synchronization between TOC button and panel
  - 优化拖拽交互，提升操作流畅度 / Enhanced drag interaction for smoother operation

### ⚡ 技术改进 / Technical Improvements
- 新增CSS过渡动画样式 / Added CSS styles for transition animations
- 改进组件生命周期管理和事件监听器清理 / Improved component lifecycle management and event listener cleanup
- 代码精简优化 / Code refinement and optimization

---

## [0.5.0] - 2026-02-03

### 🚀 新增 / Added
- 可拖拽浮动面板头部用于重新定位 / Draggable floating panel header for repositioning
- 面板和TOC按钮位置同步（折叠/展开时） / Position synchronization between panel and TOC button when collapsing/expanding
- 右侧定位支持（面板和TOC按钮） / Right-side positioning support for both panel and TOC button
- 面板位置存储 / Panel position storage (`tocPanelPosMap`)
- 增强元素可见性检测（使用计算样式、边界矩形和父元素裁剪检查） / Enhanced element visibility detection with computed styles, bounding rects, and parent clipping checks
- 注入失败提示 / Injection failed notification with retry option
- 本地化错误处理 / Localization fallback for missing translation keys

### 🔧 更改 / Changed
- **内容脚本注入方式重构 / Content script injection method refactored**
  从 manifest.json 静态声明改为通过 background.js 使用 `chrome.scripting.executeScript` 动态注入
  Changed from static declaration in manifest.json to dynamic injection via `chrome.scripting.executeScript` in background.js
- 添加 scripting 权限 / Added `scripting` permission for content script injection
- 优化元素过滤逻辑 / Optimized element filtering logic in TOC builder
- 简化 CSS 选择器工具 / Streamlined CSS selector utility functions
- 改进存储操作错误处理 / Improved error handling and fallback for storage operations
- 优化TOC按钮位置管理 / Enhanced TOC button position management with dedicated storage key

### ⚡ 技术改进 / Technical Improvements
- 检测 display:none、visibility:hidden、opacity:0 / Detect CSS hidden properties
- 检测零尺寸元素 / Detect zero-width/zero-height elements
- 检测父元素溢出裁剪 / Detect parent overflow clipping
- 检测 offsetParent 为 null / Detect detached DOM elements

---

## [0.4.1] - 2026-01-23

### 🔧 更改 / Changed
- 存储 API 现代化为 Promise 风格 / Modernized storage APIs to Promise-based style
- 改进存储操作的错误处理 / Improved error handling across storage operations

### 🐛 修复 / Fixed
- 图标切换状态现在正确使用 Promise 风格的 `chrome.action` API / Icon toggle state now properly uses Promise-based `chrome.action` API

---

## [0.4.0] - 2026-01-22

### 🚀 新增 / Added
- 配置对话框中的选择器删除功能 / Selector deletion functionality in configuration dialog
- 改进的对话框处理和 UI 反馈 / Improved dialog handling and UI feedback

### 🔧 更改 / Changed
- 改进核心组件的健壮性和错误处理 / Improved robustness and error handling across core components
- 增强事件处理和内存管理 / Enhanced event handling and memory management

---

## [0.3.0] - 2026-01-15

### 🚀 新增 / Added
- TOC 面板的深色模式支持 / Dark mode support for TOC panel
- 本地化的扩展标题消息 / Localized extension title messages

### 🔧 更改 / Changed
- 改进组件的错误处理和 UI 反馈 / Improved error handling and UI feedback across components

---

## [0.2.0] - 2026-01-15

### 🚀 新增 / Added
- 国际化 (i18n) 支持 / Internationalization (i18n) support
- 默认中文 (`zh_CN`) 语言环境 / Default Chinese (`zh_CN`) locale
- 本地化的消息和 UI 元素 / Localized messages and UI elements
- 每站点启用/禁用 UI 功能 / Per-site enable/disable UI functionality
- 站点级启用/禁用切换，带持久化状态 / Site-level enable/disable toggle with persistent state

### 🔧 更改 / Changed
- 从 `chrome.storage.sync` 切换到 `chrome.storage.local` 用于每站点配置 / Switched from `chrome.storage.sync` to `chrome.storage.local` for per-site configuration
- 更新图标颜色为蓝色主题 / Updated icon colors to blue theme
- 添加浮动 TOC 叠加层 UI 组件 / Added floating TOC overlay UI components

---

## [0.1.1] - 2025-09-15

### 🐛 修复 / Fixed
- 修复初始版本的错误和稳定性问题 / Fixed bugs and stability issues from initial release
- 改进错误处理和 UI 反馈 / Improved error handling and UI feedback
- 增强事件处理和内存管理 / Enhanced event handling and memory management

---

## [0.1.0] - 2025-09-14

### 🚀 新增 / Added
- 初始发布 / Initial release
- 从网页标题生成基本 TOC / Basic TOC generation from webpage headings
- 带交互式导航的浮动面板 / Floating panel with interactive navigation
- 自定义选择器配置 (CSS/XPath) / Custom selector configuration (CSS/XPath)
- 折叠TOC按钮模式 / Collapsed TOC button mode
- 用于选择器创建的元素选择器 / Element picker for selector creation
- 每站点配置存储 / Per-site configuration storage
- DOM 变化时自动重建 / Auto-rebuild on DOM mutations
