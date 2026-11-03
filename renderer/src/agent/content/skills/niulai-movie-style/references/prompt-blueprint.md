# 提示蓝图和参数

使用此参考将源代码分析和用户选择转换为一个可执行文件
图像编辑提示词。替换变量；不要将 schema 粘贴到生成工具中。

## 参数 schema

```yaml
skill: niu-lai-translator
preset: primitive_folk_cgi | bright_folk_cgi | sunlit_game_map | community_cgi_stage | rough_night_render
reconstruction_strength: medium | high | extreme
anchor_lock: strict | high
identity_lock: medium | high
detail_budget: very_low | low
geometry: primitive_low_poly | visibly_low_poly
polygon_budget: extremely_low | very_low
face_geometry: clumsy_asymmetric | strongly_faceted | angular_readable
gaze_quality: stiff_misaligned | crude_readable | source_faithful
proportion_fidelity: deliberately_broken | loosely_source_based
pose_lock: semantic_action_only | broad_pose
pose_quality: stiff_failed_rig | crude_rigid | source_faithful
collision_quality: visible_clipping | imperfect_contact | clean
clipping_count: 1_to_3 | sparse | none
texture_resolution: very_low | low
material_model: diffuse_only_mismatched | flat_unlit | crude_lambert
texture_repetition: obvious | strong | moderate
asset_reuse: heavy | strong | moderate
background_detail: sparse | reduced
lighting: naive_single_light | flat_stage_light | hard_awkward_daylight | crude_point_lights
palette: source_anchored_blunt | source_anchored_saturated
post_effects: none | subtle_capture_noise | mild_color_fringe
text_mode: none | preserve_exact | user_text
ratio: source_ratio | 1:1 | 3:4 | 4:3 | 9:16 | 16:9
```

## 生产提示模板

```text
Rebuild the supplied image as a primitive, visibly low-budget 3D scene. This is
not a blur filter, compression pass, or fashionable low-poly illustration.

HARD ANCHOR LOCK — Preserve [subject count/types], [left-to-right arrangement],
[semantic action or relationship], [crop/camera/perspective], [depth layers], [scene
category], [major props], and [three to six dominant color blocks]. Preserve what
the subjects are doing, not their exact joint angles, anatomical silhouette, body
ratios, or clean mesh separation. Recognition should come from meaning and layout.

DETAIL BUDGET — Use [preset], [reconstruction_strength], and [detail_budget].
Remove subtle facial acting, hair strands, fingers, embroidery, microtexture,
decorative architecture, small signs, and incidental set dressing.

TOPOLOGY — Rebuild forms with [geometry] and [polygon_budget]. Use a handful of
large awkward planes and primitive masses, hard normals, block joints, wedge hands,
crude paws/hooves, and thick hair clumps/cards. Do not preserve smooth outlines by
covering them with many small facets. No silhouette-smoothing support loops.

PROPORTION FAILURE — Use [proportion_fidelity]. Deliberately depart from source
proportions while preserving category and identity anchors: mismatch limb lengths,
head/body ratio, neck length, torso width, joint size, muzzle size, paw/hoof scale,
and animal body mass. Prefer awkward assembled parts over elegant caricature.

POSE AND RIGGING FAILURE — Use [pose_lock] and [pose_quality]. Preserve the semantic
action but alter exact pose. Lock the torso, rotate joints on one crude axis, lift
shoulders too high, kink elbows, keep wrists straight, plant feet, weaken balance,
float hands, and remove natural counter-pose and weight transfer.

COLLISION FAILURE — Use [collision_quality] with [clipping_count] readable local
intersections chosen from actual contact zones in this source: [source-tailored
clipping locations]. Allow sleeve/elbow, upper-arm/shoulder, arm/garment, hand/sleeve,
hand/held-prop, fur/harness, or adjacent-body penetration. Do not hide faces, erase
whole limbs, expose bodies, imply injury, or clip every contact.

FACES AND GAZE — For faces use [face_geometry] and [gaze_quality]: simple
reused eye construction, unequal eye sizes, slightly off-center pupils, imperfect
gaze convergence, stiff lids, block noses, flat mouth slits, and frozen expressions.
Keep broad intent readable without professional animation polish.

MATERIALS, TEXTURES, AND REUSE — Use [material_model] with diffuse/base color as the
dominant or only channel. Remove coherent PBR, normal/displacement, subsurface,
clearcoat, layered fabric/fur, and realistic reflection models. Mix flat matte areas
with a few wrongly shiny patches and inconsistent response between nearby objects.
Use [texture_resolution] maps with [texture_repetition] tiling, seams, UV stretching,
mirrored details, inconsistent scale, noisy pixels, and crude painted shadows. Use [asset_reuse]: visibly reuse
a tiny library of skin, eye, hair, cloth, fur, scale, plank, bark, grass, stone,
wall, and ground assets as relevant.

BACKGROUND — Set [background_detail]. Keep only essential setting masses. Reuse
two or three primitive background models repeatedly with minimal variation; remove
unique clutter and decorative detail.

LIGHT AND RENDER — Use [lighting]: one blunt directional or overhead-front light
plus weak flat ambient fill. Allow clipped highlights, muddy dark patches, hard
low-resolution shadows, weak contact, and inconsistent nearby exposure. Use weak
antialiasing, limited filtering, basic shadow maps, [post_effects] kept secondary,
and no professional scene separation.

OUTPUT — [ratio]. [text instruction].

DO NOT — [source-tailored prohibitions], exact premium reproduction, correct
source-faithful proportions, natural weight transfer, clean collision everywhere,
attractive aligned eyes, refined facial acting, smooth subdivision, dense small
facets masquerading as low-poly, clean designer facets,
unique high-resolution materials, rich detailed background, rim light, beauty
light, three-point lighting, volumetric beams, cinematic depth, PBR, glossy toys,
photorealism, modern game polish, darkness as a shortcut, VHS/CRT/glitch/mosaic,
random text, UI, characters, props, logos, or cow traits absent from the source.
```

## 紧凑提示词

仅当编辑器可靠地跟踪源图像时才使用：

```text
Rebuild the supplied image as exaggeratedly failed primitive folk CGI. Lock subject
count/type, broad arrangement, semantic action, camera, scene category, props, and
color blocks; release exact pose, silhouette, anatomy, and mesh separation. Use an
extremely low polygon budget made of a handful of awkward masses, not many small
facets. Deliberately distort human/animal proportions. Make the torso rigid, joints
single-axis, shoulders too high, elbows kinked, wrists straight, balance poor, and
contact weak. Add one to three local visible intersections at source-evidenced contact
zones such as sleeve/elbow, arm/shoulder, hand/prop, garment/torso, or fur/harness;
keep faces and whole limbs visible. Use stiff unequal eyes with slightly misaligned
pupils, crude face wedges, thick hair cards, wedge hands, diffuse-only materials,
dead-flat surfaces mixed with a few wrongly shiny patches, tiny blurry maps, obvious
repeated tiling, and a tiny background asset library copied many times.
Light everything with one blunt overhead-front light plus weak flat ambient: clipped
faces, muddy eye sockets, hard cheap shadows, uneven exposure, no rim or cinematic
separation. Weak antialiasing and filtering only. No correct source-faithful anatomy,
natural rigging, clean collision everywhere, polished low-poly art, detailed sets,
unique clean textures, professional facial acting, PBR, beauty light, horror, VHS,
text, UI, new subjects, props, logos, cows, or horns.
```

## 负面约束块

```text
Avoid: fine likeness; source-faithful proportions; natural counter-pose; correct
weight transfer; flexible realistic joints; perfectly separated garments and limbs;
attractive aligned eyes; expressive professional facial animation; correct smooth
anatomy; dense small facets; clean triangular mosaics; rounded toy forms;
coherent PBR materials; normal/displacement maps; subsurface skin; realistic fabric,
fur, reflections, or layered roughness; unique high-resolution textures; hidden
tiling; procedural background variety;
rich set dressing; cinematic lighting; three-point light; rim light; soft bounce;
global illumination; volumetric fog; depth of field; premium game graphics;
photorealism; darkness or horror as a shortcut; heavy blur; large pixelation;
JPEG damage; VHS; CRT; glitch; invented text, UI, logos, characters, or props.
```

## 文本处理

- `none`（默认）:省略随机符号、字幕、水印和界面文本。
- `preserve_exact`:引用准确的源代码文本，并逐个字符检查。
- `user_text`:仅包含用户提供的确切文本；不要编造任何内容。

## 源代码配方

### 肖像或群组

用`community_cgi_stage`表示群组，用`primitive_folk_cgi`表示单个人物。
锁定计数、间距、语义动作、头发质量、服装类别和色块。
重复使用眼睛、皮肤、头发和布料地图。扭曲比例、锁定躯干、扭曲肢体
关节，并在接触存在时添加局部袖子/手臂/肩部剪裁。

### 动物场景

使用`primitive_folk_cgi`。锁定物种、数量、语义动作、标记和组成。
改变身体比例、腿长、爪/蹄比例、颈部和口鼻比例，以及
平衡。在合理的情况下，使用刚性关节和局部毛皮/马具或肢体/身体夹具。
重复使用皮毛/比例尺/眼睛地图，减少面部细节和背景变化。

### 建筑或景观

使用`sunlit_game_map`。锁定视角、地平线、地形、块状和开口。
重复使用一个小型模块库，以及可见的瓷砖墙、地面、草地、树木和岩石地图。

### 仅照明后续跟进

锁定所有几何形状、材料、姿势和构图。将仅照明替换为
`naive_single_light`:钝顶前方方向，弱环境，剪影面部，
模糊的褶皱、硬的低分辨率阴影、微弱的接触和不均匀的曝光。
