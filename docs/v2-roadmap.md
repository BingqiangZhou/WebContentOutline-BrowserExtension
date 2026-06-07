# Web TOC Assistant 2.0 升级设计文档

> 创建日期：2026-06-06
> 状态：草案，待审核

---

## 1. 背景与动机

Web TOC Assistant 当前版本 v1.6.1，已上线 Chrome Web Store。经过 9 个月、24+ 个版本的迭代，核心功能已经成熟。2.0 的核心目标是**大幅简化产品**：去掉老 UI（已完成）、去掉手动配置，用 AI 自动检测取代，让插件变成"开箱即用的智能 TOC"。

**设计目标：**
1. ~~删除 Classic UI，Edge Dock 成为唯一 UI 模式~~ *(已完成 — v1.6.0)*
2. 去掉所有手动配置（Element Picker、Site Config、选择器），AI 自动检测取代
3. 简化 Edge Dock 为纯导航面板（去掉所有操作按钮）
4. 利用 Chrome 内置 AI API 增强内容区域识别

---

## 2. 设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| UI 模式 | Edge Dock only，删除 Classic | 减少 UI 复杂度，聚焦一种体验 |
| 检测方式 | AI 自动检测，完全取代手动配置 | 开箱即用，零配置 |
| Edge Dock 按钮 | 全部去掉（纯导航） | 简化交互，AI 替代手动操作 |
| 每站点控制 | 保留工具栏图标开关 | 用户仍需基本控制 |
| 开发节奏 | 分阶段发布（v1.5 → v1.6 → v2.0） | 降低风险，逐步交付 |

### v1.x → v2.0 产品定位对比

| | v1.x | v2.0 |
|---|---|---|
| UI 模式 | Edge Dock + Classic（可切换） | Edge Dock only |
| 检测方式 | 启发式 + 手动 CSS/XPath 选择器 | AI 自动检测 + 启发式降级 |
| 用户配置 | 元素选择器、站点配置、UI 模式切换 | 无需配置（仅工具栏开关） |
| Edge Dock 按钮 | 6 个操作按钮 | 0 个（纯 TOC 导航） |
| 内容区域识别 | 4 层启发式规则 | AI 分析 + 启发式降级 |
| 产品理念 | 可配置的 TOC 工具 | 开箱即用的智能 TOC |

---

## 3. 核心变更

### 3.1 删除 Classic UI

**删除的文件：**
- `src/ui/classic-floating-panel.ts`（~203 行）
- `src/ui/classic-collapsed-badge.ts`（~157 行）

**修改的文件：**
- `src/core/toc-app.ts` — 移除 Classic 模式分支、UI 模式切换逻辑
- `entrypoints/toc.content/style.css` — 移除 Classic 模式相关样式
- `src/utils/storage.ts` — 移除 UI 模式偏好存储键
- 相关测试文件 — 移除 Classic/UI-mode 相关测试用例

### 3.2 删除手动配置功能

**删除的文件：**
- `src/ui/element-picker.ts`（~271 行）— 元素选择器

**修改的文件：**
- `src/core/config-manager.ts` — 移除 Site Config overlay 逻辑和配置变更通知
- `src/core/toc-app.ts` — 移除 Element Picker 调用
- `entrypoints/background.ts` — 移除 `toc:mutateConfig` 消息处理
- 存储键 `tocConfigs` 不再使用（迁移时清理）

### 3.3 简化 Edge Dock

**去掉的操作按钮：**

| 按钮 | 现有功能 | 为什么去掉 |
|------|---------|-----------|
| Refresh | 手动刷新 TOC | AI + 自动检测处理 |
| Pick Element | 点击页面元素生成选择器 | AI 替代手动选择 |
| Site Config | 查看管理已保存选择器 | AI 替代手动配置 |
| Move Left/Right | 移动 Dock 位置 | 保留拖拽即可 |
| Switch to Classic | 切换到老 UI | Classic 已删除 |
| Close | 关闭 TOC | 折叠即可 |

**Edge Dock 2.0 交互：**
- 折叠态：边缘小图标（保持现有行为）
- Hover/点击：展开 TOC 列表
- 拖拽：移动位置（保持现有行为）
- TOC 列表：纯导航，点击跳转到对应章节
- 活跃项高亮（保持现有行为）

**修改的文件：**
- `src/ui/edge-dock.ts` — 移除设置菜单（flyout menu）及其所有按钮

### 3.4 AI 自动检测

**核心思路：** 用户无需做任何配置，AI 自动分析页面结构，识别主内容区域，提取标题生成 TOC。

**两阶段检测管线：**

```
页面加载
  ↓
阶段 1：结构检测（即时，<100ms）
  - 现有 4 层 content-region 检测
  - 标题收集（H1-H6）
  - chatbot 页面检测
  - 计算 confidence score
  ↓
  confidence > 0.8 → 直接使用
  confidence < 0.8 → 进入阶段 2
  ↓
阶段 2：AI 分析（异步，1-3s）
  - Prompt API 分析页面 DOM 骨架
  - 识别主内容区域 vs 导航/侧边栏/广告
  - 返回 { mainContentSelector, confidence }
  - 缓存 per origin
  ↓
  生成 TOC
```

**新增文件：**
- `src/utils/ai-availability.ts` — AI 模型可用性检测
- `src/utils/ai-content-analyzer.ts` — Prompt API 内容区域分析

**修改的文件：**
- `src/utils/content-region.ts` — 接入 AI 增强层（confidence 低时触发 AI）
- `src/utils/toc-builder.ts` — 使用 AI 返回的内容区域选择器
- `src/core/rebuild-scheduler.ts` — 协调异步 AI 检测与即时显示

**Prompt API 集成设计：**

```typescript
// src/utils/ai-content-analyzer.ts
interface AIContentAnalysis {
  mainContentSelector: string;   // 主内容区域 CSS 选择器
  confidence: number;            // 0-1
  reasoning: string;             // AI 判断理由（调试用）
  excludedRegions: string[];     // 被排除的区域选择器
}

async function analyzeContentRegion(doc: Document): Promise<AIContentAnalysis | null> {
  // 1. 检查 AI 可用性
  if (!await isAIAvailable()) return null;

  // 2. 提取页面结构骨架（不发送完整 DOM）
  const skeleton = extractDOMSkeleton(doc);

  // 3. 调用 Prompt API
  const session = await ai.languageModel.create();
  const result = await session.generateStructuredOutput(skeleton, analysisSchema);

  // 4. 验证返回的选择器有效
  if (validateSelector(result.mainContentSelector, doc)) {
    return result;
  }
  return null;
}
```

**缓存策略：**
- 缓存 key：origin
- 缓存内容：`AIContentAnalysis` + `pageSignature`（页面结构哈希）
- 失效条件：页面结构变化超过阈值 或 缓存超过 30 天
- 存储位置：`chrome.storage.local` → `tocAiContentCache`

**降级策略（三级保障）：**
- AI 模型不可用 → 完全使用现有启发式检测
- AI 返回无效选择器 → 回退启发式
- AI 超时（>5s）→ 使用启发式结果

### 3.5 存储版本化 + 迁移

```typescript
// src/utils/storage-migration.ts

const CURRENT_SCHEMA_VERSION = 2;

// v1 → v2 迁移：
// - tocSiteEnabledMap → 保留，继续用于工具栏开关
// - tocConfigs → 迁移时清理（不再使用手动选择器）
// - tocPanelExpandedMap → 移除（Classic 模式相关）
// - 新增 tocAiContentCache → AI 检测缓存
// - 新增 tocSchemaVersion → schema 版本号
```

**迁移时机：** `background.ts` 启动时检查 `tocSchemaVersion`，缺失则从 v1 运行迁移。

### 3.6 架构优化（可选）

**chatbot-detector.ts 拆分**（`src/utils/chatbot/`）：
- `types.ts`、`detection-layers.ts`、`selector-discovery.ts`、`hint-table.ts`、`chatbot-builder.ts`、`index.ts`

**toc-app.ts 精简：**
- 移除 Classic UI 分支后，代码量预计减少 40-50%
- 可选拆分为更小的模块

---

## 4. Chrome 内置 AI API 参考

| API | Chrome 版本 | 用途 | 降级策略 |
|-----|------------|------|---------|
| Prompt API | 138+（扩展稳定） | 页面结构分析、内容区域识别 | 纯启发式检测 |

**可用性检测：**
```typescript
async function isAIAvailable(): Promise<boolean> {
  try {
    const availability = await ai.languageModel.availability();
    return availability === 'available';
  } catch {
    return false;
  }
}
```

**硬件限制：** Gemini Nano 需要 22GB 磁盘空间、4GB+ VRAM 或 16GB+ RAM、桌面设备。
**类型支持：** `@types/dom-chromium-ai` npm 包。

---

## 5. 删除清单

| 功能 | 涉及文件 | 原因 |
|------|---------|------|
| Classic 浮动面板 | `classic-floating-panel.ts` | 只保留 Edge Dock |
| Classic 折叠徽章 | `classic-collapsed-badge.ts` | 只保留 Edge Dock |
| UI 模式切换 | `toc-app.ts` 模式分支、`storage.ts` | 只有一种模式 |
| Element Picker | `element-picker.ts` | AI 替代手动选择 |
| Site Config overlay | `config-manager.ts` 部分 | AI 替代手动配置 |
| 手动 CSS/XPath 选择器 | `tocConfigs` 存储键 | AI 替代 |
| Edge Dock 操作按钮 | `edge-dock.ts` 菜单部分 | 简化 UI |
| Config change 通知 | `config-manager.ts` callback | 不再有用户配置 |
| Picker 结果 overlay | `element-picker.ts` | 随 Picker 一起删除 |

---

## 6. 保留清单

| 功能 | 说明 |
|------|------|
| Edge Dock（唯一 UI） | 折叠/展开、拖拽移动、活跃项高亮 |
| 工具栏图标切换 | 每站点启用/禁用（蓝/灰图标） |
| 标题检测 | H1-H6 自动检测 |
| Chatbot 页面检测 | 12+ AI 平台对话 TOC |
| 内容区域检测 | 4 层启发式 + AI 增强 |
| 暗色模式 | `prefers-color-scheme` |
| 中英双语 | i18n（en + zh_CN） |
| 跨标签页同步 | storage change listener |
| 重建调度 | debounce + circuit breaker |
| 扩展上下文失效处理 | 防御性编程 |
| Edge Dock 拖拽 | 指针事件拖拽移动 |
| 侧边固定（左/右） | per-host 记住位置 |

---

## 7. 关键文件清单

| 文件 | 变更 | Phase |
|------|------|-------|
| `src/ui/classic-floating-panel.ts` | **删除** | 1 |
| `src/ui/classic-collapsed-badge.ts` | **删除** | 1 |
| `src/ui/element-picker.ts` | **删除** | 1 |
| `src/ui/edge-dock.ts` | 移除操作按钮菜单 | 1 |
| `src/core/toc-app.ts` | 移除 Classic 分支、配置管理、模式切换 | 1 |
| `src/core/config-manager.ts` | 精简，移除 overlay/手动配置逻辑 | 1 |
| `entrypoints/background.ts` | 移除 mutateConfig 处理、添加存储迁移 | 1 |
| `entrypoints/toc.content/style.css` | 移除 Classic/Picker/Config CSS | 1 |
| `src/utils/storage.ts` | 添加版本化接口 | 1 |
| 新增 `src/utils/storage-migration.ts` | 迁移系统 | 1 |
| 新增 `src/utils/ai-availability.ts` | AI 可用性检测 | 2 |
| 新增 `src/utils/ai-content-analyzer.ts` | Prompt API 内容分析 | 2 |
| `src/utils/content-region.ts` | 接入 AI 增强层 | 2 |
| `src/utils/toc-builder.ts` | 使用 AI 内容区域选择器 | 2 |
| `src/core/rebuild-scheduler.ts` | 协调异步 AI 检测 | 2 |
| `src/utils/chatbot-detector.ts` | 可选拆分为 chatbot/ 目录 | 2 |

---

## 8. 分阶段发布计划

### Phase 1: v1.6.0 — 删除 + 精简 ✅ 已完成

**目标：** 删除 Classic UI，简化为纯 Edge Dock + AI-ready 架构

Classic UI 已在 v1.6.0 中移除（classic-floating-panel.ts、classic-collapsed-badge.ts、UI 模式切换逻辑）。以下为原计划中剩余的任务：

| 任务 | 预估 | 状态 |
|------|------|------|
| 删除 Classic UI 文件和相关逻辑 | 2 天 | ✅ 已完成 |
| 删除 Element Picker + Site Config | 2 天 | 待定 |
| 删除 Edge Dock 操作按钮菜单 | 1 天 | 待定 |
| 精简 toc-app.ts（移除 Classic/配置分支） | 3 天 | 部分完成 |
| 精简 CSS（移除 Classic/Picker/Config 样式） | 1 天 | 部分完成 |
| 存储版本化 + 迁移系统 | 2 天 | 待定 |
| 更新测试 | 3 天 | 部分完成 |
| 冒烟测试 + 回归验证 | 2 天 | ✅ 已完成 |

**验证标准：**
- ✅ Edge Dock 正常折叠/展开/拖拽/导航
- ✅ 工具栏图标启用/禁用正常
- ✅ chatbot 页面检测正常
- ✅ 手动冒烟测试：5+ 不同类型网站

### Phase 2: v1.7/v2.0 — AI 自动检测

**目标：** AI 自动识别内容区域，用户零配置

| 任务 | 预估 |
|------|------|
| AI 可用性检测模块 | 1 天 |
| Prompt API 内容区域分析 | 5 天 |
| 两阶段检测管线集成 | 3 天 |
| AI 缓存机制 | 2 天 |
| 降级测试 + 多页面验证 | 3 天 |
| **合计** | **~3 周** |

**验证标准：**
- AI 检测在文档/博客/新闻/chatbot 等页面准确
- AI 不可用时降级为启发式检测，无功能损失
- 缓存命中时跳过 AI 调用
- 性能不退化（结构检测仍 <100ms）

### Phase 3: v2.0.0 — 稳定发布

**目标：** 生产级质量

| 任务 | 预估 |
|------|------|
| chatbot-detector 可选拆分 | 3 天 |
| E2E 测试基础设施（Playwright） | 5 天 |
| 性能优化 | 3 天 |
| 20+ 网站兼容性测试 | 5 天 |
| Web Store 更新准备 | 2 天 |
| **合计** | **~3 周** |

**验证标准：**
- 所有测试通过（单元 + E2E）
- 20+ 网站兼容性验证
- 存储迁移无数据丢失
- AI 降级无用户感知

**总计预估：约 8.5 周（2 个月）**

---

## 9. 风险评估

| 风险 | 可能性 | 影响 | 缓解 |
|------|--------|------|------|
| Prompt API 输出质量不稳定 | 中 | 检测不准确 | confidence 阈值 + 启发式回退 |
| Gemini Nano 硬件要求高，覆盖面小 | 高 | 大部分用户无 AI | 完全降级设计，启发式作为保底 |
| 删除功能导致现有用户不满 | 低 | 用户投诉 | v1.4 已有用户配置在迁移中保留启用状态 |
| chatbot-detector 拆分引入回归 | 中 | chatbot 检测失败 | 桶导出保持 API 不变 + 现有测试 |

---

## 10. 未来展望（2.0+）

以下特性不在 2.0 范围内，作为后续版本候选：

- **侧边栏面板** — Chrome Side Panel API
- **章节摘要** — Summarizer API
- **TOC 翻译** — Translator API
- **主题系统** — 用户自定义 CSS 变量
- **设置页面** — Options Page
- **首次提示药丸** — 新站点自动提示启用
- **E2E 测试** — Playwright 自动化
