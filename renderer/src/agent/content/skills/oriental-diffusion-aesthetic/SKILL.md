---
name: oriental-diffusion-aesthetic
description: 将上传主体转成保留轮廓与色域的东方弥散静图，确认后延展为克制的固定机位循环视频。
metadata: {"category":"动画","version":10004,"defaultEnabled":false}
---

# 东方扩散美学

当用户想要将上传的产品、人物、物体、动物或角色图像转换为东方扩散静止图像时，首先使用这个技能，然后可选择将接受的静止图像扩展为短视频。默认流程是静止图像优先，用户确认次之，视频最后。如果用户只想要静止图像，则在静止图像之后停止。

## 第一步：摄入比和宽高比

1. 如果用户没有提供源图像，请要求图像进行转换。
2. 如果提供了多个图像，请确定哪个是主要来源，哪个是可选参考；这个技能是源优先的。
3. 在生成静止图像之前请求宽高比。默认建议:`3:4`。
4. 如果用户没有指定尺寸，请询问；如果用户说 “默认”，请使用`3:4`。

## 第 2 步：分析源主题

在编写提示词之前，请确定源图像中最重要的锚点。

首先保存：

- 主题类别和计数;
- 轮廓和构图;
- 面部印象、姿势、服装、配饰、血管结构、标志或图案;
- 源代码中已经存在的清晰可见的内部色域;
- 哪些背景信息必须保留，哪些应该简化。

一般规则：

- 对于产品/容器：保留比例、功能结构、装饰和识别标志;
- 对于人物/角色/动物：保留面部印象、轮廓以及签名服装或配件;
- 如果来源已经具有强烈的内部色块或图案，请将这些作为后续分层和循环的基础。

## 第 3 步：静态图像提示内核

静止图像不应该看起来像一张写实的照片或普通的插图。它应该成为一张更加平面、诗意、中心化、象征性的东方扩散海报。

### 核心静止图像规则

- 保持主体居中，形成清晰、连续、平滑的外部轮廓，如同一个容器状的图形标记;
- 保持柔和的内部结构，但不要将其变成真正的照明或摄影，也不要使其太重；使扩散体稍微明亮一些，更清晰，更扁平，更抽象；减少局部细节;
- 不要在静止图像提示词中使用循环、波动、继电器、外部、闪烁或音乐语言;
- 仅使用源图像色域中已经可见的颜色；不要引入外来色调;
- 如果源图像只有几种清晰的颜色，请保持在这些颜色及其明暗变化范围内;
- 保持背景黑暗、清洁、克制，并使用呼吸负空间进行纸质纹理处理，但不要添加背景扩散、雾化或脏污渐变;
- 使用边缘光晕作为主体和背景之间清晰但克制的轮廓分隔；它应该是可见和支撑的，但不要依赖微小的镜面细节来创造真实的玻璃外观；保持边缘和内部更加简洁，减少材料特定性;
- 请将提示重点放在效果和结构上，而不是任何特定的工艺品名称、先前的图像名称或历史参考物体；如果用户想要更强烈的发光雾气、向外分层的扩散、更清晰的边缘光、抽象或类似封印的特征，请仅描述该视觉结构；避免添加装饰细节或产品摄影的真实感;
- 整体感觉应该结合现代东方船舶海报、旧书压花和温和的氛围图形，同时强调安静、通风和负空间。

### 静止图像编译模板

建立如下静止图像提示词：

```text
Transform the uploaded image of [subject] into a contemporary Eastern diffusion paper poster, aspect ratio [ratio].
Preserve the [3-6 most important recognition anchors], while removing realism, photographic lighting, and ordinary illustration shading.
Reconstruct the subject as a centered, flat, symbolic, vessel-like silhouette with clean, continuous, smooth outer contours.
The inside should become a large, center-out layered diffusion body: first a brighter core area, then a simplified transition band, then a more visible outer halo, like glowing haze forming a wave-like push inside the form; keep the body flatter and more abstract.
Keep soft internal structure, but only use the source image's existing color gamut; do not introduce new colors. If the source only has green and yellow, stay within deep green, light green, deep yellow, and light yellow, and compress any complexity into a few large color regions. Use fewer local details and larger color blocks.
Keep the background dark, clean, and paper-textured with breathing negative space; the background itself should stay non-diffused, but the subject halo should feel more distinct against it.
Add a restrained round Eastern emblem, seal-like symbol, or museum-card layout; use only user-provided text if any, and do not invent ad copy. Keep symbols and typography minimal.
The final image should feel like a modern Eastern vessel poster combined with gentle atmospheric graphics, not a realistic photo, a normal cartoon, an ink painting, or cyber neon; prefer abstraction over detail.
```

## 第 4 步：生成静止图像

使用默认图像生成路径创建第一个静止图像。

- 首先保持主体完整;
- 然后将其扁平化为东方扩散风格;
- 不要仅仅为了风格而丢失源代码身份;
- 不要创造源代码中没有的颜色。

生成静止图后，将其展示给用户，并询问是否继续进入视频。

## 第 5 步：确认是否继续观看视频

如果用户只想要静止图像，请在此停止。

如果用户想要视频，请继续。

在生成视频之前，请确认持续时间。默认建议:4 秒。如果用户没有说明持续时间，可以要求 4、5、6 秒，或者自定义。

## 第 6 步：视频扩展

仅从接受的静止图像构建视频，不要将静止图像模板整体复制到视频提示词中；将视频提示词限制在运动、循环和音乐范围内。

### 视频运动规则

- 固定摄影机，完全静止;
- 主体轮廓保持不变，没有位移或变形;
- 背景保持静止、干净和克制;
- 只有内部颜色会移动;
- 颜色必须保持在源图像自身的可见光谱内；不要添加新的颜色;
- 如果源图像只有两种清晰的颜色，请保持在这些颜色及其明暗变化范围内;
- 运动应该是继电器式的向外波：当一个彩色波到达边缘时，下一个波立即从内部开始，因此运动在一次传递后永不停止;
- 图像应该给人一种颜色不断从内部向外涌动的感觉，重复出现，然后交给下一个循环。

### 音乐规则

- 不要调用单独的音乐模型;
- 直接在视频提示词内键入音乐提示词;
- 使用视频模型的原生音频功能;
- 默认情况下，除非用户明确要求静音，否则音乐/氛围将被打开。

### 音乐提示模板

```text
Minimal, moderately paced, delicate electronic ambience with a clear pulse, soft synth bed, a few grainy percussion ticks or crisp accents, no vocals, no big drums, no strong melody, quiet, restrained, loopable, synchronized with the subject's relay-style outward color waves; each wave reaching the edge should slightly lift the music, and the next wave should begin immediately.
```

### 视频提示编译模板

视频提示应仅描述运动、循环和音乐，而不应重复静止图像的构图语言；容器般的轮廓和纸质纹理的静止图像已经在接受的图像中建立。

```text
Fixed camera. The frame stays completely still, with no zoom, dolly, pan, orbit, or rotation. The subject outline stays unchanged, with no displacement or deformation. Only the internal color changes. The color must stay inside the source image's existing gamut, with no new hues added. The motion should feel like relay-style waves continuously expanding outward: when one wave reaches the edge, the next wave starts immediately inside and pushes outward again, creating a continuous repeating outward flow, not flicker, not return, and not a single pass. The background stays dark, still, and clean, without background diffusion. Write the music prompt directly into the video prompt, using minimal, moderately paced, delicate electronic ambience with a clear pulse, synchronized to the outward color waves.
```

## 第 7 步：故障恢复

如果结果不正确，请按以下顺序进行修正：

- **新颜色出现了**:将调色板锁定回源图像的现有色域，并仅允许明暗变化;
- **它闪烁而不是向外流动**:切换到继电器风格的向外波，强调下一波在到达边缘后立即开始;
- **它太慢了**:增加内部波切换的密度;
- **背景看起来脏或移动**:消除背景扩散，保持干净的暗基;
- **主体失去清晰度**:减少装饰并恢复到容器般的象征性轮廓。

## 边界

仅将此技能用于单个东方扩散静止图像及其可选的短视频扩展。

不要将其用于：

- 全品牌广告;
- KOC/对白/开箱视频;
- 多镜头故事电影;
- 普通的修饰、背景替换或剪辑工作;
- 不相关的视频编辑。
