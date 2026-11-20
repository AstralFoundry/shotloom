import assert from 'node:assert/strict';
import test from 'node:test';
import { readSource } from './helpers/sourceContract.mjs';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

const templates = JSON.parse(readSource('shared/runninghubGatewayTemplates.json'));

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
