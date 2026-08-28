---
name: MiniMax H3 多段式提示词
description: 为 MiniMax H3 编写或重写结构化音画提示词，适合纯文本、首帧、首尾帧、尾帧及图片、视频、音频混合参考的视频生成任务。
---

# MiniMax H3 多段式提示词

把用户的完整创作意图整理成 H3 可执行的多段式音画描述。先调用 `inspect_model_catalog` 核对目标模型、时长、`inputMode`、`inputSlots` 和媒体数量；只使用目录真实公开的能力。用户已经指定 H3 模型或目标节点时保持该选择，除非真实能力冲突并需要用户决定。

先加载 `video-clip-generation` Recipe 获取镜头生成策略，再结合本 Skill 的 H3 字段契约组织最终 Prompt。

## 选择输出结构

根据真实输入职责选择结构，不能根据文件数量、连接顺序或 UI 文案猜测：

- 纯文本 T2VA：直接输出三个字段。
- 首帧 I2VA、首尾帧 FL2VA、尾帧 L2VA：仅当模型目录公开对应模式时，在首行写精确的图片对齐指令，空一行后输出三个字段。
- 图片、视频或音频承担角色、场景、动作、镜头、风格、剪辑、续写或声音参考时：输出六字段全参考结构。Shotloom 当前模型只公开 `reference` 时，也使用这个结构，不得伪装成首帧或首尾帧模式。

基础关键帧模式的首行必须使用对应格式，其中 `N` 是实际最后镜头，`S.SS` 是保留两位小数的有效总时长：

```text
I2VA: For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
FL2VA: How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.
L2VA: How the reference pictures align with the target video — <Picture 1> (from [Shot N]) aligns with the S.SS-second mark of the target video.
```

基础结构固定为：

```text
integrated_multimodal_description: ...

overall_soundscape: ...

non_diegetic_music: ...
```

全参考结构固定为：

```text
subject_definitions:
...

summary:
...

retention_analysis:
...

detailed_description:
...

overall_soundscape:
...

non_diegetic_music:
...
```

字段名、顺序和引用标签必须保持不变。最终写入生成节点的 Prompt 不包 Markdown 代码围栏，也不混入解释、标题或制作建议。

## 基础模式

`integrated_multimodal_description` 按播放顺序写完整画面与声音。`[Shot 1]` 不写时间；后续镜头使用严格递增且位于总时长内的 `[Shot N] At MM:SS.mmm, ...`。每个镜头交代当前构图、主体外观与位置、环境和光线、动作与状态变化、摄影机运动、同步声音及结束状态。切镜必须带来新的主体、空间、状态、视点或时间信息；只有景别或轻微角度变化时优先写连续运镜。

I2VA 从首帧的身份、服装、构图和空间关系连续向前发展。FL2VA 写出从首帧到尾帧可观察的姿态、物体、构图与光线变化路径，默认保持连续镜头，除非用户明确要求切镜。L2VA 从合理的前置状态逐步收敛到尾帧，不能把尾帧误写成开场。

摄影机运动用自然英文表达运动类型，并在有意义时补充幅度与速度，例如缓慢小幅推近、快速大幅横移；不要在句尾堆叠孤立标签。

## 全参考模式

### subject_definitions

为后续真正使用的内容分配稳定标签：

- `<Subject N>`：从参考素材抽取并在目标视频中复用或改变的人、动物、物体、环境、服装、动作、姿态、风格或特效。
- `<Picture N>`：图片本身作为首帧、关键帧、尾帧、编辑帧或分镜构图锚点。只用于定义主体的图片写入对应 Subject 来源，不重复定义 Picture。
- `<Video N>`：整段视频承担剪辑源、续写起点或完整时序、运镜、切镜结构参考。
- `<Audio N>`：音频信号被复制或用于音色、对白、歌词、节奏、音乐、音效参考。视频文件有声音不等于自动创建 Audio 标签。

每项独占一行，说明来源、职责和必须跟随的特征。标签一旦分配，在所有字段中保持同一含义；不同标签类别独立编号。

### summary

用一个简短英文段落概括目标视频和主要参考关系，以实际职责组成前缀：`[keyframe completion]`、`[reference generation]`、`[video editing]`、`[video continuation]`、`[audio reuse]`、`[audio reference]`。多种职责用 ` + ` 合并，不因文件类型自动增加任务类型，也不引入新标签。

### retention_analysis

每个引用标签独占一行，说明出现位置和保留关系。可见内容只使用 `fully_preserved`、`partially_preserved`、`attribute_transfer`、`weak_reference`；音频只使用 `fully_copy`、`partially_copy`、`reference`、`weak_reference`。关系必须符合 `subject_definitions` 中声明的职责，新增剧情或动作本身不算参考损失。

### detailed_description

先用一至两句英文确定整体媒介、视觉风格、光线和色彩，再按镜头时间线展开。重要 Subject 第一次清晰出现时写明参考特征、画面位置与动作；Picture 用于具体帧锚定；Video 和 Audio 在其结构或声音职责实际生效的位置出现。内容应是可观察、可听见且可执行的镜头描述，不能退化成剧情摘要或引用关系清单。

生成类任务通常写 350–500 个英文词；对白密集时优先容纳完整时间线，不为凑字数稀释镜头信息。编辑类任务按源视频复杂度展开。

## 台词、文字与声音

- 所有字段使用英文；仅 `<d>` 中的台词、歌词和画面内可见文字保留用户原语言与原标点，不翻译、不润色、不补写。
- 发声者按目标视频首次发声顺序分配稳定 `(S1)`、`(S2)`。引用主体发声写 `<Subject N> (Sx)`；未发声角色不分配 Speaker ID。
- 台词格式为 `<d>[Language] 原文</d>`。画外音明确写 `says in an off-screen voiceover`，并说明对应画面人物嘴唇保持闭合。跨镜台词使用 `<scenetrans>` 并声明声音连续；结尾被截断时使用 `<cutoff>`。
- 画面中真实出现的招牌、标签、字幕等放在英文双引号中并保留原文。
- `overall_soundscape` 用一至四句概括环境声、物理动作声和非语言人声，不重复台词、演唱或画内音乐；只有用户明确要求全片静默时写 `N/A`。
- `non_diegetic_music` 用一至三句写观众可听、角色不可听的配乐，说明乐器、速度、节奏和动态变化，不用抽象情绪词解释功能；无画外配乐时写 `N/A`。

## 写入 Shotloom

使用 `video-clip-generation` 读取镜头生成策略。创建节点用 `canvas_create_node`，修订现有 Prompt 用 `canvas_update_node`；只提交实际变化字段。参考边通过 `canvas_connect_nodes` 写入模型目录要求的媒体 `role` 与业务 `slot`，节点顶层写真实 `inputMode`。首帧、尾帧、普通参考图、输入视频和参考音频必须分别使用目录公开的槽位，不能靠数组位置表达语义。

如果用户只要求提示词，就只返回或写入提示词，不擅自启动生成。用户明确要求生成时，等待所有上游媒体到达成功终态并核验真实输出，再调用 `canvas_start_generation`；已经成功的创建、更新或连接操作不得整批重放。

完成前评估：结构与模式一致；字段齐全且顺序正确；引用标签稳定；镜头时间不越界；每个镜头都有构图、主体、动作、摄影机、声音和参考生效点；台词原文未改；输入模式、角色和槽位来自当前模型目录；Prompt 中没有说明性废话或未解析引用。
