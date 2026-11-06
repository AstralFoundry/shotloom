/**
 * 提示词优化器的领域规则：指令构造与结果解析。
 *
 * 模型输出按结构化契约解析（正向提示词 / 规避项 / 说明 / 假设 / 备选），
 * 解析失败时退化成「整段文本就是提示词」，并标记未结构化——界面据此提醒，
 * 而不是把一段解释当成提示词直接回填。
 */

export type OptimizerMode = 'expand' | 'polish' | 'style' | 'model' | 'reference';

export const OPTIMIZER_MODES: OptimizerMode[] = ['expand', 'polish', 'style', 'model', 'reference'];

export interface OptimizerReference {
  kind: string;
  name?: string;
  note?: string;
}

export interface OptimizerInstructionInput {
  mode: OptimizerMode;
  prompt: string;
  references?: OptimizerReference[];
  targetModel?: string;
  generationType?: 'image' | 'video' | 'audio' | 'text';
}

export interface OptimizerResult {
  prompt: string;
  avoid: string[];
  notes: string[];
  assumptions: string[];
  alternatives: string[];
  structured: boolean;
}

const MODE_GUIDE: Record<OptimizerMode, string> = {
  expand: '把模糊的想法补齐为可执行细节：主体、动作或姿态、环境、构图、光线、镜头与风格；保留原意。',
  polish: '尽量保留原意，只修正表达并补充必要细节，不改变主体、场景与动作。',
  style: '保留主体与动作，强化色彩、材质、光影与指定风格；不要新增无关主体。',
  model: '按目标生成模型与协议调整提示词结构，避免使用该模型不支持的参数语法。',
  reference: '结合已连接参考素材补充外观、一致性与构图关系；只使用给出的参考信息。',
};

function referenceLine(reference: OptimizerReference): string {
  const kind = String(reference.kind || '').trim();
  const name = String(reference.name || '').trim();
  const note = String(reference.note || '').trim();
  return [kind, name, note].filter(Boolean).join(' · ');
}

/** 构造一次优化请求的 system/user 两段指令。 */
export function buildOptimizerInstruction(input: OptimizerInstructionInput): { system: string; user: string } {
  const references = (input.references || []).filter((item) => referenceLine(item)).slice(0, 8);
  const system = [
    '你是 AI 影像创作的提示词编辑。只整理提示词，不解释创作流程，不输出寒暄。',
    '必须只返回一个 JSON 对象，键为：prompt（字符串，最终可直接使用的提示词）、avoid（字符串数组，规避项）、notes（字符串数组，修改说明）、assumptions（字符串数组，做出的假设）、alternatives（字符串数组，可选备选版本）。',
    'prompt 必须能独立执行，不包含"根据上文""如上"之类的指代。',
  ].join('\n');
  const user = [
    `优化方式：${MODE_GUIDE[input.mode] || MODE_GUIDE.expand}`,
    input.targetModel ? `目标生成模型：${input.targetModel}` : '',
    input.generationType ? `目标产物：${input.generationType}` : '',
    references.length ? `已连接参考素材：\n${references.map((item) => `- ${referenceLine(item)}`).join('\n')}` : '',
    `原始提示词：\n${String(input.prompt || '').trim() || '（空）'}`,
  ].filter(Boolean).join('\n\n');
  return { system, user };
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 8);
  if (typeof value === 'string' && value.trim()) {
    return value.split(/\n|；|;/).map((item) => item.replace(/^[-*•\d.、\s]+/, '').trim()).filter(Boolean).slice(0, 8);
  }
  return [];
}

function stripFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] || text).trim();
}

/**
 * 解析模型输出。兼容直接 JSON、围栏 JSON 与纯文本三种情况。
 */
export function parseOptimizerResult(text: string): OptimizerResult {
  const raw = String(text || '').trim();
  if (!raw) {
    return { prompt: '', avoid: [], notes: [], assumptions: [], alternatives: [], structured: false };
  }
  const candidate = stripFence(raw);
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
      const prompt = String(parsed.prompt ?? parsed.promptText ?? parsed.positive ?? '').trim();
      if (prompt) {
        return {
          prompt,
          avoid: toStringList(parsed.avoid ?? parsed.negative ?? parsed.negativePrompt),
          notes: toStringList(parsed.notes ?? parsed.explanation ?? parsed.changes),
          assumptions: toStringList(parsed.assumptions ?? parsed.assumption),
          alternatives: toStringList(parsed.alternatives ?? parsed.variants),
          structured: true,
        };
      }
    } catch {
      // 落到纯文本分支
    }
  }
  return {
    prompt: raw,
    avoid: [],
    notes: [],
    assumptions: [],
    alternatives: [],
    structured: false,
  };
}
