# 文本和铅笔分镜指南（v1.1——音频模式感知）

## 第 6 步：文本分镜文档（默认）+ 铅笔图像分镜（主动选择）

在步骤 5.5 的自检通过后，在生成任何分镜构件之前显示一张分镜模式选择卡：

- **文本分镜仅文档（默认，推荐）**——一个画布文本节点，包含所有镜头分镜作为文档内部分。反映半叙述式戏剧分镜结构：每个镜头的字段（标题/钩子/场景/人物/空间锚点/连续性/性能） 加上Pixar的每个面板四字段内容 + 每个面板的强制`Mouth State`+ 可选的 ASCII 布局。以近乎零的成本承载全部质量控制负载。步骤 7 中选择的视频模型直接将其读取为每个镜头的渲染参考。
- **文本分镜文档 + 多面铅笔图像（可视化模式，主动选择）**——文本分镜文档仍然作为权威作品生成，并且每个镜头生成一个多面铅笔图像供人工审核。成本较高，当用户在决定制作视频之前需要视觉预览，或者当俯卧撑/姿势轮廓是主要风险，并且用户想要在视觉上进行预检查时，这种方法非常有用。

在项目简介中保存所选的分镜模式，并在步骤 7、步骤 9 和再生学科中重复使用。

### 默认路径：单文本分镜脚本文档

生成一个名为`<title> text storyboards`的画布文本节点（整个短片的一个文档）。这个文档是第 7 步的权威渲染参考，即使还生成了铅笔图像。该结构反映了半叙事剧情分镜脚本——每个镜头都是同一文档中的一个部分，因此用户可以在不跳过节点的情况下阅读交叉镜头的连续性。

文档顶部内容（文档顶部的标题块）:

- 项目标题、批准的视频模型、批准的分辨率、分镜模式、**批准的音频模式 (v1.1)**和自检状态（例如`shot-table self-check: passed at <timestamp>`）。
- 一个简短的内容表，列出每个镜头、它的钩子、它的音频模式 (v1.1)**和它的节锚 (`S01`、`S02`、...)，以便用户可以跳转。

每个镜头的部分结构（每个镜头一个`##`标题，按照镜头顺序）。每个部分都必须包含这些字段，顺序如下——直接改编半叙事剧情节，并添加 v1.1 音频模式：

1. **镜头标题和持续时间**——镜头的简短人类可读标题，加上`S<N> / <duration>s`（例如`S03 / 6s`）。
2. **钩子类型**——受控受控词表之一:`setup` / `visual-joke` / `reversal` / `reveal` / `callback` / `suspense` / `tender` / `chase` / `expression-beat` / `climax`。由每集钩子分布自检使用。
3. **音频模式 (v1.1)**——`narration` / `dialogue` / `mixed` / `silent`。从镜头表中复制。这是该行的音频约定。
4. 场景和角色——准确的场景卡名称和准确的屏幕角色名称（绑定到角色卡）。v1.1:如果`Audio Mode`是`dialogue`或`mixed`，也要在这里标记`SPEAKER: <character name>`。
5. 空间锚卡（必填，四个子字段——直接改编自半叙事）:
   - `Fixed landmarks`——命名地标及其与银幕的相对位置（例如`door-frame: right third`、`kitchen-island: center bottom`）。
   - `Character positions (camera view)`——对于每个屏幕角色、屏幕相对位置、面向方向和初始姿势。**v1.1:如果`Audio Mode`是`dialogue`或`mixed`，说话者的行必须以`SPEAKER `开头，并且每个其他屏幕角色后面必须追加`non-speaker mouth: closed`。**
   - `Exited character status`——在上一个镜头中出现在屏幕上但在这个镜头中没有出现的角色，以及他们在屏幕外的位置和原因。
   - `Lighting baseline`——从场景卡继承的键/填充/边框方向，外加每个镜头的修饰符。
6. **连续性**（镜像半叙事的切换字段）:
   - `Continuity from S(N-1)`——一两句引用前一个镜头结束状态的句子。
   - `Continuity to S(N+1)`——一句话设置下一个镜头的开场。
7. **双重绑定**——`[char:角色名-01] [char:角色名-02] ... [scene:场景名] [hook: visual-joke] [audio_mode: dialogue] [speaker: 角色名-01]`——准确的角色卡名称、场景卡名称、钩子类型、音频模式，以及（对于对话行） 命名的说话人。这些是仅限分镜的参考标记；视频模型在渲染时会将它们去除。**v1.1:`[audio_mode: …]`和`[speaker: …]`标签是新的。**
8. **每个面板四字段内容**（每个面板一块，按时间顺序；这是Pixar每秒指令，从表行逐字保留，并添加了 v1.1 口型状态）:
   - `Timecode` — e.g. `0–1s`.
   - `Pose + Expression`——具体的身体姿势、轮廓、关键道具握持、眼线、面部表情路径；对于弹性节拍，需要明确提示压缩/拉伸/预期/超调。这是每个面板中最大的部分，视频模型将其解读为视觉节拍。*v1.1:对于`narration`秒，表情路径是强制性的（反映了半叙述式戏剧模式）——逐拍描述眉毛、眼睛、下巴张力、注视方向，以便屏幕上的面孔即使嘴巴闭合也能显示可见的情绪。*
   - `Camera`——拍摄尺寸，摄像机运动（推/拉/平/倾斜/握手/锁定/轨道），适用时使用荷兰语角度注释。
   - `Audio + Anchor`——音频提示 (`♪ narration: ...`/`dialogue: ...`/`SFX: ...`/`silent`) 和空间锚音符 (`door-frame: right third`/`Mia: center midground facing camera`)。**v1.1:音频提示必须包含说话者名称，如果是`dialogue`秒（例如`♪ dialogue [Mia]: "I'll be right back."`）;对于`narration`秒，使用`♪ narration (off-screen): "..."`。**
   - **v1.1:`Mouth State`（强制，第五字段）**——此秒内每个屏幕角色的明确口型。示例：
     - `Mouth: Mia OPEN (speaking) / Grandma CLOSED (listening)`——用于对话秒
     - `Mouth: Mia CLOSED / Grandma CLOSED — narrator voiceover, on-screen faces carry the emotion`——用于叙述秒
     - `Mouth: Mia CLOSED / Grandma CLOSED — silent beat`——对于无声秒
   - 表演注释（镜像半解说）:对于解说秒，标记`narrator-mouth-closed: true` AND `expression-path: <list of expression beats this second>`;对于屏幕对话，标记`mouth-open: <speaker name>`并描述表情路径/眼线/肢体动作变化；对于无声秒，标记`silent-mouth: both closed`并描述周围环境中的肢体动作。
9. **布局规则**（每个镜头适用）:
   - 3 秒镜头→3 个面板（每秒 1 个）。
   - 4 秒镜头→4 个面板。
   - 5 秒拍摄→5 个面板。
   - 6 秒拍摄→6 个面板。
   - 7+ 秒拍摄→每秒一个面板；对于亚秒级关键节拍，仅当节拍是拍摄的关键时刻时，才需要添加一个额外的迷你面板，如`2.0–2.5s`。
   - 面板必须覆盖从第一帧到最后一帧的整个镜头持续时间，不得有时间间隔。
10. **每个面板绑定**:
    - 绑定表格行中列出的确切角色卡，以锁定外观、面容、发型、头身、服装、签名道具和角色识别。使用与表格相同的角色名称。*v1.1:说话者的角色卡必须是任何`dialogue`或`mixed`面板绑定行中列出的 FIRST 角色卡——这是说话者绑定防御。*
    - 绑定行中列出的确切场景卡，以保留环境、道具、地标、运动路径和空间逻辑。
11. **可选 ASCII 布局块（强烈推荐，免费）**:
    - 在每个面板上添加一个小的 ASCII 草图（或者整个镜头的一个组合草图），这样用户就可以在几秒钟内扫描空间布局，而不需要渲染图像。示例：
      ```
      [0-1s]  Grandma (R, fg)         door-frame (R, bg)
              ──lifts basket──        Mia (L, mid)
              cam: locked | audio: SFX | mouth: Grandma CLOSED / Mia CLOSED
      [1-2s]  ...
      ```
    - **v1.1:ASCII 布局块现在还包括每秒每个屏幕角色的口型状态。**这使得口型同步意图一目了然。
    - ASCII 块只是信息性的；视频模型读取上述结构化的`Per-panel four-quadrant content`，而不是 ASCII。
12. **仅分镜标记**:
    - 当节拍至关重要时，在面板时间码后追加`[BEAT]`。
    - 当一个面板必须将特定状态传递给下一个面板或下一个镜头时，请在`[HANDOFF → ...]`后面添加一个短标签，例如`[HANDOFF → S04 opening]`。
    - **v1.1:当面板包含说话人绑定切换时，添加`[SPEAKER_HANDOFF → <character name>]`，以便模型知道说话人正在变化。**

每个镜头的部分模板（复制粘贴骨架，适用于任何镜头，v1.1 注释中的补充）:

```markdown
## S03 / 6s — Title: 奶奶把苹果筐递给 Mia
- **Hook type**: reveal
- **Audio mode (v1.1)**: dialogue                       # copied from table
- **Scene & characters**: scene:kitchen | char:Mia (SPEAKER), char:Grandma
- **Spatial anchor card**:
  - Fixed landmarks: door-frame (right third), kitchen-island (center bottom)
  - Character positions: SPEAKER Mia (L, midground, facing camera) | Grandma (R, foreground, facing Mia, non-speaker mouth: closed)
  - Exited character status: —
  - Lighting baseline: warm overhead key + cool bounce right
- **Continuity from S02**: 奶奶弯下腰从中岛拿起苹果筐
- **Continuity to S04**: Mia 接住筐转身，门铃响起
- **Double-binding**: [char:Mia] [char:Grandma] [scene:kitchen] [hook:reveal] [audio_mode:dialogue] [speaker:Mia]

### Per-panel four-quadrant content

#### 0–1s
- Pose + Expression: 奶奶弯腰双手持筐；SPEAKER Mia 左侧站姿，眼神好奇
- Camera: locked medium shot, eye-level
- Audio + Anchor: silent | Mia: L midground | basket: center bottom
- Mouth State (v1.1): Mia CLOSED / Grandma CLOSED
- Performance: [BEAT]

#### 1–2s
- Pose + Expression: 奶奶手臂伸向 Mia，筐倾斜；SPEAKER Mia 双手前伸准备接
- Camera: locked medium shot, eye-level
- Audio + Anchor: ♪ SFX: basket rustle | anchor: door-frame: right third
- Mouth State (v1.1): Mia CLOSED / Grandma CLOSED
- Performance: [HANDOFF → S04 opening]

#### 2–3s
- Pose + Expression: SPEAKER Mia 抬头看向 Grandma，嘴张开说话
- Camera: locked medium close-up on Mia
- Audio + Anchor: ♪ dialogue [Mia]: "那我们开始吧。" | anchor: Mia: L midground
- Mouth State (v1.1): Mia OPEN (speaking) / Grandma CLOSED (listening)
- Performance: [SPEAKER_HANDOFF → Mia]

#### 3–4s
- Pose + Expression: Grandma 微微点头，嘴唇轻抿
- Camera: locked medium shot
- Audio + Anchor: ♪ dialogue [Grandma]: "好。" | anchor: Grandma: R foreground
- Mouth State (v1.1): Mia CLOSED / Grandma OPEN (speaking)
- Performance: [SPEAKER_HANDOFF → Grandma]

#### 4–5s
- Pose + Expression: Grandma 手臂继续递筐；Mia 双手接过
- Camera: locked medium shot
- Audio + Anchor: ♪ SFX: basket exchange | anchor: door-frame: right third
- Mouth State (v1.1): Mia CLOSED / Grandma CLOSED
- Performance: [HANDOFF → S05 opening]

#### 5–6s
- Pose + Expression: 沉默留白 — Mia 收筐转身，Grandma 视线跟随
- Camera: slow push-in on Mia
- Audio + Anchor: silent | anchor: door-frame: right third
- Mouth State (v1.1): Mia CLOSED / Grandma CLOSED
- Performance: [BEAT]

### ASCII layout (optional)
[0-1s]  Grandma (R, fg)         door-frame (R, bg)
        ──lifts basket──        Mia (L, mid)
        cam: locked | audio: silent | mouth: Grandma CLOSED / Mia CLOSED
[1-2s]  Grandma (R, fg) → Mia (L, mid)   basket (C, bottom)
        ──extends──                ──reaches──
        cam: locked | audio: SFX | mouth: Grandma CLOSED / Mia CLOSED
[2-3s]  SPEAKER Mia (L, mid) — mouth OPEN — "那我们开始吧。"
        Grandma (R, fg) — mouth CLOSED — listening
[3-4s]  SPEAKER Grandma (R, fg) — mouth OPEN — "好。"
        Mia (L, mid) — mouth CLOSED — listening
[4-5s]  basket exchange | both mouths CLOSED
[5-6s]  silent beat | both mouths CLOSED | slow push-in on Mia
```

### v1.1 旁白面板模板（对于`Audio Mode = narration`行——3D 动画中的 RARE，请谨慎使用）

**v1.1.1 注释**:此模板适用于`narration-led`模式，这是 3D 动画短片的一个罕见的主动选择**。大多数 3D 动画项目应该是`silent`或`dialogue-led`，不应该需要此模板。如果用户未经询问就选择了`narration-led`，请先显示确认卡。对于真正需要在整个短片中使用第一人称旁白者的项目，`half-narrated-short-drama`技能比此模板具有更强的叙述 - 背景强制性。

旁白面板模板在结构上与对白面板相似，但`Mouth State`始终为屏幕上的每个角色关闭，`Pose + Expression`字段通过逐节拍**表达路径**（音频对的视觉部分） 进行升级。例如，一个 4 秒的旁白面板覆盖了一秒钟的旁白：

```markdown
#### 0–1s (narration)
- Pose + Expression: SPEAKER (off-screen narrator) — silent mouth; on-screen Mia stands center midground, brows soften, eyes drift toward upper left (memory focus), jaw relaxes
- Camera: slow push-in from medium to medium close-up on Mia
- Audio + Anchor: ♪ narration (off-screen): "我一直记得那个下午。" | anchor: Mia: center midground
- Mouth State (v1.1): Mia CLOSED — narrator off-screen, on-screen face carries the emotion
- Performance: narrator-mouth-closed: true | expression-path: [0.0s brows soften, eyes drift UL; 0.3s gaze holds; 0.6s jaw relaxes; 1.0s lips press lightly] | [SPEAKER_HANDOFF → off-screen]
```

完成所有部分后，将文档放在画布上，并在下方显示分镜审批门。文本审批本身不会授权未指定的视频生成或回退尝试；在步骤 7 之前解决初始渲染范围。不要在默认的纯文本模式下生成图像。

### 镜头级提取（重迭代模式）

默认的单文档形式针对阅读和交叉镜头连续性进行了优化。当用户标记特定镜头进行重复迭代时（通常是高潮/追逐/戏剧性拍摄，每个面板的内容需要多轮修订），将该部分提取到独立的文本节点中，以便迭代本地化：

- 用户信号：在步骤 6 之后的任何时候，用户都可以说 “让我专注于 S05”、“S05 需要重做”、“提取 S05”，或者在分镜审批选择卡中选择一个镜头。
- 提取机制：
  1. 创建一个名为`<title> S05 text storyboard (extracted)`的新画布文本节点。
  2. 将`## S05`节的完整内容从文档移动到新节点。
  3. 在文档中，将`## S05`节替换为一行占位符:`> S05 — extracted to standalone node (see `<title> S05 文本分镜（提取）`)`。
  4. 第 7 步从提取的节点中读取 S05;所有其他镜头仍然从文档中读取。
- 重新集成：当用户满意时，独立节点将折叠回文档（用最新内容替换占位符），并且独立节点将被归档。
- 多个提取的镜头：每个镜头都会获得自己的独立节点；文档会用占位符跟踪它们。

提取机制之所以存在，是因为独立节点最好根据需要使用，而不是默认使用——但当特定镜头的迭代压力较高时，它们仍然可用。

### 选择路径：多面板铅笔图像分镜（可视化模式）

如果用户在分镜模式选择卡中选择了可视化模式，ALSO 将在文本分镜文档顶部的每个表行生成一个多面板铅笔分镜图像。文本分镜文档仍然是权威的渲染参考；铅笔图像仅供人工审阅。

对于每个铅笔图像分镜：

- **双重绑定标签（右上角，图像上强制）**:
  - `[char:角色名-01] [char:角色名-02] ...`——这一行中使用的准确角色卡片名称。*v1.1:`dialogue`和`mixed`行首先列出说话者的名字。*
  - `[scene:场景名]`——准确的场景卡片名称。
  - `[shot: S03] [dur: 6s] [hook: visual-joke] [audio_mode: dialogue] [speaker: Mia]`——镜头 ID、持续时间、钩子类型、音频模式，以及（对于对话行） 指定的说话者。
  - 这些标签仅用于分镜参考标记，在视频渲染时会被去除。
- 将那一行列出的精确角色卡片进行绑定，以锁定角色的外貌、面容、发型、头身、服装、签名道具和角色身份。
- 绑定那一行列出的确切场景卡，以保留环境、道具、地标、运动路径和空间逻辑。
- 将行中的每秒指令转换为一个分镜面板或一个明确标记的节拍面板；对于 4 秒镜头，通常创建 4 个面板；对于 6 秒镜头，通常创建 6 个面板；对于亚秒级关键节拍，仅在需要时添加额外的迷你面板。
- **v1.1 附加**:每个面板必须显示每个屏幕角色的 `Mouth State`。在每个角色的轮廓下方使用小 `⊙` 标记（张嘴） 或 `—` 标记（闭嘴）。这样在渲染前检查时，说话者和听众的区别一目了然。
- **面板物理布局（强制）**:
  - 3 秒镜头→1×3 条。
  - 4 秒镜头→2×2 网格。
  - 5 秒镜头→上排 3+ 下排 2。
  - 6 秒镜头→2×3 网格。
  - 7+ 秒镜头→3 行，平衡面板。
  - 每个面板占用相同的画布面积；不要让一个面板占主导地位。
- **每个面板的四字段内容（强制）**:
  - 左上方：时间码（例如`0–1s`）。
  - 右上：姿势 + 表情草图（最大面积；实际视觉节拍）。
  - 左下角：摄像机图标 + 移动箭头（推/拉/平/轨道/锁定），以及一个用于荷兰语角度的小音符。
  - 右下角：音频提示（例如`♪ narration: "I knew it."` / `♪ dialogue [Mia]: "..."` / `SFX: door creak` / `silent`） 和锚定音符（例如`door-frame: right third`）。
  - **v1.1 附加（第五字段，时间码下方的顶部中心）**:口型状态条显示此秒内屏幕上每个字符的`Mia: ⊙ / Grandma: —`（或类似内容）。这是角色混淆的视觉预渲染检查。
- 在同一个单镜头分镜图像中按阅读顺序排列面板；不要将多个不同的镜头合并成一个图像。
- 每个面板都必须标记其时间码，例如`0–1s`、`1–2s`，并显示相应的姿势、表情、动作、摄像机运动、支撑位置、SFX 提示、口型状态和连续性切换。
- 仅输出纯黑白铅笔线条艺术：无色彩、无最终渲染灯光、无抛光 3D 渲染。
- 在分镜图像上标注镜头编号，并在需要时在每个面板上包含摄像机运动图标/标记。
- 如果有用，可以使用分镜专用标记：铅笔构图线、动作箭头、摄像机路径图标、计时标记和小注释。
- 将草稿仅保留为视频渲染参考资料，而不是最终作品。

### 分镜审批（两种模式）

在所有文本分镜部分（以及铅笔图像，如果可视化模式已打开） 制作完成后，将它们按照镜头顺序放在画布上，并按以下方式进行分组：
- `<title> text storyboards`（默认模式，单文档）,OR
- `<title> text storyboards + multi-panel pencil storyboards`（可视化模式，将文本文档和铅笔图像分开分组，因为铅笔图像包含文本文档所没有的双重绑定标签、ASCII 标签和镜头编号）

显示用户选择卡：

- 批准分镜脚本和渲染镜头视频（推荐）
- 提取/重新整合镜头（在文档和独立节点之间移动部分）
- 重新绘制选定的铅笔分镜（可视化模式）
- 修复角色一致性
- 固定场景逻辑
- 固定摄像机标记
- 修复音频/锚定标记
- **v1.1:修复口型状态/说话者绑定问题**（当自检或渲染前审核在特定面板中标记出口语同步风险时出现）

### 分镜失败：先报告，获得范围授权 (v1.1.11)

使用`fallback-policy.md`中的单一有限重绘约定和可视化策略；没有独立的分镜重试重试阶梯或新的尝试余地。失败的检查记录结果，而不是创建另一幅图像的许可。显示失败的镜头/面板、证据、保留的文本意图、拟议的修改、输出/尝试次数、成本暴露以及在任何额外生成之前的停止条件。选择铅笔可视化授权约定的第一次尝试，而不是自动重绘。

默认批准覆盖每个命名图像一次额外尝试。同一镜头/产物问题的总计最多为初始 + 两次额外尝试；模型切换、截面提取、重命名错误和镜头分割不会重置计数。在接受目标、授权限制、累积上限、取消、外部阻塞、无材料改进或未经批准的范围变更处停止；保留并报告现有输出。

提供授权显示的目标重绘、修改提案、保留当前评审图像、省略该可选图像并依赖批准的文本、提供替换或停止的选项。不要自动简化标签、减少面板、更改布局样式、分割镜头或删除所需信息。如果用户批准了这种更改，请在权威文本中保留完整的时序覆盖、音频/主播意图、口头表达和所需的故事节奏。更改的镜头结构需要在媒体生成之前获得批准。

只修复受影响的部分/图像和实际无效的依赖项；相邻部分需要切换检查，而不是自动再生。铅笔重绘绝不会强制视频重新渲染。文本编辑会触发与现有剪辑的比较；只有在需要并明确授权的情况下才进行渲染。未受影响的经批准图像、剪辑和 BGM 保持锁定。

在默认的仅文本模式下，在请求的文本编辑范围内修复受影响的行/节，并进行一次本地复核。报告未解决的问题，并等待，而不是无限期地修改。缺失的证据保持未经验证。不要声称修复了媒体的文本更正或批准了新的候选人。
