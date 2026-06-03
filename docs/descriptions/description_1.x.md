# Web TOC Assistant / 网页目录助手

## 中文商店描述

### 网页目录助手 - 为长网页自动生成可交互目录

网页目录助手是一款轻量级浏览器扩展。它会在浏览器本地分析当前网页的标题结构，为长文章、技术文档、教程和复杂网页生成可交互目录，帮助你快速理解内容层级并跳转到目标章节。

### 1.x 新版界面

1.x 默认使用全新的贴边式 Edge Dock：

- **目录缩略预览**：收起时显示当前阅读位置附近的层级横线，标题层级越深，横线越短并向内缩进。
- **当前章节高亮**：滚动页面时，缩略横线和展开目录会同步高亮正在阅读的章节。
- **悬停展开目录**：桌面端将鼠标移到缩略横线区域，即可向页面内侧展开轻量目录卡片；移开后自动收起。
- **直接点击跳转**：不展开目录也可以点击缩略横线，直接跳转到对应章节。
- **触屏设备支持**：在触屏设备上点击目录区域，可临时切换展开和收起状态。
- **左右侧切换**：工具条可以吸附在页面左侧或右侧，并记住每个网站的位置偏好。

### 快捷设置

将鼠标移到圆形设置图标上，即可展开快捷菜单：

- 刷新目录
- 拾取元素
- 管理站点配置
- 移动到页面另一侧
- 切换到经典模式

### 经典模式

如果更喜欢原来的交互方式，可以切换回经典模式。经典模式保留蓝色“目录”浮动徽章和可自由拖拽的目录面板。界面模式是全局偏好，会同步应用到已打开的标签页。

### 核心功能

- **自动生成目录**：默认识别网页中的 `h1-h6` 标题。
- **平滑快速跳转**：点击目录项即可滚动到对应内容。
- **可视化元素拾取**：直接在网页上点击目标元素，快速创建自定义目录规则。
- **CSS 与 XPath 选择器**：适配标题结构不标准的网页。
- **按网站保存配置**：为不同网站保存独立的启用状态、选择器和界面位置。
- **动态内容更新**：网页内容变化后自动更新目录，适合单页应用和持续加载页面。
- **浅色与深色主题**：自动适配系统主题。

### 适用场景

- 阅读 API 文档和开发指南
- 浏览长篇文章、博客和新闻专题
- 学习在线课程和分步教程
- 快速浏览研究文章与复杂网页
- 为标题结构不标准的网站建立专属目录规则

### 隐私与权限

网页目录助手只在你的浏览器本地分析网页结构。

- `storage`：保存站点配置和界面偏好
- `tabs`：支持按网站启用或禁用扩展
- `scripting`：在已启用的网站中注入目录功能

扩展不会将网页内容、浏览记录或个人信息发送到任何服务器。

### 开源地址

https://github.com/BingqiangZhou/WebContentOutline-BrowserExtension

---

## English Store Description

### Web TOC Assistant - Generate an Interactive Outline for Long Webpages

Web TOC Assistant is a lightweight browser extension that analyzes the current page locally and creates an interactive table of contents for long articles, technical documentation, tutorials, and complex webpages. It helps you understand page structure and jump to the section you need.

### New 1.x Interface

Version 1.x uses the modern Edge Dock by default:

- **Live outline preview**: The collapsed dock shows nearby heading bars. Deeper headings use shorter, indented bars.
- **Active section highlight**: As you scroll, both the collapsed preview and expanded TOC track your current reading position.
- **Hover-to-expand TOC**: On desktop, hover over the outline bars to open a lightweight TOC card inward from the page edge. Move away to collapse it automatically.
- **Direct collapsed navigation**: Click an outline bar to jump to a section without opening the full card.
- **Touch support**: On touch devices, tap the TOC area to temporarily toggle the expanded card.
- **Left or right edge**: Move the dock between page edges and remember its position for each website.

### Quick Settings

Hover over the circular settings icon to open the quick menu:

- Refresh TOC
- Pick Element
- Site Config
- Move to the opposite edge
- Switch to classic mode

### Classic Mode

Prefer the original interaction? Switch back to classic mode. It keeps the blue `TOC` floating badge and the freely draggable TOC panel. The UI-mode preference is global and synchronizes across open tabs.

### Key Features

- **Automatic TOC generation**: Detects standard `h1-h6` headings by default.
- **Fast smooth navigation**: Click any TOC item to scroll to the matching section.
- **Visual element picker**: Click page elements directly to create custom outline rules.
- **CSS and XPath selectors**: Adapt the TOC to websites with non-standard heading structures.
- **Per-site preferences**: Save enablement, selectors, and interface positions for each website.
- **Dynamic content updates**: Refreshes the TOC as page content changes, including single-page applications.
- **Light and dark themes**: Adapts automatically to your system theme.

### Great For

- API references and developer guides
- Long-form articles, blogs, and news features
- Online courses and step-by-step tutorials
- Research articles and complex webpages
- Websites that need custom outline rules

### Privacy and Permissions

Web TOC Assistant analyzes webpage structure locally in your browser.

- `storage`: Save site settings and interface preferences
- `tabs`: Enable or disable the extension per website
- `scripting`: Inject the TOC feature into enabled webpages

The extension does not send webpage content, browsing history, or personal information to any server.

### Open Source

https://github.com/BingqiangZhou/WebContentOutline-BrowserExtension
