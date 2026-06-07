# TOC 扩展代码结构说明

## 项目概述

**网页目录助手** 是一个浏览器扩展，为网页生成可折叠的浮动目录，支持吸附式工具条、左/右侧显示与多选择器配置（CSS/XPath）。

## 重构成果

内容脚本源码使用 ES Modules 组织，并由 WXT/Vite 打包为运行时注册的内容脚本：
- **源码**: `entrypoints/toc.content/index.ts` 作为 WXT 入口，调用 `src/content.ts`，其余模块通过依赖树传递引入
- **产物**: `.output/chrome-mv3/content-scripts/toc.js` 是 Chrome MV3 实际动态注入的 bundle
- **兼容**: 仅保留 `window.__TOC_ASSISTANT_CLEANUP__` 清理钩子，不再依赖全局模块命名空间

## 📁 文件结构

```
src/
├── content.ts                  # 内容脚本启动逻辑 - 应用启动、重注入清理、消息/storage listener
├── README.md                   # 项目文档
├── shared/                     # background 与内容脚本共享的存储原语
│   └── primitives.ts           # 存储、配置、UI 状态共享原语
├── utils/                      # 工具模块
│   ├── constants.ts            # STORAGE_KEYS、UI_CONSTANTS、CLEANUP_SELECTOR 等常量
│   ├── core-utils.ts           # 通用工具：消息、校验、焦点管理、JSON解析
│   ├── storage.ts              # 存储操作：getConfigs/saveConfigs 等
│   └── toc-utils.ts            # barrel 重导出模块
├── ui/                         # UI组件
│   ├── edge-dock.ts            # 吸附式工具条与纯 hover 目录状态
│   ├── element-picker.ts       # 元素拾取器
│   └── floating-panel.ts       # 轻量目录卡片（内联辅助函数）
└── core/                       # 核心逻辑
    ├── toc-app.ts              # 主应用协调器（含导航锁）
    ├── config-manager.ts       # 配置管理
    ├── rebuild-scheduler.ts    # 重建调度器
    ├── url-monitor.ts          # URL变化监测
    └── dom-watcher.ts          # DOM变化监测
```

## 🔧 模块加载机制

源码模块不再按运行时顺序逐个注入。WXT 从 `entrypoints/toc.content/index.ts` 静态追踪 ESM 依赖，打包成 `.output/chrome-mv3/content-scripts/toc.js`。扩展开发者模式加载 `.output/chrome-mv3`，`entrypoints/background.ts` 只对启用站点动态注入这个内容脚本 bundle。

## 🌐 全局命名空间设计

运行时不再暴露 `window.TOC_UTILS`、`window.TOC_UI`、`window.CONFIG_MANAGER` 等全局模块。源码通过 ESM import/export 连接；构建产物是单个 IIFE，消除注入顺序和全局污染风险。

保留的兼容/调试入口：
- `window.__TOC_ASSISTANT_LOADED__`：重注入防护标志
- `window.__TOC_ASSISTANT_CLEANUP__`：重注入或扩展 reload 时清理当前实例
- `globalThis.__STORAGE_PRIMITIVES`：仅 background service worker 可用

## 🏗️ 架构设计原则

### 1. 单一职责原则
每个模块只负责特定功能域。工具层拆分为独立文件（存储、DOM、选择器、拖拽、焦点等），核心层拆分为编排、配置、监听、调度和导航锁模块，UI 层按交互组件拆分。

### 2. 静态模块依赖
通过 ES Modules 明确表达模块依赖，由 WXT/Vite 在构建时打包和校验。无需关心加载顺序。

### 3. 防御性编程
每个模块包含错误处理和扩展上下文失效检测：
```javascript
if (isExtensionContextInvalidated()) {
  console.warn('[TOC Assistant] Extension context invalidated');
  return;
}
```

## 🎯 核心功能模块详解

### 工具模块层

**constants.ts** — 常量定义
- `STORAGE_KEYS`: 存储键名（tocConfigs, tocSiteEnabledMap, tocPanelExpandedMap, tocBadgePosMap）
- `UI_CONSTANTS`: UI 尺寸和布局常量
- `CLEANUP_SELECTOR`: 扩展元素清理选择器

**core-utils.ts** — 通用工具
- 扩展上下文失效检测: `isExtensionContextInvalidated()`
- 消息封装: `msg()`
- 焦点管理: `getFocusableWithin()`
- JSON解析、数值校验、选择器表达式验证
- `originFromUrl()`: URL → origin 转换

**storage.ts** — 存储操作
- 内部 `getStorage()` / `setStorage()`: 通用存储读写
- `getConfigs()` / `saveConfigs()`: TOC 配置管理
- `getEnabledMap()` / `saveEnabledMap()`: 站点启用状态
- `getBadgePosMap()` / `saveBadgePosMap()`: 工具条锚点位置
- 使用 `shared/primitives.ts` 的 `serializedWrite` 保证写入顺序

**dom-utils.ts** — DOM操作
- `collectBySelector()`: 执行 CSS/XPath 选择器
- `uniqueInDocumentOrder()`: 通过 `compareDocumentPosition` 去重
- `findMatchingConfig()`: URL 通配符匹配
- `getSiteEnabledByOrigin()`: 按域名查询启用状态

**toc-builder.ts** — TOC构建
- 选择器执行（CSS/XPath）
- 元素可见性检测：计算样式、边界矩形、overflow 裁剪、offsetParent
- 元素去重排序（compareDocumentPosition）

**css-selector.ts** — CSS选择器生成
- 优先使用 class 选择器
- 回退到路径选择器（nth-of-type）

**badge-position.ts** — 工具条锚点位置管理
- 按域名存储位置
- 窗口尺寸变化时：水平贴边，竖直按高度比例缩放

**drag-helper.ts** — 拖拽辅助
- 鼠标/触摸拖拽支持
- 拖拽 vs 点击判定

**focus-trap.ts** — 焦点陷阱
- 对话框内的 Tab 键焦点循环

**toast.ts** — Toast 提示
- 临时提示消息显示

**toc-utils.ts** — barrel 重导出
- 聚合 utils/ 下所有模块的导出

### UI组件层

**edge-dock.ts** — 吸附式工具条
- 固定吸附页面左侧或右侧，整体仅上下拖动
- 收起态显示最多 12 条实时目录横线，按标题层级缩进并高亮当前阅读位置；点击横线可直接导航且不改变展开状态
- 设置入口使用独立圆形的插件列表标记
- 桌面端 hover 横线区域后向页面内侧展开，离开横线和列表后自动恢复
- 触屏设备点击临时切换展开状态，点击外部区域收起
- 快捷设置入口：刷新、拾取元素、站点配置、侧边切换
- 按域名持久化吸附侧边和竖直位置

**element-picker.ts** — 元素拾取器
- 实时高亮悬停元素
- 避免选中扩展自身UI
- 支持ESC取消和右键取消
- 焦点管理

**floating-panel.ts** — 轻量目录卡片
- 目录列表渲染和交互
- 无标题栏卡片，按标题层级缩进
- 用户点击目录项时保持导航高亮锁定
- 挂载到 Edge Dock 并向页面内侧展开
- 错误处理

### 核心逻辑层

**active-item-tracker.ts** — 当前阅读位置跟踪
- 在卡片展开或收起时持续观察目录元素
- 将统一 activeIndex 同步给缩略横线和展开列表

**toc-app.ts** — 主应用协调器
- 组件生命周期管理（`initForConfig` 返回 `{ rebuild, collapse, expand, destroy }`）
- 状态同步和事件协调
- 重建逻辑和优化
- Edge Dock 与目录卡片状态同步
- 导航锁故障保护（8秒超时自动解锁）
- 动画帧管理和资源清理

**config-manager.ts** — 配置管理
- 站点配置的保存和读取
- 选择器管理界面
- 配置清空功能
- 通过后台 `toc:mutateConfig` 串行化配置变更并验证结果
- 通过 `setOnConfigChanged()` 回调通知 `toc-app.ts` 触发重建

**rebuild-scheduler.ts** — 重建调度器
- 协调 dom-watcher 和 url-monitor
- 固定防抖：400ms（常规），1200ms（流式内容期间）
- 内联导航锁集成（等待解锁后重建）
- 失败重试逻辑（1秒延迟）
- 断路器（连续5次失败后暂停）

**url-monitor.ts** — URL变化监测
- History API 拦截（pushState/replaceState）
- 轮询检测 URL 变化
- popstate 事件监听

**dom-watcher.ts** — DOM变化监测
- MutationObserver 监听 DOM 变更
- 上下文失效检测和自动断开

## 🛡️ 样式保护机制

### CSS防御策略
1. **CSS自定义属性主题**: 使用 `--toc-bg-panel` 等变量支持亮色/暗色主题
2. **优先级保护**: 所有样式使用 `!important`
3. **作用域重置**: 仅在 `[data-toc-owner="web-toc-assistant"]` 拥有的 UI 根节点内使用 `all: unset`
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
3. WXT/Vite 在构建时自动解析和打包，无需关心加载顺序
4. 如果是工具函数，考虑添加到 `utils/toc-utils.ts` 的 barrel 重导出

### 调试和测试
- 自动化测试：`npm test` 运行 `checks/*.test.mjs`
- 发布前验证：`npm run build` 与高危依赖审计
- 手工验证仍用于扩展加载、真实网页交互和浏览器权限行为
- 控制台日志分级输出
- 错误边界和降级处理

### 代码质量
- 统一的代码风格
- 完整的错误处理
- ESM 静态依赖，构建时校验
