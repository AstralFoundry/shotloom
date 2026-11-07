import { t } from '../../i18n/index.ts';

/**
 * 表情调节盘：5×5 的情绪坐标 + 每格对应的表情描述。
 *
 * 横向由亲近到疏离（intimacy 2 → -2），纵向由激动到平静（arousal 2 → -2）。
 * 坐标只用来排版和持久化；真正发给模型的是这一格的中文描述。
 */

export type EmotionAxis = -2 | -1 | 0 | 1 | 2;

export interface ImageEmotionPreset {
  id: string;
  label: string;
  intimacy: EmotionAxis;
  arousal: EmotionAxis;
  prompt: string;
}

export type FaceRect = { x: number; y: number; width: number; height: number };

export const DEFAULT_FACE_RECT: FaceRect = Object.freeze({ x: 0.3, y: 0.12, width: 0.4, height: 0.48 });

const GRID: ImageEmotionPreset[][] = [
  [
    { id: 'ecstatic', label: t('imageEmotion.preset.ecstatic'), intimacy: 2, arousal: 2, prompt: '放声大笑，眼睛弯起，脸颊上扬，喜悦外放但不夸张变形' },
    { id: 'elated', label: t('imageEmotion.preset.elated'), intimacy: 1, arousal: 2, prompt: '明亮的笑容，眼神有光，情绪高涨而自然' },
    { id: 'surprised', label: t('imageEmotion.preset.surprised'), intimacy: 0, arousal: 2, prompt: '眼睛睁大、眉毛抬起、嘴唇微张，是意外而不是恐惧' },
    { id: 'shocked', label: t('imageEmotion.preset.shocked'), intimacy: -1, arousal: 2, prompt: '双眼圆睁、眉毛高抬、面部短暂僵住' },
    { id: 'terrified', label: t('imageEmotion.preset.terrified'), intimacy: -2, arousal: 2, prompt: '眼睛圆睁、眉毛上扬、面部紧绷，恐惧但不扭曲五官' },
  ],
  [
    { id: 'cheerful', label: t('imageEmotion.preset.cheerful'), intimacy: 2, arousal: 1, prompt: '轻松开怀的笑，眼角带笑，情绪明亮' },
    { id: 'hopeful', label: t('imageEmotion.preset.hopeful'), intimacy: 1, arousal: 1, prompt: '目光向前，表情明亮而期待' },
    { id: 'focused', label: t('imageEmotion.preset.focused'), intimacy: 0, arousal: 1, prompt: '眼神集中，眉眼稳定，嘴唇轻收' },
    { id: 'alert', label: t('imageEmotion.preset.alert'), intimacy: -1, arousal: 1, prompt: '眉眼收紧，视线警觉，嘴部闭合' },
    { id: 'tense', label: t('imageEmotion.preset.tense'), intimacy: -2, arousal: 1, prompt: '嘴唇抿紧，眉间用力，情绪压住' },
  ],
  [
    { id: 'tender', label: t('imageEmotion.preset.tender'), intimacy: 2, arousal: 0, prompt: '柔和亲近，轻微微笑，眼神放松' },
    { id: 'gentleSmile', label: t('imageEmotion.preset.gentleSmile'), intimacy: 1, arousal: 0, prompt: '克制的浅笑，表情自然，不露齿' },
    { id: 'neutral', label: t('imageEmotion.preset.neutral'), intimacy: 0, arousal: 0, prompt: '中性放松，没有夸张情绪，五官保持原有特征' },
    { id: 'restrained', label: t('imageEmotion.preset.restrained'), intimacy: -1, arousal: 0, prompt: '压住情绪，嘴角略收，表情克制' },
    { id: 'distant', label: t('imageEmotion.preset.distant'), intimacy: -2, arousal: 0, prompt: '冷淡疏离，目光平直，面部放松' },
  ],
  [
    { id: 'reassured', label: t('imageEmotion.preset.reassured'), intimacy: 2, arousal: -1, prompt: '安心放松，眉眼舒展，嘴角柔和' },
    { id: 'relieved', label: t('imageEmotion.preset.relieved'), intimacy: 1, arousal: -1, prompt: '如释重负，眉眼放松，像轻轻呼出一口气' },
    { id: 'tired', label: t('imageEmotion.preset.tired'), intimacy: 0, arousal: -1, prompt: '眼睑下垂，表情疲惫，面部肌肉松弛' },
    { id: 'disappointed', label: t('imageEmotion.preset.disappointed'), intimacy: -1, arousal: -1, prompt: '嘴角轻垂，眼神低垂，轻微失落' },
    { id: 'sad', label: t('imageEmotion.preset.sad'), intimacy: -2, arousal: -1, prompt: '内眉抬起，嘴角下垂，眼神哀伤' },
  ],
  [
    { id: 'content', label: t('imageEmotion.preset.content'), intimacy: 2, arousal: -2, prompt: '安静满足，闭口轻笑，呼吸平稳' },
    { id: 'calm', label: t('imageEmotion.preset.calm'), intimacy: 1, arousal: -2, prompt: '平静松弛，面部没有紧绷感' },
    { id: 'cold', label: t('imageEmotion.preset.cold'), intimacy: 0, arousal: -2, prompt: '冷淡克制，目光平直，几乎没有表情' },
    { id: 'quietHurt', label: t('imageEmotion.preset.quietHurt'), intimacy: -1, arousal: -2, prompt: '强忍心伤，嘴唇压紧，眼神黯淡' },
    { id: 'despair', label: t('imageEmotion.preset.despair'), intimacy: -2, arousal: -2, prompt: '眉眼下沉，面部失去张力，深重的绝望' },
  ],
];

export const EMOTION_PRESETS: readonly ImageEmotionPreset[] = Object.freeze(GRID.flat());
export const DEFAULT_EMOTION_PRESET: ImageEmotionPreset = EMOTION_PRESETS[12] as ImageEmotionPreset;

export function findEmotionPreset(presetId: string): ImageEmotionPreset | null {
  return EMOTION_PRESETS.find((preset) => preset.id === presetId) ?? null;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

/** 脸部框以图片比例保存，窗口大小和节点缩放下都不会丢精度。 */
export function normalizeFaceRect(value: unknown): FaceRect {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const number = (input: unknown, fallback: number) => {
    const parsed = Number(input);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const width = Math.min(0.9, Math.max(0.08, number(source.width, DEFAULT_FACE_RECT.width)));
  const height = Math.min(0.9, Math.max(0.08, number(source.height, DEFAULT_FACE_RECT.height)));
  const x = Math.min(1 - width, clamp01(number(source.x, DEFAULT_FACE_RECT.x)));
  const y = Math.min(1 - height, clamp01(number(source.y, DEFAULT_FACE_RECT.y)));
  return { x, y, width, height };
}

export function faceRectPixels(rect: FaceRect, imageWidth: number, imageHeight: number) {
  const left = Math.round(rect.x * imageWidth);
  const top = Math.round(rect.y * imageHeight);
  return {
    left,
    top,
    width: Math.max(1, Math.min(imageWidth - left, Math.round(rect.width * imageWidth))),
    height: Math.max(1, Math.min(imageHeight - top, Math.round(rect.height * imageHeight))),
  };
}

/** 表情只改脸，蒙版用比脸框略大的椭圆，避免方形硬边切到脖子。 */
export function emotionMaskEllipse(rect: { left: number; top: number; width: number; height: number }) {
  const expandX = rect.width * 0.22;
  const expandTop = rect.height * 0.28;
  const expandBottom = rect.height * 0.2;
  const width = rect.width + expandX * 2;
  const height = rect.height + expandTop + expandBottom;
  return {
    centerX: rect.left + rect.width / 2,
    centerY: rect.top - expandTop + height / 2,
    radiusX: Math.max(1, width / 2),
    radiusY: Math.max(1, height / 2),
  };
}

export type EmotionBlendshapes = Record<string, number>;

/**
 * 把 5×5 的坐标折成 ARKit 表情权重。中性格返回空对象，让脸部回到默认形态。
 * 这是纯数学映射：同一格每次得到同一组权重，预览和生成提示互不依赖。
 */
export function emotionBlendshapes(preset: ImageEmotionPreset): EmotionBlendshapes {
  if (preset.intimacy === 0 && preset.arousal === 0) return {};
  const warmth = Math.max(0, preset.intimacy / 2);
  const distance = Math.max(0, -preset.intimacy / 2);
  const activation = Math.max(0, preset.arousal / 2);
  const calm = Math.max(0, -preset.arousal / 2);
  const surprise = Math.max(0, activation * (1 - Math.abs(preset.intimacy) / 3));
  const sadness = Math.max(0, calm * (0.35 + distance * 0.65));
  const smile = warmth * (0.24 + activation * 0.48 + calm * 0.12);
  const tension = distance * (0.16 + activation * 0.46 + calm * 0.22);
  const shapes: EmotionBlendshapes = {
    browInnerUp: clamp01(surprise * 0.58 + sadness * 0.42),
    browDown_L: clamp01(tension * 0.7),
    browDown_R: clamp01(tension * 0.7),
    browOuterUp_L: clamp01(activation * 0.22 + surprise * 0.32),
    browOuterUp_R: clamp01(activation * 0.22 + surprise * 0.32),
    eyeBlink_L: clamp01(calm * 0.28),
    eyeBlink_R: clamp01(calm * 0.28),
    eyeSquint_L: clamp01(smile * 0.34 + tension * 0.28),
    eyeSquint_R: clamp01(smile * 0.34 + tension * 0.28),
    eyeWide_L: clamp01(activation * (0.16 + surprise * 0.48 + distance * 0.18)),
    eyeWide_R: clamp01(activation * (0.16 + surprise * 0.48 + distance * 0.18)),
    cheekSquint_L: clamp01(smile * 0.42),
    cheekSquint_R: clamp01(smile * 0.42),
    noseSneer_L: clamp01(tension * activation * 0.35),
    noseSneer_R: clamp01(tension * activation * 0.35),
    jawOpen: clamp01(activation * (0.06 + surprise * 0.34)),
    mouthPucker: clamp01(distance * calm * 0.12),
    mouthClose: clamp01(calm * 0.18 + tension * 0.2),
    mouthSmile_L: clamp01(smile),
    mouthSmile_R: clamp01(smile),
    mouthFrown_L: clamp01(sadness * 0.54 + distance * calm * 0.14),
    mouthFrown_R: clamp01(sadness * 0.54 + distance * calm * 0.14),
    mouthDimple_L: clamp01(warmth * 0.22),
    mouthDimple_R: clamp01(warmth * 0.22),
    mouthShrugUpper: clamp01(sadness * 0.18),
    mouthPress_L: clamp01(tension * 0.48 + calm * distance * 0.18),
    mouthPress_R: clamp01(tension * 0.48 + calm * distance * 0.18),
    mouthStretch_L: clamp01(activation * distance * 0.24),
    mouthStretch_R: clamp01(activation * distance * 0.24),
  };
  return Object.fromEntries(Object.entries(shapes).filter(([, value]) => value > 0.01));
}

export function composeEmotionPrompt(preset: ImageEmotionPreset, note = ''): string {
  const base = [
    '只修改人物的面部表情，保持身份、五官、发型、服装、姿势、背景、构图、光线和色彩不变。',
    '不要改变人物数量和空间关系，不要添加道具、文字、水印或边框，不要重绘整张画面。',
    `目标表情：${preset.label}。${preset.prompt}。`,
  ].join('\n');
  const extra = note.trim();
  return extra ? `${base}\n补充要求：${extra}` : base;
}
