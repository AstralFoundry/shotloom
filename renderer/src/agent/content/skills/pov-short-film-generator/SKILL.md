---
name: pov-short-film-generator
description: 将创意、剧本或参考素材转化为严格主角眼睛视角的沉浸式短片规划与可执行镜头方案。
metadata: {"category":"短剧漫剧","version":10002,"defaultEnabled":false}
---

# 沉浸式第一人称短片

这项技能将用户想法、短剧前提、脚本片段、参考图像或现有剪辑转化为严格的第一人称视角沉浸式短片工作流程。目标是让整个视频感觉像主角亲眼所见，同时防止第三人称连续性中断，并保持视觉风格的物理基础和连贯性。

## 使用案例和界限

使用这项技能可以：
- 第一人称视角短剧、沉浸式悬念、生存、逃脱、浪漫、复仇、冒险、恐怖、工作压力以及逼真的日常生活片段。
- 明确提及第一人称视角、视角、主观摄像机、主角视角、手持沉浸式或 “我所看到的” 的请求。
- 需要 Final_Video_Spec、分镜、图像提示词、视频提示词和生成前 QC 检查清单的工作流程。

不要将这项技能用于：
- 普通的第三人称戏剧、多机位演出场景、合作场景或标准镜头对白。
- 没有主观主角体验的产品展示视频。
- 长片规划。这项技能适用于短片、开场镜头或紧凑的视角片段。

## 全球硬锁

1. 整部电影必须保持严格的第一人称视角:`first-person POV from protagonist; camera is his/her eyes; no external shot of protagonist.`
2. 主人公的脸部绝对不能暴露。不要创建正面主人公特写镜头、半身外景镜头、背景追踪镜头或第三人称表演镜头。
3. 主角可能只通过局部身体证据出现：手、鞋子、袖子、胸前物体的边缘、部分反射、屏幕眩光、呼吸雾气或持有物体。
4. 每个镜头都必须经过这个问题:“这个图像能否被主角亲眼看到？” 如果不能，则重写。
5. 不要生成字幕、标题卡、屏幕文本叠加、销售卡片或字幕层。如有必要，对话和旁白仅限音频。

## 步骤 1:提取视觉效果核心

根据用户输入，确定：
- 主角身份：摄像机所代表的眼睛。
- 当前情况：危险、欲望、秘密、压力或冲突。
- 关键外部物体：对手、爱人、怪物、物体、门、电话、车窗、镜子、桌子、走廊等。
- 可见的主角碎片：手、袖子、鞋子、呼吸、握着的物体、手机边缘、伤口、徽章、工具。
- 禁止的第三人称元素：主角的脸、主角的远景镜头、主角的背影、外部跟踪镜头。

如果用户只给出了一行概念，可以构建一个紧凑的钩子：
- 强烈的冲突或异常的细节在前 3 秒内出现。
- 在 10 秒内，某些事情迫使主人公做出反应。
- 结尾保留一个延续性的钩子或情感上的余韵。

## 第二步：视觉风格引擎

在编写 Final_Video_Spec 之前，请确定视觉样式。如果用户已经提供了样式，请直接将其物理化。如果没有提供样式，请选择或提供以下其中一种：

### A. 真实生活纪录片现实主义（默认）
- 视觉基调：真实的县城、城市村庄、工作场所、乡村或日常纹理；自然或实用光线；低饱和度。
- 物理映射：自然现实主义、实用光线、低饱和度、手持手机摄影机压缩、磨损的织物、现实生活中的杂乱。
- 最适合现实主义故事、工作场所压力、城市悬念和日常生活视角。

### B. 网络雨霓虹之夜
- 视觉基调：冷/暖对比度、高对比度、湿润反射、潮湿空气。
- 物理映射：湿沥青，霓虹反射，高对比度色差，冷青色阴影，暖琥珀色高光。

### C. Y2K / 旧家庭录像怀旧
- 视觉基调：低分辨率、CCD 噪声、色差、温暖怀旧的朦胧。
- 物理映射：复古手机摄像素材，轻微色彩变化，CCD 传感器噪声，温暖朦胧的光线，低分辨率的边缘柔和度。

### D. 工业寒冷
- 视觉基调：钢灰色、重工业、金属、低饱和度、冷雾。
- 物理映射：钢灰色铸造，工业金属纹理，低对比度雾，冷荧光照明，粗糙混凝土氛围。

### E. 电影 ARRI 纹理
- 视觉基调：高动态范围、柔和散射、精致阴影、有机温暖。
- 物理映射：柔和散射的自然光，电影般的动态范围，丰富的阴影细节，优质的有机纹理。

### F. 自定义输入

如果用户提供了抽象样式，请将其转换为可执行的物理锚点：
- 光源方向
- 色温
- 曝光行为
- 快门或运动行为
- 饱和度和对比度
- 中等纹理或传感器噪声
- 空气质量
- 场景证据

不要简单地在提示词中堆砌抽象的样式词。要将它们转化为可见的证据。例如：
- “忧郁”→空洞的构图，寒冷零散的光线，犹豫的手部动作，雨点打在玻璃上。
- “旧记忆”→ CCD 噪音、轻微的色彩变化、柔和的边缘模糊、褪色的家居用品。
- “压抑的工作场所”→冰冷的荧光灯，静音的玻璃乐谱，键盘嗡嗡声，低垂的目光，手握徽章。

## 第 3 步：编写 Final_Video_Spec

在创建分镜脚本或图像生成之前，请创建一个规范文档：

```markdown
# Final_Video_Spec

Title:
Type: First-person POV realistic short film
Aspect Ratio: 16:9 / 9:16 / user-specified
Target Duration:
Visual Style Definition:
Style Mapping Parameters:
  - Lighting / Color Temperature:
  - Medium Texture:
  - Saturation and Contrast:
  - Air / Environment Texture:
Core Rule: Strict first-person POV; no third-person shot; no protagonist face exposure
Visible Protagonist Fragments:
Key External Objects:
Image Model: user-specified or agent-selected Hub-compatible image generation
Video Model: user-specified or agent-selected Hub-compatible video generation
Sound Strategy: environment sounds, action sounds, breathing, dialogue/narration ownership
```

如果用户已经授权代理做出决定，请选择合理的默认设置，无需再次询问。

## 确认/修改卡门

为了减少重复的用户操作，不要在每个里程碑结束时都问一个开放式的 “continue?” 问题。在主要里程碑时，提供一张简洁的确认卡，并附上清晰的选项：

- **确认并继续（推荐）**——立即进入下一个生产步骤。
- 修改当前结果——询问需要修改的部分，然后在继续之前仅更新该部分。
- 暂停/导出当前结果——停止工作流程，并将当前文档或素材准备好供以后使用。

在这些主要里程碑之后使用这张卡片：
1. `Final_Video_Spec`和分镜交付之后。
2. 在关键的第一帧图像生成之后。
3. 视频片段生成后。
4. 在最终组装之前，如果下一步将合并或导出最终影片。

当用户选择**确认并继续**时，将门视为已确认，并立即执行下一步。不要再次要求确认。当用户选择**修改当前结果**时，将后续问题集中在具体可编辑的部分，如样式、持续时间、镜头顺序、对话、第一帧构图或剪辑再生。如果用户已经说了 “继续”、“下一步”、“继续” 或类似的话，跳过卡片直接继续。

## 第 4 步：分配参考图像角色

如果用户提供了参考图像，请在使用前分配明确的角色：
- R 图像：风格和构图锚。继承视觉风格、构图、光线氛围；不要继承特定的面部特征。
- C 图像：角色输入锚。仅继承服装、身材类型和本地身份标志；隔离原始颜色、光线和环境风格。
- P 图像：道具锚。继承形状、材质、穿着、比例关系；隔离原色氛围和场景氛围。
- E 图像：环境锚。仅继承空间布局；最终颜色和灯光来自统一的风格容器。

如果多个引用存在歧义，请用户标记它们。如果可以从上下文推断出角色，标记它们后继续。

## 第 5 步:Shotloom POV 素材

不要创建主角面部素材，而是设计：
- 主人公的本地素材：手、袖子、鞋子、持有物、徽章边缘、伤口、戒指、包带、手电筒、手机边缘。
- 外部人物属性：只有人或生物在主角视野中可见。
- 道具物品：手机、钥匙、门把手、固定电话、身份证章、水瓶、药品、笔记本、撬棍等。
- 场景道具：走廊、出租房间、办公室、车内、楼梯间、乡村房间、废弃商店、工厂、街角。

主人公当地素材的提示模式：

```text
[style container] close-up photo of [hand/shoes/sleeve/local POV asset], [physical style parameters], real-life texture, no studio lighting, no posters, no professional commercial look, no full face of protagonist, no third-person camera.
```

## 第 6 步：分镜Shotloom

每个片段都必须将主角的眼睛视为镜头。推荐表格字段：

| 片段 | 持续时间 | 视角视角 | 可见主角片段 | 外部对象 | 动作阶段 | 镜头运动 | 风格锚 | 声音证据 | 禁忌元素 |
|---|---:|---|---|---|---|---|---|---|---|

分镜规则：
- 使用主观动作:“我垂下目光”、“我推门”、“我的手伸向”、“我的视线被吸引”。
- 摄像机的移动必须来自头部、身体、脚步、手、呼吸或目光的移动。
- 不要写 “摄像机显示主角进入房间”。改写为 “视线穿过门缝移动；我的手握着画框”。
- 不要写 “主人公惊恐的表情”。改写为 “呼吸变得急促；手指收紧；画面颤抖”。

## 第 7 步：反彩票门

在每个剪辑提示词前运行这个检查。

### 视角检查
- 镜头中是否包含主角的第三人称形象？如果是，请重写。
- 主人公的脸是否可见？如果可见，用手、袖子、鞋子、部分反射、呼吸或持有物体作为替代。
- 摄影机真的是主人公的眼睛吗？如果不是，请重写。
- 从这个角度看，主人公的行动是否真实发生？如果不是，请重写。

### 风格一致性检查
- 所有风格词语是否都已转化为光线方向、色温、纹理、颗粒/噪音、材料或空气质量？
- C 和 P 的引用是否与其原始的环境风格分离？
- 定制的情感词语是否被转化为可见的证据？
- 当前的 Clip 是否包含与统一风格容器相冲突的场景色彩词语？如果是这样，请将对象重写为由统一光源照明，而不是堆砌更多形容词。

## 第 8 步：图像和视频提示结构

视频提示词必须包含以下模块：

```text
【Reference Inputs】
- Reference 1 (R / style and composition anchor): inherit [visual style type]; do not inherit [specific face]
- Reference 2 (C / character entry): inherit only [clothing/body/local traits]; isolate [original color/light/environment]
- Reference 3 (E / environment): inherit [spatial layout]; unified color grading comes from [style container]

【Image Container】
[physicalized style container]

【Frame】
first-person POV from [protagonist]; camera is his/her eyes; no external shot of [protagonist]. [scene, external object, visible protagonist fragment, action]

【Light / Texture / Style Lock】
[lighting, color temperature, saturation, contrast, medium texture, air quality]

【Action Phases】
0-2s:
2-5s:
5-8s:

【Camera Movement】
Movement comes from protagonist head, breathing, footstep, hand movement, hesitation, or gaze shift. No external tracking shot.

【Sound Evidence】
Environment sounds, footsteps, fabric friction, breathing, prop sounds, distant voices. No subtitles.

【Negative Hard Locks】
third-person shot, external shot of protagonist, protagonist face, over-the-shoulder shot showing protagonist, selfie angle, drone shot, title card, subtitles, on-screen text.
```

## 第 9 步：片段生成 QC

在每个片段之后，请检查：
- 视角连续性：没有主角面孔、背景、外部跟踪或全知摄像机。
- 风格连续性：饱和度、色彩趋势、颗粒/噪声、空气质量保持一致。
- 动作现实主义：感觉动作是由眼睛、头部、呼吸、步伐和双手驱动的。
- 声音沉浸：动作声音、空间声音、呼吸、环境和稀疏的对话都支持视角。

如果风格出现偏差：
- 不要堆砌风格形容词。
- 加强 R 图像或风格锚。
- 删除相互冲突的颜色词。
- 将相互冲突的物体重新改写为由统一光源照亮的样子。

如果视角中断：
- 重写镜头，使其通过主人公的眼睛可见。
- 将面部表情替换为手、袖子、鞋子、部分反射、目光颤抖和呼吸。

## 第 10 步：组装指导

最终组装应保留以下内容：
- 主人公注意力和情感压力的顺序。
- 空间声音连续性。
- 每条声线、旁白、环境音效或 BGM 层均为单一所有者。
- 没有字幕，没有标题卡，也没有屏幕文本。

如果用户明确要求使用字幕，请解释字幕目前不受支持，并建议稍后在专业编辑软件中添加。

## 触发示例

应该触发：
1. “创建一个第一人称视角短片，让我在午夜回到家，看到有人站在我门后。”
2. “把这个戏剧性的开场变成一个沉浸式的主观摄像机视频。”
3. “在第一人称视角下创建一个视觉水平的雨夜追逐场景。”

不应触发：
1. 创建一个咖啡馆里两个角色之间的正常对话场景。
2. “制作产品开箱展示视频。”
3. 生成一个角色转折表。
