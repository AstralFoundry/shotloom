import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  agentToolIcon,
  canRequestAgentClarification,
  clearAgentToolsForTests,
  listAgentTools,
  prepareAgentToolCall,
  registerAgentTool,
} from '../renderer/src/agent/core/toolRegistry.ts';

test('唯一 Agent 可在关键信息缺失时询问', () => {
  assert.equal(canRequestAgentClarification(), true);
});

test('Skill 命名空间工具在对应 Skill 加载前不进入模型请求', () => {
  clearAgentToolsForTests();
  registerAgentTool({
    id: 'skill_short_drama__inspect_structure',
    title: '拆分场次',
    description: '测试工具',
    effect: 'agent_state_write',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: () => ({ success: true }),
  });
  const context = {
    requestId: 'test', turnId: 'turn', projectKey: 'project', conversationId: 'conversation',
    agentId: 'canvas-primary',
    signal: new AbortController().signal,
    loadedSkillIds: new Set(['video-production']), attachments: [],
    capabilities: { nodeExecution: false }, state: new Map(), emit: () => {},
  };
  // 只加载了别的 Skill：该工具既不会被序列化给模型，也不允许执行。
  assert.deepEqual(listAgentTools(context).map((tool) => tool.id), []);
  assert.throws(
    () => prepareAgentToolCall('skill_short_drama__inspect_structure', '{}', context),
    /not visible to Agent canvas-primary/,
  );
  context.loadedSkillIds = new Set(['short-drama']);
  assert.deepEqual(listAgentTools(context).map((tool) => tool.id), ['skill_short_drama__inspect_structure']);
  assert.equal(prepareAgentToolCall('skill_short_drama__inspect_structure', '{}', context).definition.id,
    'skill_short_drama__inspect_structure');
  clearAgentToolsForTests();
});

test('默认 Agent 工具以真实注册表为准并允许 Runtime 重复激活', () => {
  const source = readFileSync(
    new URL('../renderer/src/agent/tools/registerDefaultTools.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /hasAgentTool\('canvas_list_nodes'\)/);
  assert.doesNotMatch(source, /let registered = false/);
});

test('画布能力通过细粒度工具暴露且不保留批量模型入口', () => {
  const source = readFileSync(
    new URL('../renderer/src/agent/tools/canvasTools.ts', import.meta.url),
    'utf8',
  );
  for (const tool of [
    'canvas_list_nodes', 'canvas_get_node', 'canvas_focus_nodes',
    'canvas_create_node', 'canvas_update_node', 'canvas_connect_nodes',
    'canvas_layout_nodes', 'canvas_delete_node', 'canvas_update_edge',
    'canvas_start_generation',
  ]) {
    assert.match(source, new RegExp(`id: '${tool}'`));
  }
  assert.doesNotMatch(source, /id: 'mutate_canvas'|id: 'get_canvas'|id: 'select_canvas'/);
  assert.match(source, /execute: executeFocusedAction/);
  assert.match(source, /normalizeAgentActions\(input\.actions, context\.turnId\)/);
  assert.match(source, /focusedActionSchema\(\['update_gen_config', 'move_node'\]\)/);
  assert.match(source, /flattenAgentActionSchema\(buildAgentActionSchema/);
  assert.doesNotMatch(source, /return \{ type: 'object' as const, oneOf:/);
  assert.doesNotMatch(source, /note_node/);
  const actionHandler = readFileSync(
    new URL('../renderer/src/services/agentCanvasActionHandler.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(actionHandler, /note_node|'note'/);
});

test('普通画布 Agent 暴露真实视频抽帧工具并返回视觉附件', () => {
  const source = readFileSync(new URL('../renderer/src/agent/tools/canvasTools.ts', import.meta.url), 'utf8');
  assert.match(source, /id: 'canvas_media_frame'/);
  assert.match(source, /captureVideoFrameToProject/);
  assert.match(source, /__toolAttachments/);
  assert.match(source, /timesSec/);
});

// 图标属于工具自身，展示层不再维护工具名表；缺省时按 effect 取类别图标，
// 未知 ID 也不能返回空字符串让图标列塌陷。
test('工具图标由注册表声明，缺省时按 effect 取类别图标', () => {
  const define = (id, extra) => registerAgentTool({
    id,
    title: '测试工具',
    description: '测试工具',
    effect: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: () => ({ success: true }),
    ...extra,
  });
  clearAgentToolsForTests();
  define('test_icons__declared', { icon: 'film' });
  define('test_icons__fallback', {});
  assert.equal(agentToolIcon('test_icons__declared'), 'film');
  assert.equal(agentToolIcon('test_icons__fallback'), 'search');
  assert.equal(agentToolIcon('test_icons__missing'), 'wrench');
  clearAgentToolsForTests();
});

// 写错图标名不会报错，IconSymbol 会静默换成 box，所以必须按真实清单校验。
test('每个 Agent 工具都声明图标且图标名真实存在', () => {
  const iconsSource = readFileSync(
    new URL('../renderer/src/app/components/IconSymbol.tsx', import.meta.url),
    'utf8',
  ).match(/const paths = \{([\s\S]*?)\n\} as const/)[1];
  const iconNames = new Set([...iconsSource.matchAll(/^\s{2}"?([a-z-]+)"?:/gm)].map(([, name]) => name));
  assert.ok(iconNames.size > 40, '未解析到图标清单');

  const files = [
    'canvasTools', 'catalogTools', 'lifecycleTools',
    'productionPlanTools', 'scriptTools', 'videoEditorTools',
  ];
  const declared = [];
  const missingIcon = [];
  for (const file of files) {
    const source = readFileSync(new URL(`../renderer/src/agent/tools/${file}.ts`, import.meta.url), 'utf8');
    // 定义可以是一行或多行，按下一个 id 切块后再在块内找 icon，避免依赖换行。
    const starts = [...source.matchAll(/\bid: '([a-z_]+)'/g)];
    starts.forEach((start, index) => {
      const body = source.slice(start.index, starts[index + 1]?.index ?? source.length);
      const icon = /\bicon: '([a-z-]+)'/.exec(body)?.[1];
      if (icon) declared.push([start[1], icon]);
      else missingIcon.push(`${file}::${start[1]}`);
    });
  }
  assert.deepEqual(missingIcon, [], '每个工具定义都必须声明图标');
  assert.ok(declared.length >= 35, `解析到的工具定义异常：${declared.length}`);
  const invalid = declared.filter(([, icon]) => !iconNames.has(icon));
  assert.deepEqual(invalid, [], '工具声明了不存在的图标');
  assert.notEqual(declared.filter(([, icon]) => icon === 'wrench').length, declared.length, '工具不能全部共用同一个图标');
});
