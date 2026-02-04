# Web TOC Assistant / 网页目录助手

---

## English Description

# Web TOC Assistant - Automatically Generate Table of Contents for Any Webpage

## What is Web TOC Assistant?

Web TOC Assistant is a browser extension that automatically generates a floating, interactive table of contents (TOC) for any webpage you visit. It transforms long, scrolling pages into easily navigable documents with just one click.

## Why Install Web TOC Assistant?

### 📚 Perfect for Long-Form Content

Stop scrolling endlessly through long articles, technical documentation, tutorials, and blog posts. Web TOC Assistant automatically detects headings (h1-h6) and creates a navigation panel that lets you jump to any section instantly.

### 🎯 Works on Any Website

Unlike some TOC tools that only work on specific platforms, Web TOC Assistant works everywhere:

- **Technical Documentation** - API docs, programming guides, tutorials
- **Blog Articles** - Medium, personal blogs, news sites
- **Forum Posts** - Reddit, Stack Overflow, community forums
- **Research Papers** - Academic articles, PDFs converted to HTML
- **Online Courses** - Step-by-step tutorials, learning platforms

### ⚙️ Highly Customizable

Every website is different. Web TOC Assistant adapts to your needs:

- **Custom Selectors** - Use CSS or XPath selectors to target specific elements
- **Visual Element Picker** - Simply click on any element to create a custom selector
- **Per-Site Control** - Enable/disable the extension for individual websites
- **Position Memory** - Drag the floating button anywhere; it remembers your preference

### 🌙 Dark Mode Support

Automatically adapts to your browser's theme:
- **Light Theme** - Clean white background with dark text
- **Dark Theme** - Easy on the eyes with dark background and light text
- **Automatic Detection** - Seamlessly switches based on your system preferences

### 🌐 Fully Internationalized

- **English** - Full support for English-speaking users
- **中文** - Complete Chinese support
- **Auto-detection** - Automatically switches to your browser's language (defaults to English)

## Key Features

### Automatic TOC Generation

- **Automatic Header Detection** - Recognizes standard HTML headings (h1-h6) by default
- **Enhanced Visibility Detection** - Advanced filtering using computed styles, bounding rects, and parent clipping checks
- **Content Filtering** - Skips hidden elements, zero-size elements, and overflow-clipped content
- **Real-time Updates** - Automatically rebuilds TOC when page content changes
- **Debounced Scanning** - 500ms debounce prevents excessive updates

### Visual Element Picker

- **Hover Highlighting** - See exactly what you're selecting in real-time
- **One-Click Selector Generation** - Automatically creates CSS selectors
- **Site Configuration Saving** - Save selectors as per-site preferences
- **Individual Selector Management** - Delete selectors one at a time with hover-to-show delete button

### Flexible UI

- **Floating Panel** - Expandable TOC panel with left/right side positioning
- **Draggable Panel Header** - Drag the panel header to reposition; position automatically saved
- **Draggable TOC Button** - Collapsed "TOC" button that you can position anywhere
- **Position Memory & Sync** - Remembers button and panel position per domain; positions synchronize when collapsing/expanding
- **Smooth Animations** - Fluid panel expand/collapse transitions for better user experience
- **Smooth Scrolling** - Click any TOC item to smoothly scroll to that section
- **Theme-Aware Design** - Adapts to light/dark mode automatically
- **Fixed Width Dialogs** - All dialogs maintain consistent 280px width with text ellipsis
- **Dialog Mutual Exclusion** - Only one dialog shown at a time for cleaner UI

### Auto Navigation

- **Current Position Highlighting** - Automatically highlights your current reading location
- **Navigation Locking** - Prevents jumping when you manually click TOC items
- **Navigation Lock Failsafe** - Auto-unlocks after timeout if stuck (prevents lock from getting stuck)
- **Active Item Recovery** - Restores highlight state after page changes
- **Anti-Jump Mechanism** - Prevents page jumping during auto-refresh and rebuilds

### Advanced Features

- **Animation Frame Management** - Properly schedules and cleans up animation frame callbacks
- **Storage Quota Handling** - Auto-manages storage quota with user confirmation prompts
- **Config Mutation Retry** - Retries failed configuration changes with verification
- **Enhanced Error Handling** - Improved error handling and recovery mechanisms throughout
- **Optimized Icon Updates** - Queued icon updates prevent flickering on rapid state changes

## How It Works

### Basic Usage

1. **Install** the extension from the Edge/Chrome Web Store
2. **Visit any webpage** - The floating "TOC" button appears
3. **Click the button** to expand the TOC panel
4. **Navigate** - Click any heading to jump to that section

### Advanced Usage

1. **Per-Site Control** - Click the extension icon to enable/disable for specific sites
2. **Custom Selectors** - If the default TOC isn't accurate:
   - Click "Pick Element"
   - Hover over elements on the page
   - Click to select the element you want to track
   - Save as a site configuration
3. **Manage Selectors** - In site configuration dialog:
   - View all saved selectors for current site
   - Hover over any selector to reveal delete button
   - Click ✕ to remove individual selectors
4. **Reposition UI** - Drag the TOC button or panel header to any position; positions are saved and synchronized

### Theme Switching

The extension automatically detects your browser's theme setting:
- **Light Mode**: White background with dark text
- **Dark Mode**: Dark gray background with light text for comfortable viewing

No manual configuration required - it just works!

## Use Cases

| Scenario | Before | After |
|----------|--------|-------|
| **Reading API Docs** | Scroll through 50+ sections | Click to jump instantly |
| **Long Blog Posts** | Lose your place while skimming | See structure, jump anywhere |
| **Research Papers** | Manually search for sections | TOC shows all sections |
| **Online Tutorials** | Scroll back to find previous steps | Navigate step-by-step easily |
| **Forum Threads** | Hunt for specific discussions | Jump to relevant comments |
| **Night Reading** | Eye strain from bright white backgrounds | Dark mode protects your eyes |

## What's New

### Latest Version

For detailed version history and updates, please visit: https://github.com/BingqiangZhou/WebContentOutline-BrowserExtension/blob/main/CHANGELOG.md

---

## Permissions & Privacy

- **storage** - Saves your site configurations and preferences locally
- **tabs** - Enables per-site enable/disable functionality

**No data is sent to any server.** All configurations are stored locally in your browser.

## Install Now

Ready to transform your browsing experience? Install Web TOC Assistant and start navigating the web more efficiently.

---

**Note**: This is a lightweight, open-source extension. Source code available on https://github.com/BingqiangZhou/WebContentOutline-BrowserExtension . Contributions welcome!

---

## 中文描述

# 网页目录助手 - 为任意网页自动生成目录

## 什么是网页目录助手？

网页目录助手是一款浏览器扩展，可以自动为任何网页生成浮动的、可交互的目录。它让冗长的滚动页面变得易于导航，只需轻轻一点。

## 为什么要安装网页目录助手？

### 📚 完美适配长篇内容

不再在冗长的文章、技术文档、教程和博客中无休止地滚动。网页目录助手自动识别标题（h1-h6），创建导航面板，让您可以瞬间跳转到任何章节。

### 🎯 适用于任何网站

与一些只能在特定平台上使用的目录工具不同，网页目录助手无处不在：

- **技术文档** - API 文档、编程指南、教程
- **博客文章** - Medium、个人博客、新闻网站
- **论坛帖子** - Reddit、Stack Overflow、社区论坛
- **研究论文** - 学术文章、转 HTML 的 PDF
- **在线课程** - 分步教程、学习平台

### ⚙️ 高度可定制

每个网站都不同。网页目录助手根据您的需求进行调整：

- **自定义选择器** - 使用 CSS 或 XPath 选择器定位特定元素
- **可视化元素拾取** - 只需点击元素即可创建自定义选择器
- **按站点控制** - 为单个网站启用/禁用扩展
- **位置记忆** - 将浮动按钮拖到任何位置；它会记住您的偏好

### 🌙 深色模式支持

自动适应您的浏览器主题：
- **浅色主题** - 纯净的白色背景配深色文字
- **深色主题** - 深灰背景配浅色文字，护眼舒适
- **自动检测** - 根据您的系统偏好设置自动切换

### 🌐 完整国际化

- **English** - 为英语用户提供完整支持
- **中文** - 完整的中文支持
- **自动检测** - 自动切换到浏览器语言（默认为英语）

## 核心功能

### 自动目录生成

- **自动标题识别** - 默认识别标准 HTML 标题（h1-h6）
- **增强可见性检测** - 使用计算样式、边界矩形和父元素裁剪检查进行高级过滤
- **内容过滤** - 跳过隐藏元素、零尺寸元素和溢出裁剪内容
- **实时更新** - 页面内容变化时自动重建目录
- **防抖扫描** - 500ms 防抖避免频繁更新

### 可视化元素拾取

- **悬停高亮** - 实时查看您正在选择的内容
- **一键生成选择器** - 自动创建 CSS 选择器
- **站点配置保存** - 将选择器保存为站点偏好设置
- **单个选择器管理** - 悬停显示删除按钮，可逐个删除选择器

### 灵活的界面

- **浮动面板** - 可展开的目录面板，支持左右侧定位
- **可拖拽面板** - 拖拽面板标题栏可重新定位，位置自动保存
- **可拖拽TOC按钮** - 可拖动的"目录"按钮，可放置在任何位置
- **位置记忆与同步** - 按域名记住按钮和面板位置，折叠/展开时自动同步
- **流畅动画** - 平滑的面板展开/折叠过渡效果，提升用户体验
- **平滑滚动** - 点击任何目录项平滑滚动到该部分
- **主题自适应** - 自动适应浅色/深色主题
- **固定宽度对话框** - 所有对话框保持一致的 280px 宽度，长文本自动省略
- **对话框互斥** - 同一时间只显示一个对话框，界面更整洁

### 自动导航

- **当前位置高亮** - 自动高亮当前阅读位置
- **导航锁定** - 手动点击目录项时防止跳动
- **导航锁故障保护** - 锁定卡死时超时自动解锁（防止卡死）
- **活动项恢复** - 页面变化后恢复高亮状态
- **防跳动机制** - 防止定时刷新和重建时页面跳动

### 高级功能

- **动画帧管理** - 正确调度和清理动画帧回调
- **存储配额处理** - 自动管理存储配额，超限时提示用户确认
- **配置变更重试** - 失败时重试配置变更并验证结果
- **增强错误处理** - 改进全范围的错误处理和恢复机制
- **优化图标更新** - 队列化图标更新，防止快速状态变化时闪烁

## 使用方法

### 基本使用

1. **安装** 扩展（从 Edge/Chrome 应用商店）
2. **访问任何网页** - 浮动"目录"按钮会出现
3. **点击按钮** 展开目录面板
4. **导航** - 点击任何标题跳转到该部分

### 高级使用

1. **按站点控制** - 点击扩展图标为特定站点启用/禁用
2. **自定义选择器** - 如果默认目录不准确：
   - 点击"拾取元素"
   - 在页面上悬停元素
   - 点击选择您想要跟踪的元素
   - 保存为站点配置
3. **管理选择器** - 在站点配置对话框中：
   - 查看当前站点所有已保存的选择器
   - 悬停在任何选择器上显示删除按钮
   - 点击 ✕ 删除单个选择器
4. **调整界面位置** - 拖动TOC按钮或面板标题栏到任意位置，位置会自动保存并同步

### 主题切换

扩展会自动检测浏览器的主题设置：
- **浅色模式**：白色背景配深色文字
- **深色模式**：深灰色背景配浅色文字，护眼舒适

无需手动配置 - 自动生效！

## 使用场景

| 场景 | 使用前 | 使用后 |
|------|--------|-------|
| **阅读 API 文档** | 滚动浏览 50+ 个章节 | 点击即可瞬间跳转 |
| **长篇博客** | 浏览时迷失位置 | 看到结构，随意跳转 |
| **研究论文** | 手动搜索章节 | 目录显示所有章节 |
| **在线教程** | 滚回查找之前的步骤 | 轻松逐步导航 |
| **论坛帖子** | 寻找特定讨论 | 跳转到相关评论 |
| **夜间阅读** | 明亮白色背景刺眼 | 深色模式保护双眼 |

## 更新内容

### 最新版本

完整的版本历史和更新内容，请访问：https://github.com/BingqiangZhou/WebContentOutline-BrowserExtension/blob/main/CHANGELOG.md 

---

## 权限与隐私

- **storage** - 在本地保存您的站点配置和偏好设置
- **tabs** - 实现按站点启用/禁用功能

**不向任何服务器发送数据。** 所有配置都存储在您的浏览器本地。

## 立即安装

准备好改变您的浏览体验了吗？安装网页目录助手，开始更高效地浏览网页。

---

**注意**：这是一个轻量级开源扩展。源代码可在 https://github.com/BingqiangZhou/WebContentOutline-BrowserExtension 上获取。欢迎贡献！
