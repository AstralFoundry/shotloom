import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const contentRoot = join(root, 'renderer/src/agent/content');

/**
 * 提示词里用反引号引用的工具名必须真实存在。
 *
 * 这条守卫来自一次真实漂移：canvas-agent.md 与多个 Skill 长期在指导模型调用
 * `plan_canvas` 和 `plan_and_execute`，而注册表里只有 `plan_write`。模型会照着提示词
 * 去调一个不存在的工具，而任何现有测试都不会发现。这里把「提示词 → 工具目录」变成
 * 可验证的契约，两端任何一侧改动都会被拦下。
 */

/** 由官方 Harness 提供、不在产品注册表里的工具。 */
const HARNESS_TOOLS = new Set([
  'ask_user_question', 'todo_read', 'todo_write', 'skill', 'subagent', 'send_message',
  'interrupt_agent', 'exit_plan_mode', 'get_goal', 'create_goal', 'update_goal',
  'read_uploaded_file', 'read_skill_reference', 'delegate_editor', 'bash',
]);

/**
 * 看着像工具名、实际是枚举值或数据字段的标识。
 * 它们由各自的 schema 定义，不归工具目录管，所以在这里显式登记而不是放宽前缀规则。
 */
const NON_TOOL_IDENTIFIERS = new Set([
  'plan_only',      // plan_write 的 executionMode 取值
  'set_artifact_type', // canvas_update_node 的动作类型，不是独立工具
  'start_state',    // 分镜数据字段（镜头进入状态），与导演台的 start_path 命令无关
]);

/**
 * 形如工具名的词：小写或数字开头，单段或多段下划线。
 * 只认「动作前缀」，避免把 `element_id`、`shot_id`、`start_state` 这类数据字段
 * 误判成工具。数据字段的命名由各自的 schema 与 Skill 正文负责，不在这里校验。
 */
const TOOL_VERB_PREFIXES = [
  'canvas_', 'video_project_', 'text_draft_', 'plan_', 'project_',
  'inspect_', 'list_', 'load_', 'save_', 'read_', 'openreel_', 'editor_',
  'add_', 'apply_', 'set_', 'remove_', 'delete_', 'create_', 'update_', 'rename_',
  'export_', 'render_', 'bake_', 'select_', 'start_', 'finish_', 'cancel_', 'clear_',
  'record_', 'duplicate_', 'ground_', 'scene_', 'history_', 'new_', 'undo', 'redo',
  'toggle_', 'focus_', 'step_', 'seek',
];

function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return extname(entry.name) === '.md' ? [path] : [];
  });
}

function looksLikeTool(identifier) {
  return TOOL_VERB_PREFIXES.some(prefix => identifier.startsWith(prefix));
}

test('提示词、契约与 Skill 引用的工具名都真实存在', async () => {
  const instance = await createRendererEnv();
  try {
    // 直接走生产组合入口：它会注册画布、目录、计划、剪辑与工程级工具。
    // 逐个模块注册不行——register() 有"已注册就早退"的保护，工程级工具会漏掉。
    (await instance.load('services/harnessProductTools')).productToolCount();
    const productTools = new Set((await instance.load('agent/core/toolRegistry')).allAgentTools().map(tool => tool.id));
    for (const type of Object.keys(JSON.parse(readFileSync(join(root, 'renderer/src/config/agent-action-contract.json'), 'utf8')).actions)) {
      productTools.add(type);
    }
    // 原生工具注册的是全部 309 个，与是否在核心集常驻无关：提示词可以引用它们，
    // 可见性由 core/openReelTools.ts 的解锁机制决定。
    const { openReelAgentTools } = await instance.load('agent/core/openReelTools');
    for (const tool of openReelAgentTools) productTools.add(`openreel_${tool.name}`);

    const known = new Set([...productTools, ...HARNESS_TOOLS, ...NON_TOOL_IDENTIFIERS]);
    const missing = [];
    for (const file of markdownFiles(contentRoot)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/`([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`/g)) {
        const identifier = match[1];
        if (!looksLikeTool(identifier) || known.has(identifier)) continue;
        missing.push(`${relative(root, file)} → ${identifier}`);
      }
    }
    assert.deepEqual(missing, [], `以下提示词引用了不存在的工具：\n${missing.join('\n')}`);
  } finally { await instance.dispose(); }
});
