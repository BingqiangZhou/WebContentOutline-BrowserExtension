# TOC 扩展代码结构说明

## 项目概述

**网页目录助手** 是一个浏览器扩展，为网页生成目录：桌面端停靠在页面左/右边缘的吸附式工具条，收起态显示目录缩略图，悬停时向页面内侧展开；支持按站点配置选择器（CSS/XPath）。

## 重构成果

内容脚本源码使用 ES Modules 组织，由 WXT/Vite 打包为运行时注册的内容脚本：
- **源码**: `entrypoints/toc.content/index.ts` 作为 WXT 入口，调用 `src/content.ts`，其余模块通过依赖树传递引入
- **产物**: `.output/chrome-mv3/content-scripts/toc.js` 是后台只对已启用站点动态注入的 bundle；`content-scripts/toc.css` 由内容脚本自行拉取并加载进它的 Shadow root
- **兼容**: 仅保留 `window.__TOC_ASSISTANT_CLEANUP__` 清理钩子，不再依赖全局模块命名空间

## 📁 文件结构

```
src/
├── content.ts                  # 内容脚本启动逻辑：启动、重注入清理、消息与 storage 监听
├── README.md                   # 本文档
├── shared/                     # 后台、内容脚本、选项页共享的模块
│   ├── primitives.ts           # 存储原语：串行写入、配置变更、UI 状态变更
│   └── messages.ts             # TOC_MESSAGE 消息协议（带类型的联合类型）
├── utils/                      # 工具模块
│   ├── constants.ts            # 存储键名与各项上限
│   ├── core-utils.ts           # i18n、上下文失效检测、选择器校验、镜像去重
│   ├── storage.ts              # 存储读取与标准化
│   ├── dom-utils.ts            # 选择器执行、文档顺序去重、滚动、清理扩展元素
│   ├── toc-builder.ts          # TOC 构建入口：调度下面的检测与收集
│   ├── content-region.ts       # 正文区域检测
│   ├── chatbot-detector.ts     # 聊天页面检测与对话式目录
│   ├── css-selector.ts         # 根据元素生成 CSS 选择器
│   ├── bounded-text.ts         # 有界的文本提取
│   ├── badge-position.ts       # 按域名保存工具条位置
│   ├── drag-helper.ts          # 指针拖拽
│   ├── focus-trap.ts           # 对话框内的 Tab 焦点循环
│   ├── toast.ts                # 提示消息
│   └── toc-utils.ts            # barrel 重导出模块
├── ui/                         # UI 组件
│   ├── shadow-root.ts          # 单一共享的 closed Shadow root 与样式加载
│   ├── edge-dock.ts            # 吸附式工具条与目录缩略图
│   ├── floating-panel.ts       # 展开后的目录列表
│   ├── element-picker.ts       # 元素拾取器
│   └── overlay-dialog.ts       # 共享的对话框骨架
└── core/                       # 核心逻辑
    ├── toc-app.ts              # 主应用协调器
    ├── config-manager.ts       # 站点配置的读取、修改与配置对话框
    ├── rebuild-scheduler.ts    # 重建调度器
    ├── dom-watcher.ts          # DOM 变化监测
    ├── url-monitor.ts          # URL 变化监测
    ├── nav-lock.ts             # 导航锁
    └── active-item-tracker.ts  # 当前阅读位置跟踪
```

## 🔧 模块加载机制

源码模块不再按运行时顺序逐个注入。WXT 从 `entrypoints/toc.content/index.ts` 静态追踪 ESM 依赖，打包成 `.output/chrome-mv3/content-scripts/toc.js`。后台只对启用的站点动态注入这一个 bundle。

## 🌐 全局命名空间设计

运行时不暴露 `window.TOC_UTILS`、`window.TOC_UI`、`window.CONFIG_MANAGER` 等全局模块。源码通过 ESM import/export 连接。

保留的兼容/调试入口：
- `window.__TOC_ASSISTANT_LOADED__`：重注入防护标志
- `window.__TOC_ASSISTANT_CLEANUP__`：重注入或扩展 reload 时清理当前实例

## 🏗️ 架构设计原则

### 1. 单一职责
每个模块只负责特定功能域。工具层拆分为独立文件（存储、DOM、选择器、拖拽、焦点等），核心层拆分为编排、配置、监听、调度和导航锁模块，UI 层按交互组件拆分。

### 2. 静态模块依赖
通过 ES Modules 明确表达模块依赖，由 WXT/Vite 在构建时打包和校验。无需关心加载顺序。

### 3. 防御性编程
每个模块包含错误处理和扩展上下文失效检测；协调器与调度器都提供 `destroy()`，观察器、监听器、定时器随之释放。

## 🎯 核心功能模块详解

### 共享层

**`shared/primitives.ts`** — `serializedWrite`（按键串行化写入）、`applyTocConfigMutation`（增删选择器、清空站点配置）、`applyUiStateMutation`（工具条位置）、`originFromUrl`、`normalizeSide`。

**`shared/messages.ts`** — `TOC_MESSAGE` 常量与 `TocRequest` 联合类型。新增消息类型必须加在这里，不要在调用处写裸字符串。

### 工具层

**`constants.ts`** — `STORAGE_KEYS`（`tocConfigs`、`tocSiteEnabledMap`、`tocBadgePosMap`）以及各项上限：条目文本 200 字符、每页最多 400 个条目、候选元素 1200 个、每个映射最多 400 个键、选择器表达式 2000 字符。

**`core-utils.ts`** — `msg()`（i18n）、`debug()`（由 `__TOC_DEBUG` 开关控制）、上下文失效检测、`validateSelectorExpression()`、`isTocContentIdentical()`、`dedupeMirrorItems()`。

**`storage.ts`** — `getConfigs()` / `getEnabledMap()` / `getBadgePosMap()` / `saveBadgePosMap()`，读取时做校验与标准化。

**`dom-utils.ts`** —
- `collectBySelector()`：执行 CSS/XPath 选择器，覆盖 light DOM、开放的 Shadow root 与同源 iframe
- `uniqueInDocumentOrder()`：通过 `compareDocumentPosition` 去重并排序
- `findMatchingConfig()`：URL 通配符匹配
- `scrollToElement()`：平滑滚动并避开固定表头
- `cleanupOwnedElements()`：经 `getTocShadowRootSync()` 清理 Shadow root 内的扩展元素

**`content-region.ts`** — 四层策略检测正文区域（语义地标 → class/id 启发式 → 祖先计分 → 全页兜底），结果按 URL 缓存。

**`chatbot-detector.ts`** — 三层检测（ARIA 语义 → data 属性 → 结构启发式）加 Hint 表兜底；七种选择器发现策略，全部依据属性，不按位置猜测；把对话转成"提问为一级、AI 回复中的标题为子级"的目录。检测结果按 URL 缓存，否定结果 5 秒后过期。

**`toc-builder.ts`** — 优先级：用户选择器 > 聊天对话目录 > 默认标题。用户选择器和默认标题都限定在检测到的正文区域内；用户选择器在区域内零命中时回退到全页。构建过程分块让出主线程。

**`css-selector.ts`** — 优先使用 class 选择器，回退到路径选择器；标识符经 `CSS.escape` 转义。

### UI 层

**`shadow-root.ts`** — 所有 UI 挂在同一个 **closed** Shadow root 里，页面脚本无法经 `host.shadowRoot` 触达。扩展代码通过 `getTocShadowRootSync()` 取 root；`getDeepActiveElement()` 沿模块引用下钻，取到真正获得焦点的元素。

**`edge-dock.ts`** — 固定吸附页面左侧或右侧，整体仅上下拖动。收起态显示最多 12 条目录横线，点击横线直接跳转；桌面端悬停时向页面内侧展开；触屏点击临时切换。快捷设置：刷新、拾取元素、站点配置、切换侧边、关闭目录。侧边和竖直位置按域名保存。

**`floating-panel.ts`** — 展开后的目录列表（listbox 语义，支持方向键、Home/End）。点击目录项时持有导航锁；流式追加时只渲染新增的条目。

**`element-picker.ts`** — 实时高亮悬停元素，点击生成选择器；ESC、右键或 20 秒无操作取消。

**`overlay-dialog.ts`** — 拾取结果与站点配置共用的对话框骨架，含焦点陷阱；关闭后焦点回到打开它的控件。

### 核心层

**`toc-app.ts`** — 主应用协调器。`initForConfig(cfg, options)` 返回 `{ rebuild, refreshConfig, collapse, expand, destroy }`。配置刷新若落在一次重建进行期间，会排队一次补跑。

**`config-manager.ts`** — 站点配置对话框、拾取结果保存、从 storage 读取最新配置；所有变更经后台的 `toc:mutateConfig` 消息串行写入。

**`rebuild-scheduler.ts`** — 协调 dom-watcher 和 url-monitor：
- 固定防抖：400ms（常规），1200ms（流式内容期间）
- 上限：首个待处理变更之后最多 3 秒必有一次重建
- 导航锁持有期间等待解锁
- 重建进行期间到达的请求，在该次重建成功后补跑一次
- 断路器：连续 5 次失败后暂停；30 秒后半开探测一次，URL 变化立即复位

**`dom-watcher.ts`** — MutationObserver 监听 DOM 变更。没有选择器时只关心涉及标题的变更；选择器列表通过 `getSelectors()` 实时读取，因此聊天页面注入的哨兵选择器能立即生效。

**`url-monitor.ts`** — 优先使用 Navigation API（Chromium 102+），回退到 popstate/hashchange 事件，另有 3 秒轮询；标签页隐藏时暂停轮询。

**`nav-lock.ts`** — 导航锁：点击目录项后 1 秒内不让阅读位置观察器改动高亮，防止跳动。

**`active-item-tracker.ts`** — 用 IntersectionObserver 跟踪当前阅读位置，在收起缩略图和展开列表之间共享同一个 activeIndex。

## 🛡️ 样式保护机制

1. **Shadow DOM 隔离**: 全部 UI 位于一个 closed Shadow root，页面 CSS 无法命中；页面脚本也无法读取或点击扩展 UI
2. **UA 样式重置**: `:host { all: initial }` 挡住继承属性；`.toc-floating`、`.toc-edge-dock` 子树与站点配置对话框里的删除按钮各有 `all: unset` 重置
3. **CSS 自定义属性主题**: 使用 `--toc-bg-panel` 等变量支持亮色/暗色主题
4. **优先级保护**: 样式普遍带 `!important`，作为第二道防线

## ⚡ 性能优化策略

### 1. 自动重建
- 内容相同时跳过重建
- 用户交互期间（导航锁）延迟重建
- 固定防抖加最大等待上限，断路器兜底

### 2. 内存管理
- `destroy()` 方法清理事件监听器和观察器
- 定时器自动清理
- 组件销毁时释放资源

### 3. DOM 操作
- 构建分块让出主线程，批量读取几何信息
- 增量更新：只改动高亮变化的那两个节点
- 使用 DocumentFragment

## 🔄 扩展和维护

### 添加新功能
1. 在对应模块目录创建新文件，使用 `export` 导出
2. 在需要使用的模块中通过 `import` 引入
3. WXT/Vite 在构建时自动解析和打包
4. 如果是工具函数，考虑添加到 `utils/toc-utils.ts` 的 barrel 重导出

### 调试和测试
- 自动化测试：`npm test` 运行 `checks/*.test.mjs`；CI 对每次推送执行 `npm run build`（类型检查、测试、构建）
- 能在沙箱里执行真实模块时，优先断言行为而不是匹配源码文本
- 手工验证仍用于扩展加载、真实网页交互和浏览器权限行为
- 需要内容脚本的调试日志时，要在 DevTools 控制台里切到扩展的内容脚本上下文，再设置 `__TOC_DEBUG = true`

### 代码质量
- 统一的代码风格
- 完整的错误处理
- ESM 静态依赖，构建时校验
