# 视觉风格和电影质量

在创建样式圣经、角色卡、场景卡、分镜框架、图像提示或动画提示时，请使用这个参考。

样式指导服从于主要技能的批准范围、故障分类、共享预算和停止规则。视觉润饰不是授权进行另一种渲染、三种变体、低规格测试或升级。保持选定的分辨率，直到明确的更改获得批准；不要将批准的样式或参考作为自动技术重试进行更改。

## 全局视图

默认为 20 世纪 90 年代末至 21 世纪初的室内电视情景喜剧，不是任何知名节目的复制品。使用正面视平面电视摄影和温暖的多摄像机摄影棚覆盖。家应该感觉舒适、杂乱，并真正生活在其中：角色们放松、争论、欢笑，并在日常混乱中生存下来。这种外观是早期电视广播图像，而不是商业产品电影、声望剧或海报。

## 摄像机和照明

从解释厨房/客厅关系的中幅大师作品开始，然后切换到中近距离对话覆盖、两人越肩拍摄和面部反应特写。大师作品推荐使用 28-35 毫米镜头，对话作品推荐使用 40-50 毫米镜头，反应作品推荐使用 65-85 毫米镜头。使用固定或轻微跟踪多个摄像机位置；喜剧源于入场、道具误用、持续动作、眼线、停顿和反应。

使用宽大、柔和的工作室键盘和填充、窗户填充、天花板灯和实用灯具。保持照明图在整个覆盖范围内稳定，使人脸和手部可读，不使用硬边缘灯、遮光阴影或广告风格的镜面高光。保持稳定的曝光、开放式黑色和可控的高光。

## 调色板和制作设计

如果没有更强的用户或品牌调色板，可以使用蜂蜜木、焦糖棕、奶油白、粉尘粉、砖红和低饱和度青色。保持图像温暖和自然饱和，但不要使用霓虹灯或青橙色大片级别。

Shotloom 可重复使用的厨房/客厅，配备蜂蜜棕色橱柜、奶油色墙壁或瓷砖，略有磨损但干净的家用电器，一台冰箱，里面放置几块磁铁和家庭照片，普通杯子、餐巾、调味瓶、盘子、桌布、地毯、照片，以及一个位于场景中心的主角道具。从门到柜台和桌子，留出清晰的演员路径。只有在增加深度而不遮挡脸部或手部时，才使用轻型前景遮挡物，如桌缘、椅背或植物。

## 角色设计

创造简单、易读、可重复的日常服装，并保持清晰的轮廓。在全身、双人和特写镜头中，保持头发、衣柜、配饰和经常使用的手持道具稳定。角色卡片是身份来源；时期造型层绝不能覆盖用户提供的身份。不要复制命名的情景喜剧角色、演员、精确的服装组合、标志、对白或签名道具。

## 纹理和完成

将以下内容放在提示的材料/完成部分，而不是堆砌空洞的质量条款：

`soft broadcast sharpness, subtle lens bloom, gentle halation around practical lights, fine uniform analog-video grain, restrained chroma noise, natural skin pores, matte painted wood, slightly worn laminate, cotton and denim weave, soft highlight roll-off, open shadows, stable white balance, consistent exposure, mild motion blur during movement, no artificial HDR`

为了获得更强烈的老式电视反应，请仅在需要时添加：

`slight late-1990s broadcast softness, mild 4:3-era television color response adapted to the requested aspect ratio, delicate tape-like grain without scanlines, very subtle chroma bleed, no heavy VHS distortion`

## 首先使用 CUT MAP

在视觉散文之前，请先绘制切换地图。每个镜头都必须指定时间码、镜头 ID、取景、焦距、摄影机位置、运动、主导动作、动作峰值和切换点。例如：

`00:00-00:03.0｜S01 master｜medium-wide, 28–35mm, eye-level fixed Camera A｜character enters and notices the hero prop｜hard cut on eye-line. 00:03.0-00:05.0｜S02 two-shot｜40–50mm, fixed Camera B, tiny lateral move｜hand reaches to stop the prop｜hard cut on action. 00:05.0-00:06.5｜S03 reaction｜65–85mm, fixed Camera C, short push-in｜closed-mouth awkward reaction｜hard cut on reaction.`

## H3 多镜头时间线

对于 H3 全参考提示，首先放置完整的 CUT MAP，然后是状态:`follow S01→S02→S03 in exact time order; one dominant action and one clear camera position per segment; never turn the clip into storyboard panels, a contact sheet, or picture-in-picture.`在每个剪辑中，保留 180 度轴线、屏幕左/右位置、眼线、主角道具状态、灯光方向和曝光。使用硬剪辑或有动机的 J 剪辑/L 剪辑；不要使用随机变焦、平移或华丽的过渡来掩盖连续性问题。

## 负面提示

`boxed composition, storyboard panels, contact sheet, frame-within-frame, UI, poster typography, letterbox bars, pristine catalog kitchen, luxury showroom, dark prestige-drama lighting, harsh rim light, neon colors, cyan-orange blockbuster grade, glossy HDR, plastic skin, waxy face, oversharpening halos, dead black shadows, clipped highlights, exposure pumping, white-balance shift, crawling texture, unstable fabric pattern, random lens change, random zoom, whip pan, unmotivated handheld shake, reversed screen direction, broken eyelines, identity drift, changed wardrobe, duplicate props, missing hero prop, extra fingers, extra limbs, copied TV show characters, copied actor likeness, copied set layout, generated logo, generated subtitles, watermark`

## 连续性检查清单

保持演员路径、180°轴线、屏幕位置、眼线、手部占用、衣柜、灯光图、道具状态、门窗状态和家具布局稳定。在支持的情况下，使用出口尾部框架作为下一个镜头的连续性锚点。保持对白简短且可听，在突出部分和反应出现之前要有停顿。

将视觉检查记录为通过/失败/未经镜头/版本/时间证据验证。呈现的标识或连续性缺陷是内容失败，而不是执行失败。仅提出受影响的镜头/参考变更；检查实际的邻近依赖项，而不自动重新生成它们。新的候选项需要在替换批准的版本之前进行审核。

对于低规格探针、放大或高规格再生，请遵循主要技能和 h3 全参考区分并共享计数。不要将确定性放大称为原生高规格再生，也不要仅仅从文件尺寸推断新的细节。增益/对齐/重混故障不是视觉故障，也不会在这里触发新的图像。
