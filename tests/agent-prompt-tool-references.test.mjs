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
  'canvas_', 'director_', 'video_project_', 'text_draft_', 'plan_', 'project_',
  'inspect_', 'list_', 'load_', 'save_', 'read_', 'openreel_', 'editor_',
  'add_', 'apply_', 'set_', 'remove_', 'delete_', 'create_', 'update_', 'rename_',
  'export_', 'render_', 'bake_', 'select_', 'start_', 'finish_', 'cancel_', 'clear_',
  'record_', 'duplicate_', 'ground_', 'scene_', 'history_', 'new_', 'undo', 'redo',
  'toggle_', 'focus_', 'step_', 'seek',
];

/** 导演台命令名（由 iframe 命令表提供，不是产品工具注册表成员）。 */
const DIRECTOR_OPERATIONS = new Set(
  [...readFileSync(join(root, 'vendor/shotloom-director-desk/src/app/host-bridge.ts'), 'utf8')
    .matchAll(/^\s{4}([a-z][a-z0-9_]*):\s*\{ kind:/gm)].map(match => match[1]),
);

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
    // 直接走生产组合入口：它会注册画布、目录、计划、剪辑、导演台与工程级工具。
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

    const known = new Set([...productTools, ...HARNESS_TOOLS, ...DIRECTOR_OPERATIONS, ...NON_TOOL_IDENTIFIERS]);
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

test('导演台命令表里每条命令都有参数契约，且分级只取三类', () => {
  const source = readFileSync(join(root, 'vendor/shotloom-director-desk/src/app/host-bridge.ts'), 'utf8');
  const commandBlock = source.slice(source.indexOf('const commands: Record<string, (input: Input) => unknown> = {'));
  // 命令表里有的条目与相邻命令写在同一行（例如 `undo: ..., redo: ...`），
  // 所以按「行首或逗号/花括号之后的标识符 + 冒号」提取，而不是只看行首。
  const implementations = [...commandBlock.slice(0, commandBlock.indexOf('\nfunction editScenes'))
    .matchAll(/(?:^|[{,]\s*)([a-z][a-z0-9_]*):\s*(?:\(|i\s*=>|function)/gm)].map(match => match[1]);
  // 每条契约独占一行，但实现可以和其他命令同行，所以两边用不同的提取锚点：
  // 契约按行首匹配（前面的注释行不影响），实现按行首或逗号/花括号之后匹配。
  const specs = [...source.matchAll(/^\s*([a-z][a-z0-9_]*):\s*\{ kind: '([a-z]+)'/gm)]
    .map(match => ({ name: match[1], kind: match[2] }));
  const specNames = new Set(specs.map(spec => spec.name));
  // 少写一条契约会让 snapshot 在运行时抛错，所以这里必须完全对齐。
  assert.deepEqual([...specNames].sort(), [...new Set(implementations)].sort());
  assert.deepEqual(specs.filter(spec => !['view', 'edit', 'export'].includes(spec.kind)), []);
  assert.ok(specs.length > 40, `导演台命令数量异常：${specs.length}`);
});

/**
 * 导演台 Agent 必须能"看见"画面，且封闭枚举必须可发现。
 *
 * 这两点各对应一次真实缺陷：84 条命令里没有任何一条把像素交回给模型，Agent 只能盲改
 * 场景、无法核验构图遮挡穿模；而 apply_framing、set_entity_option 的合法
 * 取值从来没进过 catalog，模型只能靠猜中文构图名，猜错就直接失败。
 */
test('导演台提供画面回传，且封闭枚举在 catalog 中可发现', () => {
  const bridge = readFileSync(join(root, 'vendor/shotloom-director-desk/src/app/host-bridge.ts'), 'utf8');
  const tools = readFileSync(join(root, 'renderer/src/agent/tools/directorTools.ts'), 'utf8');

  // 1. 有一条只读命令把渲染帧交回宿主，而不是像 export_image 那样只触发下载。
  assert.match(bridge, /render_preview: \{ kind: 'view'/, 'render_preview 必须存在且按只读执行');
  assert.match(bridge, /render_preview: i => session\.renderPreview\(/, 'render_preview 必须真的调用渲染');
  assert.match(tools, /__toolAttachments/, '画面必须以图片附件交给模型，否则模型看不到');
  assert.match(tools, /data:image\/png;base64,/, '附件必须是宿主可校验的 PNG data URL');

  // 2. export_image 会全分辨率渲染并触发下载，属于 export；标成 view 会绕过写操作审批。
  assert.match(bridge, /export_image: \{ kind: 'export' \}/, 'export_image 不得按只读执行');

  // 3. catalog 必须暴露所有封闭枚举，模型不能靠猜。
  for (const key of ['framings', 'entityOptions']) {
    assert.match(bridge, new RegExp(`${key}:`), `catalog 必须暴露 ${key}`);
  }
  assert.match(bridge, /entityOptions: \{ build: BUILDS, gender: GENDERS \}/, 'build/gender 取值必须来自唯一来源');

  // 4. 构图名必须是从命令实现处导出的同一份常量，两边不能各存一份。
  const sceneCommands = readFileSync(join(root, 'vendor/shotloom-director-desk/src/state/commands/scene.ts'), 'utf8');
  assert.match(sceneCommands, /export const FRAMING_NAMES/, '构图名必须导出供 catalog 使用');
  assert.match(bridge, /import \{ FRAMING_NAMES \}/, 'catalog 必须复用导出的构图名');
});
