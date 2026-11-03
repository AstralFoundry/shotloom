import { t } from '../i18n/index.ts';
// 模型参数在目录里是松散的 JSON 结构，界面只按当前真实字段读取。
type AnyRecord = Record<string, any>;

export function optionValue(option: any) {
  return option && typeof option === 'object' ? option.value ?? option.label : option;
}

export function modelTypeLabel(type: string) {
  const labels: Record<string, string> = {
    textGeneration: t("ui.taskAdapter.textGeneration.9612898b"),
    imageGeneration: t("ui.taskAdapter.imageGeneration.1f6a9dab"),
    videoGeneration: t("ui.taskAdapter.videoGeneration.19978a8d"),
    audioGeneration: t("ui.taskAdapter.audioGeneration.d371481a"),
  };
  return labels[type] || type || t("ui.modelPresentation.text.e9649f84");
}

export function optionLabel(param: AnyRecord, value: any) {
  if (param.optionLabels?.[value] != null) return String(param.optionLabels[value]);
  const option = (param.options || []).find((item: any) => optionValue(item) === value);
  if (option && typeof option === 'object') return option.label ?? option.value ?? value;
  return String(option ?? value ?? param.default ?? '');
}

export function isAspectRatioParam(param: AnyRecord) {
  const control = param.presentation && typeof param.presentation === 'object'
    ? param.presentation.control
    : param.presentation;
  return control === 'ratio' || control === 'aspectRatio'
    || param.key === 'aspectRatio'
    || String(param.label || '').includes('比例');
}

export function paramPresentation(param: AnyRecord | null | undefined): AnyRecord {
  return param?.presentation && typeof param.presentation === 'object'
    ? param.presentation
    : {};
}

/** 对数滑杆的轨道域：只描述拖动位置，写回配置的仍是目录 step 量化后的真实值。 */
const LOG_SLIDER_RANGE = 1000;

/** 倍率型参数（语速 0.5–2、音量 0.1–10）的默认值 1 在线性轨道上贴着左端，看起来像空轨；
 *  目录声明 scale:'log' 后几何中点落在轨道正中。min<=0 时无法取对数，按线性处理。 */
function usesLogSlider(param: AnyRecord): boolean {
  const presentation = paramPresentation(param);
  const min = Number(presentation.min);
  const max = Number(presentation.max);
  return presentation.scale === 'log' && Number.isFinite(min) && min > 0 && max > min;
}

export function sliderTrackDomain(param: AnyRecord): { min: number; max: number; step: number } {
  const presentation = paramPresentation(param);
  if (!usesLogSlider(param)) {
    return {
      min: Number(presentation.min),
      max: Number(presentation.max),
      step: Number(presentation.step) || 1,
    };
  }
  return { min: 0, max: LOG_SLIDER_RANGE, step: 1 };
}

export function sliderTrackPosition(param: AnyRecord, value: number): number {
  if (!usesLogSlider(param)) return value;
  const presentation = paramPresentation(param);
  const min = Number(presentation.min);
  const max = Number(presentation.max);
  const clamped = Math.min(max, Math.max(min, value));
  return Math.round((Math.log(clamped / min) / Math.log(max / min)) * LOG_SLIDER_RANGE);
}

export function sliderValueFromTrack(param: AnyRecord, position: number): number {
  if (!usesLogSlider(param)) return position;
  const presentation = paramPresentation(param);
  const min = Number(presentation.min);
  const max = Number(presentation.max);
  const decimals = String(presentation.step ?? '').split('.')[1]?.length || 0;
  const raw = min * Math.pow(max / min, position / LOG_SLIDER_RANGE);
  return Number(Math.min(max, Math.max(min, raw)).toFixed(decimals));
}

export function aspectRatioStyle(value: any) {
  const match = String(value || '1:1').trim().match(
    /([0-9]+(?:\.[0-9]+)?)\s*(?::|x|×|\/)\s*([0-9]+(?:\.[0-9]+)?)/i,
  );
  const rawWidth = Number(match?.[1]);
  const rawHeight = Number(match?.[2]);
  const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 1;
  const height = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 1;
  const ratio = width / height;
  return {
    width: `${ratio >= 1 ? 18 : Math.max(9, Math.round(18 * ratio))}px`,
    height: `${ratio >= 1 ? Math.max(9, Math.round(18 / ratio)) : 18}px`,
  };
}

/**
 * 观感描述：只写目录给不出的主观特征。厂商名与接口路径不在这里出现——
 * 它们由 generationNodeState 从模型目录实时解析，按模型 ID 猜曾经把
 * openai.json 里的 gpt-image 系列说成 StarRouter。
 */
const traitNotes: Array<[RegExp, string]> = [
  [/midjourney/i, t("ui.modelPresentation.text.0fadbb41")],
  [/flux/i, t("ui.modelPresentation.text.48d77c39")],
  [/(sdxl|stable[- ]?diffusion)/i, t("ui.modelPresentation.text.535587d5")],
  [/kling/i, t("ui.modelPresentation.text.ae88cb44")],
  [/seedance/i, t("ui.modelPresentation.text.0d2e5325")],
  [/vidu/i, t("ui.modelPresentation.text.0d10b841")],
  [/sora/i, t("ui.modelPresentation.text.9223c1d1")],
  [/runway/i, t("ui.modelPresentation.text.5af8c1e0")],
  [/pika/i, t("ui.modelPresentation.text.ec38d77d")],
  [/luma/i, t("ui.modelPresentation.text.4f27e7e2")],
  [/(suno|udio)/i, t("ui.modelPresentation.text.c9ec8f98")],
  [/(whisper|asr)/i, t("ui.modelPresentation.text.23f8124e")],
  [/pawsense/i, t("ui.modelPresentation.text.cb88b8a2")],
  [/eleven/i, t("ui.modelPresentation.text.a71dc607")],
];

export function modelTraitNote(modelId: string) {
  return traitNotes.find(([pattern]) => pattern.test(String(modelId || '')))?.[1] || '';
}

/** Summary semantics follow catalog parameter keys, independent of translated labels. */
export function paramSummary(param: AnyRecord, value: unknown): string {
  if (param.type === 'boolean') {
    if (param.key === 'generateAudio') return value ? t('ui.GenerationNodeComposer.text.5fb58f02') : t('ui.GenerationNodeComposer.text.e798b313');
    if (param.key === 'watermark') return value ? t('ui.canvasMediaActions.suffix.d52f4ea8') : t('ui.GenerationNodeComposer.text.6696df8e');
    return value ? String(param.label || param.key) : t('ui.CanvasToolbarCustomizeDialog.arialabel.6c14bd7f');
  }
  const text = optionLabel(param, value);
  return paramPresentation(param).control === 'slider' ? `${param.label} ${text}` : String(text);
}
