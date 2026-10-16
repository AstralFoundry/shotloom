/**
 * 文本 Agent 与编辑器草稿的桥接是唯一数据通道，因此断言真实行为：
 * 会话绑定哪个节点，工具就只能读写那个节点的草稿；编辑器关闭时工具直接不可见。
 */
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

let server;
let projectStore;
let normalization;
let conversations;
let bridge;
let registry;

before(async () => {
  globalThis.localStorage = {
    getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {},
  };
  globalThis.window = {
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  };
  const rendererRoot = fileURLToPath(new URL('../renderer', import.meta.url));
  server = await createServer({
    configFile: false,
    root: rendererRoot,
    resolve: { alias: { '@': path.join(rendererRoot, 'src') } },
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  projectStore = await server.ssrLoadModule('/src/store/projectStore.js');
  normalization = await server.ssrLoadModule('/src/store/projectNormalization.js');
  conversations = await server.ssrLoadModule('/src/services/copilotConversations.mjs');
  bridge = await server.ssrLoadModule('/src/agent/runtime/textDraftBridge.ts');
  registry = await server.ssrLoadModule('/src/agent/core/toolRegistry.ts');
  const { registerTextDraftTools } = await server.ssrLoadModule('/src/agent/tools/textTools.ts');
  registerTextDraftTools();
  projectStore.store.project = normalization.createProject('文本 Agent 测试项目');
});

after(async () => {
  await server?.close();
  delete globalThis.localStorage;
  delete globalThis.window;
});

function contextFor(conversationId) {
  return {
    requestId: 'test', turnId: 'turn', projectKey: 'project', conversationId,
    agentId: 'text-primary',
    signal: new AbortController().signal,
    loadedSkillIds: new Set(), attachments: [],
    capabilities: { nodeExecution: true }, state: new Map(), emit: () => {},
  };
}

async function runTool(name, input, context) {
  const call = registry.prepareAgentToolCall(name, JSON.stringify(input || {}), context);
  return call.definition.execute(call.input, context);
}

test('文本 Agent 只看见草稿读写工具，会话未绑定节点或编辑器关闭时不可用', () => {
  const project = projectStore.store.project;
  const text = conversations.createCopilotConversation(project, {
    title: '文本 Agent', agentId: 'text-primary', textNodeId: 'text-a',
  });
  const unregister = bridge.registerTextDraftTarget({
    nodeId: 'text-a', read: () => '正文', apply: (content) => content,
  });

  const visible = registry.listAgentTools(contextFor(text.id)).map((tool) => tool.id);
  assert.ok(visible.includes('text_draft_read'));
  assert.ok(visible.includes('text_draft_write'));

  unregister();
  assert.deepEqual(
    registry.listAgentTools(contextFor(text.id)).map((tool) => tool.id).filter((id) => id.startsWith('text_draft_')),
    [],
    '编辑器关闭后草稿工具不得进入模型请求',
  );

  const canvas = conversations.getActiveCopilotConversation(project);
  assert.deepEqual(
    registry.listAgentTools(contextFor(canvas.id)).map((tool) => tool.id).filter((id) => id.startsWith('text_draft_')),
    [],
    '画布会话没有绑定文本节点',
  );
});

test('读取与写入落在会话绑定的草稿上，追加会合并用户已输入的内容', async () => {
  const project = projectStore.store.project;
  const textA = conversations.createCopilotConversation(project, {
    title: '文本 Agent', agentId: 'text-primary', textNodeId: 'text-a',
  });
  const textB = conversations.createCopilotConversation(project, {
    title: '文本 Agent', agentId: 'text-primary', textNodeId: 'text-b',
  });
  let draftA = '用户已写的开头';
  let draftB = '另一个节点的内容';
  const unregisters = [
    bridge.registerTextDraftTarget({
      nodeId: 'text-a',
      read: () => draftA,
      apply: (content, mode) => {
        draftA = mode === 'append' && draftA.trim() ? `${draftA.trimEnd()}\n\n${content}` : content;
        return draftA;
      },
    }),
    bridge.registerTextDraftTarget({
      nodeId: 'text-b', read: () => draftB, apply: (content) => { draftB = content; return content; },
    }),
  ];

  const read = await runTool('text_draft_read', {}, contextFor(textA.id));
  assert.equal(read.content, '用户已写的开头');
  assert.equal(read.characters, read.content.length);

  const writeDefinition = registry.prepareAgentToolCall(
    'text_draft_write', JSON.stringify({ content: 'placeholder' }), contextFor(textA.id),
  ).definition;
  const appended = await runTool('text_draft_write', { content: '补一段结尾', mode: 'append' }, contextFor(textA.id));
  assert.equal(draftA, '用户已写的开头\n\n补一段结尾');
  assert.equal(draftB, '另一个节点的内容', '会话不能改动其他节点的草稿');
  assert.equal(appended.characters, draftA.length);
  assert.deepEqual(
    writeDefinition.summarizeResult(appended),
    { summary: `已追加 ${'补一段结尾'.length} 字，草稿共 ${draftA.length} 字` },
  );

  const replaced = await runTool('text_draft_write', { content: '整篇重写', mode: 'replace' }, contextFor(textA.id));
  assert.equal(draftA, '整篇重写');
  assert.equal(replaced.replacedCharacters, '用户已写的开头\n\n补一段结尾'.length);
  assert.deepEqual(
    writeDefinition.summarizeResult(replaced),
    { summary: '已写入草稿，共 4 字' },
  );

  await assert.rejects(
    () => runTool('text_draft_write', { content: '   ' }, contextFor(textA.id)),
    /写入内容为空/,
  );

  for (const off of unregisters) off();
});

test('文本 Agent 使用独立提示词，不带画布制作与生成指令', async () => {
  const { buildAgentSystemPrompt } = await server.ssrLoadModule('/src/agent/content/instructions.ts');
  const prompt = buildAgentSystemPrompt({ agentId: 'text-primary' }, 'RUNTIME_MODEL_CONTRACT');
  assert.match(prompt, /RUNTIME_MODEL_CONTRACT/);
  assert.match(prompt, /草稿/);
  assert.doesNotMatch(prompt, /plan_canvas|canvas_media_frame|Production Plan|media_generation/);
});

test('草稿桥只服务已注册的节点，重复注册以最后一次为准', () => {
  const unregister = bridge.registerTextDraftTarget({
    nodeId: 'shared', read: () => 'first', apply: (content) => content,
  });
  assert.equal(bridge.textDraftTarget('shared').read(), 'first');
  const unregisterSecond = bridge.registerTextDraftTarget({
    nodeId: 'shared', read: () => 'second', apply: (content) => content,
  });
  assert.equal(bridge.textDraftTarget('shared').read(), 'second');
  unregister();
  // 被替换掉的编辑器留下的旧注销函数，不能把当前编辑器一起删掉。
  assert.equal(bridge.textDraftTarget('shared').read(), 'second');
  unregisterSecond();
  assert.equal(bridge.textDraftTarget('shared'), null);
  assert.equal(bridge.textDraftTarget('missing'), null);
});
