import { settingsStore } from '@/store/settingsStore';
import { EDITOR_AGENT_ID } from '../agents/definitions.ts';
import { contractsForAgentType, formatContractsBlock } from './contractLoader';
import systemBasePrompt from './prompts/system-base.md?raw';
import type { AgentToolContext, JsonObject } from '../core/types';

/**
 * 主 Agent 的 system prompt 只有一个来源，由运行入口在每一步装配。
 *
 * `{{runtime_model_contract}}` 声明谁在管理循环、历史和子 Agent；其余内容来自提示词模板
 * 与契约，不在装配路径之外再维护一份引擎专属指令。
 */
export function buildAgentSystemPrompt(
  context: AgentToolContext,
  runtimeModelContract: string,
): string {
  const canRunNodes = settingsStore.agentCanRunNodes === true;
  const contracts = formatContractsBlock(contractsForAgentType(context.agentId));
  const base = systemBasePrompt
    .replace('{{mode_contract}}', canRunNodes
      ? '画布写入遵守本地策略；设置已允许 Agent 运行节点。复杂制作的范围和执行阶段由 Agent 根据用户完整语义与真实依赖管理。'
      : '画布可按用户要求创建和配置节点；“允许 Agent 运行节点”已关闭，任何生成任务都会在统一权限边界被拒绝。')
    .replace('{{runtime_model_contract}}', runtimeModelContract);
  return [
    base,
    context.agentId === EDITOR_AGENT_ID
      ? '当前会话属于视频剪辑工作区。先加载 video-editing Skill，并用 video_project_get 读取真实轨道和片段 ID。时间线上缺少素材时用 video_project_media 发现可导入的画布产物与项目素材，再用 video_project_edit 的 add_media 引入。成片比例用 set_canvas 设定，片段要不要铺满用 set_transform 的 fit。依据该 Skill 和用户要求使用剪辑工具；需要判断画面内容时查看真实素材帧，修改后重新读取项目并核验。剪辑任务不要改动画布节点。仅承诺工具实际支持并成功执行的操作。'
      : '',
    'Use Shotloom native tools for every canvas, project, task, model-catalog, Skill, or media operation.',
    'When a user asks what an existing image or video contains, inspect the real media instead of inferring from its filename, node title, prompt, or path. For a referenced canvas video, call canvas_media_frame with the real node ID or alias and one or more representative time points; the tool returns visual image attachments that you must actually examine before describing the content. Use bash/FFmpeg only as a fallback when no native media tool can perform the required inspection, and do not claim to have seen a frame unless an image attachment was returned successfully.',
    'For a non-trivial production request, inspect runtime capabilities first. Decide production scope from the full user message. If the scope is genuinely unresolved, use request_clarification and formulate the question and options for the actual context. Do not ask again when the user has already stated the scope clearly. Never infer execution merely because the user pasted a complete script.',
    'A plan_canvas request means materializing every determinable media output as a configured canvas node with real input edges, without starting generation. Text in your reply is not a substitute for omitted media nodes. A plan_and_execute request runs one dependency stage at a time and verifies actual outputs before continuing.',
    'Keep the Production Plan current. Bind every work item to its own real node/task runtime reference; never mark a stage done from an unrelated summary node.',
    'The newest user message is the current request. An unfinished question or rejected action from an earlier turn is context, not permission to replace the newest request.',
    'Never claim that an operation succeeded without a successful tool receipt.',
    'Use production-planner, stage-executor, or result-reviewer only for their named bounded responsibility. The primary agent owns Skill selection, user interaction and stage lifecycle.',
    'When delegating, include the selected Active Skill id and the relevant Skill constraints in the child task. Subagents must return their findings to the parent; only the parent addresses the user.',
    canRunNodes
      ? 'Node execution is enabled. Execute according to the user request and real dependencies without asking for duplicate stage approval.'
      : 'Node execution is disabled. You may create and configure nodes, but must not claim to have run them.',
    'If the run changes the project, canvas, or starts a task, call report_outcome with verifiable evidence before finishing. Every tool result returns toolCallId; copy those exact ids into evidence.toolCallIds and never use tool names as ids.',
    'For a conversational or explanatory answer that makes no project change, answer directly without report_outcome.',
    contracts,
  ].filter(Boolean).join('\n\n');
}

/** 子 Agent 的边界说明：instructions 加契约，不含主 Agent 的长提示词。 */
export function buildSubagentPrompt(agentId: string, instructions = ''): string {
  return `${instructions}\n\n${formatContractsBlock(contractsForAgentType(agentId))}`;
}

/**
 * 本轮随用户消息一起送出的真实上下文（引用节点、附件、仍在进行的制作计划）只有一个拼装处。
 * 两个引擎若各写一份，同一句用户请求就会看到不同的附加信息，引擎对比也就失去意义。
 */
export function buildRunContextBlock(input: {
  nodeMentions?: JsonObject[];
  attachments?: JsonObject[];
  planSummary?: JsonObject | null;
}): string {
  return [
    input.nodeMentions?.length ? `Mentioned nodes: ${JSON.stringify(input.nodeMentions)}` : '',
    input.attachments?.length ? `Attachments: ${JSON.stringify(input.attachments)}` : '',
    input.planSummary
      ? `Existing Production Plan candidate; continue it only if the newest request is genuinely related: ${JSON.stringify(input.planSummary)}`
      : '',
  ].filter(Boolean).join('\n');
}
