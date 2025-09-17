# 网页目录助手 / Web TOC Assistant

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Edge Extension](https://img.shields.io/badge/Edge-Extension-blue.svg)](https://microsoftedge.microsoft.com/addons/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green.svg)](https://developer.chrome.com/docs/extensions/mv3/)

一个智能的网页目录生成器，为任意网站自动创建可交互的浮动目录，提升阅读体验。

An intelligent web table of contents generator that automatically creates interactive floating TOC for any website to enhance reading experience.

## ✨ 核心功能 / Key Features

### 🎯 智能目录生成
- **默认标题识别**：没有配置选择器时，自动使用页面标题结构（h1-h6标签）
- **智能过滤**：自动过滤隐藏元素和空文本内容，确保目录项都是可见的有效内容
- **自定义选择器**：支持CSS和XPath选择器，适配各种网站结构
- **实时更新**：页面内容变化时自动重新生成目录

### 🎪 可视化元素拾取
- **鼠标悬停高亮**：移动鼠标实时高亮目标元素
- **一键生成选择器**：点击元素自动生成CSS选择器
- **配置保存**：将选择器保存为站点专属配置

### 📍 灵活的界面交互
- **浮动面板**：可展开的目录面板，支持左右侧显示
- **可拖拽按钮**：收起后的"目录"按钮支持拖拽定位
- **位置记忆**：按域名记住按钮位置，超出屏幕时使用默认位置

### ⚙️ 站点配置管理
- **通配符匹配**：使用URL模式匹配，支持通配符
- **本地存储**：配置与站点启用状态保存到 `chrome.storage.local`
- **配置管理**：可查看、清空站点配置

### 🔄 智能导航体验
- **平滑滚动**：点击目录项平滑滚动到对应位置
- **当前位置高亮**：自动高亮当前阅读位置对应的目录项
- **防抖机制**：避免滚动时频繁切换高亮状态

## 🚀 安装使用 / Installation & Usage

### 安装步骤
1. 下载项目文件到本地
2. 打开Edge浏览器，访问 `edge://extensions/`
3. 开启"开发人员模式"
4. 点击"加载已解压的扩展程序"，选择项目文件夹
5. 安装完成后访问任意网页即可使用

### 基本操作
1. **启用/禁用站点**：点击工具栏中的“网页目录助手”图标，按站点启用/禁用
2. **图标说明**：启用=亮色图标（`icons/png/toc-enabled-*.png`），禁用=灰色图标（`icons/png/toc-disabled-*.png`）；同站点的其他标签页会自动同步
3. **目录按钮**：启用后，页面右侧会出现“目录”悬浮按钮
4. **展开**：点击按钮展开目录面板，默认显示页面中的 h1-h6 标题
5. **导航**：点击目录项快速跳转到对应内容
6. **拾取**：点击“拾取元素”按钮，然后选择页面元素生成选择器
7. **保存**：将生成的选择器保存为当前站点配置，覆盖默认行为
8. **管理**：通过“保存管理”查看或清空站点配置

## 🛠️ 技术实现 / Technical Implementation

### 项目结构
```
├── manifest.json
├── icons/
│   ├── png/
│   │   ├── toc-enabled-16.png
│   │   ├── toc-enabled-32.png
│   │   ├── toc-enabled-48.png
│   │   ├── toc-enabled-128.png
│   │   ├── toc-disabled-16.png
│   │   ├── toc-disabled-32.png
│   │   ├── toc-disabled-48.png
│   │   └── toc-disabled-128.png
│   └── svg/
│       ├── toc-enabled.svg
│       └── toc-disabled.svg
├── src/
│   ├── background.js
│   ├── content.js
│   ├── content.css
│   ├── README.md
│   ├── utils.js
│   ├── utils/
│   │   ├── css-selector.js
│   │   └── toc-builder.js
│   ├── ui/
│   │   ├── collapsed-badge.js
│   │   ├── element-picker.js
│   │   └── floating-panel.js
│   └── core/
│       ├── config-manager.js
│       ├── mutation-observer.js
│       └── toc-app.js
└── README.md
```

### 核心技术
- **运行环境**：Edge浏览器 (Chromium内核)
- **扩展标准**：Manifest V3
- **开发语言**：原生JavaScript + CSS3
- **存储方案**：`chrome.storage.local` API
- **权限需求**：`storage`、`tabs`

### 关键算法
- **元素去重排序**：使用`compareDocumentPosition`保持DOM顺序
- **隐藏元素过滤**：检测`display:none`、`visibility:hidden`、`opacity:0`、零尺寸等隐藏状态
- **防抖重建**：MutationObserver + 500ms防抖避免频繁更新
- **选择器生成**：优先使用class选择器，回退到路径选择器

## 📖 配置格式 / Configuration Format

站点配置保存在`chrome.storage.local`中：

```json
[
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
]
```

**字段说明**：
- `urlPattern`：URL匹配模式，支持`*`通配符
- `side`：面板显示位置（`left`或`right`）
- `selectors`：选择器数组，支持CSS和XPath混用
- `collapsedDefault`：默认是否折叠（当前版本总是先折叠）

## 🎯 适用场景 / Use Cases

| 场景 | 描述 | 效果 |
|------|------|------|
| 📚 **技术文档** | 长篇API文档、教程 | 快速定位章节，提升查阅效率 |
| 📝 **博客文章** | 长文章、深度分析 | 一目了然的文章结构，便于跳读 |
| 🌐 **论坛帖子** | 长帖、讨论串 | 快速找到感兴趣的讨论点 |
| 📖 **在线教程** | 分步教程、课程内容 | 按步骤快速导航学习进度 |
| 🔍 **研究资料** | 学术论文、报告 | 提高信息检索和阅读效率 |

## 🔧 常见问题 / FAQ

**Q: 看不到"目录"按钮？**
A: 检查页面协议（仅支持http/https），确认扩展已正确安装并启用。

**Q: 目录为空或不准确？**
A: 扩展会默认识别h1-h6标题标签。如果页面结构特殊，可使用"拾取元素"功能为当前站点配置合适的选择器，或点击"刷新"重新扫描。

**Q: 按钮位置不对？**
A: 可以拖拽按钮到合适位置，位置会自动保存。如果保存的位置超出屏幕，会自动使用默认位置。

**Q: 目录高亮跳动？**
A: 这是正常的防抖机制，滚动停止后会自动恢复正确的高亮状态。

## 🤝 贡献指南 / Contributing

欢迎提交Issue和Pull Request！

1. Fork本项目
2. 创建功能分支：`git checkout -b feature/new-feature`
3. 提交更改：`git commit -m 'Add new feature'`
4. 推送分支：`git push origin feature/new-feature`
5. 创建Pull Request

## 📄 开源协议 / License

本项目采用MIT开源协议 - 详见[LICENSE](LICENSE)文件。

---

**如果这个项目对你有帮助，请给个 ⭐ Star 支持一下！**

*If this project helps you, please give it a ⭐ Star!*