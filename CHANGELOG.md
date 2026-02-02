# 更新日志 / Changelog

所有 Web TOC Assistant 扩展的显著更改都将记录在此文件中。

All notable changes to the Web TOC Assistant extension will be documented in this file.

[版本目录 / Table of Contents](#版本目录--table-of-contents) • [最新版本 / Latest](#050---2026-02-03)

---

## 版本目录 / Table of Contents

- [0.5.0](#050---2026-02-03) - 2026-02-03
- [0.4.1](#041---2026-01-23) - 2026-01-23
- [0.4.0](#040---2026-01-22) - 2026-01-22
- [0.3.0](#030---2026-01-15) - 2026-01-15
- [0.2.0](#020---2026-01-15) - 2026-01-15
- [0.1.1](#011---2025-09-15) - 2025-09-15
- [0.1.0](#010---2025-09-14) - 2025-09-14

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
