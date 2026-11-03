---
name: digital-drawing-timelapse
description: 将一张数字绘画成品图转成连续的十五秒绘画过程延时视频，突出创作过程和画面还原。
metadata: {"category":"动画","version":10002,"defaultEnabled":false}
---

# 数字绘图延时

使用一个已完成的字符或数字艺术参考图像，以及存储在本技能中的固定默认提示词，生成一个 15 秒的字符创建延迟。默认使用MiniMax-H3;如果用户明确选择了其他模型，请先检查其功能，并在兼容时遵循该选择。如果生成失败，请重试一次，确定诊断原因，然后切换到另一个兼容的可用模型，而不是反复强制使用同一模型。

固定的默认提示词是步骤 3 中的完整英语提示词。每当用户使用一个图像调用`/digital-drawing-timelapse`并且没有提供替换提示词时，请自动使用该提示词，不要更改。相同的提示词对于后续每一代都保持默认，并且不得随着代数、先前结果或会话历史记录的变化而变化。

用户可以显式地提供一个不同的完整视频提示，仅覆盖该调用的默认值。替换提示绝不能修改存储的默认提示。

在每次视频生成之前，显示一个卡片样式的弹出窗口，要求用户选择并确认输出分辨率、宽高比和音频处理。这些是执行设置，而不是对固定提示词的编辑。如果附加了音频文件，将其作为选项包含在同一张卡片中，并询问是否将其用作声音轨道。在用户提交卡片确认之前，不要开始生成。如果用户拒绝音频，则在没有音频轨道的情况下生成。

这项技能是一种直接的生成途径。不要检查、附加或使用原始流程视频、界面截图、二级样式参考、分镜、脚本、音频或其他创意素材。不要添加界面重建规则、软件布局要求、缩略图限制、光标形状变化、摄像机更改、音频说明或其他未出现在用户提示中的创意约束。

参考图像不是开场画面。它仅用于指导最终角色的外观、比例、服装、发型、颜色、独特特征以及提示明确要求的其他特征。生成的视频必须在所选视频功能允许的范围内尽可能紧跟用户的提示。

## 步骤 1:接受图像并解决提示

需要一个完成的艺术作品参考图像。

使用第一个提供的图像作为图像参考。不要将另一个素材重新解释为布局或样式参考。如果图像缺失，请询问它，而不是创建一个。

提示分辨率是确定的：

- 如果用户使用图像调用`/digital-drawing-timelapse`，但没有替换提示词，则自动使用步骤 3 中完整的固定提示词。
- 每一代都要逐字逐句地使用固定提示词。永远不要重写、缩短、扩展、重新排序或添加限制。
- 不要继承前几代的提示变更、先前的结果、附加的流程视频、界面截图或会话历史记录。
- 只有显式提供的新完整提示词才会覆盖当前调用的默认值；它不会更新存储的默认值。

参考图像仅用作固定提示词或用户的显式替换提示词所描述的最终视觉目标。

## 第 2 步：确认执行设置

在开始视频生成之前，显示一个卡片风格的确认弹出窗口，其中包含以下可选选项：

- 输出分辨率，无预选默认值
- 输出宽高比，建议为 16:9，但需要确认
- 音频处理：无音频或音频合成
- 如果选择了音频合成并且有音频附件可用，是否使用该附件音频作为原声带

卡必须有明确的确认操作。在应用已确认的执行设置时，保持固定提示词不变。在用户确认卡之前，不要开始视频生成。当提示词是存储的默认值时，不要再次要求用户确认。如果用户拒绝、编辑或留下任何未解决的必要选择，请等待并不要生成。

## 第 3 步：直接生成

直接从已解析的提示词和单个参考图像生成一个视频。

当没有提供替换提示时，解决的提示是固定的 STEP 3 提示。不要执行单独的界面分析阶段，使用进程视频参考，添加技能以前的界面规则，或者添加或删除任何创意指令。默认提示必须在重复的代际中保持相同。

如果提供了显式的替换提示词，请仅将该提示词用于当前调用，不要更改固定默认值。保留活动提示词中规定的任何持续时间、宽高比、分辨率、音频、摄像头、接口、光标行为、时序、样式或约束。如果活动提示词未指定输出宽高比，请使用 16:9。如果未指定音频，请不要指定音频。

使用提供的完成作品作为参考输入，而不是作为第一帧关键帧。提示仍然是流程、界面、运动、摄像机和最终呈现的主要指导。

## 第 4 步：内部提示模板

以下英文提示词是不可变的默认生成提示词。每当用户使用一个图像调用`/digital-drawing-timelapse`且没有替换提示词时，都会自动使用它。不要添加、删除、重写或重新排序任何指令。在所有生成计数和重复调用期间，它保持不变。只有显式的替换提示词可以用于一次调用。

```text
Create a 15-second fast-paced character creation timelapse inside a professional digital drawing and character design interface.

Use the provided character reference only as the final target for the character’s appearance, proportions, clothing, hairstyle, colors and distinctive features. The process must visibly start from a completely blank canvas and reconstruct the referenced character from scratch.

Show a visible mouse cursor actively controlling the entire creation process. Every major visual change should feel caused by cursor interaction with the UI.

0:00-0:02
Start on a blank white or neutral canvas inside a clean professional drawing interface. The cursor quickly creates the first loose construction lines, head shape, body proportions and basic pose using rough sketch strokes.

0:02-0:05
Accelerate into detailed sketching. The cursor rapidly defines the face, hair, anatomy, clothing silhouette, accessories and characteristic features of the referenced character. Use believable drawing gestures, short strokes, selections, transforms and occasional undo corrections.

0:05-0:08
The rough sketch becomes clean line art. The cursor switches tools, adjusts brush size and cleans the silhouette. Unnecessary construction lines disappear while precise facial details, clothing folds and small design elements are added.

0:08-0:11
Rapid coloring phase. The cursor selects regions and fills the character with the correct colors from the reference. Show quick palette selections, color picking, layer changes, clipping masks and brush passes. Add shadows, highlights and material details in fast succession.

0:11-0:13
Rendering and polish. The cursor adds final lighting, hair detail, skin shading, fabric texture, reflections and small accent details. Briefly zoom into important areas such as the face or costume while refining them, then zoom back out.

0:13-0:15
The interface clears unnecessary guides and panels. The finished character is shown fully rendered and closely matching the provided reference. End with the cursor making one final small adjustment, then stop on a clean full-character presentation.

STYLE:
High-speed digital art timelapse, polished professional character-design workflow, believable drawing software UI, smooth cursor movement, rapid but readable actions, clean layers and tool changes, no random text, no fake dialogue, no unrelated popups.

MOTION:
The entire 15 seconds should feel continuously productive. Avoid long pauses. Compress several minutes or hours of drawing into an energetic timelapse while keeping the progression clearly readable: blank canvas → rough sketch → clean line art → flat colors → shading → polished final character.

CAMERA:
Primarily screen-recording style with subtle digital zooms and pans following the cursor and active drawing area. Keep the UI stable and readable. Do not use cinematic cuts outside the software interface.

IMPORTANT:
The character must not appear instantly or through a single magical transformation. Every stage should visibly build upon the previous one through cursor-driven drawing, editing, coloring and rendering actions.
```

## 第 5 步：音频和输出规则

返回一个生成的视频及其准确的输出文件名。除非用户单独请求，否则不要创建单独的计划文档、分镜、界面参考、字幕文件或附加图像。

保留确认的持续时间、分辨率和宽高比。仅使用 15 秒和 16:9 作为此模板的默认值。分辨率没有默认值，并且必须始终在生成之前明确选择和确认。音频默认关闭，但用户确认的附加音频文件可以合成或合成为声音轨道。未经明确确认，请勿使用附加的音频文件。音频选择不得修改固定的默认提示词。

如果生成失败，只需对报告的错误进行必要的实质性修正即可重试，同时保留用户提示和参考图像。不要仅仅为了强制重试而增加创造性约束。
