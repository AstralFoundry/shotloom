import { t } from '../i18n/index.ts';
export interface ImageStylePreset {
  id: string;
  label: string;
  description: string;
  icon: string;
  tone: string;
  prompt: string;
}

export const IMAGE_STYLE_PRESETS: readonly ImageStylePreset[] = Object.freeze([
  {
    id: '',
    label: t("ui.imageStylePresets.label.4af03da7"),
    description: t("ui.imageStylePresets.description.9330c5ab"),
    icon: 'sliders',
    tone: '#b8bcc2',
    prompt: '',
  },
  {
    id: 'cinematic-narrative',
    label: t("ui.imageStylePresets.label.ab032496"),
    description: t("ui.imageStylePresets.description.eed4bc75"),
    icon: 'film',
    tone: '#697482',
    prompt: '电影分镜关键帧，主体动作与空间关系清晰，景别和视线方向明确，层次光影，真实材质，构图便于衔接前后镜头。',
  },
  {
    id: 'character-design',
    label: t("ui.imageStylePresets.label.338affe3"),
    description: t("ui.imageStylePresets.description.77ce9ca2"),
    icon: 'user',
    tone: '#9a7d74',
    prompt: '影视角色设定图，人物外形、发型、服装结构和标志性细节清晰，比例稳定，材质可信，背景克制，方便后续镜头保持角色一致。',
  },
  {
    id: 'scene-concept',
    label: t("ui.imageStylePresets.label.6e5031ae"),
    description: t("ui.imageStylePresets.description.ed545b39"),
    icon: 'image',
    tone: '#668a83',
    prompt: '影视场景概念图，前中后景层次明确，空间尺度可信，环境材质和光线方向统一，保留人物活动与镜头调度空间，建立清晰美术基调。',
  },
  {
    id: 'commercial-key-visual',
    label: t("ui.imageStylePresets.label.53d2dd36"),
    description: t("ui.imageStylePresets.description.8ac7f554"),
    icon: 'spark',
    tone: '#c98655',
    prompt: '商业广告主视觉，核心主体突出，卖点一眼可读，光线和材质精致，具有品牌记忆点，构图预留标题、标识和裁切安全区域。',
  },
  {
    id: 'product-studio',
    label: t("ui.imageStylePresets.label.2c0a0c3f"),
    description: t("ui.imageStylePresets.description.8b8139f1"),
    icon: 'box',
    tone: '#9a8470',
    prompt: '高质感产品棚拍，产品比例准确，轮廓和功能细节清晰，材质反射受控，背景干净，精确布光，适合广告与电商成片。',
  },
  {
    id: 'documentary-still',
    label: t("ui.imageStylePresets.label.912bca54"),
    description: t("ui.imageStylePresets.description.cf29c0aa"),
    icon: 'camera',
    tone: '#778c72',
    prompt: '影视纪实剧照，自然环境光，真实肤色与生活化细节，人物状态可信，轻微抓拍感，避免过度修饰，保持现场氛围。',
  },
  {
    id: 'animation-keyframe',
    label: t("ui.imageStylePresets.label.200acd39"),
    description: t("ui.imageStylePresets.description.2522df5e"),
    icon: 'play',
    tone: '#788bd1',
    prompt: '动画制作关键帧，动作轮廓清晰，姿态有张力，角色与背景分层明确，色彩关系稳定，构图适合继续制作连续镜头。',
  },
  {
    id: 'poster-layout',
    label: t("ui.imageStylePresets.label.57ccdb21"),
    description: t("ui.imageStylePresets.description.80290ace"),
    icon: 'grid',
    tone: '#b55f58',
    prompt: '影视宣传海报构图，视觉焦点明确，层级清晰，人物与场景关系有张力，预留片名、主演信息和发行标识的排版安全区域。',
  },
  {
    id: 'series-continuity',
    label: t("ui.imageStylePresets.label.b80cfa40"),
    description: t("ui.imageStylePresets.description.4a3a7a3a"),
    icon: 'workflow',
    tone: '#6f829b',
    prompt: '连续镜头一致性优先，严格保持角色外形、服装、道具、场景结构、时间与光线方向稳定，只改变当前镜头要求的动作、景别和机位。',
  },
]);

export function getImageStylePreset(id: unknown): ImageStylePreset {
  return IMAGE_STYLE_PRESETS.find((preset) => preset.id === String(id || '')) || IMAGE_STYLE_PRESETS[0] as ImageStylePreset;
}

export function applyImageStylePreset(prompt: unknown, presetId: unknown) {
  const base = String(prompt || '').trim();
  const stylePrompt = getImageStylePreset(presetId).prompt;
  if (!stylePrompt) return base;
  return base ? `${base}\n\n制作预设：${stylePrompt}` : `制作预设：${stylePrompt}`;
}
