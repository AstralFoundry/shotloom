import { t } from '../../i18n/index.ts';
export const CANVAS_AGENT_ID = 'canvas-primary';
export const EDITOR_AGENT_ID = 'editor-primary';
export const TEXT_AGENT_ID = 'text-primary';
export const AGENT_IDS = [CANVAS_AGENT_ID, EDITOR_AGENT_ID, TEXT_AGENT_ID] as const;
export type AgentId = typeof AGENT_IDS[number];

import type { AgentToolEffect } from '../core/types';
import { openReelAgentTools as openReelTools } from '../core/openReelTools.ts';

/**
 * Agent 定义是"某个 agent 能看见什么"的唯一来源。
 *
 * `tools` 是白名单：未列出的工具既不会被组装进模型请求，也无法在本地执行。
 * 新增工具时必须显式加入某个 agent 的白名单，否则它对所有 agent 都不可见。
 * 这是刻意的 fail-closed 取舍，不能改成默认全开。
 */
export interface AgentDefinition {
  id: string;
  /** 产品工作台会话的角色。 */
  role: 'primary';
  title: string;
  description: string;
  /** 该 agent 允许的副作用类别上限。与 tools 白名单是两层独立校验： */
  /** 即使工具被误加进白名单，超出 effects 上限依然不可见、不可执行。 */
  effects: AgentToolEffect[];
  tools: string[];
  /** Skill 白名单；`'*'` 表示未被其他 Agent 显式认领的已启用 Skill。空数组表示不授予任何 Skill。 */
  skills: string[];
}

// ── 工具分组 ────────────────────────────────────────────────────────────
// 分组只是白名单的书写辅助，展开后仍是逐个显式声明的工具 id。

const canvasReadTools = [
  'canvas_list_nodes', 'canvas_get_node', 'canvas_media_frame', 'canvas_media_image', 'canvas_focus_nodes', 'inspect_tasks',
];
const canvasWriteTools = [
  'canvas_create_node', 'canvas_update_node', 'canvas_connect_nodes', 'canvas_layout_nodes',
  'canvas_delete_node', 'canvas_update_edge', 'undo_canvas', 'redo_canvas',
];
const generationTools = ['canvas_start_generation'];
const catalogTools = ['inspect_runtime_capabilities', 'inspect_model_catalog', 'inspect_assets', 'list_recipes', 'load_recipe', 'inspect_skills', 'save_skill'];
const productionPlanWriteTools = ['plan_write', 'plan_patch_stage', 'plan_update_stage_state'];
const productionPlanReadTools = ['plan_get_stage_status', 'plan_get_stage_detail'];
// Goal、Plan、待办、审批与提问由官方 Host 组合，产品目录只声明领域工具。
const videoEditorTools = [
  'video_project_get', 'video_project_media', 'video_project_action_catalog',
  'video_project_actions', 'video_project_import_media', 'video_project_view',
  'video_project_diagnostics', 'video_project_frame', 'video_project_export', 'video_project_history',
];
const textDraftTools = ['text_draft_read', 'text_draft_write'];

export const AGENT_DEFINITIONS: AgentDefinition[] = [
  {
    id: CANVAS_AGENT_ID,
    role: 'primary',
    title: t('agent.role.canvas'),
    description: 'Shotloom creative workspace agent',
    effects: ['read', 'agent_state_write', 'project_write', 'canvas_write', 'media_generation'],
    tools: [
      ...canvasReadTools, ...canvasWriteTools, ...generationTools, ...catalogTools,
      'project_snapshot', 'project_save', 'project_export_package', 'canvas_prepare_editor',
      ...productionPlanWriteTools, ...productionPlanReadTools,
    ],
    skills: ['*'],
  },
  {
    id: EDITOR_AGENT_ID,
    role: 'primary',
    title: t('agent.role.editor'),
    description: 'Video editing workspace agent bound to one timeline session',
    // 剪辑工具只授予绑定时间线的读取与写入。
    effects: ['read', 'agent_state_write', 'project_write'],
    tools: [
      ...videoEditorTools,
      ...canvasReadTools, 'project_snapshot', 'inspect_assets',
      ...openReelTools.map(tool => `openreel_${tool.name}`),
      'inspect_runtime_capabilities', 'inspect_model_catalog',
    ],
    skills: ['video-editing', 'openreel-native-editing'],
  },
  {
    id: TEXT_AGENT_ID,
    role: 'primary',
    title: t('agent.role.text'),
    description: 'Text editor workspace agent bound to one open document draft',
    // 文本工具只读写绑定编辑器的草稿。
    effects: ['read', 'agent_state_write'],
    tools: [...textDraftTools],
    skills: ['text-writing', 'short-drama-writing'],
  },
];

const definitions = new Map(AGENT_DEFINITIONS.map((agent) => [agent.id, agent]));

export function agentDefinition(agentId: string): AgentDefinition {
  const definition = definitions.get(String(agentId || ''));
  if (!definition) throw new Error(t('agent.definition.unknown', { id: agentId || t('agent.definition.emptyId') }));
  return definition;
}

/**
 * 界面按 agentId 显示"谁在执行"。未知身份返回空串，让界面回落通用文案，
 * 不能猜成某个具体 Agent。
 */
export function agentTitle(agentId: string): string {
  return definitions.get(String(agentId || ''))?.title || '';
}

/** 主 Agent 的 id 会被会话层、适配层和界面呈现引用，集中在这里避免各处再写字面量。 */
