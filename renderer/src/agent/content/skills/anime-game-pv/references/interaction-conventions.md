# 互动约定与授权门

在询问缺失的决定之前，从用户的话语、真实附件和画布素材中构建`intake_state`。至少记录`production_route / identity_source / has_valid_image_asset / style_candidates / style_source / style_authority / style_authority_kind / visual_policy / default_editorial_active / dominant_theme_color / accent_color / accent_policy / character_palette_policy / palette_authority / saturation_policy / reference_processing / requires_visual_authority_asset / visual_artifact_type / visual_authority_revision / visual_authority_status / narrative_focus / duration / aspect_ratio / audio_plan / audio_drive / storyboard_revision / preview_revision / storyboard_status / prompt_status`。用户提供的身份、规格和音频信息或材料直接证明必须被继承，永远不要再次询问；风格方向是强制性的确认，并且可能永远不会仅仅从文本或附件中被静默锁定。

`visual_authority_status` 仅允许 `not_applicable | pending | approved`;`storyboard_status` 和 `prompt_status` 仅允许 `empty | pending | approved`。新生成的视觉授权图像或分镜包在首次创建或内容更改时为 `pending`。从批准的分镜包中编译提示后，将其设置为 `prompt_status=pending`;经过飞行前通过后，将其设置为 `approved` 并直接发送。后续产物永远不能追溯性地替代先前状态的批准。

执行顺序固定：无声摄入→使用素材、完成媒体分析和候选参考胶囊→风格权限门确认`style_source`→解析颜色约定→内部默认视觉路径按顺序确认主题颜色、可选重音和适用的参考处理→从视觉决策矩阵派生`style_authority_kind / requires_visual_authority_asset / visual_artifact_type`→确认剩余规格→按路径生成并确认必要的视觉权限图像→锁定单个`style_authority`和渲染约定→完成并确认分镜包→编译并预览提示词→直接生成。任何阶段都不能提前将候选源提升为最终风格权限，也不能跳过先前产物的批准。

下游无效已修复：

1. 对`style_source`或`visual_policy`进行变更：使调色板、参考处理、视觉权限、Render Contract 和 Storyboard 审批无效，并设置`prompt_status=pending`。
2. 调色板、重音或`reference_processing`的变化：使用生成的授权图像，会使当前`visual_authority_revision`失效；无论授权类型如何，都会使渲染约定和分镜审批失效，并设置`prompt_status=pending`。
3. 视觉权限素材、类型或实际绑定的变更：使 Render Contract 和 Storyboard Approval 无效，并设置`prompt_status=pending`。
4. 面板、逻辑镜头或主时间线的变更：形成新的`storyboard_revision`;九格变更形成新的`preview_revision`。这两种变更都会使分镜审批失效，并设置`prompt_status=pending`。
5. 仅对模型、法律参数、参考槽或提示性措辞进行更改，保持分镜语义完整：仅更新渲染约定或设置`prompt_status=pending`，不回滚视觉效果或分镜。

每个需要用户选择、确认或生成批准的步骤都必须使用真实的确认卡。纯文本只能解释结论、描述影响或请求上传所选材料；永远不要在普通回复中列出编号选项，永远不要将 “回复 1/2/3” 或 “除非你反对，否则我会继续” 替换为问题窗口，并且永远不要在没有相应确认的情况下继续生成。问题标题、选项、注释和建议措辞都遵循运行时注入的`working_language`;只能以该语言的自然措辞，在清晰的基础上标记建议。`default_editorial_active`、编辑、内部视觉系统名称和内部路径永远不能向用户显示。分镜确认是执行前的最终确认门；用户确认后，编译提示词，完成预检，然后直接发送。稍后对分镜、样式或参考处理的更改将返回到匹配的现有确认；其他明确的更改将更新并继续执行。当所需的确认卡被取消时，如果出现错误或没有有效结果，请在当前门处停止。

### 无声输入

在第一个问题之前，自动判断：交付意图；角色/场景/风格/布局/动作或参考视频；音频；固定 IP 和命名角色；持续时间；宽高比；平台；用户话语中的视觉方向；以及类似参考之间的冲突。只有真实存在的、可读的、与任务相关的图像附件或画布图像资源才能设置`has_valid_image_asset=true`;文本描述、视频、音频、失败的占位符或计划但未生成的图像永远不能替换。分析结果仅形成`subject | scene | style | layout | action | audio`候选贡献：默认为`subject`候选的角色图像、站立艺术和转折，以及`style`候选的独立风格图像和其他材料；在用户确认之前，任何材料都不会成为最终的`style_authority`。

固定 IP 仅直接影响身份判断，永远不会自动影响最终风格：

1. 对于固定 IP 但没有命名角色的情况，只需通过单选确认卡询问，允许免费输入哪个角色，或者是否要创作一个集成作品。
2. 对于命名角色、集合或原创角色，首先锁定`identity_source`，但仍需通过下方的风格权限门确认是否继承原作、附件或其他视觉方向。
3. 当用户明确允许对角色进行大量重新设计时，记录一个`reinterpret`候选；实际的视觉来源仍然需要在样式权限门中确认。

### 制作路线和风格源决策

如果制作方法不清楚，可以问:“这次你想怎么开始？”

| 单一选项 | 面向用户的说明 | 内部路径 |
| --- | --- | --- |
| 从现有材料中制作 | 直接从现有字符和参考资料中制作 PV | `direct_pv` |
| 首先建立关键视觉效果 | 完成角色和视觉设计，确认它，然后制作 PV | `visual_first` |
| 重新创建参考视频 | 重新创建一个参考视频，包括动作和节奏；超出本技能的范围 | 解释边界并停止此技能 |

问题窗口只显示选项和面向用户的说明，而不显示内部路径。如果选择了参考视频重现，请解释该技能生成原创动画 PV，并且不提供逐帧重现，然后停止该技能。当用户已经明确表示想要逐帧重现时，请解释边界并停止该技能，而不显示此问题；当参考视频仅用于节奏、摄像机、过渡或媒介时，请继续使用该技能。当所选路径缺乏必要材料时，请说明所需内容并等待上传；到达后自动分析，而不要再次询问方法。`production_route`一旦确认就永不更改；即使必须先生成一个视觉授权图像，也只需将其描述为当前路线的必要准备，永远不要重写用户的选择。

经过材料分析后，每个任务必须完全运行一个单一选择的样式授权门。即使用户已经描述了样式，也要将该描述作为推荐候选进行确认；绝不要因为固定的 IP、字符图像、完整插图、样式图像或明确的样式词而跳过。问题和选项是从实际材料中动态生成的：

| 可用性条件 | 单选项示例 | 内部结果 |
| --- | --- | --- |
| 字符素材存在 | 参考角色和原始风格 | 所选材料变成`style_source`、`visual_policy=faithful`。 |
| 角色素材存在 | 只保留角色身份，重建视觉表达 | 用户的后续视觉方向或内部系统变为`style_source`;原始材料仅锁定身份，`visual_policy=identity_locked_restyle`，首先生成并确认关键视觉效果。 |
| 用户描述了一个视觉方向 | 继续当前的视觉方向 | 用户的描述将成为确认的`style_source`;字符风格材料（如果有的话） 仅锁定身份。 |
| 存在独立的风格素材 | 让风格参考控制视觉效果 | 选择的独立风格材料将成为`style_source`。 |
| 没有可用的风格来源 | 让这个技能提出一个新的视觉方向 | 内部视觉系统变成了`style_source`;身份素材（如果有的话） 保持了角色的身份。 |
| 任何情况 | 使用或添加其他样式参考 | 等待用户指定或上传材料；在确认之前不要继续。 |
| 任何情况 | 根据现有设置重新设计 | 只有当用户明确允许更改角色设计`visual_policy=reinterpret`时才会显示。 |

每次只显示 2-4 个真正可执行的选项；永远不要填充缺乏物质支持的路径。对于多种候选样式，选项必须说明具体来源或允许自由输入；在确认之前只保留`style_candidates`，答案就会确定为一个`style_source`。只有当用户选择了这个技能提供的新方向，或者选择重建视觉表达而不提供其他文本/图像样式来源时，才会在内部设置`default_editorial_active=true`;这个内部名称和固定语法永远不会被外化为 “唯一的内置样式”。忠实的原始样式、用户书面指示和独立的样式引用都会使其失效。

门的答案决定了路径：原始作品或原始材料的视觉效果给出`faithful`;书面方向、独立风格材料或本技能提出的新方向，使用现有的识别材料给出`identity_locked_restyle`;没有识别材料，给出`original_direction`;改变设计的许可给出`reinterpret`。然后阅读`references/visual-inputs.md`中的单个视觉决策矩阵，推导出`style_authority_kind / requires_visual_authority_asset / visual_artifact_type`。直接重用现有的生产就绪材料使用`style_authority_kind=existing_asset / requires_visual_authority_asset=false / visual_artifact_type=not_applicable`;载体清理、风格转换、识别融合、角色重新设计或缺乏直接可用的图像使用`generated_asset / true / the matching concrete type`。

角色揭示、觉醒、战斗、世界观或抽奖目标首先从用户的话语中推断出来；只有在推广重点真正不明确时，才通过单选确认卡在 “角色魅力和情感/技能、行动和战斗/故事、人际关系和世界观” 中进行询问。一次调用最多包含三个相互独立的未解决问题，每个单选都带有`multiple: true`禁忌；内部默认路径的主题颜色、重音和参考处理取决于确认的风格，必须在风格权限门返回后依次询问。

### 色彩方向、参考处理和视频规格

样式权限门返回后，首先确定内部默认视觉路径是否处于活动状态。以下问题只显示实际颜色和处理结果——绝不显示编辑或任何内部样式名称：

- **主题颜色问题。**首先确认`dominant_theme_color`，提供 3 个高纯度、高饱和度的主题方向，具有明显不同的叙事氛围，允许自由输入。主题颜色控制环境场、MG 图形、核心道具/主题、文本/UI 强调和过渡载体；角色的原始图像颜色永远不会自动决定这个答案。
- **重音颜色问题。**在主题颜色之后，单独询问`accent_color`;它必须包含一个 “无重音” 选项，以及 2-3 个候选者，每个候选者承担一个语义义务，例如危险、超自然断裂、目标锁定、身份差异或冲击火花。选择重音也会锁定单个`accent_role`;允许自由输入，当用户给出一个无义务的颜色时，请跟进该义务。
- **内部色彩预算。**构建`palette_authority={ black, white, optional_neutral_gray, dominant_theme_color, accent_color|null }`。主题色彩保持在一个色调家族内，变化的亮度不会漂移到相邻的彩虹色；重点保持在每帧 5% 以下，整个胶片的平均值为 3%，可能不会成为背景、全身装扮、大型道具、城市照明系统或持续的边缘光，并且应该消失很长时间，然后在其单一语义节点重新出现。
- **其他风格路径。**忠实的、用户书面指导或独立的风格参考可以根据已确认的源代码调色板构建`palette_authority`;只有在源代码冲突、用户请求的重新着色或不确定的调色板时才能进一步询问——永远不要强加非黑即白的单主题预算。

在包含角色图像的内部默认路径上，在调色板确认后，通过单选确认卡询问参考处理：

- **保持角色的原始调色板**:身份和原始色彩保持稳定，主题色彩仅控制环境和 MG;必要时，生成载体清理的动画截图参考，无需将原始背景、布局或构图传递给视频。
- **不饱和平面色彩保留**:保持角色的色彩逻辑，但降低饱和度并将其平面化为固体块，然后生成动画截图参考。
- **完全黑白主题转换**:将角色转换为黑色、白色、可选的中性灰色和确认的主题颜色；仅将用户指定的本地颜色限制在指定区域内。

记录`reference_processing=preserve_original_palette | flattened_palette | strict_single_hue`和匹配的`character_palette_policy`。当用户已经指定了处理后，继承它；不要悄悄地重新着色。在调色板和处理后，只询问仍然不清楚的视频规格：

- **持续时间:`15 s (recommended) / 10 s / 6 s / other`。继承给定的持续时间；默认为推荐的 15 秒。
- **长宽比**:从平台或用户的话语中推断；当无法推断时，询问`9:16 vertical / 16:9 horizontal / 1:1 square`，通过发布场景对推荐进行排序。
- **Sound**:对于上传的未说明用途的音频，询问 “这个音频应该如何参与？”，提供`reference for music rhythm / reference for lines or vocals / analyze rhythm and mood only / do not use this audio`。前两个将真实音频传递给选定的视频模型；第三个仅对模型原生声音使用分析；第四个返回到无用户音频路径；显式的节拍同步、口型同步或情绪目的将被继承。没有音频，也没有用户偏好，询问`model-native sound (recommended) / silent video / reserve space for post BGM`;预留空间意味着不会生成背景音乐，同时氛围和动作声音保持节奏。

主题颜色、重音和参考处理问题必须按照依赖顺序调用，绝不能相互融合或与视频规格合并；跳过没有角色图像的处理问题。一个规格确认卡最多只能容纳三个独立的问题；在询问持续时间、宽高比和声音之前，要锁定调色板和处理——绝不要将这些决定合并到组合选项中。

对于超过 15 秒的持续时间，在任何风格或制作步骤之前解决持续时间限制：解释这个技能只能提供一部长达 15 秒的影片，然后发放一张真实的单选确认卡，提供 “压缩到 15 秒内（推荐）” 和 “保持原始持续时间并结束这个技能”。聊天中的选择列表不是确认卡。等待其有效答案；取消、失败或没有答案会使此确认点保持未解决状态，并且不允许生成。只有在用户选择压缩时才能继续确认的持续时间；选择原始持续时间就结束这个技能，而不需要选择其他制作路线。不要分割成多个视频来拼接这个技能。当用户想要屏幕上没有准确措辞的文本时，请单独要求准确的文本——永远不要再问一个已经清楚的 “需要文本？”。

### 视觉确认和生成授权

1. 使用`style_authority_kind=generated_asset`，在视觉权威图像生成并检查后，设置`visual_authority_status=pending`并通过实际确认卡提供：继续当前视觉参考，调整样式表达，调整调色板，调整参考处理，调整角色一致性。在确认记录中确认`visual_authority_revision`并设置获得批准;existing_asset路径设置`visual_authority_status=not_applicable / visual_authority_revision=not_applicable`。
2. 完成所有面板、逻辑镜头、主时间轴和`storyboard_review.md`后，设置`storyboard_status=pending`并显示分镜确认卡：确认分镜并生成；查看九格预览；调整叙事和节奏；调整角色和动作；调整视觉效果和声音。在 “预览” 中，从当前语义分镜中派生出九格，并返回同一个门；最终确认绑定语义分镜、当前锁定的渲染合约和`preview_revision`（如果存在）。
3. 当`storyboard_status=approved`及其收据绑定当前分镜包和 Render Contract 时，编译完整的 Markdown 提示词。编译将确认的内容转换为可执行的提示词，而无需添加创意决策。在提示词和 Render Contract 通过预发布后，设置`prompt_status=approved`并直接发送。

每次只修改用户选择的范围，根据统一的无效规则重新呈现受影响的内容。选择样式、颜色或参考绑定调整返回到匹配决策阶段，根据需要重新生成视觉授权图像，然后更新渲染约定和分镜包。对面板、逻辑镜头、主时间线、分镜文本或生成的九格的更改构成了新的分镜包修订，并再次显示分镜确认卡；其他执行信息更改遵循用户的新请求，并在新的预检后继续调度。
