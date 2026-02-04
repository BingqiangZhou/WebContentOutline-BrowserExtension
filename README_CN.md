# 网页目录助手 / Web TOC Assistant

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green.svg)](https://chromewebstore.google.com/detail/fnicpbioofepnfgpdhggjmhjalogbgcn)
[![Edge Extension](https://img.shields.io/badge/Edge-Extension-blue.svg)](https://microsoftedge.microsoft.com/addons/detail/jejjhfkmfdlccdbifpihkepaabcdlijc)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green.svg)](https://developer.chrome.com/docs/extensions/mv3/)

**[English](README.md)** | [中文](README_CN.md)

一个网页目录生成器，为任意网站自动创建可交互的浮动目录，提升阅读体验。

<p align="left">
  <img src="dist/descriptions/Gemini_Generated_screenshots1280x800.png" alt="Web TOC Assistant Screenshot" width="800"/>
</p>

## ✨ 核心功能

### 🎯 目录生成
- **默认标题识别**：没有配置选择器时，自动使用页面标题结构（h1-h6标签）
- **增强可见性检测**：增强的元素过滤，使用计算样式、边界矩形和父元素裁剪检测，确保只包含真正可见的元素
- **自动过滤**：自动过滤隐藏元素（display:none、visibility:hidden、opacity:0）、零尺寸元素和溢出裁剪内容
- **自定义选择器**：支持CSS和XPath选择器，适配各种网站结构
- **实时更新**：页面内容变化时自动重新生成目录（防抖500ms）

### 🎪 可视化元素拾取
- **鼠标悬停高亮**：移动鼠标实时高亮目标元素
- **一键生成选择器**：点击元素自动生成CSS选择器
- **配置保存**：将选择器保存为站点专属配置
- **自动排除**：自动排除扩展自身的UI元素

### 📍 灵活的界面交互
- **浮动面板**：可展开的目录面板，支持左右侧显示
- **可拖拽面板**：拖拽面板标题栏可重新定位，位置自动保存
- **可拖拽按钮**：收起后的"目录"按钮支持拖拽定位
- **位置记忆**：按域名记住面板和按钮位置，折叠/展开时同步位置
- **平滑滚动**：点击目录项平滑滚动到对应位置

### 🔄 导航体验
- **当前位置高亮**：自动高亮当前阅读位置对应的目录项（IntersectionObserver）
- **导航锁定**：用户点击导航时锁定高亮，防止滚动时跳动
- **导航锁故障保护**：锁定卡死时8秒后自动解锁（v0.6.0+新增）
- **状态恢复**：页面变化后自动恢复高亮状态
- **防跳动机制**：防止定时刷新和重建时页面跳动

### ⚙️ 站点配置管理
- **通配符匹配**：使用URL模式匹配，支持通配符（如 `https://example.com/*`）
- **本地存储**：配置与站点启用状态保存到 `chrome.storage.local`
- **配置管理**：可查看、清空站点配置
- **多选择器支持**：同一站点可配置多个CSS/XPath选择器

### 🌐 多站点控制
- **按站点启用/禁用**：每个站点独立控制扩展是否生效
- **图标状态指示**：启用=蓝色图标，禁用=灰色图标
- **跨标签同步**：同一站点的多个标签页自动同步状态

## 🚀 安装使用

### 安装步骤

#### 方法一：从应用商店安装（推荐）

1. **Chrome 浏览器**：访问 [Chrome 网上应用店](https://chromewebstore.google.com/detail/fnicpbioofepnfgpdhggjmhjalogbgcn)
2. **Edge 浏览器**：访问 [Microsoft Edge 加载项](https://microsoftedge.microsoft.com/addons/detail/jejjhfkmfdlccdbifpihkepaabcdlijc)
3. 点击"添加至 Chrome/Edge"按钮安装
4. 安装完成后访问任意网页即可使用

#### 方法二：加载已解压的扩展程序（开发者模式）

1. 下载项目文件到本地
2. 打开 Chrome 浏览器访问 `chrome://extensions/` 或 Edge 浏览器访问 `edge://extensions/`
3. 开启"开发人员模式"（Developer Mode）
4. 点击"加载已解压的扩展程序"（Load unpacked），选择项目文件夹
5. 安装完成后访问任意网页即可使用

### 基本操作

#### 1. 启用/禁用扩展

**操作方式**：点击浏览器工具栏中的"网页目录助手"图标

**效果**：
- 启用状态：图标变为蓝色，页面出现"目录"悬浮按钮
- 禁用状态：图标变为灰色，"目录"按钮消失
- 同步效果：同一站点的其他标签页会自动同步状态

#### 2. 展开目录面板

**操作方式**：点击页面上的"目录"悬浮按钮

**默认行为**：
- 自动识别页面中的 h1-h6 标题
- 在左侧或右侧显示浮动面板
- 显示当前页面内容结构

#### 3. 快速导航

**操作方式**：点击目录中的任意项

**效果**：
- 平滑滚动到对应内容位置
- 自动高亮当前阅读位置
- 支持键盘方向键上下选择

#### 4. 拾取元素（自定义选择器）

**适用场景**：页面默认识别的标题不准确，或需要识别其他元素

**操作步骤**：
1. 展开目录面板
2. 点击"拾取元素"按钮
3. 鼠标在页面上移动，会高亮显示目标元素
4. 点击想要识别的元素
5. 自动生成CSS选择器并显示预览
6. 点击"保存"将选择器保存为当前站点配置

**注意事项**：
- 拾取模式下按 ESC 键可取消
- 右键点击也可取消拾取
- 拾取模式20秒无操作自动取消
- 不会选中扩展自身的UI元素

#### 5. 管理站点配置

**操作方式**：在目录面板中点击"保存管理"按钮

**功能**：
- 查看当前站点的所有配置
- 清空当前站点的配置
- 查看配置的URL匹配规则

#### 6. 调整按钮和面板位置

**操作方式**：
- 拖拽"目录"悬浮按钮到任意位置
- 拖拽展开面板的标题栏到任意位置

**效果**：
- 按钮和面板会记住当前位置（按域名保存）
- 刷新页面或下次访问时自动恢复
- 折叠/展开时自动同步位置
- 如果保存的位置超出屏幕，自动使用默认位置

#### 7. 刷新目录

**操作方式**：在目录面板中点击"刷新"按钮

**适用场景**：
- 页面内容动态变化后需要重新扫描
- 怀疑目录不准确时

### 高级功能

#### 可拖拽面板
**操作方式**：点击并拖拽面板标题栏可重新定位

**效果**：
- 面板位置按域名自动保存
- 折叠/展开时与按钮位置同步
- 鼠标指针变化指示可拖拽状态

### 高级使用

#### URL 匹配规则

配置支持通配符匹配：
- 精确匹配：`https://example.com/page`
- 域名匹配：`https://example.com/*`
- 路径匹配：`https://example.com/docs/*`

#### 多选择器配置

可以为同一站点配置多个选择器：
```json
{
  "urlPattern": "https://example.com/*",
  "selectors": [
    { "type": "css", "expr": "h1, h2, h3" },
    { "type": "css", "expr": ".article-title" },
    { "type": "xpath", "expr": "//article//h2" }
  ]
}
```

#### XPath 选择器

对于复杂的页面结构，可以使用XPath：
- `//article//h2` - article 下的所有 h2
- `//*[@class='title']` - 任何 class 为 title 的元素
- `//div[@id='content']//h3` - 特定容器内的标题

## 🛠️ 技术实现

### 项目结构

```
├── manifest.json              # Manifest V3 配置文件
├── icons/                     # 扩展图标
│   ├── png/                   # PNG 图标（16/32/48/128）
│   │   ├── toc-enabled-*.png  # 启用状态图标
│   │   └── toc-disabled-*.png # 禁用状态图标
│   └── svg/                   # SVG 源文件
├── _locales/                  # 国际化文件
│   ├── en/
│   │   └── messages.json      # 英文翻译
│   └── zh_CN/
│       └── messages.json      # 中文翻译
├── src/
│   ├── background.js          # 后台服务工作者
│   ├── content.js             # 内容脚本入口
│   ├── content.css            # 内容脚本样式
│   ├── utils.js               # 基础工具函数
│   ├── README.md              # 技术文档
│   ├── utils/                 # 工具模块
│   │   ├── css-selector.js   # CSS 选择器生成
│   │   └── toc-builder.js    # TOC 构建逻辑
│   ├── ui/                    # UI 组件
│   │   ├── collapsed-badge.js    # 折叠按钮
│   │   ├── element-picker.js     # 元素拾取器
│   │   └── floating-panel.js     # 浮动面板
│   └── core/                  # 核心逻辑
│       ├── config-manager.js     # 配置管理
│       ├── mutation-observer.js  # 页面监听
│       └── toc-app.js            # 主应用逻辑
├── CLAUDE.md                  # Claude Code 开发指南
└── README_EN.md               # 英文版
```

### 核心技术

- **运行环境**：Edge/Chrome 浏览器（Chromium 内核）
- **扩展标准**：Manifest V3
- **开发语言**：原生 JavaScript + CSS3（无构建系统）
- **存储方案**：`chrome.storage.local` API
- **权限需求**：`storage`、`tabs`、`scripting`
- **站点权限**：`http://*/*`、`https://*/*`

### 架构设计

**模块化设计**：10 个模块文件，按依赖顺序加载
- Layer 1: `utils.js` - 基础工具
- Layer 2: `utils/css-selector.js`, `utils/toc-builder.js` - 工具模块
- Layer 3: `ui/collapsed-badge.js`, `ui/element-picker.js`, `ui/floating-panel.js` - UI 组件
- Layer 4: `core/config-manager.js`, `core/mutation-observer.js`, `core/toc-app.js` - 核心逻辑
- Layer 5: `content.js` - 入口文件

**全局命名空间**：所有模块通过 `window` 对象暴露 API
- `window.TOC_UTILS` - 基础工具
- `window.CSS_SELECTOR` - 选择器生成
- `window.TOC_BUILDER` - TOC 构建
- `window.TOC_UI` - UI 组件
- `window.CONFIG_MANAGER` - 配置管理
- `window.MUTATION_OBSERVER` - DOM 监听
- `window.TOC_APP` - 主应用

### 关键算法

- **元素去重排序**：使用 `compareDocumentPosition` 保持 DOM 顺序
- **隐藏元素过滤**：检测 `display:none`、`visibility:hidden`、`opacity:0`、零尺寸等
- **防抖重建**：MutationObserver + 500ms 防抖避免频繁更新
- **选择器生成**：优先使用 class 选择器，回退到路径选择器
- **导航锁定**：用户点击时锁定 IntersectionObserver，防止跳动
- **导航锁故障保护**：卡死时超时自动解锁（默认8秒）
- **动画帧管理**：调度和清理 requestAnimationFrame 回调
- **存储配额处理**：配额超出时自动修剪旧数据
- **配置变更重试**：失败时重试配置变更并验证结果

## 📖 配置格式

站点配置保存在 `chrome.storage.local` 中：

```json
{
  "tocConfigs": [
    {
      "urlPattern": "https://example.com/*",
      "side": "right",
      "selectors": [
        { "type": "css", "expr": "h1, h2, h3, h4, h5, h6" },
        { "type": "css", "expr": ".article-title, .section-header" },
        { "type": "xpath", "expr": "//article//h2[@class='title']" }
      ],
      "collapsedDefault": false
    }
  ],
  "tocSiteEnabledMap": {
    "https://example.com": true,
    "https://another.com": false
  },
  "tocPanelExpandedMap": {
    "https://example.com": true
  },
  "tocBadgePosMap": {
    "example.com": { "x": 100, "y": 200 }
  }
}
```

**字段说明**：
- `urlPattern`：URL 匹配模式，支持 `*` 通配符
- `side`：面板显示位置（`left` 或 `right`）
- `selectors`：选择器数组，支持 CSS 和 XPath 混用
- `collapsedDefault`：默认是否折叠
- `tocBadgePosMap`：TOC 按钮中心点位置存储（按域名），包含 `x`、`y`

## 🎯 适用场景

| 场景 | 描述 | 效果 |
|------|------|------|
| 📚 **技术文档** | 长篇 API 文档、教程 | 快速定位章节，提升查阅效率 |
| 📝 **博客文章** | 长文章、深度分析 | 一目了然的文章结构，便于跳读 |
| 🌐 **论坛帖子** | 长帖、讨论串 | 快速找到感兴趣的讨论点 |
| 📖 **在线教程** | 分步教程、课程内容 | 按步骤快速导航学习进度 |
| 🔍 **研究资料** | 学术论文、报告 | 提高信息检索和阅读效率 |

## 🔧 常见问题

### Q: 看不到"目录"按钮？
**A:** 检查以下几点：
1. 确认扩展已正确安装并启用
2. 点击工具栏图标，确认当前站点已启用
3. 确认页面协议为 http 或 https（不支持 file:// 等其他协议）
4. 刷新页面重试

### Q: 目录为空或不准确？
**A:** 扩展会默认识别 h1-h6 标题标签。如果页面结构特殊：
1. 使用"拾取元素"功能为当前站点配置合适的选择器
2. 点击"刷新"重新扫描页面
3. 尝试使用 XPath 选择器进行更精确的匹配

### Q: 目录高亮跳动或不同步？
**A:** 这是正常的防抖机制：
1. 滚动停止后会自动恢复正确的高亮状态
2. 点击目录项时会锁定导航，防止跳动
3. 页面内容变化后会重新扫描

### Q: 按钮位置不对或丢失？
**A:**
1. 可以拖拽按钮到合适位置，位置会自动保存
2. 如果保存的位置超出屏幕，会自动使用默认位置
3. 清空浏览器缓存可能会重置位置

### Q: 配置不生效？
**A:**
1. 检查 URL 匹配规则是否正确
2. 确认选择器语法无误
3. 尝试刷新页面或重新加载扩展

### Q: 扩展在某个网站不工作？
**A:**
1. 某些网站可能有 CSP（内容安全策略）限制
2. 页面使用了 Shadow DOM 可能导致选择器失效
3. 尝试使用 XPath 选择器

## 🔧 开发指南

### 无构建系统
本项目采用纯原生 JavaScript，无需构建工具：
- 直接编辑文件即可
- 修改 `manifest.json` 后需重新加载扩展
- 修改内容脚本后刷新页面即可看到效果

### 调试方法
1. **后台页面调试**：在 `edge://extensions/` 页面点击"Service Worker"查看后台日志
2. **内容脚本调试**：在目标网页按 F12 打开开发者工具，查看 Console 日志
3. **存储查看**：在开发者工具的 Application > Storage 中查看 `chrome.storage.local`

### 添加新功能
1. 在对应模块目录创建新文件
2. 更新 `manifest.json` 中的加载顺序
3. 通过全局命名空间暴露 API
4. 在依赖模块中引入使用

详细的技术文档请查看 [`src/README.md`](src/README.md) 和 [`CLAUDE.md`](CLAUDE.md)。

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本项目
2. 创建功能分支：`git checkout -b feature/new-feature`
3. 提交更改：`git commit -m 'Add new feature'`
4. 推送分支：`git push origin feature/new-feature`
5. 创建 Pull Request

## 📄 开源协议

本项目采用 MIT 开源协议 - 详见 [LICENSE](LICENSE) 文件。

## 📝 更新日志

查看 [CHANGELOG.md](CHANGELOG.md) 了解版本历史和更新内容。

---

**如果这个项目对你有帮助，请给个 ⭐ Star 支持一下！**

*If this project helps you, please give it a ⭐ Star!*
