---
name: micro-expression-video-generator
description: 将角色图、剧本或情绪短语转化为细腻可信、可执行的微表情指导。
metadata: {"category":"专业影视","version":10004,"defaultEnabled":false}
---

# 微表情性能

当用户希望角色的情感表现感觉更自然、层次化和电影般的时候，可以使用这个技能。

## 输入模式

- 图像模式：一个要继续的角色图像。
- 脚本模式**一个脚本、镜头提示或分镜，仅增强表演层。
- **情感短语模式**一个简短的感觉或场景提示。

## 参考素材

使用捆绑的参考素材进行详细的写作系统：

- `references/source-notes.md`
- `references/performance-prototype-library.md`
- `references/emotion-route-library.md`
- `references/muscle-dispatch-library.md`
- `references/video-prompt-guardrails.md`
- `references/tempo-density-guide.md`
- `references/climax-reset-patterns.md`

## 工作流程

1. 阅读用户输入，保留现有的角色、场景、对白和摄像机意图。
2. 如果没有，请询问拍摄时间；如果没有，请询问表演强度。
3. 起草一个简洁的提示包并提交给审核。只有在确认后才能继续使用可选的性能剪辑。最好使用MiniMax H3，因为它支持所需的图像、音频和动作控制工作流程。如果另一个用户选择的模型满足确认的要求，请尊重它；如果不满足，请解释性能差异，并让用户选择一个等价的模型。

## 限制

这项技能侧重于表演提示和表演方向。它不会取代完整的脚本编写、面部表情调整、口型同步编辑或最终合成。

## 参考文档：references/climax-reset-patterns.md

高潮重置模式——高压微表情结构。包含：核心模式、10-12 秒特写的 2 秒密度结构、有用的行动提示、提高纪律性等。需要该主题的规则、模板或检查项时，用 `skill` 工具读取本文件，不要凭记忆补写。

## 参考文档：references/emotion-route-library.md

情感路线库——150 条情感路线。包含：爱与失去、悲伤与克制、愤怒与压抑、恐惧与伪装等。需要该主题的规则、模板或检查项时，用 `skill` 工具读取本文件，不要凭记忆补写。

## 参考文档：references/muscle-dispatch-library.md

肌肉调度链库——70 个可见的行动链。包含：眼睑视线、眉心额部、嘴角下颌、喉咙呼吸等。需要该主题的规则、模板或检查项时，用 `skill` 工具读取本文件，不要凭记忆补写。

## 参考文档：references/performance-prototype-library.md

性能原型库——130 个表演原型。包含：克制内伤、亲密拉扯、社交面具、惊惧警觉等。需要该主题的规则、模板或检查项时，用 `skill` 工具读取本文件，不要凭记忆补写。

## 参考文档：references/source-notes.md

资料来源：微表情表现提示的公开参考素材。包含：参考资料、这项技能的提取原则、使用规则等。需要该主题的规则、模板或检查项时，用 `skill` 工具读取本文件，不要凭记忆补写。

## 参考文档：references/tempo-density-guide.md

速度密度指南——避免慢动作微表情视频。包含：从创作者提示示例中观察到的源模式、关键规则、建议的时序密度、保持正常速度的动词选择等。需要该主题的规则、模板或检查项时，用 `skill` 工具读取本文件，不要凭记忆补写。

## 参考文档：references/video-prompt-guardrails.md

视频提示护栏——视频中的微表情表现。包含：1.镜头连续性锁定、2. 情绪极性锁定、3. 口角安全规则、4.微表情时序结构等。需要该主题的规则、模板或检查项时，用 `skill` 工具读取本文件，不要凭记忆补写。
