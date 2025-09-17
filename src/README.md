# TOC 扩展代码结构说明

## 项目概述

**网页目录助手** 是一个浏览器扩展，为网页生成可折叠的浮动目录，支持左/右侧显示与多选择器配置（CSS/XPath）。

## 重构成果

原始的 `content.js` 文件包含了 847 行代码（30.4KB），现已重构为模块化架构：
- **重构前**: 单文件 847 行
- **重构后**: 10 个模块文件，主入口仅 49 行

## 📁 文件结构与代码统计

```
src/
├── content.js (49行)           # 主入口文件 - 应用启动和初始化
├── utils.js (127行)            # 基础工具函数 - 存储、选择器、DOM操作
├── content.css (306行)         # 样式文件 - 包含防御性CSS保护
├── README.md                   # 项目文档
├── utils/                      # 工具模块 (132行)
│   ├── css-selector.js (51行)  # CSS选择器生成工具
│   └── toc-builder.js (81行)   # TOC构建逻辑和元素过滤
├── ui/                         # UI组件模块 (461行)
│   ├── collapsed-badge.js (148行) # 可拖拽折叠按钮
│   ├── element-picker.js (108行)  # 交互式元素拾取器
│   └── floating-panel.js (205行)  # 主浮动面板和目录列表
└── core/                       # 核心逻辑模块 (405行)
    ├── config-manager.js (108行)  # 配置管理和持久化
    ├── mutation-observer.js (130行) # 页面变化监听
    └── toc-app.js (167行)         # 主应用逻辑和组件协调
```

**总计**: 1174 行代码，平均每个模块 117 行

## 🔧 模块加载顺序

按 `manifest.json` 中定义的依赖顺序：

1. **基础层** - `utils.js` (127行)
2. **工具层** - `utils/css-selector.js` (51行) + `utils/toc-builder.js` (81行)
3. **UI层** - `ui/collapsed-badge.js` (148行) + `ui/element-picker.js` (108行) + `ui/floating-panel.js` (205行)
4. **核心层** - `core/config-manager.js` (108行) + `core/mutation-observer.js` (130行) + `core/toc-app.js` (167行)
5. **入口层** - `content.js` (49行)

## 🌐 全局命名空间设计

```javascript
window.TOC_UTILS          // 基础工具：存储、DOM操作、选择器匹配
window.CSS_SELECTOR       // CSS选择器生成：buildClassSelector, cssPathFor
window.TOC_BUILDER        // TOC构建：buildTocItems, buildTocItemsFromSelectors
window.TOC_UI            // UI组件：renderFloatingPanel, renderCollapsedBadge, createElementPicker
window.CONFIG_MANAGER    // 配置管理：manageSave, saveSelector, updateConfigFromStorage
window.MUTATION_OBSERVER // 页面监听：createMutationObserver
window.TOC_APP          // 主应用：initForConfig, rebuild
```

## 🏗️ 架构设计原则

### 1. 单一职责原则
每个模块只负责特定功能域：
- **utils.js**: 基础工具和存储操作
- **css-selector.js**: CSS选择器生成算法
- **toc-builder.js**: TOC项目构建和过滤逻辑
- **floating-panel.js**: 浮动面板UI和交互
- **config-manager.js**: 配置的CRUD操作

### 2. 依赖注入模式
通过全局命名空间实现松耦合：
```javascript
const { getConfigs, findMatchingConfig } = window.TOC_UTILS || {};
const { initForConfig } = window.TOC_APP || {};
```

### 3. 防御性编程
每个模块都包含依赖检查和错误处理：
```javascript
if (!getConfigs || !initForConfig) {
  console.error('[目录助手] 缺少必要的依赖模块');
  return;
}
```

## 🎯 核心功能模块详解

### 基础工具层 (127行)
**utils.js** - 提供扩展的基础能力
- 存储操作：`getConfigs()`, `saveConfigs()`
- 选择器执行：`collectBySelector()`
- DOM操作：`uniqueInDocumentOrder()`, `scrollToElement()`
- URL匹配：`findMatchingConfig()`

### UI组件层 (461行)
**collapsed-badge.js** (148行) - 折叠状态按钮
- 可拖拽定位，支持位置记忆
- 跨域名位置持久化
- 防止意外触发的拖拽检测

**element-picker.js** (108行) - 元素拾取器
- 实时高亮悬停元素
- 避免选中扩展自身UI
- 支持ESC取消和右键取消

**floating-panel.js** (205行) - 主浮动面板
- 目录列表渲染和交互
- IntersectionObserver自动高亮
- 用户选择锁定机制
- 操作按钮集成

### 核心逻辑层 (405行)
**config-manager.js** (108行) - 配置管理
- 站点配置的保存和读取
- 选择器管理界面
- 配置清空功能

**mutation-observer.js** (130行) - 页面监听
- 智能变化检测
- 防抖重建机制
- 导航锁定期间的延迟处理

**toc-app.js** (167行) - 主应用协调器
- 组件生命周期管理
- 状态同步和事件协调
- 重建逻辑和优化

## 🛡️ 样式保护机制

### CSS防御策略 (306行样式)
1. **优先级保护**: 所有样式使用 `!important`
2. **全局重置**: 防止网站样式干扰
3. **属性覆盖**: 重置所有可能被影响的CSS属性
4. **交互保护**: 确保按钮和链接正常工作

### 样式组织
```css
/* 全局重置 */
.toc-floating, .toc-floating *, .toc-collapsed-badge, .toc-collapsed-badge * {
  all: unset !important;
  box-sizing: border-box !important;
}

/* 组件样式 */
.toc-floating { /* 浮动面板 */ }
.toc-btn { /* 操作按钮 */ }
.toc-item { /* 目录项 */ }
.toc-collapsed-badge { /* 折叠按钮 */ }
```

## ⚡ 性能优化策略

### 1. 智能重建机制
- 内容相同时跳过重建
- 用户交互期间延迟重建
- 防抖处理页面变化

### 2. 内存管理
- 正确清理事件监听器
- 定时器自动清理
- 组件销毁时的资源释放

### 3. DOM操作优化
- 批量DOM更新
- 避免强制重排
- 使用DocumentFragment

## 🔄 扩展和维护

### 添加新功能
1. 在对应模块目录创建新文件
2. 更新 `manifest.json` 加载顺序
3. 通过全局命名空间暴露API
4. 在依赖模块中引入使用

### 调试和测试
- 每个模块独立可测试
- 控制台日志分级输出
- 错误边界和降级处理

### 代码质量
- 统一的代码风格
- 完整的错误处理
- 详细的注释文档