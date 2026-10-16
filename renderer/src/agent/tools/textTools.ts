import { registerAgentTool } from '../core/toolRegistry';
import { conversationRecord } from '../loop/transcript';
import { textDraftTarget } from '../runtime/textDraftBridge';
import type { AgentToolContext, JsonObject } from '../core/types';

/**
 * 会话记录上的 textNodeId 决定这个 Agent 面对哪份草稿，模型不能自己指定节点，
 * 否则一个文本会话就可能改动另一个节点的编辑器。
 */
function boundTextNodeId(context: AgentToolContext): string {
  return String(conversationRecord(context.conversationId)?.textNodeId || '');
}

function requireDraftTarget(context: AgentToolContext) {
  const nodeId = boundTextNodeId(context);
  if (!nodeId) throw new Error('当前会话没有绑定文本节点');
  const target = textDraftTarget(nodeId);
  if (!target) throw new Error('文本编辑器已关闭，草稿不可读写');
  return target;
}

export function registerTextDraftTools(): void {
  registerAgentTool({
    id: 'text_draft_read',
    icon: 'search',
    title: '读取当前草稿',
    description: '读取文本编辑器里当前未保存的草稿正文（Markdown）。编辑器内容可能已被用户改动，改写或续写前都要重新读取，不要沿用历史里的旧内容。',
    effect: 'read',
    isAvailable: (context) => Boolean(textDraftTarget(boundTextNodeId(context))),
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: (_input, context) => {
      const content = requireDraftTarget(context).read();
      return { success: true, content, characters: content.length };
    },
  });

  registerAgentTool<JsonObject>({
    id: 'text_draft_write',
    icon: 'pencil',
    title: '写入当前草稿',
    description: '把内容写入文本编辑器当前的未保存草稿。replace 替换整篇，append 追加到末尾。写入不会保存节点，用户仍需在编辑器里保存；草稿里有用户未保存的改动时不要用 replace 覆盖，先读取并合并。',
    effect: 'agent_state_write',
    isAvailable: (context) => Boolean(textDraftTarget(boundTextNodeId(context))),
    inputSchema: {
      type: 'object',
      required: ['content'],
      properties: {
        content: { type: 'string', description: '要写入草稿的正文（Markdown）' },
        mode: { type: 'string', enum: ['replace', 'append'] },
      },
      additionalProperties: false,
    },
    summarizeInput: (input) => (input.mode === 'append' ? '追加草稿' : '替换草稿'),
    summarizeResult: (result: any) => {
      if (result?.success !== true) return undefined;
      return {
        summary: result.mode === 'append'
          ? `已追加 ${Number(result.appendedCharacters || 0)} 字，草稿共 ${Number(result.characters || 0)} 字`
          : `已写入草稿，共 ${Number(result.characters || 0)} 字`,
      };
    },
    execute: (input, context) => {
      const content = String(input.content || '');
      if (!content.trim()) throw new Error('写入内容为空，请提供要写进草稿的正文');
      const mode = input.mode === 'append' ? 'append' : 'replace';
      const target = requireDraftTarget(context);
      const before = target.read();
      const draft = target.apply(content, mode);
      return {
        success: true,
        mode,
        characters: draft.length,
        appendedCharacters: content.length,
        replacedCharacters: mode === 'replace' ? before.length : 0,
      };
    },
  });
}
