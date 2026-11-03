---
name: video-production
description: 统筹短片、MV、预告和品牌影像制作，组织真实画布节点与输入依赖，并按任务范围推进生成和核验。
metadata: {"category":"video","version":17}
---

# 全流程影像制作

这是视频制作的编排 Skill，不承载所有写作、视觉设计、音频设计和模型参数细节。先识别输入成熟度与用户要交付的层级，再组织制作；本 Skill 负责选择顺序、建立依赖、写入画布和核验结果。若本轮已经加载本 Skill，就由它继续完成用户目标；新建具名人物身份资产时，调用 `skill` 加载 `character-board`；为场景、道具或分镜静帧写图片提示词时，调用 `skill` 加载 `visual-prompt-craft`；为视频镜头写提示词，或创建、配置、更新任何视频生成节点时，必须调用 `skill` 加载 `short-drama-video-prompt`，不能因为用户没有明确说“提示词”而跳过。辅助 Skill 只负责对应内容标准，执行仍回到本流程。

## 编排流程

1. 判断当前输入是主题、小说/长篇、梗概、剧本、分镜、参考素材还是已有成片，并确认用户要分析、规划、生成还是完整执行。
2. 只补下一项必要工作：不把小说直接当分镜，不重做已有剧本或镜头表，也不因为流程完整而创建无用文档。
3. 在内部归并跨镜视觉实体和别名，标记身份、空间、动作、构图、声音和模型能力风险；这只是路由依据，不额外创建分析节点。
4. 对每个确定的交付物直接编写具体内容；下列 Recipe 只是可选提示词参考，按需用 `list_recipes`、`load_recipe` 读取。不要把 Recipe 名称传给 `skill` 工具，也不要因为某个 Recipe 不存在而停止制作。
5. `plan_canvas` 必须把已经确定的媒体交付物落成真实节点、输入边和完整配置；文字说明不能代替节点。
6. `plan_and_execute` 按依赖阶段启动节点，等待真实输出成功后再继续下游；视频输入的内部适配由运行时完成，不创建预处理节点。
7. 完成前检查真实节点、任务、文件和回执，报告缺失输入、降级交付或未执行内容。

## 加载前的入口选择

以下入口帮助画布 Agent 在加载 Skill 前依据完整请求选择。若用户已显式调用 `/video-production`，本轮仍由本 Skill 完成相应交付，不改选其他 Skill。

- 用户给出剧本，要求人物/场景参考、站位、分镜图或细化镜头提示词，并希望本轮直接落地画布：`script-storyboard`。写入制作计划只是中间动作，应继续落实节点、真实输入边和要求生成的图片。
- 用户给出完整剧本，要求从成片规格、元素资产、镜头提示词推进到视频和声音交接：`script-to-video`。按用户已授权范围连续制作；每个进入视频制作的 `shot_id` 先加载 `short-drama-video-prompt`，再根据动作连续性和构图风险决定是否建立时间板或镜头板，不强制建立两张板或 3×3 宫格；仅在用户明确要求逐阶段审阅时设置暂停点。
- 用户只要角色板或三视图：`character-board`；只要关键帧动画编排：`keyframe-video`；指定具体视频模型时，由 `short-drama-video-prompt` 读取对应模型路由参考。

## 可选 Recipe 参考

- 原作、梗概和剧本：`narrative-source-analysis`、`screenplay-adaptation`
- 创意和镜头设计：`video-creative-outline`、`video-storyboard-script`、`video-shot-storyboard`、`video-action-sequence-board`、`video-storyboard-grid`
- 角色、场景和道具：`video-character-design`、`video-character-turnaround`、`script-element-reference`
- 关键帧与连续视频：`video-frame-extraction`、`video-clip-generation`
- 配音、音乐和拟音：`video-audio-design`、`video-audio-production-sheet`

Recipe 未覆盖时，直接编写满足当前模型能力和交付规格的提示词，不因缺少模板而阻塞计划。

## 画布与执行边界

- 每个已经确定的连续镜头对应真实视频节点；身份、空间、动作和关键帧只有在当前镜头确实需要时才建立上游节点。
- 输入边的媒体类型、业务槽位和节点 `inputMode` 必须使用统一契约；不要用连线顺序、素材数量或 UI 文案猜测语义。
- `canvas_layout_nodes` 只整理真实节点和拓扑，不推断故事顺序；不得创建代码中不存在的时间线、合成器或汇总节点。
- 只有生产范围为 `plan_and_execute` 且用户设置允许时，才调用 `canvas_start_generation`。
- 任务失败时根据真实回执修复具体问题；不能靠重复调用或堆叠无关参考掩盖失败。

## 交付核验

完成前确认：依赖无环、节点配置完整、prompt 非空、输入职责可解释、生成任务和输出文件真实存在，且没有把独立生成描述成提取结果。内容质量、流程完整性和事实核验都由本轮已加载的 Skill 负责。
