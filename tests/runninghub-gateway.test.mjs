import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from './helpers/sourceContract.mjs';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

const templates = JSON.parse(readSource('shared/runninghubGatewayTemplates.json'));

test('published Krea2 accepts text input and rejects unsupported reference images', async () => {
  const env = await createRendererEnv();
  try {
    const { modelCatalog } = await env.load('domain/catalog/ModelCatalog');
    const { generationUpstreamReadiness } = await env.load('domain/graph/generationPayload');
    modelCatalog.replacePublishedModels([{ ...templates[1], id: 'krea2-normal-v1' }]);
    const target = { id: 'target', title: '图片生成', type: 'imageGeneration', model: 'krea2-normal-v1', prompt: 'A red ball', config: {} };
    const source = { id: 'source', type: 'imageGeneration', uploadedFile: { path: '/reference.png', name: 'reference.png', type: 'image/png', resourceType: 'image' } };
    const project = { nodes: [target, source], edges: [], tasks: [], materials: [] };
    assert.deepEqual(generationUpstreamReadiness(target, project).issues, []);
    target.inputMode = 'reference';
    project.edges.push({ source: 'source', target: 'target', data: { inputRole: 'referenceImage' } });
    const readiness = generationUpstreamReadiness(target, project);
    assert.equal(readiness.ready, false);
    assert.match(readiness.issues.join('；'), /不支持参考图片/);
  } finally { await env.dispose(); }
});

test('RunningHub gateway templates submit images, poll videos and download authenticated content', async () => {
  const env = await createRendererEnv();
  try {
    const { modelCatalog } = await env.load('domain/catalog/ModelCatalog');
    const { getProviderAdapter } = await env.load('domain/provider/adapters/index');
    const { desktopApi } = await env.load('services/desktopApi');
    const adapter = getProviderAdapter('openai');
    for (const template of templates) {
      const id = template.type === 'videoGeneration' ? 'minimax-h3-reference-to-video' : 'krea2-normal-v1';
      const model = { ...template, id, upstreamModel: id };
      for (const mode of model.modes) {
        const contract = modelCatalog.buildRuntimeContract(model, mode.id);
        const images = mode.inputFormat === 'multipart' ? [
          { filePath: '/reference-a.png', fileName: 'a.png', mimeType: 'image/png', inputSlot: 'reference' },
          { filePath: '/reference-b.png', fileName: 'b.png', mimeType: 'image/png', inputSlot: 'reference' },
        ] : [];
        let sent;
        const submit = async body => {
          sent = body;
          return model.type === 'videoGeneration' ? { id: 'task-test', status: 'queued' }
            : { data: [{ url: 'https://cdn.example/result.png' }] };
        };
        desktopApi.model.videoGeneration = submit;
        desktopApi.model.imageGeneration = submit;
        const task = await adapter.submit(adapter.compileRequest({
          taskType: model.type, model: id, prompt: 'A red ball', modelContract: contract,
          params: { duration: 5, aspectRatio: '16:9', resolution: '1K' }, modelInputs: { images },
        }));
        assert.equal(sent.model, id);
        assert.equal(sent.prompt, 'A red ball');
        assert.equal(sent.aspect_ratio, '16:9');
        assert.equal(sent.resolution, '1K');
        assert.equal(sent.__endpointPath, mode.endpoint.path);
        if (model.type === 'imageGeneration') {
          assert.equal(task.status, 'completed');
          assert.equal(task.result.files[0].url, 'https://cdn.example/result.png');
          continue;
        }
        assert.equal(sent.seconds, 5);
        assert.equal(task.remoteTaskId, 'task-test');
        if (images.length) {
          assert.equal(sent.__multipart, true);
          assert.deepEqual(sent.__inputImages.map(file => file.fieldName), ['input_reference[]', 'input_reference[]']);
        }
        for (const [status, expected] of [['queued', 'queued'], ['in_progress', 'running'], ['completed', 'completed'], ['failed', 'failed']]) {
          desktopApi.model.videoTask = async body => {
            assert.equal(body.endpointPath, '/videos/task-test');
            assert.equal(body.endpointMethod, 'GET');
            return { id: 'task-test', status, progress: 50, error: status === 'failed' ? { message: 'upstream failed' } : undefined };
          };
          const state = await adapter.poll(task, contract);
          assert.equal(state.status, expected);
          if (status === 'failed') assert.equal(state.error, 'upstream failed');
          if (status === 'completed') {
            const file = state.result.files[0];
            assert.equal(file.mimeType, 'video/mp4');
            assert.equal(file.metadata.downloadAuth.endpointPath, '/videos/task-test/content');
            assert.equal(file.metadata.downloadAuth.providerId, 'openai');
          }
        }
      }
    }
  } finally { await env.dispose(); }
});

test('completed H3 video downloads through the cloud relay before archiving to canvas', async () => {
  const env = await createRendererEnv({ withWindow: true });
  const previousFetch = globalThis.fetch;
  const calls = [];
  let downloadStatus = 200;
  globalThis.fetch = async (url, init) => {
    calls.push(url);
    if (url === '/api/relay/videos/task-existing') return Response.json({ id: 'task-existing', status: 'completed', progress: 100 });
    if (url === '/api/relay/videos/task-existing/content') {
      assert.equal(init.method, 'GET');
      assert.equal(init.credentials, 'include');
      assert.equal(init.headers.get('x-shotloom-provider'), 'openai');
      assert.equal(init.headers.get('x-shotloom-scope'), 'v1');
      return downloadStatus === 204 ? new Response(null, { status: 204 })
        : downloadStatus === 200 ? new Response('video bytes', { headers: { 'Content-Type': 'video/mp4' } })
        : Response.json({ error: { message: 'content denied' } }, { status: downloadStatus });
    }
    if (url === '/api/files/upload-url') return Response.json({ success: true, data: { url: 'https://storage.example/upload' } });
    if (url === 'https://storage.example/upload') {
      assert.equal(init.method, 'PUT');
      assert.equal(init.headers['Content-Type'], 'video/mp4');
      assert.equal(await init.body.text(), 'video bytes');
      return new Response(null, { status: 200 });
    }
    assert.fail(`Unexpected request ${url}`);
  };
  try {
    const { createCloudApi } = await env.load('services/cloudApi');
    const { desktopApi } = await env.load('services/desktopApi');
    const { modelCatalog } = await env.load('domain/catalog/ModelCatalog');
    const { getProviderAdapter } = await env.load('domain/provider/adapters/index');
    const { archiveGeneratedOutput } = await env.load('services/generatedResultArchive');
    const api = createCloudApi({ file: { readArrayBuffer: () => assert.fail('Authenticated video must not fall back to a local file') } });
    desktopApi.model.videoTask = api.model.videoTask;
    desktopApi.file.downloadUrlToProject = api.file.downloadUrlToProject;
    const model = { ...templates[0], id: 'minimax-h3-reference-to-video' };
    const contract = modelCatalog.buildRuntimeContract(model, 'text-to-video');
    const remote = await getProviderAdapter('openai').poll({ remoteTaskId: 'task-existing' }, contract);
    const project = { materials: [] };
    const node = { id: 'video-node', type: 'videoGeneration', title: 'H3 video' };
    const task = { id: 'canvas-task', model: model.id, remoteTaskId: 'task-existing' };
    const archived = await archiveGeneratedOutput({ project, node, task, output: remote.result });
    assert.equal(archived.archivedFiles.length, 1);
    assert.match(archived.archivedFiles[0].path, /^cloud:\/\/media\/.+\.mp4$/);
    assert.equal(project.materials[0].remoteTaskId, 'task-existing');
    assert.equal(project.materials[0].mimeType, 'video/mp4');
    const uploadCount = calls.filter(url => url === '/api/files/upload-url').length;
    downloadStatus = 403;
    await assert.rejects(archiveGeneratedOutput({ project, node, task, output: remote.result }), /content denied/);
    assert.equal(calls.filter(url => url === '/api/files/upload-url').length, uploadCount);
    assert.equal(project.materials.length, 1, 'failed downloads cannot add a canvas result');
    downloadStatus = 204;
    await assert.rejects(archiveGeneratedOutput({ project, node, task, output: remote.result }), /download is empty/);
    assert.equal(calls.filter(url => url === '/api/files/upload-url').length, uploadCount);
  } finally { globalThis.fetch = previousFetch; await env.dispose(); }
});
