# 更新日志 / Changelog

所有 Web TOC Assistant 扩展的显著更改都将记录在此文件中。

All notable changes to the Web TOC Assistant extension will be documented in this file.

[版本目录 / Table of Contents](#版本目录--table-of-contents) • [最新版本 / Latest](#054---2026-02-05)

---

## 版本目录 / Table of Contents

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
