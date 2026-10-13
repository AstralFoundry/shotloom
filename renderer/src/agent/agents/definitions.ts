import type { AgentToolEffect } from '../core/types';

/**
 * Agent 定义是"某个 agent 能看见什么"的唯一来源。
 *
 * `tools` 是白名单：未列出的工具既不会被组装进模型请求，也无法在本地执行。
 * 新增工具时必须显式加入某个 agent 的白名单，否则它对所有 agent 都不可见。
 * 这是刻意的 fail-closed 取舍，不能改成默认全开。
 */
export interface AgentDefinition {
  id: string;
  /** primary 直接面向用户；subagent 只由父 agent 派发，不直接对话。 */
  role: 'primary' | 'subagent';
  title: string;
  description: string;
  maxSteps: number;
  /** 该 agent 允许的副作用类别上限。与 tools 白名单是两层独立校验： */
  /** 即使工具被误加进白名单，超出 effects 上限依然不可见、不可执行。 */
  effects: AgentToolEffect[];
  tools: string[];
  /** Skill 白名单；`'*'` 表示所有已启用 Skill。子 agent 用空数组表示不授予任何 Skill。 */
  skills: string[];
  /** 可以派发的子 agent id 列表。 */
  dispatch: string[];
  /**
   * 子 Agent 的职责边界说明。主 Agent 的 system prompt 由 content/prompts/system-base.md
   * 组装，因此不在此声明。
   */
  instructions?: string;
}

// ── 工具分组 ────────────────────────────────────────────────────────────
// 分组只是白名单的书写辅助，展开后仍是逐个显式声明的工具 id。

const canvasReadTools = [
  'canvas_list_nodes', 'canvas_get_node', 'canvas_media_frame', 'canvas_focus_nodes', 'inspect_tasks',
];
const canvasWriteTools = [
  'canvas_create_node', 'canvas_update_node', 'canvas_connect_nodes', 'canvas_layout_nodes',
  'canvas_delete_node', 'canvas_update_edge', 'undo_canvas', 'redo_canvas',
];
const generationTools = ['canvas_start_generation'];
const catalogTools = ['inspect_runtime_capabilities', 'inspect_model_catalog', 'list_recipes', 'load_recipe'];
const userInteractionTools = ['request_clarification', 'report_outcome', 'save_skill'];
const productionPlanWriteTools = ['plan_write', 'plan_patch_stage', 'plan_update_stage_state'];
const productionPlanReadTools = ['plan_get_stage_status', 'plan_get_stage_detail'];
/** Skill 命名空间工具仍然要等对应 SKILL.md 真正加载后才可见，见 core/visibility.ts。 */
const skillNamespacedTools = ['skill_short_drama__inspect_structure'];
const videoEditorTools = [
  'video_project_get', 'video_project_media', 'video_project_edit', 'video_project_view',
  'video_project_diagnostics', 'video_project_frame', 'video_project_export', 'video_project_history',
];

export const AGENT_DEFINITIONS: AgentDefinition[] = [
  {
    id: 'canvas-primary',
    role: 'primary',
    title: '画布 Agent',
    description: 'Shotloom creative workspace agent',
    maxSteps: 80,
    effects: ['read', 'agent_state_write', 'project_write', 'canvas_write', 'media_generation'],
    tools: [
      ...canvasReadTools, ...canvasWriteTools, ...generationTools, ...catalogTools,
      ...userInteractionTools, ...productionPlanWriteTools, ...productionPlanReadTools,
      ...skillNamespacedTools,
    ],
    skills: ['*'],
    dispatch: ['production-planner', 'stage-executor', 'result-reviewer'],
  },
  {
    id: 'editor-primary',
    role: 'primary',
    title: '剪辑 Agent',
    description: 'Video editing workspace agent bound to one timeline session',
    maxSteps: 80,
    // 剪辑 agent 只改时间线（project_write），不拥有画布写入与媒体生成。
    effects: ['read', 'agent_state_write', 'project_write'],
    tools: [
      ...videoEditorTools, 'request_clarification', 'report_outcome',
      'inspect_runtime_capabilities', 'inspect_model_catalog',
    ],
    skills: ['video-editing'],
    dispatch: [],
  },
  {
    id: 'production-planner',
    role: 'subagent',
    title: '制作规划',
    description: 'Author complete Production Plan work items, prompts, dependencies and completion criteria',
    maxSteps: 40,
    effects: ['read', 'agent_state_write', 'project_write'],
    tools: [
      ...canvasReadTools, ...catalogTools, ...productionPlanWriteTools, ...productionPlanReadTools,
      ...skillNamespacedTools,
    ],
    skills: [],
    dispatch: [],
    instructions: 'Author a Production Plan for the requested scope. Use the Active Skill and its constraints supplied by the parent task. Do not mutate the canvas or claim completion.',
  },
  {
    id: 'stage-executor',
    role: 'subagent',
    title: '阶段执行',
    description: 'Compile and execute the current Production Plan stage',
    maxSteps: 60,
    effects: ['read', 'agent_state_write', 'project_write', 'canvas_write', 'media_generation'],
    tools: [
      ...canvasReadTools, ...canvasWriteTools, ...generationTools, ...catalogTools,
      ...productionPlanWriteTools, ...productionPlanReadTools, ...skillNamespacedTools,
    ],
    skills: [],
    dispatch: [],
    instructions: 'Execute the requested stage using the Active Skill and constraints supplied by the parent task. Respect real dependencies and return exact receipts.',
  },
  {
    id: 'result-reviewer',
    role: 'subagent',
    title: '结果核验',
    description: 'Verify outcomes, constraints, artifacts and canvas state',
    maxSteps: 24,
    // 核验者只读：任何写入类别都不在它的上限内。
    effects: ['read', 'agent_state_write'],
    tools: [...canvasReadTools, ...catalogTools, ...productionPlanReadTools, ...skillNamespacedTools],
    skills: [],
    dispatch: [],
    instructions: 'Verify using read tools and tool receipts. Never modify the canvas.',
  },
];

const definitions = new Map(AGENT_DEFINITIONS.map((agent) => [agent.id, agent]));

export function agentDefinition(agentId: string): AgentDefinition {
  const definition = definitions.get(String(agentId || ''));
  if (!definition) throw new Error(`未知的 Agent：${agentId || '(空)'}。Agent 必须先在 agents/definitions.ts 中声明`);
  return definition;
}

/** 两个主 Agent 的 id 会被会话层和适配层引用，集中在这里避免各处再写字面量。 */
export const CANVAS_AGENT_ID = 'canvas-primary';
export const EDITOR_AGENT_ID = 'editor-primary';
