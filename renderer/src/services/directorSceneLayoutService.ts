/**
 * AI 识图站位：把参考图/场景描述交给一个支持图片输入的文本模型，输出结构化站位 JSON。
 * 模型调用复用产品现有的目录契约与厂商适配器，不新建任务、不写画布。
 */

import { getGenerationInputModes, getModelIdsByType, resolveModelRuntimeContract } from '@/domain/catalog/ModelCatalog';
import { getProviderAdapter } from '@/domain/provider/adapters';
import { getModelCredentialStatus, settingsStore } from '@/store/settingsStore';
import { extractGeneratedText } from '@/utils/generatedOutputParsing';

const SYSTEM_PROMPT = [
  '你是 3D 导演台的场景搭建助手。根据参考图和补充描述，给出可执行的演员、道具和机位站位。',
  '只输出 JSON，不要 Markdown、解释或代码块。格式：',
  '{"characters":[{"name":"角色A","bodyType":"mannequin","position":[0,0,0],"rotationY":0,"posePresetId":"stand"}],',
  '"props":[{"name":"桌子","geometryType":"box","position":[0,0,1],"scale":1,"color":"#4F8EF7"}],',
  '"cameras":[{"name":"正面中景","position":[0,1.8,4.5],"target":[0,1.2,0],"fov":50}]}',
  'bodyType 可选：mannequin、female、broad、muscular、slim、teen、child、chibi。',
  'geometryType 可选：box、sphere、cylinder、torus、cone、pyramid。',
  '最多 8 个角色、8 个道具、4 个机位；坐标单位为米，人物的脚落在地面 y=0。',
  '没有把握的对象不要编造；宁可少输出，也不要输出画面中不存在的实体。',
].join('\n');

export interface DirectorSceneLayoutRequest {
  imageDataUrl?: string;
  prompt: string;
  signal?: AbortSignal;
}

export interface DirectorSceneLayoutResult {
  characters: Array<{
    name: string;
    bodyType: string;
    position: [number, number, number];
    rotationY: number;
    posePresetId: string;
  }>;
  props: Array<{
    name: string;
    geometryType: string;
    position: [number, number, number];
    scale: number;
    color: string;
  }>;
  cameras: Array<{
    name: string;
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
  }>;
}

function supportsImages(modelId: string) {
  return getGenerationInputModes(modelId).some((mode) => mode.maxImages > 0);
}

function pickTextModel(needsImage: boolean) {
  const models = getModelIdsByType('textGeneration');
  const candidates = models.filter((model) => !needsImage || supportsImages(model));
  const preferred = String(settingsStore.agentPreferredTextModel || '');
  if (preferred && candidates.includes(preferred) && getModelCredentialStatus(preferred).available) return preferred;
  return candidates.find((model) => getModelCredentialStatus(model).available)
    || candidates[0]
    || '';
}

/** 模型输出必须能解析成 JSON 对象；解析失败时抛错让面板显示可操作信息。 */
export function parseDirectorSceneLayoutText(text: string): DirectorSceneLayoutResult {
  const cleaned = String(text || '')
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('模型没有返回 JSON 场景站位');
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error('模型返回的 JSON 无法解析');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('模型返回的场景站位格式不正确');
  }
  const value = parsed as Record<string, unknown>;
  return {
    characters: Array.isArray(value.characters) ? value.characters as DirectorSceneLayoutResult['characters'] : [],
    props: Array.isArray(value.props) ? value.props as DirectorSceneLayoutResult['props'] : [],
    cameras: Array.isArray(value.cameras) ? value.cameras as DirectorSceneLayoutResult['cameras'] : [],
  };
}

export async function generateDirectorSceneLayout(input: DirectorSceneLayoutRequest): Promise<DirectorSceneLayoutResult> {
  const needsImage = Boolean(input.imageDataUrl);
  const model = pickTextModel(needsImage);
  if (!model) {
    throw new Error(needsImage
      ? '没有可用的视觉文本模型，请先配置 Gemini 等支持图片输入的文本模型'
      : '没有可用的文本模型');
  }
  const credential = getModelCredentialStatus(model);
  if (!credential.available) {
    throw new Error(`模型 ${model} 未配置凭据：${credential.message}`);
  }
  const contract = resolveModelRuntimeContract('textGeneration', model, needsImage ? ['referenceImage'] : []);
  if (!contract) throw new Error(`模型 ${model} 不支持当前输入`);
  const adapter = getProviderAdapter(contract.provider);
  const compiled = adapter.compileRequest({
    taskType: 'textGeneration',
    model,
    prompt: `${SYSTEM_PROMPT}\n\n补充描述：${String(input.prompt || '').trim() || '根据参考图搭建一个可拍摄的基础场景。'}`,
    modelContract: contract,
    params: {},
    ...(needsImage
      ? { modelInputs: { images: [{ url: input.imageDataUrl!, mimeType: 'image/png', inputSlot: 'reference' }] } }
      : {}),
    signal: input.signal ?? new AbortController().signal,
    timeoutMs: 120000,
  });
  const task = await adapter.submit(compiled);
  if (task.status === 'failed') throw new Error(task.error || '场景站位模型调用失败');
  const text = extractGeneratedText(task.result)
    || extractGeneratedText((task.result as Record<string, unknown> | undefined)?.raw)
    || extractGeneratedText(task.raw);
  if (!text) throw new Error('模型没有返回场景站位');
  return parseDirectorSceneLayoutText(text);
}
