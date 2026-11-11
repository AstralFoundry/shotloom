import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';
import { readSource } from './helpers/sourceContract.mjs';

let env, tools, projects, normalization, settings, identity, sessions, drafts, translate;
before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  projects = await env.load('store/projectStore');
  normalization = await env.load('store/projectNormalization');
  settings = (await env.load('store/settingsStore')).settingsStore;
  identity = await env.load('services/agentProjectIdentity');
  sessions = await env.load('services/harnessSessionStore');
  drafts = await env.load('services/textDraftBridge');
  tools = await env.load('services/harnessProductTools');
  translate = (await env.load('i18n/index')).t;
});
after(async () => { await env?.dispose(); });
function fixture(agentId = 'canvas-primary', nodeId) {
  projects.store.project = normalization.createProject('Harness product boundary');
  projects.store.projectDir = '/harness-project';
  projects.store.filePath = '/harness-project/project.shotloom.json';
  settings.agentApprovalPolicy = 'ask'; settings.agentCanRunNodes = false;
  const conversation = sessions.createHarnessSession(projects.store.project, {
    agentId, ...(nodeId && agentId === 'text-primary' ? { textNodeId: nodeId } : {}),
    ...(nodeId && agentId === 'editor-primary' ? { editorNodeId: nodeId } : {}),
    ...(nodeId && agentId === 'director-primary' ? { directorNodeId: nodeId } : {}),
  });
  const binding = { sessionId: crypto.randomUUID(), projectKey: identity.getAgentProjectKey(), conversationId: conversation.id, agentId, ...(nodeId ? { nodeId } : {}) };
  const catalog = tools.productToolCatalog(binding);
  tools.bindProductSession(binding);
  return { binding, catalog };
}
function request(binding, toolName, input = {}, extra = {}) {
  return { requestId: crypto.randomUUID(), binding, toolName, input, ...extra };
}

test('skill authoring requires approval, persists readback, detects stale edits and protects built-ins', async () => {
  const library = await env.load('store/skillsStore');
  await library.loadGlobalSkills();
  const { binding, catalog } = fixture();
  assert.equal(catalog.find(tool => tool.name === 'save_skill').approvalRequired, true);
  const input = { id: 'test-prop-method', name: '道具设定方法', description: '用于道具设定', instructions: '读取真实素材后创作道具节点。', agentIds: ['canvas-primary'] };
  const denied = await tools.executeProductRequest(request(binding, 'save_skill', input));
  assert.equal(denied.code, 'APPROVAL_REQUIRED');
  assert.equal(library.skillsStore.skills.some(skill => skill.id === input.id), false);
  const fullAccess = await tools.executeProductRequest(request(binding, 'save_skill', { ...input, id: 'test-prop-method-full-access' }, { authorizedByFullAccess: true }));
  assert.equal(fullAccess.result.success, true);
  const saved = await tools.executeProductRequest(request(binding, 'save_skill', input, { approvedByHarness: true }));
  assert.equal(saved.result.success, true);
  await library.loadGlobalSkills();
  const read = await tools.executeProductRequest(request(binding, 'inspect_skills', { skillId: input.id }));
  assert.equal(read.result.skills[0].instructions, input.instructions);
  assert.deepEqual(read.result.skills[0].agentIds, input.agentIds);
  const conflict = await tools.executeProductRequest(request(binding, 'save_skill', { ...input, instructions: '过期修改' }, { approvedByHarness: true }));
  assert.equal(conflict.result.code, 'SKILL_VERSION_CONFLICT');
  const updated = await tools.executeProductRequest(request(binding, 'save_skill', { ...input, instructions: '更新后的方法', expectedUpdatedAt: read.result.skills[0].updatedAt }, { approvedByHarness: true }));
  assert.equal(updated.result.success, true);
  const builtIn = await tools.executeProductRequest(request(binding, 'save_skill', { ...input, id: 'skill-creator' }, { approvedByHarness: true }));
  assert.equal(builtIn.result.code, 'BUILT_IN_SKILL');
  const editor = fixture('editor-primary', 'timeline');
  assert.equal(editor.catalog.some(tool => tool.name === 'save_skill'), false);
});

test('failed skill storage does not publish an unsaved skill', async () => {
  const library = await env.load('store/skillsStore');
  const api = (await env.load('services/desktopApi')).desktopApi;
  const original = api.skills.setGlobal;
  api.skills.setGlobal = async () => { throw new Error('storage unavailable'); };
  try {
    const { binding } = fixture();
    await assert.rejects(tools.executeProductRequest(request(binding, 'save_skill', {
      id: 'test-unsaved-skill', name: '未保存', description: '测试失败', instructions: '不会保存', agentIds: ['canvas-primary'],
    }, { approvedByHarness: true })), /storage unavailable/);
    assert.equal(library.skillsStore.skills.some(skill => skill.id === 'test-unsaved-skill'), false);
  } finally { api.skills.setGlobal = original; }
});

test('named product catalog covers workbenches and excludes generic forwarding and legacy loop tools', () => {
  const { catalog } = fixture();
  for (const name of ['canvas_list_nodes', 'canvas_create_node', 'canvas_start_generation', 'inspect_assets', 'inspect_tasks', 'plan_write', 'project_save', 'project_export_package']) assert.ok(catalog.some(tool => tool.name === name), name);
  for (const name of ['shotloom_tool', 'request_clarification', 'todo_write', 'create_goal', 'exit_plan_mode']) assert.ok(!catalog.some(tool => tool.name === name), name);
  const text = fixture('text-primary', 'text-a').catalog;
  assert.deepEqual(text.map(tool => tool.name).sort(), ['text_draft_read', 'text_draft_write']);
  const clip = fixture('editor-primary', 'clip-a').catalog;
  assert.ok(clip.some(tool => tool.name === 'video_project_actions'));
  assert.ok(!clip.some(tool => tool.name === 'canvas_create_node'));
});

test('canvas, editor and director all receive video frame tool with file path and contact sheet options', () => {
  for (const agentId of ['canvas-primary', 'editor-primary', 'director-primary']) {
    const { catalog } = fixture(agentId);
    const frame = catalog.find(tool => tool.name === 'canvas_media_frame');
    assert.ok(frame, `${agentId} should receive canvas_media_frame`);
    assert.equal(frame.effect, 'read');
    assert.ok(frame.parameters.properties.nodeId);
    assert.ok(frame.parameters.properties.filePath);
    assert.deepEqual(frame.parameters.properties.outputMode.enum, ['frames', 'contact_sheet']);
    assert.match(frame.parameters.properties.outputMode.description, /多时间点概览优先选 contact_sheet/);
    assert.equal(frame.parameters.properties.timesSec.maxItems, 24);
  }
  assert.equal(fixture('text-primary').catalog.some(tool => tool.name === 'canvas_media_frame'), false);
});

test('editor receives supported OpenReel schemas and retains approval and node boundaries', async () => {
  const api = (await env.load('services/desktopApi')).desktopApi;
  const platform = api.platform;
  api.platform = 'tauri';
  const native = (await env.load('agent/core/openReelTools')).openReelAgentTools;
  const { binding, catalog } = fixture('editor-primary', 'native-clip');
  projects.store.project.nodes.push({ id: 'native-clip', type: 'videoEditor', title: 'Native editor' });
  const calls = [];
  const { registerActiveVideoEditor } = await env.load('agent/tools/videoEditorTools');
  const release = registerActiveVideoEditor({ projectKey: binding.projectKey, nodeId: binding.nodeId,
    executeNativeTool: async (name, input) => { calls.push({ name, input }); return { ok: true, summary: 'Actual adapter receipt', data: {
      id: 'track-real', coreWorkflow: ['add_track', 'rig_humanoid_model'],
      recoveryWorkflow: ['probe_rigging_backend', 'list_tracks'], suggestedNextTools: ['openreel_rig_humanoid_model', 'inspect_3d_model'],
    } }; },
    refreshState: async () => {},
  });
  try {
    const registered = catalog.filter(tool => tool.name.startsWith('openreel_'));
    const core = (await env.load('agent/core/openReelTools')).EDITOR_CORE_TOOL_NAMES;
    // 默认只下发核心集，其余等 editor_find_tools 解锁，避免 309 个 schema 淹没提示词。
    assert.equal(registered.length, core.length);
    for (const tool of native) {
      const exposed = registered.find(item => item.name === `openreel_${tool.name}`);
      if (core.includes(tool.name)) {
        assert.deepEqual(exposed.parameters, tool.inputSchema, tool.name);
        assert.equal(exposed.approvalRequired, tool.destructive || tool.expensive, tool.name);
      } else {
        assert.equal(exposed, undefined, `${tool.name} must stay hidden until unlocked`);
      }
    }
    const read = await tools.executeProductRequest(request(binding, 'openreel_list_tracks'));
    assert.equal(read.result.data.id, 'track-real');
    assert.equal(read.result.applied, false);
    assert.deepEqual(read.result.data.coreWorkflow, ['add_track']);
    assert.deepEqual(read.result.data.recoveryWorkflow, ['list_tracks']);
    assert.deepEqual(read.result.data.suggestedNextTools, ['inspect_3d_model']);
    const input = { trackId: 'track-real' };
    const denied = await tools.executeProductRequest(request(binding, 'openreel_remove_track', input));
    assert.equal(denied.code, 'APPROVAL_REQUIRED');
    assert.equal(calls.length, 1);
    const applied = await tools.executeProductRequest(request(binding, 'openreel_remove_track', input, { approvedByHarness: true }));
    assert.equal(applied.result.applied, true);
    assert.deepEqual(calls.at(-1), { name: 'remove_track', input });
    const stats = await tools.executeProductRequest(request(binding, 'openreel_export_creation_scene_gltf', { includeGltf: false }, { phase: 'authorize' }));
    assert.equal(stats.approvalRequired, false);
    const exportFile = request(binding, 'openreel_export_creation_scene_gltf', {});
    assert.equal((await tools.executeProductRequest({ ...exportFile, phase: 'authorize' })).approvalRequired, true);
    assert.equal((await tools.executeProductRequest(exportFile)).code, 'APPROVAL_REQUIRED');
    assert.equal(calls.length, 2, 'model export must not reach the runtime before approval');
    projects.store.project.harnessSessions.find(item => item.id === binding.conversationId).editorNodeId = 'other-node';
    const { t } = await env.load('i18n/index');
    await assert.rejects(tools.executeProductRequest(request(binding, 'openreel_list_tracks')), { message: t('agent.bindingNodeMissing') });
  } finally { release(); api.platform = platform; }
  assert.equal(fixture().catalog.some(tool => tool.name.startsWith('openreel_')), false);
});

test('unsupported backends stay hidden and stale desktop calls cannot run after storage becomes unavailable', async () => {
  const api = (await env.load('services/desktopApi')).desktopApi;
  const platform = api.platform;
  const policy = JSON.parse(readSource('renderer/src/config/openreel-agent-policy.json'));
  const upstream = JSON.parse(readSource('renderer/src/config/openreel-agent-tools.json'));
  const registry = await env.load('agent/core/toolRegistry');
  const { registerActiveVideoEditor } = await env.load('agent/tools/videoEditorTools');
  let dispatched = 0;
  let release;
  try {
    api.platform = 'tauri';
    const { binding, catalog } = fixture('editor-primary', 'supported-tools');
    projects.store.project.nodes.push({ id: binding.nodeId, type: 'videoEditor' });
    release = registerActiveVideoEditor({ projectKey: binding.projectKey, nodeId: binding.nodeId,
      executeNativeTool: async () => { dispatched++; return { ok: true }; }, refreshState: async () => {},
    });
    const names = catalog.map(tool => tool.name);
    const openReel = await env.load('agent/core/openReelTools');
    const core = openReel.EDITOR_CORE_TOOL_NAMES;
    assert.equal(names.filter(name => name.startsWith('openreel_')).length, core.length);
    for (const name of Object.keys(policy.excludedTools)) {
      assert.equal(names.includes(`openreel_${name}`), false, name);
      assert.equal(registry.hasAgentTool(`openreel_${name}`), false, name);
      await assert.rejects(tools.executeProductRequest(request(binding, `openreel_${name}`, {}, { approvedByHarness: true })), { message: translate('agent.toolUnavailable', { name: `openreel_${name}` }) });
    }
    for (const name of policy.desktopProjectTools) assert.ok(names.includes(`openreel_${name}`), name);
    // bake_creation_asset 不在核心集里：解锁前不下发。这条断言只能跑一次，
    // 因为解锁是会话级状态，会在后续重复检查里残留。
    assert.equal(catalog.some(tool => tool.name === 'openreel_bake_creation_asset'), false);
    const rejectDesktopCalls = async () => {
      const current = tools.productToolCatalog(binding);
      for (const name of [...policy.desktopProjectTools.map(name => `openreel_${name}`), 'video_project_export', 'video_project_frame']) {
        assert.equal(current.some(tool => tool.name === name), false, name);
        await assert.rejects(tools.executeProductRequest(request(binding, name, {}, { approvedByHarness: true })), { message: translate('agent.toolUnavailable', { name }) }, name);
      }
      assert.ok(current.some(tool => tool.name === 'openreel_add_track'));
      assert.ok(current.some(tool => tool.name === 'openreel_inspect_3d_model'));
    };
    projects.store.projectDir = '';
    await rejectDesktopCalls();
    projects.store.projectDir = '/harness-project';
    api.platform = 'browser';
    await rejectDesktopCalls();
    assert.equal(dispatched, 0);
    // 解锁后进入目录；非桌面运行时把 includeGltf 降级为只能传 false。
    openReel.unlockNativeTools(['bake_creation_asset'], binding.conversationId);
    const unlocked = tools.productToolCatalog(binding);
    assert.deepEqual(unlocked.find(tool => tool.name === 'openreel_bake_creation_asset').parameters.properties.includeGltf.enum, [false]);
    await assert.rejects(tools.executeProductRequest(request(binding, 'openreel_bake_creation_asset', { assetId: 'asset', includeGltf: true }, { approvedByHarness: true })), /includeGltf/);
    api.platform = 'tauri';
    assert.ok(tools.productToolCatalog(binding).some(tool => tool.name === 'openreel_export_video'));
  } finally { release?.(); api.platform = platform; }
});

test('project snapshot excludes persisted chats and media bytes while retaining real node facts', async () => {
  const { binding } = fixture();
  const legacyImage = 'data:image/jpeg;base64,' + 'A'.repeat(200000);
  projects.store.project.agentConversations = [{ id: 'legacy', messages: [{ content: 'private old chat' }], runtimeTranscript: [{ image: legacyImage }] }];
  projects.store.project.nodes.push({ id: 'real-node', type: 'textGeneration', title: '真实节点', prompt: 'hello' });
  const receipt = await tools.executeProductRequest(request(binding, 'project_snapshot'));
  const serialized = JSON.stringify(receipt);
  assert.ok(serialized.includes('real-node'));
  assert.ok(!serialized.includes('private old chat'));
  assert.ok(!serialized.includes('runtimeTranscript'));
  assert.ok(!serialized.includes(legacyImage));
  assert.equal(projects.store.project.agentConversations[0].runtimeTranscript[0].image, legacyImage);
});

test('Harness model limits come from the product catalog', async () => {
  settings.providerConfigs.starrouter = { apiKey: 'isolated-test', baseUrl: 'https://example.invalid/v1' };
  const config = (await env.load('services/harnessModelConfig')).harnessModelConfig();
  const model = config.providers['shotloom-starrouter-openai-completions'].profile.models.find(row => row.id === 'qwen3.6-plus');
  assert.equal(model.contextWindow, 131072);
  assert.equal(model.maxTokens, 16384);
});

test('Harness advertises StarRouter DeepSeek Flash reasoning levels and Agent defaults', async () => {
  settings.providerConfigs.starrouter = { apiKey: 'isolated-test', baseUrl: 'https://example.invalid/v1' };
  const previous = settings.agentPreferredTextModel;
  try {
    settings.agentPreferredTextModel = 'starrouter-deepseek-flash';
    const build = (await env.load('services/harnessModelConfig')).harnessModelConfig;
    const config = build();
    const models = config.providers['shotloom-starrouter-openai-completions'].profile.models;
    assert.equal(models.some(row => row.id === 'deepseek-v4-pro'), false);
    assert.equal(config.defaultModel.reasoningEffort, 'high');
    const flash = models.find(row => row.id === 'deepseek-flash');
    assert.deepEqual(flash.input, ['text', 'image']);
    assert.deepEqual(flash.reasoningEfforts, { off: 'none', low: 'low', high: 'high', max: 'max' });
    assert.equal(flash.compat.supportsReasoningEffort, true);
  } finally { settings.agentPreferredTextModel = previous; }
});

test('product boundary rejects forged bindings, switched project instances and disabled generation', async () => {
  const { binding } = fixture();
  await assert.rejects(tools.executeProductRequest(request({ ...binding, projectKey: 'forged' }, 'canvas_list_nodes')), { message: translate('agent.bindingUnknown') });
  await assert.rejects(tools.executeProductRequest(request(binding, 'canvas_start_generation', { type: 'start_generation', nodeId: 'missing' })), /unavailable/);
  // The same path and project id with a new mounted instance is still a different owner.
  projects.store.project = { ...projects.store.project };
  await assert.rejects(tools.executeProductRequest(request(binding, 'canvas_list_nodes')), /项目已经切换/);
});

test('director session reads its bound scene and rejects a changed node binding', async () => {
  const { binding } = fixture('director-primary', 'director-scene');
  projects.store.project.nodes.push({ id: 'director-scene', type: 'threeDDirector', title: 'Director scene' });
  const snapshot = await tools.executeProductRequest(request(binding, 'project_snapshot'));
  assert.ok(snapshot.result);
  const canvas = await tools.executeProductRequest(request(binding, 'canvas_list_nodes'));
  assert.ok(canvas.result);
  projects.store.project.harnessSessions.find(item => item.id === binding.conversationId).directorNodeId = 'another-scene';
  await assert.rejects(tools.executeProductRequest(request(binding, 'project_snapshot')), { message: translate('agent.bindingNodeMissing') });
});

test('real text draft writes use native bound node and replay one call without repeating the write', async () => {
  const { binding } = fixture('text-primary', 'text-a');
  projects.store.project.nodes.push({ id: 'text-a', type: 'text', content: 'original' }, { id: 'text-b', type: 'text', content: 'other' });
  let text = 'user draft'; let writes = 0;
  const release = drafts.registerTextDraftTarget({ nodeId: 'text-a', read: () => text, apply(content, mode) { writes++; text = mode === 'append' ? text + content : content; return text; } });
  try {
    const call = request(binding, 'text_draft_write', { content: ' plus', mode: 'append' });
    const preflight = await tools.executeProductRequest({ ...call, phase: 'authorize' });
    assert.deepEqual(preflight, { success: true, approvalRequired: false });
    const receipt = await tools.executeProductRequest(call);
    assert.equal(receipt.sessionId, binding.sessionId);
    await tools.executeProductRequest(call);
    assert.equal(text, 'user draft plus'); assert.equal(writes, 1);
    assert.equal(projects.store.project.nodes[1].content, 'other');
    projects.store.project.nodes = projects.store.project.nodes.filter(node => node.id !== 'text-a');
    await assert.rejects(tools.executeProductRequest(request(binding, 'text_draft_read')), { message: translate('agent.bindingNodeMissing') });
  } finally { release(); }
});

test('live approval settings are checked on both preflight and execution', async () => {
  const { binding } = fixture();
  const call = request(binding, 'undo_canvas');
  assert.equal((await tools.executeProductRequest({ ...call, phase: 'authorize' })).approvalRequired, true);
  assert.equal((await tools.executeProductRequest(call)).code, 'APPROVAL_REQUIRED');
  settings.agentApprovalPolicy = 'never';
  assert.equal((await tools.executeProductRequest({ ...call, phase: 'authorize' })).approvalRequired, false);
});

test('composer canvas references resolve real text and reject deleted nodes, wrong roles and switched projects', async () => {
  const { binding } = fixture();
  projects.store.project.nodes.push({ id: 'mention-text', type: 'text', title: '引用便签', content: '真实内容：秋日咖啡' });
  const catalog = await tools.readHarnessCanvasReference(binding.sessionId);
  assert.equal(catalog.nodes.find(node => node.id === 'mention-text').label, '引用便签');
  const resolved = await tools.readHarnessCanvasReference(binding.sessionId, 'mention-text');
  assert.match(JSON.stringify(resolved.snapshot), /真实内容：秋日咖啡/);
  assert.deepEqual(resolved.images, []);
  projects.store.project.nodes = [];
  await assert.rejects(tools.readHarnessCanvasReference(binding.sessionId, 'mention-text'), /删除/);
  const text = fixture('text-primary', 'text-ref');
  await assert.rejects(tools.readHarnessCanvasReference(text.binding.sessionId), /不能引用画布/);
  await assert.rejects(tools.readHarnessCanvasReference('unknown'), /不能引用画布/);
  await assert.rejects(tools.readHarnessCanvasReference(binding.sessionId), /工程|project/i);
});


test('prop classification survives persistence and is visible to Harness references and filtered tools', async () => {
  const { binding, catalog } = fixture();
  projects.store.project.nodes.push({ id: 'real-prop', type: 'text', title: '杯子资料', content: '陶瓷咖啡杯', artifactType: 'prop' },
    { id: 'unclassified', type: 'text', title: '场景名称不自动分类', content: 'not a classified scene' });
  const loaded = normalization.normalizeProject(JSON.parse(JSON.stringify(projects.store.project)));
  assert.equal(loaded.nodes.find(node => node.id === 'real-prop').artifactType, 'prop');
  assert.equal(loaded.nodes.find(node => node.id === 'unclassified').artifactType, 'other');
  const references = await tools.readHarnessCanvasReference(binding.sessionId);
  assert.equal(references.nodes.find(node => node.id === 'real-prop').artifactType, 'prop');
  assert.equal(references.nodes.find(node => node.id === 'unclassified').artifactType, 'other');
  assert.ok(JSON.stringify(catalog.find(tool => tool.name === 'canvas_update_node').parameters).includes('prop'));
  const receipt = await tools.executeProductRequest(request(binding, 'canvas_list_nodes', { artifactType: 'prop', view: 'summary' }));
  assert.match(JSON.stringify(receipt), /real-prop/);
  assert.ok(!JSON.stringify(receipt).includes('unclassified'));
  await tools.executeProductRequest(request(binding, 'canvas_update_node', { type: 'set_artifact_type', nodeId: 'unclassified', artifactType: 'prop' }, { approvedByHarness: true }));
  assert.equal(projects.store.project.nodes.find(node => node.id === 'unclassified').artifactType, 'prop');
});

test('reference media revision changes with selected output even when filenames match', async () => {
  const { binding } = fixture();
  const node = { id: 'media-versions', type: 'imageGeneration', title: '同名版本',
    selectedOutputNodeId: 'v1', generatedOutputs: [
      { id: 'v1', url: 'data:image/png;base64,' + 'A'.repeat(10000), fileName: 'same.png', filePath: '/isolated/v1/same.png', resourceType: 'image' },
      { id: 'v2', fileName: 'same.png', filePath: '/isolated/v2/same.png', resourceType: 'image' },
    ] };
  projects.store.project.nodes.push(node);
  const before = (await tools.readHarnessCanvasReference(binding.sessionId)).nodes.find(item => item.id === node.id);
  node.selectedOutputNodeId = 'v2';
  const after = (await tools.readHarnessCanvasReference(binding.sessionId)).nodes.find(item => item.id === node.id);
  assert.equal(before.label, after.label);
  assert.notEqual(before.mediaRevision, after.mediaRevision);
  assert.ok(before.mediaRevision.length < 32, "reference index carries a compact fingerprint, never inline media bytes");
});

test('editor reads canvas subtitle sources, imports the matching video and stays confined to its timeline', async () => {
  const { binding, catalog } = fixture('editor-primary', 'clip-subtitles');
  projects.store.project.nodes.push(
    { id: binding.nodeId, type: 'clipStudio', title: '字幕剪辑' },
    { id: 'subtitle-source', type: 'text', title: '字幕稿', content: '00:00–00:03 你好，世界。' },
    { id: 'source-video', type: 'videoGeneration', title: '视频', resourceType: 'video', generatedOutputs: [
      { id: 'real-output', name: 'real.mp4', filePath: '/harness-project/assets/real.mp4', resourceType: 'video', duration: 3 },
    ] },
  );
  for (const name of ['canvas_list_nodes', 'canvas_get_node', 'canvas_media_frame', 'video_project_media', 'video_project_import_media']) assert.ok(catalog.some(tool => tool.name === name), name);
  for (const name of ['canvas_create_node', 'canvas_update_node', 'canvas_start_generation', 'canvas_prepare_editor']) assert.ok(!catalog.some(tool => tool.name === name), name);
  const editor = await env.load('services/videoEditorSession');
  const api = (await env.load('services/desktopApi')).desktopApi;
  const probe = api.file.probeMedia;
  api.file.probeMedia = async () => ({ duration: 3, width: 1280, height: 720 });
  const imported = [];
  const release = editor.registerActiveVideoEditor({ projectKey: binding.projectKey, nodeId: binding.nodeId,
    read: () => ({ assets: [], tracks: [] }),
    importAsset: async asset => { imported.push(asset); return { mediaId: 'native-real-media' }; },
  });
  try {
    const text = await tools.executeProductRequest(request(binding, 'canvas_get_node', { nodeId: 'subtitle-source' }));
    assert.match(JSON.stringify(text.result), /你好，世界/);
    const reference = await tools.readHarnessCanvasReference(binding.sessionId, 'subtitle-source');
    assert.match(JSON.stringify(reference.snapshot), /你好，世界/);
    const sources = await tools.executeProductRequest(request(binding, 'video_project_media'));
    const source = sources.result.assets.find(asset => asset.nodeId === 'source-video');
    assert.ok(source);
    const denied = await tools.executeProductRequest(request(binding, 'video_project_import_media', { assetId: source.id }));
    assert.equal(denied.code, 'APPROVAL_REQUIRED');
    assert.equal(imported.length, 0);
    const receipt = await tools.executeProductRequest(request(binding, 'video_project_import_media', { assetId: source.id }, { approvedByHarness: true }));
    assert.equal(receipt.result.mediaId, 'native-real-media');
    assert.equal(imported[0].sourceFile, '/harness-project/assets/real.mp4');
    assert.equal(imported[0].duration, 3);
    await assert.rejects(tools.executeProductRequest(request(binding, 'canvas_create_node', {})));
    // Another active editor must not silently replace this conversation's target.
    const other = editor.registerActiveVideoEditor({ projectKey: binding.projectKey, nodeId: 'other-clip', importAsset: async () => { throw new Error('wrong editor'); } });
    try {
      const again = await tools.executeProductRequest(request(binding, 'video_project_import_media', { assetId: source.id }, { approvedByHarness: true }));
      assert.equal(again.result.mediaId, 'native-real-media');
    } finally { other(); }
    release();
    await assert.rejects(tools.executeProductRequest(request(binding, 'video_project_import_media', { assetId: source.id }, { approvedByHarness: true })));
  } finally { release(); api.file.probeMedia = probe; }
});

test('canvas preparation waits for its actual editor and rejects missing targets and stale project bindings', async () => {
  const { binding } = fixture();
  projects.store.project.nodes.push({ id: 'delegated-clip', type: 'clipStudio', title: '剪辑' });
  const editor = await env.load('services/videoEditorSession');
  let opened, releaseRuntime, bound = 0;
  const closeLauncher = editor.registerVideoEditorLauncher(nodeId => {
    opened = nodeId;
    queueMicrotask(() => { releaseRuntime = editor.registerActiveVideoEditor({ projectKey: binding.projectKey, nodeId }); });
  });
  tools.registerEditorSessionBinder(async nodeId => {
    bound++;
    return { sessionId: 'actual-editor-session', projectKey: binding.projectKey, nodeId, conversationId: 'editor-conversation', agentId: 'editor-primary' };
  });
  try {
    const missing = await tools.executeProductRequest(request(binding, 'canvas_prepare_editor', { nodeId: 'missing-clip' }));
    assert.equal(missing.result.success, false);
    assert.equal(opened, undefined);
    const result = await tools.executeProductRequest(request(binding, 'canvas_prepare_editor', { nodeId: 'delegated-clip' }));
    assert.equal(result.result.success, true);
    assert.equal(result.result.binding.nodeId, 'delegated-clip');
    assert.equal(opened, 'delegated-clip');
    assert.equal(bound, 1);
    projects.store.project = normalization.createProject('another canvas');
    assert.equal(editor.videoEditorSession(binding.projectKey, 'delegated-clip'), undefined, 'reopened project cannot borrow an old editor runtime');
    await assert.rejects(tools.executeProductRequest(request(binding, 'canvas_prepare_editor', { nodeId: 'delegated-clip' })));
  } finally { releaseRuntime?.(); closeLauncher(); }
});

test('standalone editor binding resolves the project workspace without a fabricated canvas node', async () => {
  const { binding } = fixture('editor-primary', 'workspace-video-editor');
  projects.store.project.videoEditorSession = { project: { assets: [], tracks: [] } };
  projects.store.project.nodes.push({ id: 'source-text', type: 'text', content: '独立工作台也能读的字幕' });
  const result = await tools.executeProductRequest(request(binding, 'canvas_get_node', { nodeId: 'source-text' }));
  assert.match(JSON.stringify(result.result), /独立工作台也能读的字幕/);
  projects.store.project.videoEditorSession = null;
  await assert.rejects(tools.executeProductRequest(request(binding, 'canvas_get_node', { nodeId: 'source-text' })));
});
