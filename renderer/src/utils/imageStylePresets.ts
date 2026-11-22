import { getLocale, t } from '../i18n/index.ts';
import imageTools from '../assets/open-ai-canvas/image-tools.json' with { type: 'json' };
import { isRecord } from './typeGuards.ts';

export interface ImageStylePreset {
  id: string;
  label: string;
  prompt: string;
  category?: string;
  cover?: string;
}

export interface CustomImageStyle extends ImageStylePreset {
  category: ImageStyleCategory;
}

export const IMAGE_STYLE_CATEGORIES = [
  'period', 'city', 'decade', 'life', 'science_fiction', 'type', 'poetic', 'animation', 'drawing', 'myth', 'other',
] as const;
export type ImageStyleCategory = (typeof IMAGE_STYLE_CATEGORIES)[number];

export function imageStyleCategory(value: unknown): ImageStyleCategory | undefined {
  return IMAGE_STYLE_CATEGORIES.find(category => category === value);
}

export function normalizeCustomImageStyle(input: unknown): CustomImageStyle | undefined {
  if (!isRecord(input) || typeof input.id !== 'string' || !input.id.startsWith('custom:')) return;
  const label = typeof input.label === 'string' ? input.label.trim() : '';
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!label || !prompt) return;
  const category = imageStyleCategory(input.category) ?? 'other';
  const cover = typeof input.cover === 'string' && input.cover.length <= 300_000
    && /^data:image\/(webp|png);base64,[\w+/]+=*$/u.test(input.cover) ? input.cover : undefined;
  return { id: input.id, label, prompt, category, ...(cover ? { cover } : {}) };
}

export function normalizeImageStyleLibrary(input?: unknown) {
  const library = isRecord(input) ? input : {};
  const custom = Array.isArray(library.custom)
    ? library.custom.map(normalizeCustomImageStyle).filter((style): style is CustomImageStyle => !!style)
    : [];
  return { custom };
}

const NO_IMAGE_STYLE: ImageStylePreset = {
  id: '',
  label: t("ui.imageStylePresets.label.4af03da7"),
  prompt: '',
};

// Existing projects keep their original prompts. These styles are no longer selectable.
const LEGACY_IMAGE_STYLE_PRESETS: readonly ImageStylePreset[] = [
  {
    id: 'cinematic-narrative',
    label: t("ui.imageStylePresets.label.ab032496"),
    prompt: '电影分镜关键帧，主体动作与空间关系清晰，景别和视线方向明确，层次光影，真实材质，构图便于衔接前后镜头。',
  },
  {
    id: 'character-design',
    label: t("ui.imageStylePresets.label.338affe3"),
    prompt: '影视角色设定图，人物外形、发型、服装结构和标志性细节清晰，比例稳定，材质可信，背景克制，方便后续镜头保持角色一致。',
  },
  {
    id: 'scene-concept',
    label: t("ui.imageStylePresets.label.6e5031ae"),
    prompt: '影视场景概念图，前中后景层次明确，空间尺度可信，环境材质和光线方向统一，保留人物活动与镜头调度空间，建立清晰美术基调。',
  },
  {
    id: 'commercial-key-visual',
    label: t("ui.imageStylePresets.label.53d2dd36"),
    prompt: '商业广告主视觉，核心主体突出，卖点一眼可读，光线和材质精致，具有品牌记忆点，构图预留标题、标识和裁切安全区域。',
  },
  {
    id: 'product-studio',
    label: t("ui.imageStylePresets.label.2c0a0c3f"),
    prompt: '高质感产品棚拍，产品比例准确，轮廓和功能细节清晰，材质反射受控，背景干净，精确布光，适合广告与电商成片。',
  },
  {
    id: 'documentary-still',
    label: t("ui.imageStylePresets.label.912bca54"),
    prompt: '影视纪实剧照，自然环境光，真实肤色与生活化细节，人物状态可信，轻微抓拍感，避免过度修饰，保持现场氛围。',
  },
  {
    id: 'animation-keyframe',
    label: t("ui.imageStylePresets.label.200acd39"),
    prompt: '动画制作关键帧，动作轮廓清晰，姿态有张力，角色与背景分层明确，色彩关系稳定，构图适合继续制作连续镜头。',
  },
  {
    id: 'poster-layout',
    label: t("ui.imageStylePresets.label.57ccdb21"),
    prompt: '影视宣传海报构图，视觉焦点明确，层级清晰，人物与场景关系有张力，预留片名、主演信息和发行标识的排版安全区域。',
  },
  {
    id: 'series-continuity',
    label: t("ui.imageStylePresets.label.b80cfa40"),
    prompt: '连续镜头一致性优先，严格保持角色外形、服装、道具、场景结构、时间与光线方向稳定，只改变当前镜头要求的动作、景别和机位。',
  },
];

const english = getLocale() === 'en-US';
const REFERENCE_IMAGE_STYLE_PRESETS: readonly ImageStylePreset[] = imageTools.styles.map(preset => ({
  ...preset,
  label: english ? preset.id.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ') : preset.label,
}));
const STYLES_BY_ID = new Map([...REFERENCE_IMAGE_STYLE_PRESETS, ...LEGACY_IMAGE_STYLE_PRESETS].map(style => [style.id, style]));

export function listImageStylePresets(): readonly ImageStylePreset[] {
  return REFERENCE_IMAGE_STYLE_PRESETS;
}

export function getImageStylePreset(id: unknown, snapshot?: unknown): ImageStylePreset {
  const custom = normalizeCustomImageStyle(snapshot);
  if (custom && custom.id === id) return custom;
  return (typeof id === 'string' && STYLES_BY_ID.get(id)) || NO_IMAGE_STYLE;
}

export function applyImageStylePreset(prompt: unknown, presetId: unknown, snapshot?: unknown) {
  const base = String(prompt || '').trim();
  const style = getImageStylePreset(presetId, snapshot);
  if (!style.prompt) return base;
  const fragment = LEGACY_IMAGE_STYLE_PRESETS.some(preset => preset.id === style.id)
    ? `制作预设：${style.prompt}` : style.prompt;
  return base ? `${base}\n\n${fragment}` : fragment;
}
