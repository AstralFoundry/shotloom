import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { classifyAgentToolResult, validateToolInput } from '../renderer/src/agent/core/toolRegistry.ts';
import { buildAgentActionSchema, normalizeAgentAction } from '../renderer/src/agent/tools/agentProtocol.ts';
import { IncrementalActionsParser } from '../renderer/src/utils/chatCompletionStream.mjs';
import { MODEL_AGENT_CANVAS_ACTION_TYPES } from '../renderer/src/utils/agentCanvasActionTypes.mjs';
import {
  compileGenerationNodeConfig,
  generationNodeConfig,
  generationOutputSpec,
} from '../renderer/src/domain/graph/GenerationNodeContract.ts';
import { validateGraphMutations } from '../renderer/src/domain/graph/GraphValidator.ts';

const contract = JSON.parse(readFileSync(
  new URL('../renderer/src/config/agent-action-contract.json', import.meta.url),
  'utf8',
));

test('模型可见 action schema 只在工具边界约束动作类型', () => {
  const schema = buildAgentActionSchema(contract, {
    allowedTypes: ['create_gen_node', 'connect_nodes'],
  });
  assert.throws(() => validateToolInput(schema, {
    type: 'connect_nodes',
    source: 'N-01',
  }), /target is required/);
  assert.doesNotThrow(() => validateToolInput(schema, {
    type: 'create_gen_node',
    tempId: 'image-1',
    nodeType: 'imageGeneration',
    prompt: '电影感夜景中的红色汽车',
    model: 'gpt-image-2',
    recipeId: 'general-image',
    outputSpec: { aspectRatio: '16:9' },
    config: { aspectRatio: '16:9' },
  }));
  assert.doesNotThrow(() => validateToolInput(schema, {
    type: 'create_gen_node',
    nodeType: 'imageGeneration',
    prompt: '使用参考图生成夜景汽车',
    model: 'gpt-image-2',
    recipeId: 'general-image',
    inputLinks: [{ nodeId: 'N-01' }],
  }));
  assert.doesNotThrow(() => validateToolInput(schema, {
    type: 'connect_nodes',
    source: 'N-01',
    target: 'N-02',
    role: 'referenceImage',
    slot: 'firstFrame',
  }));
  assert.throws(() => validateToolInput(schema, {
    type: 'connect_nodes',
    source: 'N-01',
    target: 'N-02',
    role: 'dependencyOnly',
  }), /role must be one of/);
  assert.throws(() => validateToolInput(schema, {
    type: 'create_gen_node',
    nodeType: 'imageGeneration',
    prompt: '错误的简写输入',
    model: 'gpt-image-2',
    recipeId: 'general-image',
    inputLinks: ['N-01'],
  }), /inputLinks\[0\] must be object/);
  assert.doesNotThrow(() => validateToolInput(schema, {
    type: 'create_gen_node',
    nodeType: 'imageGeneration',
    prompt: '缺少模型',
    recipeId: 'general-image',
  }));
  assert.throws(() => validateToolInput(schema, {
    type: 'add_node',
    nodeType: 'imageGeneration',
  }), /type must be one of/);
});

test('Agent 画布工具公开连接已有节点动作', () => {
  assert.equal(MODEL_AGENT_CANVAS_ACTION_TYPES.includes('connect_nodes'), true);
  const schema = buildAgentActionSchema(contract, {
    allowedTypes: MODEL_AGENT_CANVAS_ACTION_TYPES,
  });
  const connect = schema.oneOf.find((branch) => branch.properties.type.enum[0] === 'connect_nodes');
  assert.deepEqual(connect.required, ['type', 'source', 'target']);
  assert.match(connect.description, /连接两个现有节点/);
});

test('Agent 不暴露视频输入的内部彩铅预处理', () => {
  assert.equal(MODEL_AGENT_CANVAS_ACTION_TYPES.includes('apply_colored_pencil'), false);
  assert.equal(Object.hasOwn(contract.actions, 'apply_colored_pencil'), false);
  const schema = buildAgentActionSchema(contract, {
    allowedTypes: MODEL_AGENT_CANVAS_ACTION_TYPES,
  });
  assert.equal(schema.oneOf.some((branch) => branch.properties.type.enum[0] === 'apply_colored_pencil'), false);
  assert.throws(() => validateToolInput(schema, {
    type: 'apply_colored_pencil',
    tempId: 'pencil-image',
    nodeId: 'N-01',
  }), /Invalid tool input/);
});

test('Agent 不暴露画布菜单中不存在的资源节点创建动作', () => {
  assert.equal(MODEL_AGENT_CANVAS_ACTION_TYPES.includes('create_resource_node'), false);
  assert.equal(Object.hasOwn(contract.actions, 'create_resource_node'), false);
  const schema = buildAgentActionSchema(contract, {
    allowedTypes: MODEL_AGENT_CANVAS_ACTION_TYPES,
  });
  const exposedCreateTypes = schema.oneOf
    .map((branch) => branch.properties.type.enum[0])
    .filter((type) => type.startsWith('create_'));
  assert.deepEqual(exposedCreateTypes, ['create_gen_node', 'create_note_node']);
  assert.deepEqual(Object.keys(contract.actions).sort(), [...MODEL_AGENT_CANVAS_ACTION_TYPES].sort());
});

test('Agent 可以把素材库真实文件放回普通画布节点', () => {
  const schema = buildAgentActionSchema(contract, {
    allowedTypes: MODEL_AGENT_CANVAS_ACTION_TYPES,
  });
  const branch = schema.oneOf.find((item) => item.properties.type.enum[0] === 'place_asset_on_canvas');
  assert.ok(branch);
  assert.deepEqual(
    ['assetId', 'materialId', 'assetName'].filter((key) => Object.hasOwn(branch.properties, key)),
    ['assetId', 'materialId', 'assetName'],
  );
  assert.match(branch.description, /普通图片、视频、音频或文本节点/);
});

test('普通画布 schema 不暴露付费运行 action', () => {
  const generationTypes = new Set(['start_generation']);
  const schema = buildAgentActionSchema(contract, {
    allowedTypes: Object.keys(contract.actions).filter((type) => !generationTypes.has(type)),
  });
  const exposed = schema.oneOf.map((branch) => branch.properties.type.enum[0]);

  assert.ok(exposed.includes('create_gen_node'));
  assert.equal(exposed.includes('create_note_node'), true);
  assert.equal(exposed.includes('start_generation'), false);
  assert.equal(exposed.includes('create_resource_node'), false);
});

test('工具 JSON 的部分成功不会被归类为整批失败', () => {
  assert.deepEqual(classifyAgentToolResult({ success: false, error: '模型不可用' }), {
    failed: true,
    error: '模型不可用',
    skippedCount: 0,
  });
  assert.equal(classifyAgentToolResult({ success: true, appliedCount: 1, skippedCount: 1 }).failed, false);
  assert.equal(classifyAgentToolResult({ success: true, appliedCount: 1 }).failed, false);
});

test('流式 Action 解析器逐个产出完整动作', () => {
  const parser = new IncrementalActionsParser();
  assert.deepEqual(parser.push('{"actions":[{"type":"create_gen_'), []);
  assert.deepEqual(parser.push('node","prompt":"夜景"},{"type":"move_node","nodeId":"N-01"'), [
    { type: 'create_gen_node', prompt: '夜景' },
  ]);
  assert.deepEqual(parser.push(',"x":120}]}'), [{ type: 'move_node', nodeId: 'N-01', x: 120 }]);
});

test('动作归一化补齐类型、临时 ID、节点类型和输入列表', () => {
  assert.deepEqual(normalizeAgentAction({ prompt: '夜景' }, 0, 'run-1'), {
    type: 'create_gen_node', prompt: '夜景', tempId: 'run-1:node:1',
    inputLinks: [], nodeType: 'imageGeneration', config: {}, outputSpec: {},
  });
  assert.deepEqual(normalizeAgentAction({
    type: 'create_gen_node',
    prompt: '参考首帧生成视频',
    inputLinks: [{ nodeId: 'N-01', role: 'referenceImage', slot: 'firstFrame', required: false }],
  }, 0, 'run-2').inputLinks, [{
    nodeId: 'N-01', role: 'referenceImage', slot: 'firstFrame', required: false,
  }]);
});

test('画布更新工具契约允许修改已有 Note 而不重复创建', () => {
  const schema = buildAgentActionSchema(contract, {
    allowedTypes: ['update_note_node'],
  });
  assert.doesNotThrow(() => validateToolInput(schema, {
    type: 'update_note_node', nodeId: 'N-01', content: '修订后的 Prompt Draft',
  }));
  assert.equal(MODEL_AGENT_CANVAS_ACTION_TYPES.includes('update_note_node'), true);
});

test('图校验器能解析已落地助手节点的 tempId', () => {
  const project = {
    nodes: [{ id: 'real-1', type: 'textGeneration', title: '第一段', status: 'idle' }],
    edges: [],
    tasks: [],
    tempIdMap: { 'assistant:run:script-1': 'real-1' },
  };
  const result = validateGraphMutations(project, [
    { id: 'real-2', tempId: 'assistant:run:script-2', type: 'textGeneration', title: '第二段', prompt: '生成第二段文本' },
  ], [{
    source: 'assistant:run:script-1',
    target: 'assistant:run:script-2',
    kind: 'dependency',
  }], [], []);

  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test('生成节点 config 只接受模型参数', () => {
  assert.deepEqual(generationNodeConfig({ aspectRatio: '16:9' }), { aspectRatio: '16:9' });
});

test('生成节点 config 出现 prompt/model 时直接拒绝', () => {
  assert.throws(() => generationNodeConfig({ prompt: '重复提示词' }), /不得包含 prompt/);
  assert.throws(() => generationNodeConfig({ model: '重复模型' }), /不得包含 model/);
});

test('生成配置只保留当前模型 schema 参数并补其默认值', () => {
  const params = [
    { key: 'prompt', type: 'text' },
    { key: 'temperature', numeric: true, default: 0.7 },
  ];
  assert.deepEqual(compileGenerationNodeConfig({
    aspectRatio: '16:9', duration: 4, imageSize: '1536x1024', resolution: '1080p',
  }, params), { temperature: 0.7 });
});

test('生成配置省略空的可选数字并按模型协议限制数值范围', () => {
  const params = [
    { key: 'optionalSeed', numeric: true },
    { key: 'maxCompletionTokens', numeric: true, presentation: { min: 1, max: 32768, step: 1 } },
  ];
  assert.deepEqual(compileGenerationNodeConfig({
    optionalSeed: '', maxCompletionTokens: 0, staleModelParam: 8192,
  }, params), { maxCompletionTokens: 1 });
});

test('图片输出意图同步编译为 GPT Image 的真实 size 参数', () => {
  const params = [
    { key: 'size', type: 'select', default: '1024x1024', options: ['1024x1024', '1536x864', '1536x1024', '1024x1536'] },
    { key: 'generationCount', numeric: true, default: 1, options: [1, 2, 4] },
  ];
  const outputSpec = generationOutputSpec('imageGeneration', {
    aspectRatio: '16:9', duration: 4, resolution: '1080p',
  });
  assert.deepEqual(outputSpec, { aspectRatio: '16:9' });
  assert.deepEqual(compileGenerationNodeConfig({}, params, outputSpec), {
    size: '1536x864', generationCount: 1,
  });
});

test('图事务入口拒绝生成节点重复使用 config.prompt/config.model', () => {
  const result = validateGraphMutations({ nodes: [], edges: [], tasks: [] }, [{
    tempId: 'image-1',
    type: 'imageGeneration',
    title: '测试图片',
    prompt: '顶层提示词',
    model: 'gpt-image-2',
    config: { prompt: '重复提示词', model: 'gpt-image-2', aspectRatio: '16:9' },
  }], [], [], []);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'DUPLICATE_GENERATION_FIELDS'));
});
