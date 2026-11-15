import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

const image = 'https://media.example/input.png';
const output = 'https://media.example/output.mp4';
// Hand-authored wire samples based on the official sources listed in docs/media-protocols.md.
const scenarios = [
  { model: 'MiniMax-H3-Image', path: '/v1/images/generations', sync: true,
    body: { model: 'MiniMax-H3-Image', prompt: 'A moving camera', aspect_ratio: '1:1', n: 1, response_format: 'url' },
    submit: { data: [{ url: output }], output_format: 'png' } },
  { model: 'MiniMax-H3-Image-Highspeed', path: '/v1/images/generations', sync: true,
    body: { model: 'MiniMax-H3-Image-Highspeed', prompt: 'A moving camera', aspect_ratio: '1:1', n: 1, response_format: 'url' },
    submit: { data: [{ url: output }], output_format: 'png' } },
  ...['flux-3-image', 'flux-3-image-klein'].map(model => ({ model, path: `/v1/${model}`, auth: ['x-key', 'test-key'],
    body: { prompt: 'A moving camera', aspect_ratio: '1:1', resolution: '1k' },
    submit: { id: 'flux3-image-task' }, pollPath: '/v1/get_result?id=flux3-image-task',
    pending: { id: 'flux3-image-task', status: 'Reasoning' },
    complete: { id: 'flux3-image-task', status: 'Ready', result: { sample: output } } })),
  { model: 'flux-3-video', path: '/v1/flux-3-video', auth: ['x-key', 'test-key'],
    body: { mode: 't2v', prompt: 'A moving camera', duration: 5, aspect_ratio: '16:9', resolution: 'hd', generate_audio: true },
    submit: { id: 'flux3-video-task' }, pollPath: '/v1/get_result?id=flux3-video-task',
    pending: { id: 'flux3-video-task', status: 'Generating' },
    complete: { id: 'flux3-video-task', status: 'Ready', result: { sample: output } } },
  ...[['vidu-q3-pro', 'viduq3-pro'], ['vidu-q3-turbo', 'viduq3-turbo']].map(([model, upstream]) => ({ model, path: '/ent/v2/text2video', auth: ['Authorization', 'Token test-key'],
    body: { model: upstream, prompt: 'A moving camera', duration: 5, resolution: '720p', aspect_ratio: '16:9', audio: true },
    submit: { task_id: 'vidu3-task', state: 'created' }, pollPath: '/ent/v2/tasks/vidu3-task/creations',
    pending: { id: 'vidu3-task', state: 'processing' }, complete: { id: 'vidu3-task', state: 'success', creations: [{ url: output }] } })),
  { model: 'seedream-5.5', path: '/images/generations', sync: true,
    body: { model: 'doubao-seedream-5-5-261028', prompt: 'A moving camera', size: '2K', response_format: 'url', watermark: true },
    submit: { data: [{ url: output }] } },
  { model: 'flux-2-pro', path: '/v1/flux-2-pro', auth: ['x-key', 'test-key'],
    body: { prompt: 'A moving camera', width: 1024, height: 1024, output_format: 'jpeg' },
    submit: { id: 'bfl-task' }, pollPath: '/v1/get_result?id=bfl-task',
    pending: { id: 'bfl-task', status: 'Generating' },
    complete: { id: 'bfl-task', status: 'Ready', result: { sample: output } } },
  { model: 'veo-3.1-generate-preview', path: '/models/veo-3.1-generate-preview:predictLongRunning', auth: ['x-goog-api-key', 'test-key'],
    body: { instances: [{ prompt: 'A moving camera' }], parameters: { sampleCount: 1, aspectRatio: '16:9', durationSeconds: 8 } },
    submit: { name: 'models/veo-3.1-generate-preview/operations/veo-task' },
    pollPath: '/models/veo-3.1-generate-preview/operations/veo-task',
    pending: { name: 'models/veo-3.1-generate-preview/operations/veo-task' },
    complete: { done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: output } }] } } } },
  { model: 'runway-gen4.5', path: '/v1/text_to_video', header: ['X-Runway-Version', '2024-11-06'],
    body: { model: 'gen4.5', promptText: 'A moving camera', ratio: '1280:720', duration: 5 },
    submit: { id: 'runway-task' }, pollPath: '/v1/tasks/runway-task', pending: { id: 'runway-task', status: 'RUNNING', progress: 0.5 }, progress: 50,
    complete: { id: 'runway-task', status: 'SUCCEEDED', output: [output] }, cancelPath: '/v1/tasks/runway-task', cancelMethod: 'DELETE' },
  { model: 'vidu-q2', path: '/ent/v2/text2video', auth: ['Authorization', 'Token test-key'],
    body: { model: 'viduq2', prompt: 'A moving camera', duration: 5, resolution: '720p', aspect_ratio: '16:9' },
    submit: { task_id: 'vidu-task', state: 'created' }, pollPath: '/ent/v2/tasks/vidu-task/creations', pending: { id: 'vidu-task', state: 'processing' },
    complete: { id: 'vidu-task', state: 'success', creations: [{ url: output }] } },
  { model: 'fal-flux-schnell', path: '/fal-ai/flux/schnell', auth: ['Authorization', 'Key test-key'],
    body: { prompt: 'A moving camera', image_size: 'landscape_4_3', num_images: 1 },
    submit: { request_id: 'fal-image-task' }, pollPath: '/fal-ai/flux/requests/fal-image-task/status',
    pending: { status: 'IN_QUEUE' }, pendingStatus: 'queued', complete: { status: 'COMPLETED' },
    resultPath: '/fal-ai/flux/requests/fal-image-task', result: { images: [{ url: output }] },
    cancelPath: '/fal-ai/flux/requests/fal-image-task/cancel', cancelMethod: 'PUT' },
  { model: 'fal-veo3-fast', path: '/fal-ai/veo3/fast', auth: ['Authorization', 'Key test-key'],
    body: { prompt: 'A moving camera', aspect_ratio: '16:9', duration: '8s', resolution: '720p' },
    submit: { request_id: 'fal-video-task' }, pollPath: '/fal-ai/veo3/requests/fal-video-task/status',
    pending: { status: 'IN_PROGRESS' }, complete: { status: 'COMPLETED' },
    resultPath: '/fal-ai/veo3/requests/fal-video-task', result: { video: { url: output } },
    cancelPath: '/fal-ai/veo3/requests/fal-video-task/cancel', cancelMethod: 'PUT' },
  { model: 'replicate-flux-schnell', path: '/v1/models/black-forest-labs/flux-schnell/predictions',
    body: { input: { prompt: 'A moving camera', aspect_ratio: '16:9', num_outputs: 1 } },
    submit: { id: 'replicate-task', status: 'starting' }, pollPath: '/v1/predictions/replicate-task',
    pending: { id: 'replicate-task', status: 'processing' }, complete: { id: 'replicate-task', status: 'succeeded', output: [output] },
    cancelPath: '/v1/predictions/replicate-task/cancel', cancelMethod: 'POST' },
];

test('new media protocols compile and run submit/poll/result/cancel through a local HTTP service', async () => {
  const env = await createRendererEnv({ storage: new Map(), withWindow: true });
  let fixture, stage, calls = [];
  const server = createHttpServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    calls.push({ path: req.url, method: req.method, headers: req.headers, body: body ? JSON.parse(body) : undefined });
    let data;
    if (stage === 'submit') data = fixture.submit;
    else if (stage === 'pending') data = fixture.pending;
    else if (stage === 'complete') data = req.url === fixture.resultPath ? fixture.result : fixture.complete;
    else data = {};
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(data));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { desktopApi } = await env.load('services/desktopApi');
    const { registeredModels } = await env.load('domain/provider/plugins/ProviderPlugins');
    const { modelCatalog, catalogModelValidationErrors } = await env.load('domain/catalog/ModelCatalog');
    const { getProviderAdapter } = await env.load('domain/provider/adapters/index');
    const { modelJsonRequestBody } = await env.load('utils/modelRequestBody');
    const invoke = async (path, method, body, auth, headers, signal) => {
      const h = { 'content-type': 'application/json', ...(headers || {}) };
      const header = auth?.type === 'header' ? auth.name : 'Authorization';
      h[header] = `${auth?.type === 'header' ? auth.prefix || '' : 'Bearer '}test-key`;
      return (await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), signal })).json();
    };
    desktopApi.model.imageGeneration = desktopApi.model.videoGeneration = async body => invoke(body.__endpointPath, body.__endpointMethod, modelJsonRequestBody(body), body.__auth, body.__headers, body.__signal);
    desktopApi.model.videoTask = async query => invoke(query.endpointPath, query.endpointMethod, query.body, query.auth, query.headers, query.signal);
    for (fixture of scenarios) {
      calls = []; stage = 'submit';
      const model = registeredModels().find(model => model.id === fixture.model);
      assert.deepEqual(catalogModelValidationErrors(model, { requireProvider: true }), [], fixture.model);
      const contract = modelCatalog.buildRuntimeContract(model);
      const adapter = getProviderAdapter(contract.provider, contract.pluginRef);
      const params = Object.fromEntries(model.modes[0].params.map(param => [param.key, param.default]));
      const task = await adapter.submit(adapter.compileRequest({ taskType: model.type, modelContract: contract, prompt: 'A moving camera', params }));
      assert.equal(calls[0].path, fixture.path, fixture.model);
      assert.equal(calls[0].method, 'POST');
      assert.deepEqual(calls[0].body, fixture.body, fixture.model);
      if (fixture.auth) assert.equal(calls[0].headers[fixture.auth[0].toLowerCase()], fixture.auth[1]);
      if (fixture.header) assert.equal(calls[0].headers[fixture.header[0].toLowerCase()], fixture.header[1]);
      if (fixture.sync) { assert.equal(task.result.files[0].url, output); continue; }
      stage = 'pending';
      const pending = await adapter.poll(task, contract);
      assert.equal(pending.status, fixture.pendingStatus || 'running', fixture.model);
      assert.equal(calls.at(-1).path, fixture.pollPath);
      if (fixture.progress) assert.equal(pending.progress, fixture.progress);
      const before = calls.length;
      stage = 'complete';
      const completed = await adapter.poll(task, contract);
      assert.equal(completed.status, 'completed');
      assert.equal(completed.result.files[0].url, output);
      if (fixture.resultPath) { assert.equal(calls.length, before + 2); assert.equal(calls.at(-1).path, fixture.resultPath); }
      if (fixture.model.startsWith('veo-')) assert.equal(completed.result.files[0].metadata.downloadAuth.auth.name, 'x-goog-api-key');
      if (fixture.cancelPath) {
        stage = 'cancel'; await adapter.cancel({ remoteTaskId: task.remoteTaskId, modelContract: contract });
        assert.equal(calls.at(-1).path, fixture.cancelPath); assert.equal(calls.at(-1).method, fixture.cancelMethod);
      }
    }
    // Reference inputs use the same real template renderer and transport.
    for (const [id, expectedPath, key] of [['seedream-5.5', '/images/generations', 'image'], ['flux-2-pro', '/v1/flux-2-pro', 'input_image'], ['runway-gen4.5', '/v1/image_to_video', 'promptImage'], ['runway-gen4-turbo', '/v1/image_to_video', 'promptImage'], ['vidu-q2-pro', '/ent/v2/img2video', 'images']]) {
      const model = registeredModels().find(m => m.id === id);
      const mode = model.modes.find(m => ['image-to-image', 'image-to-video'].includes(m.id));
      const contract = modelCatalog.buildRuntimeContract(model, mode.id);
      fixture = scenarios.find(s => s.model === id) || scenarios.find(s => s.model === (id.startsWith('runway-') ? 'runway-gen4.5' : 'vidu-q2')); stage = 'submit';
      const adapter = getProviderAdapter(model.provider, contract.pluginRef);
      await adapter.submit(adapter.compileRequest({ taskType: model.type, modelContract: contract, prompt: 'Animate', params: Object.fromEntries(mode.params.map(p => [p.key, p.default])), modelInputs: { images: [{ url: image, inputSlot: 'firstFrame' }] } }));
      assert.equal(calls.at(-1).path, expectedPath);
      assert.deepEqual(calls.at(-1).body[key], ['image','images'].includes(key) ? [image] : image);
    }
    for (const [id, path, key, expected] of [
      ['MiniMax-H3-Image', '/v1/images/edits', 'images', [{ image_url: image }, { image_url: 'https://media.example/second.png' }]],
      ['MiniMax-H3-Image-Highspeed', '/v1/images/edits', 'images', [{ image_url: image }, { image_url: 'https://media.example/second.png' }]],
      ['flux-3-image', '/v1/flux-3-image', 'images', [image, 'https://media.example/second.png']],
      ['flux-3-image-klein', '/v1/flux-3-image-klein', 'images', [image, 'https://media.example/second.png']],
      ['flux-3-video', '/v1/flux-3-video', 'keyframes', image],
      ['vidu-q3-pro', '/ent/v2/img2video', 'images', [image]],
      ['vidu-q3-turbo', '/ent/v2/img2video', 'images', [image]],
    ]) {
      const model = registeredModels().find(m => m.id === id);
      const mode = model.modes.find(m => ['image-to-image', 'image-to-video'].includes(m.id));
      const contract = modelCatalog.buildRuntimeContract(model, mode.id);
      fixture = scenarios.find(s => s.model === id); stage = 'submit';
      const refs = [{ url: image, inputSlot: mode.inputMode === 'reference' ? 'reference' : 'firstFrame' }];
      if (mode.inputMode === 'reference') refs.push({ url: 'https://media.example/second.png', inputSlot: 'reference' });
      await getProviderAdapter(model.provider, contract.pluginRef).submit(getProviderAdapter(model.provider, contract.pluginRef).compileRequest({
        taskType: model.type, modelContract: contract, prompt: 'Animate',
        params: Object.fromEntries(mode.params.map(p => [p.key, p.default])), modelInputs: { images: refs },
      }));
      assert.equal(calls.at(-1).path, path);
      assert.deepEqual(calls.at(-1).body[key], expected, id);
      if (id === 'flux-3-video') assert.equal(calls.at(-1).body.mode, 'i2v');
    }
  } finally { await env.dispose(); await new Promise(resolve => server.close(resolve)); }
});

test('media lifecycle preserves failures, rejects malformed polls and aborts before result retrieval', async () => {
  const env = await createRendererEnv({ storage: new Map(), withWindow: true });
  try {
    const { desktopApi } = await env.load('services/desktopApi');
    const { registeredModels } = await env.load('domain/provider/plugins/ProviderPlugins');
    const { modelCatalog } = await env.load('domain/catalog/ModelCatalog');
    const { getProviderAdapter } = await env.load('domain/provider/adapters/index');
    const resolve = id => { const model = registeredModels().find(m => m.id === id); const contract = modelCatalog.buildRuntimeContract(model); return [getProviderAdapter(model.provider, contract.pluginRef), contract]; };
    for (const [id, response, expected] of [
      ['flux-2-pro', { status: 'Content Moderated' }, 'failed'],
      ['runway-gen4.5', { status: 'FAILED', failure: 'Generation rejected' }, 'failed'],
      ['vidu-q2', { state: 'failed', err_code: 'CONTENT_REJECTED' }, 'failed'],
      ['replicate-flux-schnell', { status: 'canceled' }, 'cancelled'],
      ['veo-3.1-generate-preview', { done: true, error: { code: 3, message: 'Invalid request' } }, 'failed'],
    ]) {
      const [adapter, contract] = resolve(id); desktopApi.model.videoTask = async () => response;
      const result = await adapter.poll({ remoteTaskId: 'task-1' }, contract);
      assert.equal(result.status, expected, id);
      if (id === 'vidu-q2') assert.equal(result.error, 'CONTENT_REJECTED');
      if (id.startsWith('veo-')) assert.equal(result.error, 'Invalid request');
    }
    const [veo, veoContract] = resolve('veo-3.1-generate-preview');
    desktopApi.model.videoTask = async () => ({});
    await assert.rejects(veo.poll({ remoteTaskId: 'task-1' }, veoContract));
    desktopApi.model.videoTask = async () => ({ name: 'different-task' });
    await assert.rejects(veo.poll({ remoteTaskId: 'task-1' }, veoContract));
    const [fal, falContract] = resolve('fal-flux-schnell'); let calls = 0;
    desktopApi.model.videoTask = async query => {
      calls++;
      if (query.endpointPath.endsWith('/status')) return { status: 'COMPLETED' };
      throw new Error('Result temporarily unavailable');
    };
    await assert.rejects(fal.poll({ remoteTaskId: 'request-1' }, falContract), /temporarily unavailable/);
    assert.equal(calls, 2);
    // A retry only queries status/results; it never submits a new generation.
    desktopApi.model.videoTask = async query => query.endpointPath.endsWith('/status') ? { status: 'COMPLETED' } : { images: [{ url: output }] };
    assert.equal((await fal.poll({ remoteTaskId: 'request-1' }, falContract)).result.files[0].url, output);
    const controller = new AbortController(); let abortCalls = 0;
    desktopApi.model.videoTask = async () => { abortCalls++; controller.abort(); return { status: 'COMPLETED' }; };
    await assert.rejects(fal.poll({ remoteTaskId: 'request-1' }, falContract, controller.signal), { name: 'AbortError' });
    assert.equal(abortCalls, 1);
    await assert.rejects(fal.poll({ remoteTaskId: '../escape' }, falContract), /任务 ID/);
    assert.throws(() => modelCatalog.buildRuntimeContract({ ...registeredModels().find(m => m.id === 'fal-flux-schnell'), upstreamModel: '../unsafe' }));
  } finally { await env.dispose(); }
});

test('canvas output intent maps to the exact provider aspect ratio and duration values', async () => {
  const env = await createRendererEnv({ storage: new Map(), withWindow: true });
  try {
    const { buildGenerationPayload } = await env.load('domain/graph/generationPayload');
    const { getProviderAdapter } = await env.load('domain/provider/adapters/index');
    const { renderProtocolTemplate } = await env.load('utils/modelProtocol');
    for (const [model, type, expected] of [
      ['runway-gen4.5', 'videoGeneration', { ratio: '720:1280', duration: 6 }],
      ['fal-veo3-fast', 'videoGeneration', { aspect_ratio: '9:16', duration: '6s' }],
      ['fal-flux-schnell', 'imageGeneration', { image_size: 'portrait_16_9' }],
    ]) {
      const node = { id: 'generation', type, model, prompt: 'Portrait shot', config: {}, outputSpec: { aspectRatio: '9:16', duration: 6 }, x: 0, y: 0 };
      const payload = buildGenerationPayload(node, { nodes: [node], edges: [] });
      const compiled = getProviderAdapter(payload.modelContract.provider, payload.modelContract.pluginRef).compileRequest({ taskType: type, modelContract: payload.modelContract, prompt: payload.prompt, params: payload });
      const wire = renderProtocolTemplate(compiled.protocolTemplate, compiled.protocolVariables);
      for (const [key, value] of Object.entries(expected)) assert.equal(wire[key], value, `${model}:${key}`);
    }
  } finally { await env.dispose(); }
});

test('refreshed text presets preserve their official model IDs, endpoints and reasoning enums', async () => {
  const env = await createRendererEnv({ storage: new Map(), withWindow: true });
  try {
    const { desktopApi } = await env.load('services/desktopApi');
    const { registeredModels } = await env.load('domain/provider/plugins/ProviderPlugins');
    const { modelCatalog, catalogModelValidationErrors } = await env.load('domain/catalog/ModelCatalog');
    const { getProviderAdapter } = await env.load('domain/provider/adapters/index');
    const { modelJsonRequestBody } = await env.load('utils/modelRequestBody');
    let captured;
    desktopApi.model.chatCompletion = async body => {
      captured = body;
      return { choices: [{ message: { content: 'Verified' } }], content: [{ type: 'text', text: 'Verified' }] };
    };
    for (const [id, path, effort] of [
      ['gpt-6.1-sol', '/chat/completions', 'medium'],
      ['gpt-6.1-terra', '/chat/completions', 'medium'],
      ['gpt-6-luna', '/chat/completions', 'medium'],
      ['kimi-k3.1-pro', '/chat/completions', 'max'],
      ['kimi-k3.1-pro-highspeed', '/chat/completions', 'max'],
      ['MiniMax-M3.1-Flash', '/v1/chat/completions', 'max'],
      ['MiniMax-M3', '/v1/chat/completions', undefined],
      ['glm-5.3-flash', '/paas/v4/chat/completions', undefined],
      ['glm-5.3-flashx', '/paas/v4/chat/completions', undefined],
      ['claude-haiku-5-5', '/v1/messages', undefined],
      ['qwen3.7-plus', '/compatible-mode/v1/chat/completions', undefined],
    ]) {
      const model = registeredModels().find(model => model.id === id);
      assert.deepEqual(catalogModelValidationErrors(model, { requireProvider: true }), [], id);
      const mode = model.modes[0];
      const contract = modelCatalog.buildRuntimeContract(model);
      const adapter = getProviderAdapter(model.provider, contract.pluginRef);
      const task = await adapter.submit(adapter.compileRequest({ taskType: 'textGeneration', modelContract: contract, prompt: 'Hello',
        params: Object.fromEntries(mode.params.map(param => [param.key, param.default])),
      }));
      assert.equal(captured.__endpointPath, path, id);
      assert.equal(modelJsonRequestBody(captured).model, id);
      assert.equal(modelJsonRequestBody(captured).reasoning_effort, effort, id);
      assert.equal(task.result.text, 'Verified', id);
      const options = mode.params.find(param => param.key === 'reasoningEffort')?.options;
      if (id.startsWith('kimi-k3.1')) assert.deepEqual(options, ['low', 'high', 'max']);
      if (id === 'gpt-6.1-sol' || id === 'MiniMax-M3.1-Flash') assert.equal(options.includes('none'), false);
    }
  } finally { await env.dispose(); }
});
