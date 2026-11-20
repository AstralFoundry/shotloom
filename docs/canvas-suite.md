# 分镜脚本、批量创作表与姿势库

这三个功能都接在同一张无限画布上：分镜脚本把剧情拆成可编辑的镜头行，批量创作表把多行提示词排成可并发的生成队列，姿势库提供可直接插入画布的动作参考图。节点数据随项目保存，生成结果仍按普通图片、视频节点归档。

## 分镜脚本

- **入口**：画布空白处双击或右键 →「分镜脚本」。
- **数据**：节点本质是文本生成节点（`textGeneration`），`canvasView: storyboard-script`，镜头行保存在 `storyboardShots`。模型输出只解析成镜头行，不自动提交图片或视频生成。
- **节点内生成**：节点底部的输入框直接接收剧本/剧情，旁边的文本模型、拆分数量（自动或 1–10 镜）和单镜时长（自动或 5/10/15/30 秒）会一起编译进请求。请求会把固定 JSON 合同和用户原文发给文本模型；完成后 `storyboardShots` 被替换，原始回执保存在 `storyboardRawText`，解析失败时保留原行并写入 `storyboardParseError`。
- **流程页签**：`分镜` 编辑镜头行；`分镜图（可选）` 与 `视频` 展示逐镜产出并按需生成未完成项；`合并成片` 汇总已完成视频并给出剪辑入口。
- **手动编辑**：节点内直接编辑时长、视频提示词和台词；全屏编辑器补充画面、景别、机位、运动、音效、图片提示词、角色、负面提示词和参考资产。新增、插入、上下移动、删除都会写入画布历史。
- **逐镜生成**：每行可以单独生成分镜图或视频，也可以生成全部未完成项。应用为每行创建或复用 `imageGeneration` / `videoGeneration` 节点，把行内提示词写入节点，并把分镜节点的上游参考图片连到每个产出节点；生成按镜头顺序串行执行，避免重复扣费。
- **边界**：AI 拆镜和其他生成一样需要已连接可用的文本模型；没有可用模型时发送按钮禁用。生成分镜图/视频前会检查对应类型是否已有可用模型，失败原因保留在对应节点和行状态上。

## 批量创作表

- **入口**：画布菜单「批量创作表」。
- **数据**：节点类型 `batchTable`，字段 `batchTable` 保存 `mode`、`concurrency`、`globalPrompt`、参考列和任务行。每行有 `enabled`、`prompt`、`referenceNodeIds`、`outputNodeId`。
- **参考图**：每行按列保存行级参考；列的空位由连到批量创作表的图片节点按连线顺序补齐。行级选择优先于表格连线。只有带真实图片文件的图片节点可以入表。
- **运行**：全局提示词会加在每行提示词前。启用且仍可运行的行按并发数（1/3/5）进入队列，实际生成节点按行创建或复用；每行完成后写入 `runState` 进度、失败数与取消状态。停止只阻止后续行开始，已经提交的远端任务按真实状态结束。
- **模式**：图片模式创建 `imageGeneration`，视频模式创建 `videoGeneration`；切换模式不会删除旧产出节点。「开始批量」跳过已经完成的产出，只处理待生成或失败的行；单行「运行」会强制重跑该行。

## 姿势库

- **入口**：画布底部工具条的「姿势库」按钮，或画布空白处双击/右键菜单。左侧按体系和分类筛选，顶部按视角筛选，卡片内小图切换视角；选择卡片（可切换视角、多选最多 16 张）后「插入画布」。
- **目录来源**：默认读取 [ai-pose-gallery-zh](https://github.com/anhao/ai-pose-gallery-zh) 的 `data/pose-zh.json` 元数据，图片按需从同一仓库的 `thumbs/`、`img/` 加载；目录元数据本地缓存 7 天。也可以侧栏「导入姿势包」使用 `yingce-pose-library` 格式，把 `source.baseUrl` 指向自己的姿势图服务器。
- **插入**：桌面版会把原始姿势图下载到当前项目 `assets/`，创建普通图片节点并写入 `poseReference` 元数据；姿势库目录后续删除或停用不影响已插入的图片。图片计入项目素材和用户上传额度。浏览器预览没有项目文件系统，会提示改用桌面应用。
- **版权**：仓库与发行包不携带图片。默认数据源中的图片版权归原作者，`ai-pose-gallery-zh` 的 MIT 许可不覆盖图片；商业使用前请自行确认来源授权，或导入自建姿势包。
- **网络**：远程图片和目录受 CSP 限制，默认只允许 `raw.githubusercontent.com`；若自定义姿势包使用其他图片域名，需要在 `renderer/index.html` 的 `img-src` 中显式加入该域名。

## 相关实现

| 边界 | 入口 |
| --- | --- |
| 分镜数据与解析 | `renderer/src/domain/graph/StoryboardScript.ts` |
| 分镜节点与编辑器 | `renderer/src/app/canvas/StoryboardScriptNode.tsx`、`StoryboardScriptEditor.tsx` |
| 分镜生成编排 | `renderer/src/app/canvas/storyboardScriptActions.ts` |
| 批量表数据 | `renderer/src/domain/graph/BatchTable.ts` |
| 批量表节点与运行 | `renderer/src/app/canvas/BatchTableNode.tsx`、`batchTableActions.ts` |
| 姿势目录 | `renderer/src/domain/pose/PoseLibrary.ts`、`renderer/src/services/poseLibraryService.ts` |
| 姿势弹窗与插入 | `renderer/src/app/canvas/PoseLibraryModal.tsx`、`poseLibraryActions.ts` |

## 验证

- 领域测试：`tests/storyboard-script.test.mjs`、`tests/batch-table.test.mjs`、`tests/pose-library.test.mjs`、`tests/canvas-suite-nodes.test.mjs`。
- 静态门禁：`npm run check`（含 i18n、分层、样式、UI 控件、存储与测试架构）。
- 浏览器验收：创建分镜脚本，手动添加与 AI 拆镜；创建批量表，设置参考与并发并运行；打开姿势库筛选、切换视角、多选后插入（插入需桌面版）。
