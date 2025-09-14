# 网页内容大纲插件 / Web Content Outline Extension

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Edge Extension](https://img.shields.io/badge/Edge-Extension-blue.svg)](https://microsoftedge.microsoft.com/addons/)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-green.svg)](https://developer.chrome.com/docs/extensions/mv3/)

为任意网站生成可折叠的浮动目录（Table of Contents, TOC）。支持自定义选择器、拖拽定位、站点配置等功能。

A floating table of contents (TOC) generator for any website with customizable selectors, draggable positioning, and site-specific configurations.

## ✨ 功能特性 / Features

- 🎯 **悬浮目录面板** - 显示匹配到的标题/分段文本，点击平滑滚动至对应元素
- 📍 **折叠按钮** - 面板可收起为"目录"徽章，按钮支持拖拽，位置按域名记忆
- ⚙️ **站点配置** - 以 urlPattern（通配符）为粒度保存选择器与侧边位置，持久化到 chrome.storage.sync
- 🎪 **元素拾取** - 移动鼠标高亮目标元素，点击生成CSS选择器并可保存到当前站点配置
- 🔄 **自动重建** - 页面 DOM 变化后进行防抖重建，避免频繁刷新与滚动干扰
- 🎭 **平滑滚动** - 点击目录项平滑滚动到对应位置，当前激活项高亮
- 🔧 **CSS/XPath 支持** - 支持 CSS 和 XPath 选择器，两者可混用

## 🚀 快速开始 / Quick Start

### 安装 / Installation

1. 下载或克隆本项目到本地
   ```bash
   git clone https://github.com/your-username/web-content-outline.git
   ```

2. 在 Edge 浏览器中加载扩展：
   - 打开 Edge 浏览器
   - 进入 `edge://extensions/`
   - 开启"开发人员模式"
   - 点击"加载已解压的扩展程序"
   - 选择项目根目录（包含 `manifest.json` 的文件夹）

3. 安装完成后，访问任意网页，右侧会出现"目录"悬浮按钮

### 基本使用 / Basic Usage

1. **展开目录**：点击页面右侧的"目录"按钮
2. **拾取元素**：点击"拾取元素"按钮，然后在页面上选择标题元素
3. **保存配置**：拾取元素后可保存为当前站点的配置
4. **管理配置**：点击"保存管理"查看或清空站点配置
5. **刷新目录**：点击"刷新"重新扫描页面生成目录
6. **收起面板**：点击"收起"将面板折叠为按钮

## 📖 详细说明 / Documentation

### 功能特性详解

- **悬浮目录面板**：显示匹配到的标题/分段文本，点击平滑滚动至对应元素
- **折叠按钮**：面板可收起为"目录"徽章；按钮支持拖拽，位置按域名记忆。插件启动时总是先显示为折叠按钮
- **站点配置**：
  - 以 urlPattern（通配符）为粒度保存选择器与侧边位置
  - 持久化到 chrome.storage.sync（异常时回退 localStorage）
  - 支持 type: css | xpath，两者可混用
- **元素拾取**：移动鼠标高亮目标元素，点击生成CSS选择器并可保存到当前站点配置。如需XPath选择器需手动编辑配置
- **自动重建**：页面 DOM 变化后进行防抖重建，避免频繁刷新与滚动干扰

### 站点配置格式

配置保存在 `chrome.storage.sync` 的 `tocConfigs` 中：

```json
[
  {
    "urlPattern": "https://example.com/*",
    "side": "right",
    "selectors": [
      { "type": "css", "expr": "h1, h2, h3" },
      { "type": "xpath", "expr": "//article//h2" }
    ],
    "collapsedDefault": false
  }
]
```

**配置说明**：
- `urlPattern`：支持"*"通配符的URL匹配模式
- `side`：`left` | `right`，决定面板与折叠按钮的侧边
- `selectors`：可包含多条 CSS/XPath 选择器
- `collapsedDefault`：当前实现总是先折叠为按钮（字段保留用于兼容）

## 🛠️ 开发 / Development

### 项目结构

```
├── manifest.json          # MV3 扩展清单
├── src/
│   ├── utils.js          # 工具函数（配置存取、选择器处理等）
│   ├── content.js        # 主内容脚本（UI渲染、事件处理）
│   └── content.css       # 样式文件
└── README.md
```

### 技术栈

- **运行环境**：Edge (Chromium)，Manifest V3
- **核心技术**：Vanilla JavaScript, CSS3
- **存储**：chrome.storage.sync API
- **权限**：仅需 `storage` 权限，无网络请求

### 调试方法

1. 在开发者模式加载扩展后，打开目标页面
2. 按 F12 打开开发者工具
3. 在 Sources 面板查看已注入的 `src/*` 源码
4. 可在内容脚本中设置断点或使用 `console.log` 调试

## 🔧 常见问题 / FAQ

<details>
<summary><strong>看不到"目录"按钮</strong></summary>

- 检查是否为支持的协议（仅支持 `http/https`，不支持 `chrome://`、`edge://`、PDF等）
- 页面样式可能覆盖了按钮，尝试滚动页面或缩放查看
- 按钮具有内联兜底样式，确保在异常环境下仍可见
</details>

<details>
<summary><strong>目录为空</strong></summary>

- 该站点可能未配置选择器或选择器不匹配当前页面结构
- 使用"拾取元素"功能生成并保存选择器
- 在动态内容加载后点击"刷新"重新扫描
</details>

<details>
<summary><strong>如何使用 XPath 选择器</strong></summary>

- 当前 UI 的拾取器仅生成 CSS 选择器
- 如需 XPath，请手动编辑配置，添加 `{ "type": "xpath", "expr": "..." }`
- 可通过浏览器开发者工具测试 XPath 表达式
</details>

<details>
<summary><strong>面板高亮错乱或跳动</strong></summary>

- 滚动期间启用"导航锁"避免 IntersectionObserver 抢占导致闪烁
- 滚动停止后会自动解锁并恢复正确高亮
</details>

## 🎯 适用场景 / Use Cases

- 📚 **技术文档**：为长篇技术文档生成导航目录
- 📝 **博客文章**：提升长文章的阅读体验
- 🌐 **论坛帖子**：快速定位感兴趣的内容段落
- 📖 **在线教程**：按章节快速跳转
- 🔍 **研究资料**：提高信息检索效率

## 🤝 贡献 / Contributing

欢迎提交 Issue 和 Pull Request！

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证 / License

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🙏 致谢 / Acknowledgments

- 感谢所有贡献者和用户的反馈
- 灵感来源于各种阅读辅助工具的最佳实践

---

**如果这个项目对你有帮助，请给个 ⭐ Star 支持一下！**

*If this project helps you, please give it a ⭐ Star!*