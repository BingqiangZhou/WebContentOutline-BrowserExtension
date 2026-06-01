# TOC 扩展代码结构说明

## 项目概述

**网页目录助手** 是一个浏览器扩展，为网页生成可折叠的浮动目录，支持吸附式工具条、左/右侧显示与多选择器配置（CSS/XPath）。

## 重构成果

内容脚本源码使用 ES Modules 组织，并在构建时通过 esbuild 打包为单个 IIFE：
- **源码**: `src/content.js` 作为入口，直接 import `utils/toc-utils.js` 和 `core/toc-app.js`，其余模块通过依赖树传递引入
- **产物**: `dist/build/src/content.js` 是 Chrome MV3 实际动态注入的 bundle
- **兼容**: 仅保留 `window.__TOC_ASSISTANT_CLEANUP__` 清理钩子，不再依赖全局模块命名空间

## 📁 文件结构与代码统计

```
src/
├── content.js                  # 内容脚本入口 (469行) - 应用启动、重注入清理、消息/storage listener
├── background.js               # MV3 service worker (758行) - 图标状态、站点开关、动态注入
├── content.css                 # 样式文件 (1,062行) - 包含防御性CSS保护、CSS自定义属性主题、动画
├── README.md                   # 项目文档
├── shared/                     # background 与内容脚本共享的存储原语
│   └── storage-primitives.js   # ESM 源码；构建时另产出 background 可 importScripts 的 IIFE
├── utils/                      # 工具模块 (1,546行)
│   ├── constants.js            # (75行)  STORAGE_KEYS、UI_CONSTANTS、CLEANUP_SELECTOR 等常量
│   ├── core-utils.js           # (218行) 通用工具：消息、校验、焦点管理、JSON解析
│   ├── toast.js                # (91行)  Toast 提示
│   ├── storage.js              # (412行) 存储操作：getConfigs/saveConfigs 等
│   ├── badge-position.js       # (128行) 工具条锚点位置管理（兼容旧键名）
│   ├── dom-utils.js            # (176行) DOM操作：选择器执行、元素去重、配置匹配
│   ├── css-selector.js         # (52行)  CSS选择器生成算法
│   ├── toc-builder.js          # (139行) TOC构建：选择器执行、元素过滤、项目映射
│   ├── drag-helper.js          # (165行) 拖拽辅助
│   ├── focus-trap.js           # (49行)  焦点陷阱
│   └── toc-utils.js            # (19行)  barrel 重导出模块
├── ui/                         # UI组件
│   ├── edge-dock.js            # 吸附式工具条、hover 预览与 pinned 状态
│   ├── element-picker.js       # (272行) 元素拾取器
│   ├── floating-panel-helpers.js # 浮动面板辅助函数
│   └── floating-panel.js       # 轻量目录卡片
└── core/                       # 核心逻辑 (1,711行)
    ├── toc-app.js              # (658行) 主应用协调器
    ├── config-manager.js       # (343行) 配置管理
    ├── rebuild-scheduler.js    # (253行) 重建调度器
    ├── url-monitor.js          # (196行) URL变化监测
    ├── dom-watcher.js          # (162行) DOM变化监测
    ├── nav-lock.js             # (78行)  导航锁
    └── event-bus.js            # (21行)  事件总线
```

总计约 6,639 行源码。

## 🔧 模块加载机制

源码模块不再按运行时顺序逐个注入。`build.js` 使用 esbuild 从 `src/content.js` 静态追踪 ESM 依赖，打包成 `dist/build/src/content.js`。扩展应加载 `dist/build`，`src/background.js` 只注入这一个内容脚本 bundle。

## 🌐 全局命名空间设计

运行时不再暴露 `window.TOC_UTILS`、`window.TOC_UI`、`window.CONFIG_MANAGER` 等全局模块。源码通过 ESM import/export 连接；构建产物是单个 IIFE，消除注入顺序和全局污染风险。

保留的兼容/调试入口：
- `window.__TOC_ASSISTANT_LOADED__`：重注入防护标志
- `window.__TOC_ASSISTANT_CLEANUP__`：重注入或扩展 reload 时清理当前实例
- `globalThis.__STORAGE_PRIMITIVES`：仅 background service worker 可用

## 🏗️ 架构设计原则

### 1. 单一职责原则
每个模块只负责特定功能域。工具层拆分为 11 个独立文件（存储、DOM、选择器、拖拽、焦点等），核心层拆分为 7 个文件（编排、配置、监听、调度、锁、事件），UI层拆分为 3 个组件文件。

### 2. 静态模块依赖
通过 ES Modules 明确表达模块依赖，由 esbuild 在构建时打包和校验。无需关心加载顺序。

### 3. 防御性编程
每个模块包含错误处理和扩展上下文失效检测：
```javascript
if (isExtensionContextInvalidated()) {
  console.warn('[TOC Assistant] Extension context invalidated');
  return;
}
```

## 🎯 核心功能模块详解

### 工具模块层 (1,546行)

**constants.js** (76行) — 常量定义
- `STORAGE_KEYS`: 存储键名（tocConfigs, tocSiteEnabledMap, tocPanelExpandedMap, tocBadgePosMap）
- `UI_CONSTANTS`: UI 尺寸和布局常量
- `CLEANUP_SELECTOR`: 扩展元素清理选择器

**core-utils.js** (218行) — 通用工具
- 扩展上下文失效检测: `isExtensionContextInvalidated()`
- 消息封装: `msg()`
- 焦点管理: `getFocusableWithin()`
- JSON解析、数值校验、选择器表达式验证
- `originFromUrl()`: URL → origin 转换

**storage.js** (412行) — 存储操作
- `getStorage()` / `setStorage()`: 通用存储读写
- `getConfigs()` / `saveConfigs()`: TOC 配置管理
- `getEnabledMap()` / `saveEnabledMap()`: 站点启用状态
- `getPanelStateMap()` / `savePanelStateMap()`: 面板展开状态
- `getBadgePosMap()` / `saveBadgePosMap()`: 工具条锚点位置（兼容旧徽标数据）
- 使用 `shared/storage-primitives.js` 的 `serializedWrite` 保证写入顺序

**dom-utils.js** (191行) — DOM操作
- `collectBySelector()`: 执行 CSS/XPath 选择器
- `uniqueInDocumentOrder()`: 通过 `compareDocumentPosition` 去重
- `findMatchingConfig()`: URL 通配符匹配
- `getSiteEnabledByOrigin()`: 按域名查询启用状态

**toc-builder.js** (139行) — TOC构建
- 选择器执行（CSS/XPath）
- 元素可见性检测：计算样式、边界矩形、overflow 裁剪、offsetParent
- 元素去重排序（compareDocumentPosition）

**css-selector.js** (52行) — CSS选择器生成
- 优先使用 class 选择器
- 回退到路径选择器（nth-of-type）

**badge-position.js** (128行) — 工具条锚点位置管理
- 按域名存储位置
- 窗口尺寸变化时：水平贴边，竖直按高度比例缩放

**drag-helper.js** (171行) — 拖拽辅助
- 鼠标/触摸拖拽支持
- 拖拽 vs 点击判定

**focus-trap.js** (49行) — 焦点陷阱
- 对话框内的 Tab 键焦点循环

**toast.js** (91行) — Toast 提示
- 临时提示消息显示

**toc-utils.js** (19行) — barrel 重导出
- 聚合 utils/ 下所有模块的导出

### UI组件层 (1,426行)

**edge-dock.js** — 吸附式工具条
- 固定吸附页面左侧或右侧，整体仅上下拖动
- 收起态显示最多 12 条实时目录横线，按标题层级缩进并高亮当前阅读位置
- 设置入口使用四格闪光图标
- 桌面端 hover 临时预览，点击锁定展开
- 触屏设备点击切换展开状态
- 快捷设置入口：刷新、拾取元素、站点配置、侧边切换
- 按域名持久化吸附侧边和竖直位置

**element-picker.js** (272行) — 元素拾取器
- 实时高亮悬停元素
- 避免选中扩展自身UI
- 支持ESC取消和右键取消
- 焦点管理

**floating-panel.js** — 轻量目录卡片
- 目录列表渲染和交互
- 无标题栏卡片，按标题层级缩进
- 用户选择锁定机制
- 挂载到 Edge Dock 并向页面内侧展开
- 错误处理

### 核心逻辑层 (1,711行)

**active-item-tracker.js** — 当前阅读位置跟踪
- 在卡片展开或收起时持续观察目录元素
- 将统一 activeIndex 同步给缩略横线和展开列表

**toc-app.js** (658行) — 主应用协调器
- 组件生命周期管理（`initForConfig` 返回 `{ rebuild, collapse, expand, destroy }`）
- 状态同步和事件协调
- 重建逻辑和优化
- Edge Dock 与目录卡片状态同步
- 导航锁故障保护（8秒超时自动解锁）
- 动画帧管理和资源清理

**config-manager.js** (343行) — 配置管理
- 站点配置的保存和读取
- 选择器管理界面
- 配置清空功能
- `mutateConfigsWithRetry` 配置变更验证
- 通过 event-bus 发送 `toc:config-changed` 事件

**rebuild-scheduler.js** (253行) — 重建调度器
- 协调 dom-watcher 和 url-monitor
- 动态防抖：`DEBOUNCE_MS * 1.3^consecutiveMutations`，上限 1000ms
- 导航锁集成（等待解锁后重建）
- 失败重试逻辑（1秒延迟）
- 断路器（连续5次失败后暂停）

**url-monitor.js** (196行) — URL变化监测
- History API 拦截（pushState/replaceState）
- 轮询检测 URL 变化
- popstate 事件监听

**dom-watcher.js** (162行) — DOM变化监测
- MutationObserver 监听 DOM 变更
- 上下文失效检测和自动断开

**nav-lock.js** (78行) — 导航锁
- `lock(durationMs)`, `unlock()`, `isLocked()`, `onUnlock(callback)`, `destroy()`
- 防止 IntersectionObserver 在用户点击 TOC 项时干扰
- 自动超时解锁

**event-bus.js** (21行) — 事件总线
- `on(event, fn)`, `off(event, fn)`, `emit(event, ...args)`
- 当前仅用于 `toc:config-changed` 事件

## 🛡️ 样式保护机制

### CSS防御策略 (895行样式)
1. **CSS自定义属性主题**: 使用 `--toc-bg-panel` 等变量支持亮色/暗色主题
2. **优先级保护**: 所有样式使用 `!important`
3. **全局重置**: `.toc-floating, .toc-floating * { all: unset !important; }`
4. **交互保护**: 确保按钮和链接正常工作

## ⚡ 性能优化策略

### 1. 自动重建机制
- 内容相同时跳过重建
- 用户交互期间延迟重建
- 动态防抖（爆发突变时自动增加防抖间隔）
- 断路器保护（连续失败后暂停）

### 2. 内存管理
- `destroy()` 方法清理事件监听器和观察者
- 定时器自动清理
- 组件销毁时的资源释放

### 3. DOM操作优化
- 批量DOM更新
- 避免强制重排
- 使用 DocumentFragment

## 🔄 扩展和维护

### 添加新功能
1. 在对应模块目录创建新文件，使用 `export` 导出
2. 在需要使用的模块中通过 `import` 引入
3. esbuild 在构建时自动解析和打包，无需关心加载顺序
4. 如果是工具函数，考虑添加到 `utils/toc-utils.js` 的 barrel 重导出

### 调试和测试
- 无自动化测试框架，需手动加载扩展测试
- 控制台日志分级输出
- 错误边界和降级处理

### 代码质量
- 统一的代码风格
- 完整的错误处理
- ESM 静态依赖，构建时校验
