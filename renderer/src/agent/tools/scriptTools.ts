import type { JsonObject } from '../core/types';
import { registerSkillTool } from '../core/toolRegistry';
import { inspectScriptStructure, type InspectScriptStructureInput } from '@/utils/scriptSceneSplitter';

type InspectScriptStructureToolInput = InspectScriptStructureInput & JsonObject;

export function registerShortDramaTools(): void {
  registerSkillTool<InspectScriptStructureToolInput>('short-drama', {
    id: 'inspect_structure',
    title: '读取剧本结构候选',
    description: '无损分页读取剧本文本，返回段落边界、显式场次标题候选和对白说话人候选。候选不是制作结论；Agent 根据完整语义复核并决定场次和工作项。',
    effect: 'agent_state_write',
    inputSchema: {
      type: 'object',
      required: ['sourceText'],
      properties: {
        sourceText: { type: 'string', description: '待拆分的剧本或改编稿正文' },
        sourceTitle: { type: 'string' },
        episodeId: { type: 'string' },
        cursor: { type: 'integer', description: '从上一页 nextCursor 继续读取；首次省略' },
        pageChars: { type: 'integer', description: '期望单页字符数；超出资源上限时会明确分页且不丢弃原文' },
      },
      additionalProperties: false,
    },
    summarizeInput: (input) => `${String(input.sourceTitle || input.episodeId || '剧本')} 结构读取`,
    execute: (input, context) => {
      const result = inspectScriptStructure(input);
      context.emit({
        type: 'script_structure_inspected',
        cursor: result.page.cursor,
        nextCursor: result.page.nextCursor,
        episodeId: result.episodeId,
      });
      return result;
    },
  });
}
