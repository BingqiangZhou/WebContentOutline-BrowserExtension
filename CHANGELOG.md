# 更新日志 / Changelog

所有 Web TOC Assistant 扩展的显著更改都将记录在此文件中。

All notable changes to the Web TOC Assistant extension will be documented in this file.

## [0.4.1] - 2026-01-23

### 更改 / Changed
- 存储 API 现代化为 Promise 风格 / Modernized storage APIs to Promise-based style
- 改进存储操作的错误处理 / Improved error handling across storage operations

### 修复 / Fixed
- 图标切换状态现在正确使用 Promise 风格的 `chrome.action` API / Icon toggle state now properly uses Promise-based `chrome.action` API

## [0.4.0] - 2026-01-22

### 新增 / Added
- 配置对话框中的选择器删除功能 / Selector deletion functionality in configuration dialog
- 改进的对话框处理和 UI 反馈 / Improved dialog handling and UI feedback

### 更改 / Changed
- 改进核心组件的健壮性和错误处理 / Improved robustness and error handling across core components
- 增强事件处理和内存管理 / Enhanced event handling and memory management

## [0.3.0] - 2026-01-15

### 新增 / Added
- TOC 面板的深色模式支持 / Dark mode support for TOC panel
- 本地化的扩展标题消息 / Localized extension title messages

### 更改 / Changed
- 改进组件的错误处理和 UI 反馈 / Improved error handling and UI feedback across components

## [0.2.0] - 2026-01-15

### 新增 / Added
- 国际化 (i18n) 支持 / Internationalization (i18n) support
- 默认中文 (`zh_CN`) 语言环境 / Default Chinese (`zh_CN`) locale
- 本地化的消息和 UI 元素 / Localized messages and UI elements
- 每站点启用/禁用 UI 功能 / Per-site enable/disable UI functionality
- 站点级启用/禁用切换，带持久化状态 / Site-level enable/disable toggle with persistent state

### 更改 / Changed
- 从 `chrome.storage.sync` 切换到 `chrome.storage.local` 用于每站点配置 / Switched from `chrome.storage.sync` to `chrome.storage.local` for per-site configuration
- 更新图标颜色为蓝色主题 / Updated icon colors to blue theme
- 添加浮动 TOC 叠加层 UI 组件 / Added floating TOC overlay UI components

## [0.1.1] - 2025-09-15

### 修复 / Fixed
- 修复初始版本的错误和稳定性问题 / Fixed bugs and stability issues from initial release
- 改进错误处理和 UI 反馈 / Improved error handling and UI feedback
- 增强事件处理和内存管理 / Enhanced event handling and memory management

## [0.1.0] - 2025-09-14

### 新增 / Added
- 初始发布 / Initial release
- 从网页标题生成基本 TOC / Basic TOC generation from webpage headings
- 带交互式导航的浮动面板 / Floating panel with interactive navigation
- 自定义选择器配置 (CSS/XPath) / Custom selector configuration (CSS/XPath)
- 折叠徽章模式 / Collapsed badge mode
- 用于选择器创建的元素选择器 / Element picker for selector creation
- 每站点配置存储 / Per-site configuration storage
- DOM 变化时自动重建 / Auto-rebuild on DOM mutations
