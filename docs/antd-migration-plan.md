# Ant Design 6 迁移计划

> 状态：Phase 0–4 已实施，待人工视觉回归 · 编写日期：2026-11-06 · 范围：`renderer/src/app` 的手写 UI
> 落地成果：`antd@6.7.0` 接管标准控件；`npm run check`（含新增 `check:ui`）全绿；`vite build` 通过。

---

## 1. 背景

### 1.1 起点

仓库里存在大量"手写但本质是标准控件"的实现，行为成本远高于视觉价值：

| 类型 | 数量 | 分布 |
| :-- | :-- | :-- |
| 原生 `<select>` | 13 | 7 个文件 |
| 手写 `role="dialog"` / `aria-modal` | 10 | 6 个文件 |
| 手写 `role="menu"` | 4 | `CanvasContextMenu`、`CanvasNodeToolbar`×2、`ProjectsView` |
| 手写 `role="listbox"` | 2 | `CameraControlPanel`、`GenerationNodeComposer` |
| 原生 checkbox / number / range / file | 16 | 10 个文件 |
| `<table>` | 0 | 列表均为卡片布局 |

这些控件的共同问题是：焦点陷阱、Esc/遮罩关闭、滚动锁定、边界翻转、键盘导航、无障碍语义，每一项都要自己实现一遍，并且每个文件实现得都不完全一致。

### 1.2 已完成基线（本次计划的前提）

| 产物 | 说明 |
| :-- | :-- |
| `package.json` | `antd ^6.7.0`、`@ant-design/icons ^6.3.4` |
| `renderer/src/app/ui/antd/AntdProvider.tsx` | 唯一挂 `ConfigProvider` 的地方；`zhCN`、`autoInsertSpace: false`、seed token |
| `renderer/styles/antd-theme.css` | `--ant-*` → `tokens.css` 映射；弹层容器焦点环抑制 |
| `renderer/src/main.tsx` | `AntdProvider` 包裹 `ReactWorkbench`；`antd-theme.css` 在区域样式之后导入 |
| `renderer/src/app/components/UpdateDialog.tsx` | `Modal` + `Button` + `Progress` + `Alert` 试点 |
| `tests/desktop-updater.test.mjs` | 更新弹窗的 AntD 契约断言 |

已验证：`npm run check` 630 pass、`typecheck`、`check:styles`（19 表 / 682 色阶）、`check:layers`（303 文件）、`vite build` 通过；更新弹窗四态、Esc/遮罩、强制更新拦截、`.dark` 跟随、按钮对齐（top/bottom 完全一致）均实测通过。

---

## 2. 目标与非目标

### 2.1 目标

1. 把"行为复杂、样式简单"的控件替换为 AntD，减少手写焦点管理、弹层定位和键盘导航代码。
2. 保持现有黑白极简视觉：所有颜色、圆角、字体、阴影只来自 `renderer/styles/tokens.css`。
3. 保持现有状态架构：AntD 只出现在 `app/` 层，不进入 `store/`、`domain/`、`services/`。
4. 每一批迁移都可独立回滚，且不改变业务状态与数据契约。

### 2.2 非目标

- 不替换画布、节点、React Flow 控件、3D 导演台、OpenReel 宿主、时间轴。
- 不引入 AntD 的布局系统（`Layout`、`Grid`、`Space`）重写现有 shell。
- 不引入 AntD 的全局 reset（`antd/dist/reset.css`）。
- 暗色由 `.dark` 类触发，`AntdProvider` 监听类变化并切换 `darkAlgorithm`；主题状态不写进 store，CSS 变量继续由 `tokens.css` 的 `.dark` 镜像提供。
- 不把 AntD 的状态（Modal open、Select value）搬进 `store/`。

---

## 3. 技术约束

### 3.1 主题分层

| 层 | 位置 | 规则 |
| :-- | :-- | :-- |
| Seed token | `AntdProvider.tsx` | 必须写字面量。`colorPrimary` 与 `tokens.css` 的 `--brand-accent` 同值（当前 `#6d6cff`），否则 AntD 的色板推导失效 |
| Alias token | `antd-theme.css` | 用 `--ant-*: var(--token)` 映射背景、文字、边框、圆角、字体、阴影 |
| 组件微调 | `AntdProvider.tsx` 的 `theme.components` | 只调结构性 token（如 `Modal.paddingContentHorizontalLG`） |

新增 `--ant-*` 映射时必须写在 `:root:root` 块里（AntD 以 priority -999 注入变量，单层 `:root` 可能被覆盖）。

### 3.2 样式门禁（`npm run check:styles`）

- `renderer/styles/` 下每个 `.css` 必须且只能被 `main.tsx` 导入一次，`tokens.css` 必须是第一个。
- 组件规则里禁止颜色字面量，只能 `var(--token)`。
- `var(--x)` 必须有真实定义（CSS 自定义属性、TSX 内联样式键或 `setProperty`）。
- 因此：所有 AntD 覆写集中在 `antd-theme.css`，不新建 `antd-modal.css` 之类的旁支文件。

### 3.3 分层门禁（`npm run check:layers`）

- `antd` 只允许在 `app/**` 出现。
- `store/`、`domain/`、`services/`、`agent/` 不得导入 `antd`。
- `app/store/` 不得引入 `domainReactivity` 之外的组合方式，也不承载 AntD 状态。

### 3.4 状态引擎

- 弹窗开关、选择值等仍由现有 `domainReactivity` / zustand 决定；AntD 组件只做受控呈现。
- 不使用 `Modal.confirm()` 这类隐式状态 API 处理业务确认，除非该确认不需要持久状态（如"清空输入"）。

### 3.5 弹层层级

现有层级令牌：

```
--layer-canvas-control: 110
--layer-canvas-popover: 115
--layer-canvas-composer: 120
--layer-toast: 600
```

AntD 默认 `zIndexPopupBase = 1000`（遮罩 1000、容器 1010），会盖住 `--layer-toast: 600`。

**决策**：在 `AntdProvider` 设置 `zIndexPopupBase: 560`。这样遮罩 560 / 容器 570，低于 Toast 600，通知仍然可见。手写搜索遮罩、工作区弹层、技能抽屉原先用的 `--layer-modal` / `--layer-workspace` / `--layer-overlay` 随迁移全部删除，弹层层级只保留 Provider 一处来源。

### 3.6 弹层容器策略

- 默认使用 body 挂载（AntD 默认），保证 Modal 不受画布 `transform` 影响。
- 只有位于画布 viewport 或工作区 `section.content` 内、且需要跟随局部滚动/裁剪的浮层，才传 `getPopupContainer`。
- 需要跟随节点的浮层（节点工具条、mention 菜单）继续自绘，不迁移。

### 3.7 已知债务（在 Phase 0 处理）

| 问题 | 现象 | 处理 |
| :-- | :-- | :-- |
| 暗色组件变量不跟随 | antd 6 在组件作用域生成 `--ant-*`，根节点别名盖不住，`.dark` 下 Select/InputNumber 仍是白底 | `AntdProvider` 跟随 `.dark` 切换 `darkAlgorithm`，并按主题切换 primary seed（#6d6cff / #8b8aff） |
| 缺少 `App` 上下文 | 后续用 `message` / `Modal.confirm` 时拿不到主题和 locale | `AntdProvider` 内加一层 `AntdApp` |
| 主 chunk 偏大 | `main` 约 2.38 MB / 690 KB gzip | 加 `manualChunks` 拆 `react` / `antd` / `openreel` 三组 vendor |

---

## 4. 阶段计划

### Phase 0 — 基础设施加固

**目标**：在批量迁移前把主题、层级、上下文、构建四件事固定下来，避免每个组件各自打补丁。

| # | 任务 | 文件 | 验收 |
| :-- | :-- | :-- | :-- |
| 0.1 | 包裹 `AntdApp`，暴露 `App.useApp()` | `app/ui/antd/AntdProvider.tsx` | `message` 在深色下背景/文字跟随 token |
| 0.2 | 设置 `zIndexPopupBase: 560` | 同上 | Modal 遮罩 560、容器 570；Toast 仍在其上 |
| 0.3 | 跟随 `.dark` 切换 `darkAlgorithm` 与 primary seed | `app/ui/antd/AntdProvider.tsx` | 深色下 Select、InputNumber、按钮的底色与主色都跟随 tokens |
| 0.4 | 抽出 `antdPopupContainer` 帮助函数（仅在有需要时使用） | `app/ui/antd/popupContainer.ts` | 无调用方时不产生死代码（Phase 3 再接入） |
| 0.5 | `manualChunks` 拆分 vendor | `vite.config.mjs` | `main` chunk 明显下降，构建无 >500 KB 警告 |

**完成标志**：`npm run check`、`npx vite build` 通过，更新弹窗在浅色/深色下外观不变。

---

### Phase 1 — 低风险弹窗（第二批）

**目标**：把三个结构标准的弹窗换成 AntD，同时固定 `Modal` 的使用范式。

#### 1.1 `VoicePickerDialog`

- 文件：`app/components/VoicePickerDialog.tsx`（115 行）
- 现状：`createPortal` + `role="dialog"` + 手写 Esc + 原生 `<select>` + 自绘按钮列表
- 目标：`Modal` + `Input.Search` + `Select` + `List`
- 保留：音色目录来自 `config/systemVoices`；允许未收录 ID；`onSelect` 契约不变
- 删除：`VoicePickerDialog.css` 中的遮罩、定位、Esc 相关规则
- 验收：搜索、语言筛选、空结果、选择回填、Esc/遮罩关闭

#### 1.2 `ProjectSearch`

- 文件：`app/components/ProjectSearch.tsx`（155 行）
- 现状：`role="dialog"` + 手写键盘上下选择 + 结果列表
- 目标：`Modal` + `Input` + `List`（保留 `onKeyDown` 的上下/回车逻辑，或改用 `AutoComplete`）
- 保留：跨项目搜索、`focusCanvasNodes`、`navigateToRoute`
- 验收：空结果、键盘循环、回车跳转、关闭后焦点回到触发按钮

#### 1.3 `CanvasToolbarCustomizeDialog`

- 文件：`app/canvas/CanvasToolbarCustomizeDialog.tsx`（229 行）
- 现状：portal + `role="dialog"` + 自绘 tablist + checkbox + 手写重置
- 目标：`Modal` + `Tabs` + `Checkbox` + `Button`
- 保留：dnd-kit 拖拽排序、`writeCustomization`、`nodeToolbarScopes` 顺序
- 注意：`Tabs` 的 `activeKey` 与 `scope` 双向同步；拖拽容器不能被 Modal 的 `overflow` 裁掉
- 验收：三个 scope 切换、拖拽跨区、重置、显示标签开关

#### 1.4 `CreationView` 的两个 select

- 文件：`app/views/CreationView.tsx`（素材类型 / 排序）
- 目标：`Select`（`size="small"`，`variant="borderless"` 视设计而定）
- 验收：筛选/排序结果与现状一致，`.dark` 下背景透明

**阶段验收**：`npm run check` + 浏览器实测三弹窗 + 无 `Warning: [antd:` 输出。

---

### Phase 2 — 设置与技能

**目标**：把表单类界面统一到 AntD，减少设置项各自的输入控件实现。

#### 2.1 `SettingsPanel`

- 文件：`app/views/SettingsPanel.tsx`（587 行）
- 现状：原生 `<select>` ×1、自绘模型下拉（`settings-model-select`，button + 绝对定位菜单）、原生 number/checkbox
- 目标：
  - 语言选择 → `Select`
  - 模型下拉 → `Select` + `optionRender`（保留 `ProviderBrandIcon`）
  - 数值项 → `InputNumber`
  - 开关项 → `Switch`
  - 分栏 → `Segmented`（如"自动 / 手动"）
- 保留：`settings-model-menu` 的分组顺序、当前选中态、`disabled` 条件
- 风险：设置项较多，建议按 section 逐个替换，单次提交不超过一个 section
- 验收：每个 section 改动前后行为一致；保存/回滚逻辑不变

#### 2.2 `SkillEditorPanel`

- 文件：`app/views/SkillEditorPanel.tsx`（192 行）
- 现状：3 个原生 checkbox + number 输入
- 目标：`Form` + `Checkbox` + `InputNumber` + `Switch`
- 注意：如果表单只是本地草稿、没有校验需求，可以只用受控组件而不强行套 `Form`

#### 2.3 `SkillsView`

- 文件：`app/views/SkillsView.tsx`（242 行）
- 现状：4 个原生 checkbox + 隐藏 file input + 自绘多选列表
- 目标：`Checkbox.Group` + `Upload` + `List` + `Empty`
- 保留：批量启用/禁用、导入解析、错误提示
- 验收：全选/反选、导入成功与失败、空列表

**阶段验收**：设置面板全部 section 实测；技能导入/多选实测；`check:i18n` 通过（新增可见文案必须走 `t()`）。

---

### Phase 3 — 列表与菜单

**目标**：把"自己算位置、自己监听 Escape"的浮层换成库组件。

#### 3.1 `ProjectsView` 的菜单与筛选

- 文件：`app/views/ProjectsView.tsx`（587 行）
- 现状：`role="menu"` 排序菜单 + 原生筛选 select + 右键上下文菜单（`openEntryMenu`）
- 目标：
  - 排序 → `Dropdown` + `Menu`
  - 筛选 → `Select`
  - 右键 → `Dropdown trigger={["contextMenu"]}` + `Menu`
- 保留：`openCreateMenu` 在空白处右键、项目条目菜单项（重命名/删除/归档等）
- 风险：右键菜单当前可能依赖 `anchor` 坐标；`Dropdown` 会接管定位，需确认多选/键盘行为
- 验收：空白右键、条目右键、排序切换、筛选切换、删除确认

#### 3.2 `ClipExportMenu`

- 文件：`app/editor/ClipExportMenu.tsx`（68 行）
- 现状：portal + 手写 `place()` + `ResizeObserver` + 手写 Escape
- 目标：`Dropdown` + `Menu`（目标分组用 `Menu.ItemGroup`）
- 收益：可删除整段定位与 `ResizeObserver` 代码
- 注意：菜单在 `useWorkbenchSurfaceRoot()` 里，需要 `getPopupContainer={() => surface}`
- 验收：靠近视口边缘自动翻转；导出成功/失败提示不变

#### 3.3 `CameraControlPanel` 的 listbox

- 文件：`app/canvas/CameraControlPanel.tsx`
- 现状：`role="listbox"` 自绘相机预设
- 目标：`Select`（预设分隔用 `Divider`）
- 风险：该面板位于画布内，弹层需要 `getPopupContainer` 到面板根节点，避免随画布缩放

**阶段验收**：三个浮层在画布缩放/滚动、内容区滚动下定位正确；Escape 只关最上层。

---

### Phase 4 — 媒体与编辑器

**目标**：处理交互最重的部分，逐项确认后再迁移。

| # | 文件 | 现状 | 目标 | 关键风险 |
| :-- | :-- | :-- | :-- | :-- |
| 4.1 | `app/editor/AssetPickerDialog.tsx`（364 行） | portal + 自绘 Modal + Tabs + 多选网格 | `Modal` + `Tabs` + `Checkbox` + `Empty` + `Spin`；网格自绘 | 50 个上限、"已添加"判定、媒体预览 |
| 4.2 | `app/components/ImageCropEditor.tsx`（153 行） | 4 个原生 select | `Segmented` + `Select` + `InputNumber` | 裁剪模式切换时画布重排 |
| 4.3 | `app/components/ImageWatermarkEditor.tsx`（355 行） | 3 个 select + checkbox | `Select` + `Checkbox` + `Slider` | 水印定位与画布坐标 |
| 4.4 | `app/components/ImageAnnotationEditor.tsx`（158 行） | select + 工具按钮 | `Segmented` / `Radio.Group` + `Tooltip` | 绘制手势不能被焦点抢占 |
| 4.5 | `app/canvas/GenerationSettingsPanel.tsx`（223 行） | select + `type="range"` | `Select` + `Slider` + `InputNumber` | 参数直接驱动生成请求，需确认数值语义 |

**阶段验收**：每个编辑器在真实素材上跑一遍；生成参数提交后请求体不变；`check` 全绿。

---

### Phase 5 — 收尾

| # | 任务 | 说明 |
| :-- | :-- | :-- |
| 5.1 | 评估 `ToastHost` 的 `MessagePopup` | 可选：把 `<dialog>` 换成 `Modal` 统一焦点管理；Toast 栈本身保持自绘（`notificationStore` 是 zustand 界面状态，不引入第二套通知队列） |
| 5.2 | 清理死 CSS | 每个阶段删除对应区域样式表中失效的选择器，保持 `check:styles` 色阶数不虚增 |
| 5.3 | 补充开发说明 | 在 `docs/` 或 `app/ui/antd/` 下写一页"新增 AntD 组件的三步：Provider token → 主题变量 → 契约测试" |
| 5.4 | 构建优化复盘 | 确认 `manualChunks` 生效，记录主 chunk 体积变化 |
| 5.5 | 全量回归 | `npm run verify:product`（含 `check`、`harness:test`、`build`、`harness:verify-package`） |

---

## 5. 单个组件的迁移模板（DoD）

每个组件迁移必须完成以下清单，缺一项不算完成：

1. **替换实现**：只换 UI 组件，不改业务 props 与回调签名。
2. **受控状态**：`open` / `value` 仍来自现有 store 或本地 state；AntD 不持有业务状态。
3. **主题**：不写颜色字面量；必要时在 `antd-theme.css` 补 `--ant-*` 映射。
4. **层级**：确认不会被 Toast 盖住，也不会盖住更高层工作区。
5. **键盘与无障碍**：Tab 循环、Esc 关闭、焦点返回触发元素。
6. **暗色**：切到 `.dark` 实测背景/文字/边框。
7. **无弃用警告**：控制台不得出现 `Warning: [antd:`。
8. **删除死 CSS**：对应区域样式表中不再使用的规则一并移除。
9. **契约测试**：更新或新增 `tests/*.test.mjs` 断言（源码契约或 SSR 渲染）。
10. **验证命令**：

```bash
npm run typecheck
npm run check:styles
npm run check:layers
npm run check:tests
node --test tests/<相关>.test.mjs
npx vite build
```

11. **浏览器实测**：浅色 + 深色，正常路径 + 空态 + 错误态。

---

## 6. 测试策略

### 6.1 已有设施

- `tests/helpers/sourceContract.mjs`：统一读取源码做契约断言（`readSource` / `readSources` / `assertSource`）。
- `tests/helpers/rendererSsr.mjs`：起渲染进程模块图做 SSR 冒烟。
- `scripts/verify-test-architecture.mjs`：禁止测试里手写 `readFileSync(new URL(...))` 和 `createServer`。

### 6.2 新增断言方向

| 类型 | 示例 |
| :-- | :-- |
| 组件替换 | `assert.match(source, /<Modal[\s\S]*?open=\{open\}/)` |
| 主题桥 | `assert.match(themeCss, /--ant-color-bg-container: var\(--surface\)/)` |
| 层级 | `assert.match(provider, /zIndexPopupBase: 560/)` |
| 行为保留 | 断言关键回调仍被调用（`onSelect`、`onExport`、`writeCustomization`） |
| 死代码 | `assert.doesNotMatch(styles, /\.voice-picker-backdrop/)` |

### 6.3 手工验证清单

- 浅色 / `.dark` 各一遍
- 窗口窄到 800×600 时弹窗不溢出
- 画布缩放到 50% / 200% 时浮层定位
- 同时打开 Modal + Toast，确认 Toast 在最上层

---

## 7. 工作量与顺序

| 阶段 | 内容 | 预估 |
| :-- | :-- | :-- |
| Phase 0 | 基础设施加固 | 0.5 天 |
| Phase 1 | 3 个弹窗 + 2 个 select | 1.5 天 |
| Phase 2 | 设置 + 技能 | 2.5 天 |
| Phase 3 | 项目菜单 + 导出菜单 + 相机面板 | 2 天 |
| Phase 4 | 媒体编辑器 + 生成参数 | 3 天 |
| Phase 5 | 收尾与全量回归 | 1 天 |
| **合计** | | **约 10.5 天** |

依赖关系：Phase 0 必须先完成；Phase 1–4 之间无强依赖，可按业务优先级调整；Phase 5 必须最后做。

---

## 8. 风险与回滚

| 风险 | 影响 | 缓解 |
| :-- | :-- | :-- |
| 视觉漂移 | 界面变成"企业后台" | 只迁移行为复杂的控件；主题全部走 `tokens.css`；每个组件必须过 `.dark` 实测 |
| 弹层层级冲突 | Toast 被 Modal 盖住 | Phase 0 固定 `zIndexPopupBase: 560` |
| 画布内浮层错位 | 缩放/滚动后偏移 | 画布内浮层保留自绘；必须迁移时用 `getPopupContainer` 到局部根 |
| 表单行为变化 | 设置项保存值类型变化 | 逐个 section 替换；`onChange` 里显式转换类型并写断言 |
| 包体积增长 | 首屏变慢 | Phase 0 拆 vendor；后续新增组件按需 import |
| AntD 版本弃用 | 控制台警告 | 每次迁移检查 `Warning: [antd:`，按 v6 新 API 写（`mask.closable`、`Alert title`、`size="medium"`） |
| 测试断言脆弱 | 源码文本断言随格式化失败 | 只断言结构关键片段，不断言整段 JSX |

**回滚策略**：每个组件独立提交，回滚只需 `git revert` 单个 commit；主题与 Provider 的改动集中在 Phase 0，回滚 Phase 0 即回到当前基线。

---

## 9. 保持自绘清单（明确不做）

| 区域 | 文件 | 原因 |
| :-- | :-- | :-- |
| 画布与节点 | `WorkflowCanvas`、`CanvasNodes`、`CanvasNodeToolbar` | React Flow 坐标系与缩放 |
| 画布内联浮层 | `CanvasDisplaySettings`、`GenerationNodeComposer` mention 菜单 | 跟随节点/光标定位 |
| 3D 导演台 | `ThreeDDirectorNode`、`vendor/storyai-3d-director-desk/` | iframe + postMessage 隔离 |
| 剪辑台 | `VideoEditorWorkspace`、时间轴/轨道 | 像素级拖拽与吸附 |
| 媒体查看 | `MediaViewer` | 手势缩放、全屏、视频控制 |
| 窗口控制 | `WindowControls` | 桌面端原生语义 |
| Toast 宿主 | `ToastHost` 的 toast 栈 | `notificationStore` 是 zustand 界面状态；悬停暂停/最多 3 条是产品规则 |
| 右键画布菜单 | `CanvasContextMenu` | 需要与画布坐标系绑定，`Dropdown` 定位反而更复杂 |

---

## 10. 附录：组件对照表

| 手写实现 | AntD 组件 | 备注 |
| :-- | :-- | :-- |
| `role="dialog"` + backdrop | `Modal` | 统一 `centered`、`mask.blur` |
| 原生 `<select>` | `Select` | 需要搜索时用 `showSearch` |
| 自绘下拉菜单 | `Dropdown` + `Menu` | 右键用 `trigger={["contextMenu"]}` |
| 自绘列表选择 | `List` / `Radio.Group` | 单选/多选语义分开 |
| `<input type="checkbox">` | `Checkbox` / `Switch` | 布尔开关优先 `Switch` |
| `<input type="number">` | `InputNumber` | 需要步进与精度 |
| `<input type="range">` | `Slider` | 需要同时展示数值时配 `InputNumber` |
| `<input type="file">` | `Upload` | `beforeUpload` 返回 `false` 保留手动上传 |
| 手写进度条 | `Progress` | 已用于 `UpdateDialog` |
| 手写错误条 | `Alert` | v6 用 `title`，不是 `message` |
| 手写空态 | `Empty` | 统一文案走 `t()` |
| 手写加载态 | `Spin` / `Skeleton` | 大区块用 `Skeleton` |
| 手写 Tab 栏 | `Tabs` | `items` API |
| 手写分段控件 | `Segmented` | 2–5 个互斥选项 |

---

## 11. 实施记录（2026-11-06）

### 11.1 已迁移

| 批次 | 文件 | 结果 |
| :-- | :-- | :-- |
| Phase 0 | `ui/antd/AntdProvider.tsx`、`styles/antd-theme.css`、`vite.config.mjs` | Provider、`zIndexPopupBase: 560`、跟随 `.dark` 的 darkAlgorithm、vendor 分包 |
| Phase 1 | `VoicePickerDialog`、`ProjectSearch`、`CanvasToolbarCustomizeDialog`、`CreationView` | `Modal` + `List` / `Select` / `Segmented`；手写 Esc、遮罩、焦点陷阱删除 |
| Phase 2 | `SettingsPanel`、`SkillEditorPanel`、`SkillsView` | `Select` / `InputNumber` / `Switch` / `Checkbox` / `Upload`；设置字段统一成资产下载路径的 34px / 7.2px 圆角外观 |
| Phase 3 | `ProjectsView`、`ClipExportMenu`、`CameraControlPanel` | `Dropdown` 接管右键/排序/导出定位；`Select` 取代自绘 listbox |
| Phase 4 | `AssetPickerDialog`、`ImageCropEditor`、`ImageWatermarkEditor`、`GenerationSettingsPanel` | `Modal` / `Tabs` / `Segmented` / `Slider`；画布内浮层外壳保留自绘 |
| Phase 5 | `ToastHost`、`UpdateDialog`、`ReactWorkbench` 设置工作台 | 重要消息、更新弹窗与设置工作台改用 `Modal`；toast 栈仍自绘 |
| 追加 | `SkillsView`、`AssetsView`、`MaterialsView`、`TasksView`、`HarnessSessionToolbar` | 技能抽屉、重命名/分类弹窗、三处右键菜单、会话历史全部交给 antd |
| 追加 | `AssetsView`、`MaterialsView`、`TasksView`、`SkillsFeature`、`CreationView` | 视图层 8 处 `window.confirm` 改为 `App.useApp().modal.confirm` |
| 追加 | `ui/confirm/confirmService.ts`、`ui/confirm/ConfirmHost.tsx`、适配器、`windowCloseGuard` | 非 React 模块通过确认服务使用 antd modal；全仓不再有 `window.confirm` |
| 追加 | `components/SearchInput.tsx`、`SettingsPanel`、`SkillEditorPanel`、`TasksView`、`CreationView` | 六个搜索框、厂商凭据、技能字段、任务筛选与素材分档改用 antd |

### 11.2 防回退

新增 `scripts/verify-ui-components.mjs`（`npm run check:ui`，已并入 `npm run check`）：

- 禁止新增原生 `<select>`、`input[type=checkbox|number|range|file]`。
- 禁止在未登记的文件里手写 `role="dialog"` / `role="menu"` / 遮罩类名。
- 禁止任何源码使用 `window.confirm`，确认统一走 `App.useApp().modal.confirm` / `confirmService`。
- 自绘白名单：dialog 四处（`CanvasDisplaySettings`、`ThreeDDirectorNode`、`ImageWatermarkEditor`、`MediaViewer`）；遮罩两处（3D 导演台、媒体灯箱）；`role="menu"` 两处（画布工具栏、画布右键菜单）。新增例外必须在脚本里写明原因。

### 11.3 验证结果

- `npm run check`：630 tests pass，`check:ui` 通过。
- `npx vite build`：通过；`main` 1.92 MB / 536 KB gzip、`antd` 696 KB / 226 KB gzip，React 与 i18n 共享块单独输出。
- 契约测试已同步到 AntD 语义：`generation-node-composer.test.mjs`、`workbench-surface.test.mjs`、`design-token-contract.test.mjs`、`skills-view-ui.test.mjs`、`settings-controls.test.mjs`、`ui-component-batch.test.mjs`、`confirm-service.test.mjs`、`confirm-wiring.test.mjs`、`ui-input-batch.test.mjs`。
- 浏览器冒烟：项目库首屏、设置工作台在浅色 / `.dark` 下均正常渲染，控制台 0 error；暗色下 Select / InputNumber 的组件变量为 `#141414`，设置弹窗容器为 `#161616`。
- 设置页字段对齐：Select / InputNumber 与资产下载路径输入框同为 34px 高、7.2px 圆角、1px `--line-strong` 边框、13px 字号；文本在字段内垂直居中（实测 Select 文本中心 422 / 字段中心 422.5，InputNumber 均为 662）；浅色/暗色均已截图核对。
- 第三批冒烟：技能抽屉浅色/暗色渲染正常，4px 窗框、16.8px 圆角、Esc 关闭；任务页右键菜单定位到锚点、图标 14px、菜单不折行；控制台 0 error。
- 确认服务冒烟：项目库“删除”弹出 antd 危险确认，取消后项目保留；脏技能关闭同样走 antd 确认，控制台 0 error。
- P3 冒烟：技能搜索无结果时显示 `Empty` 空态，浅色/暗色文字色正确；取色器与素材范围分档通过类型与结构校验（这两个视图当前没有侧栏入口，未做点击冒烟）。
- P2 冒烟：技能/项目库/任务三处搜索框宽度高度与图标正常，清空按钮可用；任务状态 `Segmented` 选中胶囊在浅色/暗色都可见；厂商 API Key（含眼睛切换）与接口地址、技能编辑字段在浅色/暗色下均与既有字段同高同边框；控制台 0 error。
- 确认框冒烟：技能切换/恢复默认、任务清空/重试、素材删除全部走 antd `modal.confirm`，不再出现浏览器原生对话框。

### 11.4 仍需人工回归

浅色 / `.dark` 各一遍，重点检查：三个弹窗（音色、搜索、工具栏定制）、设置页模型下拉、项目库右键菜单、剪辑导出菜单、资源选择器上限与失败态、画布缩放 50% / 200% 时的相机面板与生成参数弹层，以及 Modal 打开时 Toast 仍在最上层。

---

## 12. 第三、四批组件迁移（2026-11-06）

`check:ui` 现在拦原生 `select` / `checkbox` / `number` / `range` / `file`、未登记的 `backdrop` 类名、未登记的 `role="dialog"` / `role="menu"`。本批迁完了审计里最重复的五类结构。

### 已完成

| 位置 | 原实现 | 现在 |
| :-- | :-- | :-- |
| `views/SkillsView.tsx`、`styles/skills.css` | portal + 自绘遮罩 + `DRAWER_EXIT_MS` 进出场 | antd `Drawer`，只保留 4px 窗框和产品外壳 |
| `views/AssetsView.tsx`、`views/MaterialsView.tsx` | 两套重命名弹窗、一套分类弹窗 | `Modal` + `Input`，共用 `rename-dialog-body` 样式 |
| `views/AssetsView.tsx`、`views/MaterialsView.tsx`、`views/TasksView.tsx` | 三处右键菜单各自算坐标、钳边缘、点外关闭 | `components/ContextMenu.tsx` + `Dropdown`，边缘翻转交给组件 |
| `agent-chat/HarnessSessionToolbar.tsx` | `<details>` + 手写 outside/Esc/blur | `Dropdown` + 分组菜单 |
| `styles/project-materials.css`、`styles/skills.css`、`styles/agent-session.css` | 菜单、遮罩、抽屉动画的旧规则 | 随迁移删除；未消费 token `--scrim-soft`、`--action-icon-gap`、`--layer-overlay` 一并移除 |

### 确认

全部确认已统一：

- 视图层 8 处直接用 `App.useApp().modal.confirm`。
- 非 React 的 6 处（项目库回收 2、带片段连线删除 2、窗口关闭保存/放弃 2）通过 `ui/confirm/confirmService.ts` 请求，`ConfirmHost` 把 `App.useApp().modal.confirm` 注册给服务；宿主未挂载时默认拒绝危险动作。
- `check:ui` 禁止任何源码再写 `window.confirm`。

### P2：本批已完成

| 位置 | 原实现 | 现在 |
| :-- | :-- | :-- |
| `views/SettingsPanel.tsx` | 厂商 API Key / Base URL 原生输入 | `Input.Password` / `Input`，保留失焦提交与回车收起 |
| `views/SkillEditorPanel.tsx` | 名称、ID、分类、说明、指令原生输入 | `Input` / `Input.TextArea`；校验仍留在 `submit()` |
| `views/TasksView.tsx` | 状态筛选按钮组 | `Segmented`，计数、禁用态与选中胶囊保留 |
| `views/CreationView.tsx` | 画布素材三档 `role="tablist"` | `Segmented`（`canvas-material-tabs`），外壳仍跟随画布定位 |
| 六个视图 | 搜索框各自包 `.search` + 图标 + 原生 input | 统一 `components/SearchInput.tsx`（antd `Input` + `prefix` + `allowClear`） |

`check:ui` 同时禁止原生 `input[type=search|password]`。

### P3：本批已完成

| 位置 | 原实现 | 现在 |
| :-- | :-- | :-- |
| `components/ImageWatermarkEditor.tsx` | 原生 `input[type=color]` | antd `ColorPicker`，弹层走 body，不受画布缩放影响 |
| `views/AssetsView.tsx` | 项目/本地两档手写 `role="tablist"` | `Segmented`，下划线选中态由 `::after` 保留 |
| `views/SkillsView.tsx` | 自定义 `.skills-empty` 文案 | `Empty`（`PRESENTED_IMAGE_SIMPLE`） |

`check:ui` 同时禁止原生 `input[type=color]` 与手写 `role="tablist"`。

### 明确保留自绘

画布节点工具条、节点右键菜单、`CanvasContextMenu`、`GenerationNodeComposer` 的模型/预设/mention 菜单、`CanvasDisplaySettings`、`MediaViewer`、3D 导演台、OpenReel 时间轴、Toast 栈、图片裁剪/标注/水印的画布定位外壳。理由与第 9 节一致：它们绑定画布坐标、缩放或像素级手势，换成通用弹层反而要额外写适配。

### 门禁

`scripts/verify-ui-components.mjs` 已同步收紧：未登记的 `backdrop` 类名、未登记的 `role="menu"` / `role="tablist"`、原生 `<select>` / `input[type=checkbox|number|range|file|search|password|color]`、以及任何 `window.confirm` 都会让 `npm run check` 变红。
