import { uid } from '../../utils/format.ts';

/**
 * 分镜脚本节点是 textGeneration 节点的一种画布视图：模型输出被解析成真实镜头行，
 * 行数据只服务画布里的分镜表与逐镜生成，不参与供应商请求结构。
 *
 * 所有字段都保留用户可编辑的原文；解析器只做类型收窄和编号整理，不按关键词猜测
 * 镜头质量，也不把模型没给的字段补成看似真实的内容。
 */
export const STORYBOARD_SCRIPT_SUBTASK = 'storyboard-script';
export const STORYBOARD_SCRIPT_VIEW = 'storyboard-script';
export const MAX_STORYBOARD_SHOTS = 100;

export type StoryboardShotStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface StoryboardShot {
  id: string;
  shotNumber: number;
  durationSeconds: number;
  plot: string;
  shotSize: string;
  camera: string;
  motion: string;
  imagePrompt: string;
  videoPrompt: string;
  dialogue: string;
  sound: string;
  characters: string;
  negativePrompt: string;
  /** 这一镜自己关联的参考图；为空时继承分镜节点的上游参考。 */
  referenceNodeIds: string[];
  imageNodeId: string;
  videoNodeId: string;
  status: StoryboardShotStatus;
  error: string;
}

export interface StoryboardShotPatch {
  durationSeconds?: unknown;
  plot?: unknown;
  shotSize?: unknown;
  camera?: unknown;
  motion?: unknown;
  imagePrompt?: unknown;
  videoPrompt?: unknown;
  dialogue?: unknown;
  sound?: unknown;
  characters?: unknown;
  negativePrompt?: unknown;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function firstText(source: UnknownRecord, keys: readonly string[]): string {
  for (const key of keys) {
    const value = text(source[key]);
    if (value) return value;
  }
  return '';
}

function positiveNumber(value: unknown, fallback: number): number {
  const number = Number(String(value ?? '').replace(/\s*s(?:ec(?:onds?)?)?$/i, ''));
  return Number.isFinite(number) && number > 0 ? Math.round(number * 10) / 10 : fallback;
}

function characters(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'string') return item.trim();
      const entry = record(item);
      return entry ? firstText(entry, ['name', 'label', '角色', '姓名']) : '';
    }).filter(Boolean).join('、');
  }
  return text(value);
}

/** 镜头行按画布字段建模；未知输入只取真实存在的字段，缺失字段留空。 */
export function createStoryboardShot(shotNumber: number, patch: StoryboardShotPatch = {}): StoryboardShot {
  return normalizeStoryboardShot({
    id: uid(),
    shotNumber,
    status: 'idle',
    ...normalizeShotFields(patch as UnknownRecord),
  }, shotNumber);
}

function normalizeShotFields(source: UnknownRecord): Omit<StoryboardShot, 'id' | 'shotNumber' | 'status' | 'referenceNodeIds' | 'imageNodeId' | 'videoNodeId' | 'error'> {
  return {
    durationSeconds: positiveNumber(source.durationSeconds, 4),
    plot: firstText(source, ['plot', 'plotDescription', 'content', '画面', '画面描述', '镜头内容', 'description']),
    shotSize: firstText(source, ['shotSize', '景别']),
    camera: firstText(source, ['camera', 'cameraMove', '机位', '运镜']),
    motion: firstText(source, ['motion', 'cameraMove', '动作', '运动']),
    imagePrompt: firstText(source, ['imagePrompt', 'imageGenerationPrompt', 'image', '图片提示词', '画面提示词']),
    videoPrompt: firstText(source, ['videoPrompt', 'videoMotionPrompt', 'video', '视频提示词', '运动提示词']),
    dialogue: firstText(source, ['dialogue', '台词', '对白']),
    sound: firstText(source, ['sound', 'audioEffects', '音效', '声音']),
    characters: characters(source.characters),
    negativePrompt: firstText(source, ['negativePrompt', 'negative', '负面提示词']),
  };
}

function normalizeStoryboardShot(source: UnknownRecord, fallbackNumber: number): StoryboardShot {
  const id = text(source.id) || uid();
  const number = Number(source.shotNumber);
  const status = source.status;
  return {
    id,
    shotNumber: Number.isFinite(number) && number > 0 ? Math.round(number) : fallbackNumber,
    ...normalizeShotFields(source),
    referenceNodeIds: Array.isArray(source.referenceNodeIds)
      ? [...new Set(source.referenceNodeIds.map((id) => text(id)).filter(Boolean))]
      : [],
    imageNodeId: text(source.imageNodeId),
    videoNodeId: text(source.videoNodeId),
    status: status === 'running' || status === 'completed' || status === 'failed' ? status : 'idle',
    error: text(source.error),
  };
}

/** 保留已有行 ID、产出节点和错误状态，只更新用户可编辑内容。 */
export function patchStoryboardShot(shot: StoryboardShot, patch: StoryboardShotPatch): StoryboardShot {
  return { ...shot, ...normalizeShotFields(patch as UnknownRecord) };
}

export function renumberStoryboardShots(shots: StoryboardShot[]): StoryboardShot[] {
  return shots.map((shot, index) => shot.shotNumber === index + 1 ? shot : { ...shot, shotNumber: index + 1 });
}

export function normalizeStoryboardShots(value: unknown): StoryboardShot[] {
  if (!Array.isArray(value)) return [];
  return renumberStoryboardShots(value
    .map((item, index) => record(item) ? normalizeStoryboardShot(item as UnknownRecord, index + 1) : null)
    .filter((shot): shot is StoryboardShot => Boolean(shot))
    .slice(0, MAX_STORYBOARD_SHOTS));
}

export function isStoryboardScriptNode(node: Record<string, unknown> | null | undefined): boolean {
  return Boolean(node && node.canvasView === STORYBOARD_SCRIPT_VIEW);
}

/** 模型偶尔会包 ```json 或混入解释；只取第一个 JSON 数组或带 shots 的对象。 */
export function parseStoryboardScriptResult(value: unknown): StoryboardShot[] | null {
  let payload: unknown = value;
  if (typeof payload === 'string') {
    let source = payload.trim();
    const fenced = source.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/i);
    if (fenced) source = (fenced[1] as string).trim();
    try {
      payload = JSON.parse(source);
    } catch {
      const start = source.search(/[[{]/);
      if (start < 0) return null;
      const end = Math.max(source.lastIndexOf(']'), source.lastIndexOf('}'));
      if (end <= start) return null;
      try {
        payload = JSON.parse(source.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  const root = record(payload);
  const rows = Array.isArray(payload) ? payload : Array.isArray(root?.shots) ? root.shots : null;
  if (!rows?.length) return null;
  const seenIds = new Set<string>();
  const shots = rows
    .map((item, index) => {
      const entry = record(item);
      return entry ? normalizeStoryboardShot(entry, index + 1) : null;
    })
    .filter((shot): shot is StoryboardShot => Boolean(shot))
    .map((shot) => {
      if (!seenIds.has(shot.id)) { seenIds.add(shot.id); return shot; }
      const next = { ...shot, id: uid() };
      seenIds.add(next.id);
      return next;
    });
  return shots.length ? renumberStoryboardShots(shots.slice(0, MAX_STORYBOARD_SHOTS)) : null;
}

/** 请求模型输出可持久化的镜头行；镜头数量只限制输出规模，不限制用户已有镜头。 */
export function storyboardScriptInstruction(
  count: number | 'auto',
  extra = '',
  duration: number | 'auto' = 'auto',
): string {
  const autoCount = count === 'auto' || !Number.isFinite(Number(count)) || Number(count) <= 0;
  const shotCount = autoCount ? 0 : Math.max(1, Math.min(MAX_STORYBOARD_SHOTS, Math.round(Number(count))));
  const requirement = text(extra);
  const durationHint = duration === 'auto' || !Number.isFinite(Number(duration)) || Number(duration) <= 0
    ? '单镜时长由内容决定，通常 3–10 秒；台词较长时可以延长。'
    : `每个镜头时长以 ${Math.round(Number(duration))} 秒为基准，可根据台词和动作在合理范围内微调。`;
  return [
    '你是专业的影视分镜师。请把下面提供的剧情/创意拆成可逐镜拍摄和生成的分镜脚本。',
    autoCount
      ? '请根据内容决定镜头数量，通常 6–12 个镜头；不要为了凑数拆分没有变化的内容，也不要合并叙事职责不同的镜头。'
      : `输出恰好 ${shotCount} 个镜头（如果素材实在不足可以少于此数，但不要凑无关镜头）。`,
    '每个镜头按时间顺序连续，保持角色身份、服装、道具和空间轴线一致；发生转身、换位或过轴时写进画面描述。',
    '图片提示词只描述这一镜的静态画面，不包含“镜头运动”等视频语义；视频提示词描述本镜的动作、表演与镜头运动。',
    '台词逐字保留用户提供的原话，没有台词就留空；音效只写画面里真实存在的声源。',
    durationHint,
    '只输出合法 JSON，不要 Markdown 代码块或解释。结构必须是：',
    '{"shots":[{"shotNumber":1,"durationSeconds":4,"plot":"画面事件与动作","shotSize":"中景","camera":"固定机位","motion":"缓慢推近","imagePrompt":"完整图片生成提示词","videoPrompt":"完整视频运动提示词","dialogue":"台词或空字符串","sound":"音效或空字符串","characters":"出场角色","negativePrompt":"负面提示词或空字符串"}]}',
    'durationSeconds 是秒数数字；shotNumber 从 1 连续编号。',
    requirement ? `补充要求：${requirement}` : '',
  ].filter(Boolean).join('\n');
}

/** 单镜生成使用行内提示词；用户没写时退回画面描述，保证请求仍有真实内容。 */
export function storyboardShotPrompt(shot: StoryboardShot, kind: 'image' | 'video'): string {
  if (kind === 'image') {
    if (shot.imagePrompt.trim()) return shot.imagePrompt;
    return [
      shot.plot,
      shot.shotSize ? `景别：${shot.shotSize}` : '',
      shot.camera ? `机位：${shot.camera}` : '',
      shot.characters ? `出场角色：${shot.characters}` : '',
      shot.negativePrompt ? `避免：${shot.negativePrompt}` : '',
    ].filter(Boolean).join('\n');
  }
  if (shot.videoPrompt.trim()) return shot.videoPrompt;
  return [
    shot.plot,
    shot.motion ? `运动：${shot.motion}` : '',
    shot.camera ? `机位：${shot.camera}` : '',
    shot.dialogue ? `台词：${shot.dialogue}` : '',
    shot.sound ? `音效：${shot.sound}` : '',
  ].filter(Boolean).join('\n');
}

export function storyboardShotSummary(shots: StoryboardShot[]) {
  const totalDuration = shots.reduce((sum, shot) => sum + (Number(shot.durationSeconds) || 0), 0);
  return { count: shots.length, totalDuration: Math.round(totalDuration * 10) / 10 };
}
