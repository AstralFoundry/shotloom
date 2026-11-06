import { t } from '../../i18n/index.ts';

/**
 * 图片节点的「机位 / 光线」编辑参数与提示词合成。
 *
 * 这是一份纯数据契约：面板只负责把拖拽与滑杆写进参数，节点只保存参数，
 * 出图前由这里把参数翻成模型能执行的指令。参数和提示词必须由同一处派生，
 * 否则重新打开面板改一个角度时，节点里旧的提示词不会跟着变。
 */

export type ImageRecipeKind = 'angle' | 'lighting';

export interface ImageAngleParams {
  /** 水平环绕：-180 正后方，0 正面，正值向右环绕。 */
  horizontalAngle: number;
  /** 垂直俯仰：-60 仰拍，0 平视，60 俯拍。 */
  pitchAngle: number;
  /** 机位距离：1 最近，10 最远，3 以下按近景处理。 */
  cameraDistance: number;
  /** 广角与否只改变透视强度，不改变环绕角度。 */
  wideAngle: boolean;
}

export interface ImageLightingOptions {
  /** 主光方位角 0–359，0 为正前方，90 为右侧。 */
  azimuth: number;
  /** 主光俯仰角 -90–90，正值从上方打，负值从下方打。 */
  elevation: number;
  /** 亮度 0–100，50 为不改变曝光。 */
  brightness: number;
  rimLight: boolean;
  stylePresetId: string;
  smartMode: boolean;
  smartDescription: string;
  /** 光色，默认白色代表不加色偏。 */
  lightColor: string;
  /** 用户可改的提示词骨架，占位符由 applyLightingPromptTemplate 替换。 */
  promptTemplate: string;
}

export interface ImageAngleRecipe {
  kind: 'angle';
  params: ImageAngleParams;
}

export interface ImageLightingRecipe {
  kind: 'lighting';
  params: ImageLightingOptions;
}

export type ImageRecipe = ImageAngleRecipe | ImageLightingRecipe;

export const IMAGE_RECIPE_VERSION = 1;

export const DEFAULT_ANGLE_PARAMS: ImageAngleParams = Object.freeze({
  horizontalAngle: 45,
  pitchAngle: 0,
  cameraDistance: 4.8,
  wideAngle: false,
});

export const ANGLE_HORIZONTAL_RANGE = Object.freeze({ min: -180, max: 180 });
export const ANGLE_PITCH_RANGE = Object.freeze({ min: -60, max: 60 });
export const ANGLE_DISTANCE_RANGE = Object.freeze({ min: 1, max: 10 });

export interface AnglePreset {
  id: 'custom' | 'front' | 'left' | 'right' | 'back' | 'top' | 'bottom';
  label: string;
  horizontalAngle: number;
  pitchAngle: number;
}

export const ANGLE_PRESETS: readonly AnglePreset[] = Object.freeze([
  { id: 'custom', label: t('imageRecipe.angle.preset.custom'), horizontalAngle: DEFAULT_ANGLE_PARAMS.horizontalAngle, pitchAngle: 0 },
  { id: 'front', label: t('imageRecipe.angle.preset.front'), horizontalAngle: 0, pitchAngle: 0 },
  { id: 'left', label: t('imageRecipe.angle.preset.left'), horizontalAngle: -90, pitchAngle: 0 },
  { id: 'right', label: t('imageRecipe.angle.preset.right'), horizontalAngle: 90, pitchAngle: 0 },
  { id: 'back', label: t('imageRecipe.angle.preset.back'), horizontalAngle: 180, pitchAngle: 0 },
  { id: 'top', label: t('imageRecipe.angle.preset.top'), horizontalAngle: 0, pitchAngle: 60 },
  { id: 'bottom', label: t('imageRecipe.angle.preset.bottom'), horizontalAngle: 0, pitchAngle: -60 },
]);

export function anglePresetId(params: Pick<ImageAngleParams, 'horizontalAngle' | 'pitchAngle'>): AnglePreset['id'] {
  return ANGLE_PRESETS.find((preset) => (
    preset.id !== 'custom'
    && preset.horizontalAngle === params.horizontalAngle
    && preset.pitchAngle === params.pitchAngle
  ))?.id ?? 'custom';
}

/** 景别文案同时服务面板读数与提示词，避免两处各定一次阈值。 */
export function angleDistanceLabel(cameraDistance: number): string {
  if (cameraDistance <= 3) return t('imageRecipe.angle.distance.near');
  if (cameraDistance >= 7) return t('imageRecipe.angle.distance.far');
  return t('imageRecipe.angle.distance.medium');
}

export interface LightPosition {
  id: 'left' | 'top' | 'right' | 'front' | 'bottom' | 'back';
  label: string;
  azimuth: number;
  elevation: number;
}

export const LIGHT_POSITIONS: readonly LightPosition[] = Object.freeze([
  { id: 'left', label: t('imageRecipe.lighting.position.left'), azimuth: 270, elevation: 0 },
  { id: 'top', label: t('imageRecipe.lighting.position.top'), azimuth: 0, elevation: 80 },
  { id: 'right', label: t('imageRecipe.lighting.position.right'), azimuth: 90, elevation: 0 },
  { id: 'front', label: t('imageRecipe.lighting.position.front'), azimuth: 0, elevation: 0 },
  { id: 'bottom', label: t('imageRecipe.lighting.position.bottom'), azimuth: 0, elevation: -80 },
  { id: 'back', label: t('imageRecipe.lighting.position.back'), azimuth: 180, elevation: 0 },
]);

export interface LightingStylePreset {
  id: string;
  label: string;
  /** 预设缩略图的基色；用 CSS 渐变代替图片资产，避免多带一组二进制素材。 */
  tone: string;
  prompt: string;
}

export const LIGHTING_STYLE_PRESETS: readonly LightingStylePreset[] = Object.freeze([
  {
    id: 'overexposed',
    label: t('imageRecipe.lighting.preset.overexposed'),
    tone: '#d8c4a4',
    prompt: '过曝胶片质感，高调照明，高光轻微溢出，柔和漫射光，复古胶片色调',
  },
  {
    id: 'blueBacklight',
    label: t('imageRecipe.lighting.preset.blueBacklight'),
    tone: '#1c3f63',
    prompt: '戏剧性逆光，冷蓝色轮廓光，暗部压深，主体边缘留出细窄高光',
  },
  {
    id: 'rembrandt',
    label: t('imageRecipe.lighting.preset.rembrandt'),
    tone: '#6b4522',
    prompt: '伦勃朗布光，45 度侧前方主光，面部三角光斑，明暗对比强烈，古典肖像质感',
  },
  {
    id: 'cyberpunk',
    label: t('imageRecipe.lighting.preset.cyberpunk'),
    tone: '#4a1147',
    prompt: '赛博朋克霓虹照明，青品红双色光，合成感辉光，湿润反射，未来都市氛围',
  },
  {
    id: 'sunset',
    label: t('imageRecipe.lighting.preset.sunset'),
    tone: '#8a3a12',
    prompt: '黄金时刻夕照，暖橙侧逆光，长阴影，胶片暖色偏，浪漫氛围',
  },
  {
    id: 'mysterious',
    label: t('imageRecipe.lighting.preset.mysterious'),
    tone: '#14141c',
    prompt: '低调黑色电影布光，大面积深阴影，只保留关键轮廓与眼神光，高反差静谧',
  },
  {
    id: 'goldenHour',
    label: t('imageRecipe.lighting.preset.goldenHour'),
    tone: '#8a6a12',
    prompt: '黄金时刻柔和暖光，眼神光清晰，轻微体积光与耀斑，皮肤通透',
  },
  {
    id: 'nolanGrey',
    label: t('imageRecipe.lighting.preset.nolanGrey'),
    tone: '#22333a',
    prompt: '冷灰去饱和调色，IMAX 质感，青色阴影与中性高光，克制的高反差',
  },
]);

export const LIGHT_POSITION_RANGE = Object.freeze({ azimuth: { min: 0, max: 359 }, elevation: { min: -90, max: 90 } });

/**
 * 默认骨架是提示词内容而不是界面文案，所以固定为这一份，不跟随界面语言。
 * {{...}} 段落为空时会被丢掉，用户删掉一行等于这次不描述它。
 */
export const DEFAULT_LIGHTING_PROMPT_TEMPLATE = [
  '{{consistency}}',
  '{{preset}}',
  '{{smart}}',
  '{{direction}}',
  '{{brightness}}',
  '{{rimLight}}',
  '{{lightColor}}',
  '{{meta}}',
].join('\n');

export const DEFAULT_LIGHTING_OPTIONS: ImageLightingOptions = Object.freeze({
  azimuth: 0,
  elevation: 0,
  brightness: 50,
  rimLight: false,
  stylePresetId: '',
  smartMode: true,
  smartDescription: '',
  lightColor: '#ffffff',
  promptTemplate: DEFAULT_LIGHTING_PROMPT_TEMPLATE,
});

/**
 * 提示词骨架的占位符。面板只展示这一段清单，替换逻辑只在这里实现，
 * 用户在模板里删掉某一项就表示这次不想描述它。
 */
export const LIGHTING_PROMPT_PLACEHOLDERS = Object.freeze([
  'consistency',
  'preset',
  'smart',
  'direction',
  'brightness',
  'rimLight',
  'lightColor',
  'meta',
] as const);

export type LightingPromptPlaceholder = (typeof LIGHTING_PROMPT_PLACEHOLDERS)[number];

const LIGHTING_CONSISTENCY_PROMPT = [
  '这是对参考图的打光编辑：场景、人物、动作、服装、背景保持不变，只改变光线。',
  '下面的描述说的是光如何落在主体上，不是要新增到画面里的物体。',
  '不要在画面中添加灯具、聚光灯、灯架、反光板、柔光箱、火把、蜡烛或任何摄影器材。',
  '保持输入图中的人物身份、面部、服装、发型、姿态和背景布局。',
  '画面中若有多人，保持人数和空间关系不变。',
  '只改变光照方向、光色、亮度、阴影、对比和氛围。',
].join('');

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

export function normalizeAngleParams(value: unknown): ImageAngleParams {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    horizontalAngle: Math.round(clampNumber(source.horizontalAngle, ANGLE_HORIZONTAL_RANGE.min, ANGLE_HORIZONTAL_RANGE.max, DEFAULT_ANGLE_PARAMS.horizontalAngle)),
    pitchAngle: Math.round(clampNumber(source.pitchAngle, ANGLE_PITCH_RANGE.min, ANGLE_PITCH_RANGE.max, DEFAULT_ANGLE_PARAMS.pitchAngle)),
    cameraDistance: Math.round(clampNumber(source.cameraDistance, ANGLE_DISTANCE_RANGE.min, ANGLE_DISTANCE_RANGE.max, DEFAULT_ANGLE_PARAMS.cameraDistance) * 10) / 10,
    wideAngle: pickBoolean(source.wideAngle, DEFAULT_ANGLE_PARAMS.wideAngle),
  };
}

export function normalizeLightingOptions(value: unknown): ImageLightingOptions {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const presetId = pickString(source.stylePresetId, '');
  const lightColor = pickString(source.lightColor, DEFAULT_LIGHTING_OPTIONS.lightColor);
  return {
    azimuth: Math.round(clampNumber(source.azimuth, LIGHT_POSITION_RANGE.azimuth.min, LIGHT_POSITION_RANGE.azimuth.max, DEFAULT_LIGHTING_OPTIONS.azimuth)),
    elevation: Math.round(clampNumber(source.elevation, LIGHT_POSITION_RANGE.elevation.min, LIGHT_POSITION_RANGE.elevation.max, DEFAULT_LIGHTING_OPTIONS.elevation)),
    brightness: Math.round(clampNumber(source.brightness, 0, 100, DEFAULT_LIGHTING_OPTIONS.brightness)),
    rimLight: pickBoolean(source.rimLight, DEFAULT_LIGHTING_OPTIONS.rimLight),
    stylePresetId: LIGHTING_STYLE_PRESETS.some((preset) => preset.id === presetId) ? presetId : '',
    smartMode: pickBoolean(source.smartMode, DEFAULT_LIGHTING_OPTIONS.smartMode),
    smartDescription: typeof source.smartDescription === 'string' ? source.smartDescription.slice(0, 2000) : DEFAULT_LIGHTING_OPTIONS.smartDescription,
    lightColor: isHexColor(lightColor) ? lightColor : DEFAULT_LIGHTING_OPTIONS.lightColor,
    promptTemplate: pickString(source.promptTemplate, DEFAULT_LIGHTING_OPTIONS.promptTemplate),
  };
}

/** 读取节点上已保存的编辑参数；形状不对就当作没有，面板回到默认值。 */
export function readImageRecipe(value: unknown): ImageRecipe | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as { kind?: unknown; params?: unknown };
  if (source.kind === 'angle') return { kind: 'angle', params: normalizeAngleParams(source.params) };
  if (source.kind === 'lighting') return { kind: 'lighting', params: normalizeLightingOptions(source.params) };
  return null;
}

/** 写进节点前统一走归一化，避免面板传入越界值后落库。 */
export function createImageRecipe(kind: ImageRecipeKind, params: unknown): ImageRecipe {
  return kind === 'angle'
    ? { kind: 'angle', params: normalizeAngleParams(params) }
    : { kind: 'lighting', params: normalizeLightingOptions(params) };
}

function angleHorizontalPhrase(horizontalAngle: number): string {
  if (horizontalAngle === 0) return '正面视角';
  if (horizontalAngle === 180 || horizontalAngle === -180) return '背面视角';
  return horizontalAngle > 0 ? `向右环绕 ${horizontalAngle}°` : `向左环绕 ${Math.abs(horizontalAngle)}°`;
}

function anglePitchPhrase(pitchAngle: number): string {
  if (pitchAngle === 0) return '水平平视';
  return pitchAngle > 0 ? `向下俯视 ${pitchAngle}°` : `向上仰视 ${Math.abs(pitchAngle)}°`;
}

/**
 * 重新生成一个新机位，而不是把原图做透视变形——这是多角度与原图裁剪、
 * 缩放的根本区别，所以身份锁定与「只改机位」写进提示词正文。
 */
export function composeAnglePrompt(params: ImageAngleParams): string {
  const normalized = normalizeAngleParams(params);
  const lens = normalized.wideAngle ? '广角镜头，加强空间纵深与边缘透视' : '标准镜头，透视自然';
  return [
    '以参考图为唯一身份与场景依据，重新生成同一主体在新机位下的画面：保持人物身份、五官、发型、服装、道具、场景结构、材质与整体风格一致，只改变摄影机的位置和取景。',
    `当前机位：${angleHorizontalPhrase(normalized.horizontalAngle)}，${anglePitchPhrase(normalized.pitchAngle)}，机位距离 ${normalized.cameraDistance.toFixed(1)}（${angleDistanceLabel(normalized.cameraDistance)}），${lens}。`,
    '不要只做透视变形或镜像翻转，不要新增人物、道具或改变背景布局，不要改变主体数量与空间关系。',
  ].join('\n');
}

/** 光照方向翻成自然语言；只有数字角度模型读不懂，所以这里不复述角度。 */
export function describeLightDirection(azimuth: number, elevation: number): string {
  const normalizedAzimuth = ((Math.round(azimuth) % 360) + 360) % 360;
  if (elevation >= 60) return '主光来自正上方，强烈的顶光从头顶向下压';
  if (elevation <= -60) return '主光来自正下方，强烈的底光从下方向上抬';
  const horizontal = normalizedAzimuth >= 345 || normalizedAzimuth <= 15
    ? '来自正前方，正面顺光'
    : normalizedAzimuth < 75
      ? '来自右前方约 45 度'
      : normalizedAzimuth <= 105
        ? '来自右侧，接近纯侧光'
        : normalizedAzimuth < 165
          ? '来自右后方，形成轮廓光与边缘高光'
          : normalizedAzimuth <= 195
            ? '来自主体正后方，形成强逆光与剪影'
            : normalizedAzimuth < 255
              ? '来自左后方，形成轮廓光与边缘高光'
              : normalizedAzimuth <= 285
                ? '来自左侧，接近纯侧光'
                : '来自左前方约 45 度';
  const tilt = elevation >= 30 ? '，并向下倾斜' : elevation <= -30 ? '，并向上倾斜' : '';
  return `主光${horizontal}${tilt}`;
}

function brightnessPrompt(brightness: number): string {
  if (brightness >= 75) return '高调明亮，整体曝光抬高，高光通透';
  if (brightness <= 25) return '低调昏暗，深阴影，曝光压低';
  if (brightness === 50) return '';
  return brightness > 50 ? '整体曝光略微提亮' : '整体曝光略微压暗';
}

/**
 * 按占位符骨架拼装打光指令：空段落直接丢掉，所以用户删掉模板里的某一项
 * 就等于这次不描述它，不需要在面板上再加一层开关。
 */
export function applyLightingPromptTemplate(template: string, values: Record<string, string>): string {
  return template
    .split('\n')
    .map((line) => line.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? ''))
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

export function composeLightingPrompt(options: ImageLightingOptions): string {
  const normalized = normalizeLightingOptions(options);
  const preset = LIGHTING_STYLE_PRESETS.find((item) => item.id === normalized.stylePresetId);
  const isWhite = normalized.lightColor.toLowerCase() === '#ffffff';
  const values: Record<string, string> = {
    consistency: LIGHTING_CONSISTENCY_PROMPT,
    preset: preset?.prompt ?? '',
    smart: normalized.smartMode ? normalized.smartDescription.trim() : '',
    direction: describeLightDirection(normalized.azimuth, normalized.elevation),
    brightness: brightnessPrompt(normalized.brightness),
    rimLight: normalized.rimLight ? '沿主体轮廓补充清晰的轮廓光与边缘高光' : '',
    lightColor: isWhite ? '' : `主光色温偏向 ${normalized.lightColor}`,
    meta: `[lighting azimuth:${normalized.azimuth}° elevation:${normalized.elevation}° brightness:${normalized.brightness}%${normalized.rimLight ? ' rim:on' : ''}]`,
  };
  return applyLightingPromptTemplate(normalized.promptTemplate, values);
}

export function composeImageRecipePrompt(recipe: ImageRecipe): string {
  return recipe.kind === 'angle'
    ? composeAnglePrompt(recipe.params)
    : composeLightingPrompt(recipe.params);
}
