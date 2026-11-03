/**
 * Shotloom Agent 可用的 OpenReel 动作目录。
 *
 * OpenReel 的 Action 联合类型有 100 多种，里面混着 project/create、
 * media/import（存根）、applyEditSnapshot、shader 注册这类内部动作。
 * 这里只暴露"对已打开工程做编辑"的安全动作；参数最终仍由 OpenReel 的
 * ActionExecutor 校验，宿主不自己发明第二套编辑语义。
 *
 * 目录随代码维护；新增动作时同时补一条中文说明和参数提示。
 */
type CatalogAction = {
  type: string;
  description: string;
  params: string;
};

const actions: Array<[string, string, string]> = [
  // 工程 / 画布
  ["project/updateSettings", "更新画布尺寸、帧率等工程设置", "{ width?, height?, frameRate? }（直接放在 params）"],
  ["project/setCanvasBackground", "设置画布背景（颜色或模糊填充）", "{ backgroundFillMode?: 'color'|'blur', layoutBackgroundColor?: string }"],
  ["project/rename", "重命名工程", "{ name: string }"],
  // 轨道
  ["track/add", "新增轨道", "{ trackType: 'video'|'audio'|'image'|'text'|'graphics', position?, name?, role? }"],
  ["track/duplicate", "复制轨道", "{ sourceTrackId: string, position?: number }"],
  ["track/remove", "删除轨道", "{ trackId: string }"],
  ["track/rename", "重命名轨道", "{ trackId: string, name: string }"],
  ["track/reorder", "调整轨道顺序", "{ trackId: string, newPosition: number }"],
  ["track/hide", "显示/隐藏轨道", "{ trackId: string, hidden: boolean }"],
  ["track/lock", "锁定/解锁轨道", "{ trackId: string, locked: boolean }"],
  ["track/mute", "静音/取消静音轨道", "{ trackId: string, muted: boolean }"],
  ["track/solo", "独奏/取消独奏轨道", "{ trackId: string, solo: boolean }"],
  // 片段
  ["clip/add", "向轨道添加媒体片段", "{ trackId, mediaId, startTime?, duration?, inPoint?, outPoint? }"],
  ["clip/remove", "删除片段", "{ clipId: string }"],
  ["clip/restore", "恢复已删除片段", "{ clip: Clip }"],
  ["clip/move", "移动片段到新轨道/时间", "{ clipId, trackId?, startTime? }"],
  ["clip/trim", "调整片段入出点或时长", "{ clipId, startTime?, duration?, inPoint?, outPoint? }"],
  ["clip/trimToPlayhead", "按播放头裁剪片段", "{ clipId: string, playheadTime: number }"],
  ["clip/split", "在指定时间切分片段", "{ clipId: string, time: number }"],
  ["clip/roll", "滚动编辑相邻片段接缝", "{ clipId: string, delta: number }"],
  ["clip/slide", "滑移片段内容（时间线位置不变）", "{ clipId: string, delta: number }"],
  ["clip/slip", "滑动片段内容（入出点变化）", "{ clipId: string, delta: number }"],
  ["clip/rippleDelete", "波纹删除片段并闭合空隙", "{ clipId: string }"],
  ["clip/rippleRestore", "波纹恢复片段", "{ clip: Clip }"],
  ["clip/closeGapBefore", "闭合片段前方空隙", "{ clipId: string }"],
  ["clip/restoreTiming", "恢复片段原始时长/入出点", "{ clipId: string }"],
  ["clip/merge", "合并片段", "{ clipIds: string[] }"],
  ["clip/setSpeed", "设置片段播放速度", "{ clipId: string, speed: number }"],
  ["clip/setReverse", "倒放片段", "{ clipId: string, reversed: boolean }"],
  ["clip/setPitchCorrection", "设置变速时是否保持音高", "{ clipId: string, pitchCorrection: boolean }"],
  ["clip/setBlendMode", "设置片段混合模式", "{ clipId: string, blendMode: string }"],
  ["clip/setBlendOpacity", "设置片段混合不透明度", "{ clipId: string, blendOpacity: number }"],
  ["clip/setChromaKey", "设置抠像参数", "{ clipId: string, chromaKey: object }"],
  ["clip/setColorGrading", "设置调色参数", "{ clipId: string, colorGrading: object }"],
  ["clip/setStabilization", "设置视频稳定", "{ clipId: string, stabilization: object }"],
  ["clip/setEmphasisAnimation", "设置强调动画", "{ clipId: string, emphasisAnimation: object }"],
  ["transform/update", "更新片段变换（位置/缩放/旋转/不透明度）", "{ clipId: string, transform: { position?, scale?, rotation?, opacity?, fitMode? } }"],
  // 音频
  ["audio/setVolume", "设置音频片段音量", "{ clipId: string, volume: number }"],
  ["audio/setFade", "设置音频淡入淡出", "{ clipId: string, fadeIn?: number, fadeOut?: number }"],
  ["audio/addEffect", "添加音频效果", "{ clipId: string, effect: object }"],
  ["audio/updateEffect", "更新音频效果", "{ clipId: string, effectId: string, updates: object }"],
  ["audio/removeEffect", "移除音频效果", "{ clipId: string, effectId: string }"],
  ["audio/toggleEffect", "启用/停用音频效果", "{ clipId: string, effectId: string, enabled: boolean }"],
  ["audio/addAutomation", "添加音量/声像自动化点", "{ clipId: string, parameter: 'volume'|'pan', point: object }"],
  // 视频效果
  ["effect/add", "添加视频效果", "{ clipId: string, effectType: string, params?: object }"],
  ["effect/update", "更新视频效果参数", "{ clipId: string, effectId: string, updates: object }"],
  ["effect/remove", "移除视频效果", "{ clipId: string, effectId: string }"],
  ["effect/toggle", "启用/停用视频效果", "{ clipId: string, effectId: string, enabled: boolean }"],
  ["effect/reorder", "调整效果顺序", "{ clipId: string, fromIndex: number, toIndex: number }"],
  ["effect/setOrder", "设置效果顺序", "{ clipId: string, effectIds: string[] }"],
  ["effect/setStack", "整体替换效果栈", "{ clipId: string, effects: object[] }"],
  // 转场
  ["transition/add", "添加转场", "{ trackId? , clipAId, clipBId, type, duration? }"],
  ["transition/update", "更新转场参数", "{ transitionId: string, updates: object }"],
  ["transition/set", "整体设置转场", "{ trackId?: string, transitions: object[] }"],
  ["transition/remove", "移除转场", "{ transitionId: string }"],
  // 文字 / 图形 / 贴纸
  ["text/create", "创建文字片段", "{ clip: TextClip }"],
  ["text/update", "更新文字内容或样式", "{ clipId: string, updates: object }"],
  ["text/remove", "删除文字片段", "{ clipId: string }"],
  ["shape/create", "创建形状片段", "{ clip: ShapeClip }"],
  ["shape/update", "更新形状片段", "{ clipId: string, updates: object }"],
  ["shape/remove", "删除形状片段", "{ clipId: string }"],
  ["svg/create", "创建 SVG 片段", "{ clip: SVGClip }"],
  ["svg/update", "更新 SVG 片段", "{ clipId: string, updates: object }"],
  ["svg/remove", "删除 SVG 片段", "{ clipId: string }"],
  ["sticker/create", "创建贴纸片段", "{ clip: StickerClip }"],
  ["sticker/update", "更新贴纸片段", "{ clipId: string, updates: object }"],
  ["sticker/remove", "删除贴纸片段", "{ clipId: string }"],
  // 关键帧 / 速度曲线 / 遮罩 / 调色层
  ["keyframe/add", "添加关键帧", "{ clipId: string, keyframe: object }"],
  ["keyframe/update", "更新关键帧", "{ clipId: string, keyframeId: string, updates: object }"],
  ["keyframe/remove", "删除关键帧", "{ clipId: string, keyframeId: string }"],
  ["keyframe/setAll", "整体替换关键帧", "{ clipId: string, keyframes: object[] }"],
  ["speed/setKeyframes", "设置变速关键帧", "{ clipId: string, keyframes: object[] }"],
  ["speed/setRampData", "设置速度曲线", "{ clipId: string, rampData: object }"],
  ["speed/setFreezeFrames", "设置定格帧", "{ clipId: string, freezeFrames: object[] }"],
  ["mask/setAll", "整体设置遮罩", "{ clipId: string, masks: object[] }"],
  ["adjustment/setAll", "设置调整图层", "{ clipId: string, adjustments: object[] }"],
  // 字幕 / 标记 / 媒体
  ["subtitle/add", "添加字幕数据", "{ text: string, startTime: number, endTime: number }；可视字幕使用 captions 轨道的 text/create"],
  ["subtitle/update", "更新字幕", "{ subtitleId: string, updates: object }"],
  ["subtitle/remove", "删除字幕", "{ subtitleId: string }"],
  ["subtitle/replace", "整体替换字幕", "{ subtitles: object[] }"],
  ["subtitle/setAll", "整体设置字幕", "{ subtitles: object[] }"],
  ["subtitle/setStyle", "设置字幕样式", "{ subtitleId: string, style: object }"],
  ["marker/add", "添加时间线标记", "{ time: number, label?: string, color?: string }"],
  ["marker/update", "更新标记", "{ markerId: string, updates: object }"],
  ["marker/remove", "删除标记", "{ markerId: string }"],
  ["media/rename", "重命名素材", "{ mediaId: string, name: string }"],
  ["media/delete", "删除素材", "{ mediaId: string }"],
  // 多机位 / 嵌套序列 / 动效（高级）
  ["multicam/setAll", "整体设置多机位", "{ group: object }"],
  ["multicam/applyEdit", "应用多机位剪辑", "{ edit: object }"],
  ["multicam/restoreEdit", "恢复多机位剪辑", "{ editId: string }"],
  ["nested/setAll", "设置嵌套序列", "{ sequences: object[] }"],
  ["motion/createComposition", "创建动效合成", "{ composition: object }"],
  ["motion/upsertComposition", "新增/更新动效合成", "{ composition: object }"],
  ["motion/removeComposition", "删除动效合成", "{ compositionId: string }"],
  ["motion/insertInstance", "插入动效实例", "{ instance: object }"],
  ["motion/removeInstance", "删除动效实例", "{ instanceId: string }"],
];

export const SHOTLOOM_ACTION_CATALOG = {
  version: 1,
  description:
    "OpenReel 原生动作目录。先调用 video_project_get 读取真实 track/clip/media id，再用 video_project_actions 提交。",
  denylist: [
    "project/create",
    "media/import",
    "project/applyEditSnapshot",
    "project/registerGeneratedShader",
    "project/removeGeneratedShader",
    "subtitle/import",
  ],
  actions: actions.map<CatalogAction>(([type, description, params]) => ({
    type,
    description,
    params,
  })),
};
