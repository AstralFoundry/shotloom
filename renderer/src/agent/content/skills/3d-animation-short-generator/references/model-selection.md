# 视频模型选择和提示词塑形（v1.1——音频模式感知）

## 第 7 步：视频模特选择卡 + 单镜头视频片段

### 视频模型选择卡（任何片段渲染前必填）

在渲染任何片段之前，请显示视频模型选择卡。选择将保存在项目简介中，并在本项目的每个片段中重复使用，除非用户后来更改了它。

视频模型卡：

- **H3（推荐默认值）**——在可视化包装、运动图形、文本/UI 清晰度、多模态上下文理解和成本效益方面表现强劲（约为旗舰模型价格的 1/3,2K 时价格为 1/2,768P 时价格为 1/2）。原生双声道音频。2K 时每个片段最高可达 15 秒。最佳选择：风格化 3D 动画短裤，具有强大的设计语言、文本叠加、运动图形时刻、包装风格转换和对白驱动的节奏，其中音频是可交付内容的一部分。
- **其他可用模型（明确主动选择）**——仅当用户命名模型或 H3 无法满足硬性能要求时才使用。使用前请检查其功能并记录异常。
- **按镜头混合（高级）**——让用户在`Shot Description`列中标记`video_model: H3`或其他明确选择的模型。未标记行的默认值为 H3。

**v1.1 音频模式交互（在 v1.1.1 中修正）**:视频模型的选择会与步骤 0 中选择的音频模式交互。

- 对于`silent`项目（视觉 3D 动画的初级模式），两种模型都可以使用；根据视觉风格优先级进行选择。H3 通常是更好的默认模式。
- 对于`dialogue-led`项目，保留 H3 作为默认模式，只有在检查所选模型的单说话人和音频功能后才能切换。
- 对于`narration-led`项目（一个罕见的 3D 动画选择）,H3 的双声道音频优势显著——H3 可以在一次通过中生成和混合旁白。推荐使用 H3。*3D 动画警告：大多数 3D 动画项目不需要`narration-led`;如果用户未经询问就选择了它，请确认后再继续。

### 分辨率选择卡（视频模型之后）

视频模型锁定后，显示分辨率选择卡：

- 768P（推荐用于 H3 首次通过；具有成本效益）
- 2K（H3 默认质量；成本更高，最终渲染更清晰）
- 1080p（当所选模型需要时）
- 720p（支持时为草稿）
- 匹配项目/自定义分辨率

用户必须在第一个片段渲染之前确认分辨率。如果用户想要一个更详细的英雄镜头，可以稍后更改每个片段的分辨率。

### 模型选择不是额外的生成授权 (v1.1.11)

选择模型或分辨率会选择一个生产约束；它不会批准无限制的渲染。在第一批之前，说明已批准的镜头行和它涵盖的输出。所有额外的生成都遵循`fallback-policy.md`:首先报告 QC 发现，验证范围授权，并计算跨模型切换的尝试次数，而不是启动新的重试阶梯。默认的重新审批允许每个列出的产物额外尝试一次；同一镜头/发行限制为初始 + 两次额外尝试，并且存在更严格的用户/平台限制。

切换到不同模型、更高分辨率、更改参考、不同持续时间或音频模式需要在执行前明确批准。仅记录受影响镜头的每个镜头异常；对于不相关的镜头，保持选择和批准的输出不变。不要因为模型无法使用而丢弃参考；报告不兼容性并询问。现有的旁白/混合示例不允许在主要技能边界之外进行旁白引导的回退。

在每次授权尝试后，审核候选人，记录通过/失败/未经验证和证据，并在接受目标、限制、暂停/取消、阻碍、材料改进不足或未经批准的变更处停止。批准一个候选人和批准另一个渲染是不同的决定。渲染实际上只影响镜头，保留其余部分。

### 单镜头剪辑渲染

对于每个批准的表行，调用所选视频模型生成相应的独立视频片段。每个片段必须使用文本分镜脚本文档中的完全匹配部分（如果该部分已提取，则使用提取的独立节点，否则使用文档内部部分）、角色卡 (s) 以及该行的场景卡。

每个镜头的规则对所有视频模型都是通用的：

- 使用文本分镜文档作为每个镜头的权威参考，包括叙事、构图、摄像机运动、动作分段、每秒计时、口型和镜头数量。对于已经提取到独立节点的镜头，请改为阅读提取的节点。如果还存在铅笔图像分镜，请仅用于人体姿势/轮廓预检查；不要让它覆盖文本分镜。
- 使用角色卡作为权威的身份信息来源。
- 使用场景卡作为权威的环境信息来源。
- **在视频渲染前去除所有分镜双重绑定标签**(`[char:…]`、`[scene:…]`、`[shot:…]`、`[dur:…]`、`[hook:…]`、`[audio_mode:…]`、`[speaker:…]`)——这些标签仅限于分镜参考标记，不得出现在最终剪辑中。铅笔图像分镜还有自己的镜头编号、摄影机图标、箭头和注释，必须在渲染时移除。
- 渲染的片段必须只包含干净的全彩Pixar灵感来源的 3D 动画内容。
- 没有分镜线条艺术，没有手绘草图纹理，没有标签，除非要求，否则没有字幕，没有水印。
- 保持分辨率选择卡上批准的屏幕尺寸/宽高比和批准的视频分辨率。

### v1.1 音频模式感知的提示词塑形（NEW——替换 v1.0 提示前缀部分）

v1.0 提示前缀是每个模型的一个静态字符串。**v1.1 重写每个模型的每个音频模式的提示前缀**，因此模型被明确告知：

- 哪个字符是说话者（用于对话）
- 哪些角色必须保持嘴巴闭合（非说话者）
- 画外音旁白是否发生在屏幕外（因此所有屏幕上的嘴巴都必须保持闭合）

这是对抗 AI 角色混淆口型同步错误最有效的干预措施。

#### 第 1 步：组装每个镜头的上下文块

在生成特定于模型的提示词之前，从镜头表和分镜中构建一个小的**lip-sync 上下文块**。这个块预设为提示词，并在渲染时剥离：

```
[AUDIO_MODE] <narration|dialogue|mixed|silent>
[SPEAKER] <exact character card name, or "off-screen narrator" for narration rows, or "n/a" for silent rows>
[NON_SPEAKERS_MOUTH] <comma-separated list of exact character card names whose mouths must stay CLOSED this entire shot, or "all (narration/silent mode)">
[SHOT_DURATION] <N>s
```

对于`narration`行：

```
[AUDIO_MODE] narration
[SPEAKER] off-screen narrator
[NON_SPEAKERS_MOUTH] <every on-screen character by exact name> — keep all mouths closed this entire shot; the narrator voice plays in voiceover, on-screen faces carry the emotion through brows/eyes/jaw only
[SHOT_DURATION] <N>s
```

对于`dialogue`行（每个镜头只有一个说话者，由镜头表规则强制执行）:

```
[AUDIO_MODE] dialogue
[SPEAKER] <character name> — this is the ONLY character with mouth movement this shot
[NON_SPEAKERS_MOUTH] <every other on-screen character by exact name> — mouths must stay CLOSED for the entire shot
[SHOT_DURATION] <N>s
```

对于`mixed`行（罕见；通常是主角对白，由旁白结束）:

```
[AUDIO_MODE] mixed
[SPEAKER] <character name> during dialogue seconds; off-screen narrator during narration seconds
[NON_SPEAKERS_MOUTH] <every other on-screen character> — mouths closed except during their own dialogue seconds
[SHOT_DURATION] <N>s
[SECONDS] 0-1s=narration, 1-3s=dialogue[Mia], 3-5s=dialogue[Grandma], 5-6s=narration
```

对于`silent`行：

```
[AUDIO_MODE] silent
[SPEAKER] n/a
[NON_SPEAKERS_MOUTH] all on-screen characters — keep all mouths closed this entire shot
[SHOT_DURATION] <N>s
```

#### 步骤 2:将 Lip-sync 上下文块预设为特定模型的提示词

完整的提示词现在有三层，顺序如下：

1. **口型同步上下文块**（v1.1，音频模式感知）——参见上文
2. **特定于模型的前缀**（样式基线）——参见下文
3. **每秒镜头指令**（来自文本分镜，包括`Mouth State`字段）

#### H3 提示前缀（v1.1，音频模式感知）

基本样式前缀（始终包含，与音频模式无关）:

```
Pixar-inspired 3D cartoon rendering, C4D + Octane look, stylized Q-version proportions, warm SSS skin, designed-with-detail hair, strong character design language, clean motion, on-brand color palette.
```

根据镜头的音频模式添加以下口型同步后缀：

- 对于`narration`行，追加：
  ```
  NARRATION-LOCKED SHOT: voiceover is off-screen. Every on-screen character must keep their mouth CLOSED and STILL for the entire shot. Emotion is expressed through brows, eyes, jaw tension, gaze direction only — no mouth movement, no lip movement, no speech-related micro-motion.
  ```
- 对于`dialogue`行，追加：
  ```
  DIALOGUE-LOCKED SHOT: only [SPEAKER] speaks this shot. Every other on-screen character must keep their mouth CLOSED and STILL for the entire shot. [SPEAKER]'s mouth moves only during their dialogue seconds as marked in the per-second directives. The shot's narrative beat belongs to [SPEAKER].
  ```
- 对于`mixed`行，追加：
  ```
  MIXED-AUDIO SHOT: this shot contains both off-screen narration and on-screen dialogue. Follow the per-second mouth-state map strictly. During narration seconds every on-screen character's mouth must stay CLOSED. During dialogue seconds only the named speaker's mouth opens.
  ```
- 对于`silent`行，追加：
  ```
  SILENT SHOT: no speech, no voiceover. Every on-screen character's mouth must stay CLOSED for the entire shot. Emotion is expressed through body, face above the mouth, and gesture only.
  ```

#### 替换模型提示前缀（v1.1，音频模式感知）

基本样式前缀（始终包含，音频模式独立）:

```
cinematic Pixar-quality 3D animation, elastic squash-and-stretch performance, Disney-style anticipation and overshoot, dramatic key lighting, lens-specific depth of field.
```

添加与 H3 相同的音频模式后缀，根据显式选择的模型的摄像机和性能优势调整措辞：

- 对于`narration`行，追加：
  ```
  This is a NARRATION-LOCKED shot. Voiceover is off-screen; on-screen faces must stay mouth-closed and still. Use the per-second expression-path to deliver emotion: brow furrow, eye-line shift, jaw tension, gaze drop. No speech micro-motion.
  ```
- 对于`dialogue`行，追加：
  ```
  This is a DIALOGUE-LOCKED shot. [SPEAKER] is the only character whose mouth moves this shot. Use elastic squash-and-stretch on [SPEAKER]'s face and body during their dialogue seconds; every other on-screen character must keep their mouth CLOSED for the entire shot.
  ```
- 对于`mixed`行，追加：
  ```
  This is a MIXED-AUDIO shot. Honor the per-second mouth-state map. Narration seconds → all on-screen mouths closed, expression path drives the emotion. Dialogue seconds → only the named speaker's mouth opens.
  ```
- 对于`silent`行，追加：
  ```
  This is a SILENT shot. No speech. All on-screen mouths CLOSED. Drive emotion through elastic body mechanics, squash-and-stretch, and ambient gesture.
  ```

当用户选择`per-shot mixed`时，应用与行的`video_model`字段匹配的前缀。

### v1.1 说话者绑定参考图像选择 (NEW)

对于`dialogue`行，当视频模型支持面部绑定时，应使用说话者的角色卡作为主要面部参考图像。这将模型的面部 ID 锚定到说话者，并减少镜头中的身份漂移。

- H3:使用说话者的角色卡中的`main 3/4 view`作为`face_reference`输入。如果角色卡具有`speaking`参考图像（在步骤 3 中添加了 v1.1），请优先使用该参考图像。
- 替代选择的模型：与 H3 相同——说话者的角色卡是面部锚。

对于`narration`行，屏幕上人物的人物卡是面部锚（根据定义，旁白者是屏幕外的）。

对于`silent`行，面部锚定使用屏幕上最突出的角色；这是由风格驱动的，而不是由嘴唇同步驱动的。
