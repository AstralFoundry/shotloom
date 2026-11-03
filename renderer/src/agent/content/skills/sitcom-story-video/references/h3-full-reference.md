# MiniMax H3 完全参考模式：镜头和切换方向

当用户在MiniMax H3 中以全合一/完整参考模式生成情景喜剧时，请使用此参考。将界面当前可用的长宽比、持续时间、分辨率、音频和参考槽视为权威；不要创建不受支持的控件。

主要技能 v1.0.1 的故障分类、授权分类、共享预算和停止条件管理着这里的每一个操作。本参考提供了创意/技术建议，不包括额外的尝试或许可来更改锁定的规格、生成桥接镜头、添加声音或在混音故障后重新生成视频。

## H3 制作单元：明确的镜头时间线

不要让剪辑成为 “电影蒙太奇” 或 “动态剪辑” 等模棱两可的短语。在撰写视觉文字之前，创建一个剪辑地图。它必须按顺序列出每个镜头、开始/结束时间、镜头大小、镜头、摄像机运动、演员遮挡、动作峰值、剪辑点和转场逻辑。当用户想要一个多镜头剪辑时，一个 H3 提示可能会描述多个镜头，但每个镜头片段都必须在该时间线内独立指定。

每个片段使用一个主导动作和一个主动镜头运动，不必为每个镜头单独生成一个片段。默认为 2-4 秒，如果与批准的时序兼容，则使用可用手柄。如果内部切换失败，请保留证据，并在相同的切换图下建议单独的片段生成；首先获得批准更改包装、增加输出计数/成本，以及任何时序变更。每个生成的分割输出都会消耗原始单元的剩余余额；不要绕过上限或用模糊的缩放/蒙太奇替换计划的切换。

## 所需的切换图

在提示文本前添加表格：

| 时间码 | 拍摄 ID | 取景/镜头 | 镜头运动 | 动作峰值 | 切换/转场 | 连续性切换 |
|---|---|---|---|---|---|---|
| 00:00-00:02.5 | S01 | 中宽，35 毫米 | 左慢速轨道 | 角色注意到道具 | 凝视上的硬切 | 屏幕右侧对 S02 的凝视 |

允许的过渡标签是具体且有意义的：当时间/地点变化需要时，可以使用`hard cut on action`、`hard cut on reaction`、`match cut by hand/prop direction`、`eye-line cut`、`J-cut/L-cut with diegetic sound`或`brief motivated dissolve`。不要在未命名跨界匹配项的情况下使用`smooth transition`。

对于每个剪辑，要说明四个锚点:(1) 出镜方向，(2) 入镜方向，(3) 共享视觉或音频线索，以及 (4) 必须保持的确切状态。如果剪辑故意打破轴线或调色板，要标记故事原因，并在入镜中确立新的地理位置。

## 参考层次

给每个引用一个明确的角色和索引。一个可靠的堆栈是：

1. `REF_01_SCENE`:一个干净、充满活力的位置框架，用于确定地理位置、光线方向和反复出现的背景锚。
2. `REF_02_CHAR_A`（可选`REF_03_CHAR_B`）:单一角色参考，最好是一个清晰的全身或 3/4 视角；锁定脸部、头发、衣橱、身高比和轮廓。
3. `REF_04_PROP`:一个单一的英雄道具，或者当它驱动堵嘴时的确切手持物体。
4. `REF_05_POSE_OR_TAIL`:先前批准的终场画面或下一个镜头的简单动作姿势参考。

使用最少的参考素材来完整说明镜头。三个强有力的参考素材通常比一个拥挤的拼贴画更安全。千万不要上传联系表、多面板分镜脚本、UI 截图、带边框的图像，或者包含替换服装的参考素材作为角色参考;H3 可能会将这些面板视为同时场景内容。

在提示词中，说明每个参考文件控制的内容和不能改变的内容:`REF_01 controls space and light only; REF_02 controls identity and wardrobe only; REF_04 controls shape and material only.`这样可以防止场景图像重写人脸或道具图像改变场景。

## 完整框架和反框架规则

为了避免参考调整后可能出现的方框式、卡片式或分镜式的外观，请包括:`edge-to-edge cinematic frame, no border, no frame-within-frame, no contact sheet, no panel layout, no UI, no letterbox bars, no poster typography`。将镜头描述为具有前景、中景和背景的摄影场景，而不是卡片、缩略图或插图图片。

将重要的面部和手部保持在一个宽敞的动作安全区域内。不要强制进行极端的边缘处理或过于对称的中心处理。使用有动机的前景遮挡物、实用光线和可读的地平线/房间线，在不创建装饰性画框的情况下赋予图像深度。

## 切断连续性配方

在地图上规划切换，并在 H3 提示词中编码完整的局部切换方向：

- 匹配一个轴：保持 180 度的屏幕方向，并确定谁是屏幕左侧/屏幕右侧。
- **Match one vector**:将手、目光、身体或道具的移动沿同一方向切换。
- 匹配一个状态：在输出帧和输入帧中指定确切的道具状态、手部占用、面部表情和光线水平。
- 使用尾帧切换：在支持的情况下，将批准的出口端帧输入到下一个镜头中作为`REF_05_POSE_OR_TAIL`。否则，在两个提示词中逐字输入状态。
- **在动作或反应时切换：将编辑放在接触/转动/实现的峰值处，而不是在镜头运动时。
- **桥接声音**:在剪辑中将下一个动作的渐变声音预叠加约 2-6 帧；不要让 H3 发明过渡效果。

对于 H3 的多镜头提示，将切出部分写成提示内时间线，例如:`00:00-00:02.5 SHOT S01 medium-wide 35 mm, slow left track; cut hard on the character's gaze at 00:02.5. 00:02.5-00:04.5 SHOT S02 50 mm two-shot, short push-in along the same gaze vector; cut on the hand contacting PROP_01 at 00:04.5.`永远不要在一长段风格形容词后面隐藏切出指令。

对于困难的过渡，首先要检查批准的素材是否支持干净的剪辑。一个中性的桥段镜头可以只考虑其故事角色、持续时间、新的输出计数、连续性影响和成本；在创建之前，请批准剪辑地图的变更和生成范围。不要将桥段生成视为免费修复。避免交叉渐变、数字平移或变焦，这些变焦会隐藏不匹配，除非明确选择。

## 纹理和图像质量保障

H3 可能会导致皮肤变得蜡质，边缘过于尖锐，细纹不稳定，实用灯光闪烁，以及切口之间的曝光变化。用具体的物理语言来对抗这种情况：

- `natural skin pores, fine fabric weave, matte painted surfaces, restrained micro-contrast, soft highlight roll-off, stable exposure, consistent white balance, fine grain applied uniformly across the whole frame`;
- 命名正在接触的材料 (`brushed aluminum`、`aged oak`、`cotton knit`、`ceramic glaze`)，以及导致其突出的光源;
- 保持不同覆盖范围的照明图表相同：关键方向、色温、阴影柔和度和实用亮度;
- 要求`subtle texture movement caused by the action`而不是一般的 “高细节” 或 “超逼真”;
- 将字体、标志、屏幕和小标签留待后期制作；在 H3 中使用干净的空白表面。

避免将`8K`、`hyper-detailed`、`HDR`、`glossy`、`crystal sharp`和`cinematic`作为空洞的质量词语堆叠。它们通常会产生脆弱的边缘和塑料高光。建议进行一个克制的整理，并在后期对所有选定的剪辑一起进行评分。

在适当的时候添加这个负方块:`boxed composition, storyboard panels, contact sheet, border, frame-within-frame, letterbox bars, UI elements, poster text, plastic skin, waxy faces, oversharpening halos, unstable fabric weave, crawling linework, texture flicker, exposure pumping, white-balance shift, random lens change, unmotivated zoom, morphing hands, duplicate props, identity drift`。

## H3 提示骨架，带有明确的剪切

```text
[MODEL/SPEC] MiniMax H3; {available aspect ratio}; {available duration}; {reference mode}.
[CUT MAP] {numbered shot timeline with exact timecodes, shot sizes/lenses, camera moves, action peaks, cut points, and transition labels}.
[STORY BEAT] Shot S01: {visible change and comic function}; Shot S02: {visible change and comic function}; each segment has one dominant action.
[REFERENCE ROLES] REF_01_SCENE controls space/light only. REF_02_CHAR_A controls identity/wardrobe only. REF_04_PROP controls object shape/material only. REF_05_POSE_OR_TAIL controls incoming pose and direction only.
[VISUAL FINISH] Edge-to-edge cinematic sitcom frame; {camera/lens}; {lighting diagram}; natural pores, fabric weave, matte surfaces, stable exposure, restrained micro-contrast, uniform fine grain.
[SHOT-BY-SHOT DIRECTION] S01 {start pose -> action -> reaction/end pose; screen-left/right; camera move; cut at timecode}. S02 {incoming state -> action -> reaction/end pose; camera move; cut at timecode}. Continue for every shot.
[CUT HANDOFF] At each cut, match {axis/vector/eye-line/prop state/audio cue}; state whether it is a hard action cut, reaction cut, match cut, eye-line cut, J-cut, L-cut, or motivated dissolve.
[AUDIO] {diegetic cue and room tone}; dialogue only if explicitly requested and speaker is visible; no music or generated text.
[NEGATIVE] {anti-box + texture + continuity negatives}.
```

## 恢复决策，而不是自动重试阶梯 (v1.0.1)

### 1.根据证据进行分类

- 执行失败：显式终端故障/拒绝，无可用输出。诊断实际原因，同时保留批准的内容/规格。成功渲染并出现检索问题应恢复，而不是重新生成。未知/超时状态需要先进行工作/结果调优；如果未解决，则暂停，不再提交。
- 内容失败：渲染的镜头违反了标识、动作、连续性、帧、剪辑或对话。记录镜头/版本/时间戳以及失败或未经验证的检查。不要将其称为执行错误以获得免费重试。
- 音频/后期故障：分别检查原始图像、原始音频、添加的背景音乐和混音/导出。增益、渐变、同步、路由或导出故障需要授权的确定性修复，而不是新视频。有缺陷的背景音乐可能需要进行有限范围的仅音乐替换，而不是视频再生。

### 2. 选择最小的提案

在变量改变之前进行诊断。候选变更包括修正经过验证的参考绑定错误、简化操作、重新定时或选择一个更干净的经批准的连续性参考。删除任何参考、特征或支撑；改变持续时间、模型、规格或切割拓扑；或生成新的锚/桥需要明确批准。保留未受影响的创意约束和经批准的输出；不要在每次尝试时重写整个风格提示。保留相邻的镜头，除非有证据证明它们的实际依赖关系无效。

对于已知的执行错误，主要技能默认最多允许一次原因修正的执行重试，但仅限于精确的预授权和共享限制。内容更改始终需要一个批准的修复范围；仅凭第一次通过/分镜/分辨率批准是不允许的。如果范围已经精确预授权，则不要再次询问。

### 3. 低规格验证和随后的交付

低成本测试是可选的额外生成，绝不是强制性的恢复阶段。在此之前，说明受影响的单元、支持的测试分辨率/方面/持续时间、输出计数、目的、成本不确定性、剩余余额以及如何满足最终目标规范。获得明确批准，以偏离锁定规范，即使是暂时的。

通过测试后，区分：

| 下一步行动 | 预算/账户处理 | 批准和证据 |
|---|---|---|
| 以较低规格版本交付已接受的测试 | 无新一代 | 用户必须明确接受修改后的交付规范；不得声称符合原始目标 |
| 确定性地放大/转码现有测试 | 邮件操作，而非视频生成；收取共享邮件预算 | 首先批准方法/输出规格；不要声称原生的高规格详细信息或重置之前的生成计数 |
| 生成新的目标规格 | 另一次视频生成尝试加上共享成本 | 批准或重用明确的条件授权；重新检查身份、切换、动作和音频，因为测试成功不能保证新的目标规格 |

一个明确的计划可以预先授权一次探测和一次有条件的目标规范操作，并分别计算其费用，从而避免了冗余的问题。如果没有这个范围，测试批准永远不会授权升级。如果目标操作没有足够的剩余预算/尝试余额，请停下来要求在范围内提供替代方案，而不是默默地花费。

### 4. 一个共享的上限和停止规则

“三次尝试” 最多意味着初始生成加上两次额外的实际生成尝试，针对同一问题/单元，跨越主文件、参考文件、变体、模型和分辨率。这是一个上限，而不是三次重试或最小变体计数。每个低规格探针和高规格再生计数，包括成功的测试；分配的输出将按照其父单元的剩余余额计费。技术性飞行前拒绝和后续操作将被记录在其真实类别下，而不是误称为生成的视频。未知的计费将保持未知。

例如：初始目标规格采集失败 QC（尝试 1）;明确批准的低规格探针通过（尝试 2）;单独或有条件授权的目标规格再生使用尝试 3。不存在第四次 “升级尝试”。对现有批准媒体的编辑/重新混音是一项单独的后续操作，仍然需要预算和授权。

停止接受、任何用户/平台或共享的尝试/预算/时间限制、用户暂停/取消、外部阻碍、未知的工作状态、没有材料改进或未经批准的下一步。在上限时，保留输出并报告未解决的问题。使用现有素材、用户提供的媒体、带标签的评审/部分版本或实质性修订的计划提供授权编辑；不要机械地重新启动相同的问题，也不要自动生成新的动作片段、桥接、反应或声音提示。新的福莱/笑声仍然在主要 Skill 的仅 BGM 声音分支之外。

一个光滑的静止画框并不能证明一个镜头的连续性或删减已通过。记录通过/失败/未经实际报道验证，并且在审核之前绝不要用新的候选版本替换已批准的版本。
