---
name: visual-prompt-craft
description: 为 Shotloom 场景、道具和分镜图片编写可直接送入模型的具体提示词。
metadata: {"category":"video","version":13}
---

# 视觉提示词精修

只处理用户请求的提示词；作为辅助 Skill 时，主 Skill 负责剧本事实、画布操作和生成执行。参考图必须通过真实输入边传入，姓名、手写 @名称或提示词声明不能代替媒体输入。未生成的上游图是待验证设计，不称为模型已见参考。模型参数、输入槽位和声音能力服从当前模型目录。

- 写场景、道具、单镜静帧或多格图：按需读 references/image-direction.md。
- 写单镜视频、逐镜估时、视频参考素材职责或跨镜连续性：加载 `short-drama-video-prompt`，按需读取它的 `short-drama-video-prompt/references/prompt-recipes.md`、`short-drama-video-prompt/references/shotloom-binding.md` 或 `short-drama-video-prompt/references/h3-routing.md`。
- 人物身份板的版式和服装细节由 character-board 指导。

成品图片提示词写可观察的主体、位置、姿态、摄影机、空间地标、光线和参考职责，不以“电影感”“华服”“神态复杂”代替这些事实。单格图只定格一个时刻；同镜头时间板与镜头板分别写动作顺序和叙事构图；跨镜头总览仅在明确请求时制作。视频提示词和视频模型路由统一由 `short-drama-video-prompt` 负责。

写入节点后读回 prompt、模式、时长和输入边；只有真实生成并看过结果，才声称画面或视频通过核验。
