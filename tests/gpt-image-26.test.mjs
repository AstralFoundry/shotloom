import assert from 'node:assert/strict';
import test from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';
import { normalizeProtocolResponse } from '../renderer/src/utils/modelProtocol.ts';
import { extensionForGeneratedFile } from '../renderer/src/utils/generatedOutputNaming.ts';
import { compileGenerationNodeConfig } from '../renderer/src/domain/graph/GenerationNodeContract.ts';
import { modelResponseError } from '../renderer/src/utils/modelResponseParsing.ts';
import { loadModelCatalog } from './helpers/modelCatalog.mjs';

// Two frames, different delays, and an infinite loop extension.
const gif = Buffer.from('47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f90400140000002c00000000010001000002024c01003b', 'hex').toString('base64');

test('GIF 缺省尺寸使用小尺寸预设，静态图与显式尺寸保持不变', () => {
  for (const model of loadModelCatalog().models.filter(m => m.id.includes('gpt-image-2.6-'))) {
    for (const mode of model.modes) {
      const params = mode.params;
      const config = compileGenerationNodeConfig({ outputFormat: 'gif' }, params);
      assert.equal(config.size, '512x512');
      assert.equal(config.generationCount, 1);
      assert.equal(config.frameCount, 9);
      assert.equal(compileGenerationNodeConfig({ outputFormat: 'png' }, params).size, '1024x1024');
      assert.equal(compileGenerationNodeConfig({ outputFormat: 'gif', size: '768x512', frameCount: 4 }, params).size, '768x512');
      assert.deepEqual(params.find(p => p.key === 'outputFormat').valueDefaults.gif, { size: '512x512', generationCount: 1 });
    }
  }
  const message = modelResponseError({ error: { message: 'GIF frames exceed the total request pixel budget. Reduce the frame size or frame_count.' } }, 400);
  assert.match(message, /总像素/);
  assert.match(message, /GIF 帧数/);
  assert.match(message, /每帧时长不影响/);
});

test('切换 GIF 保留底栏参数摘要，仅按输出格式显隐动画参数', async () => {
  const env = await createRendererEnv({ storage: new Map(), withWindow: true });
  try {
    const { generationNodeState } = await env.load('app/canvas/generationNodeState');
    const { paramSummary } = await env.load('utils/modelPresentation');
    for (const prefix of ['', 'starrouter-']) {
      for (const variant of ['sunburst', 'flare']) {
        const node = { id: 'gif-summary', type: 'imageGeneration', model: `${prefix}gpt-image-2.6-${variant}`,
          inputMode: 'reference', config: { size: '1024x1024', quality: 'auto', background: 'auto' } };
        for (const outputFormat of ['png', 'gif', 'svg', 'png']) {
          node.config.outputFormat = outputFormat;
          const state = generationNodeState(node, true, []);
          assert.deepEqual(state.summaryParams.map(p => p.key), ['size', 'quality', 'background', 'outputFormat']);
          assert.ok(state.summaryParams.map(p => paramSummary(p, state.config[p.key] ?? p.default)).some(text => text === (outputFormat === 'gif' ? 'GIF 动画' : outputFormat === 'svg' ? 'SVG 矢量图' : '无损格式')));
          assert.equal(state.params.some(p => p.key === 'frameCount'), outputFormat === 'gif');
          assert.equal(state.params.some(p => p.key === 'frameDurationMs'), outputFormat === 'gif');
        }
      }
    }
    const audio = generationNodeState({ id: 'speech', type: 'audioGeneration', model: 'minimax-speech-2.8-hd', config: {} }, true, []);
    assert.ok(audio.summaryParams.length > 0);
    assert.ok(audio.summaryParams.every(p => p.presentation.summary === true), '显式配置的音频摘要仍然生效');
  } finally { await env.dispose(); }
});

test('Images 2.6 两家渠道的生成和编辑传递 GIF 参数，归档保留全部帧', async () => {
  const env = await createRendererEnv();
  try {
    const { desktopApi } = await env.load('services/desktopApi');
    const { getProviderAdapter } = await env.load('domain/provider/adapters/index');
    const { resolveModelRuntimeContract, getModelSchema } = await env.load('domain/catalog/ModelCatalog');
    const { archiveGeneratedOutput } = await env.load('services/generatedResultArchive');
    const previousGenerate = desktopApi.model.imageGeneration;
    const previousSave = desktopApi.file.saveDataUrlToProject;
    let sent;
    desktopApi.model.imageGeneration = async body => {
      sent = body;
      return { output_format: 'gif', data: [{ b64_json: gif }] };
    };
    desktopApi.file.saveDataUrlToProject = async (dataUrl, name) => {
      assert.equal(dataUrl, `data:image/gif;base64,${gif}`);
      assert.equal(name, '循环表情.gif');
      return { filePath: `/project/${name}`, name, ext: 'gif' };
    };
    try {
      for (const provider of ['openai', 'starrouter']) {
        for (const variant of ['sunburst', 'flare']) {
          const upstream = `gpt-image-2.6-${variant}`;
          const id = provider === 'openai' ? upstream : `starrouter-${upstream}`;
          for (const modeId of ['text-to-image', 'image-to-image']) {
            const edit = modeId === 'image-to-image';
            const contract = resolveModelRuntimeContract('imageGeneration', id, edit ? ['referenceImage'] : [], modeId);
            const schema = getModelSchema('imageGeneration', id, modeId);
            const params = Object.fromEntries(schema.params.map(p => [p.key, p.default]));
            const frameCount = schema.params.find(p => p.key === 'frameCount');
            assert.deepEqual(frameCount.visibleWhen, { outputFormat: 'gif' });
            assert.deepEqual([frameCount.presentation.min, frameCount.presentation.max], [2, 16]);
            assert.equal(contract.resultFormatPath, 'output_format');
            const adapter = getProviderAdapter(provider);
            const task = await adapter.submit(adapter.compileRequest({
              taskType: 'imageGeneration', model: id, prompt: '循环表情', modelContract: contract,
              params: { ...params, outputFormat: 'gif', size: '512x512', frameCount: 12, frameDurationMs: 80, complexity: 'medium' },
              modelInputs: { images: edit ? [{ url: 'https://example.com/ref.png', filePath: '/project/ref.png', mimeType: 'image/png' }] : [] },
            }));
            assert.equal(sent.model, upstream);
            assert.equal(sent.__endpointPath, edit ? '/images/edits' : '/images/generations');
            assert.equal(sent.__multipart, edit);
            assert.deepEqual([sent.output_format, sent.frame_count, sent.frame_duration_ms, sent.complexity], ['gif', 12, 80, 'medium']);
            assert.equal(task.status, 'completed');
            const project = { materials: [] };
            const archived = await archiveGeneratedOutput({ project,
              node: { id: 'node', type: 'imageGeneration', title: '循环表情' },
              task: { id: 'task', model: id }, output: task.result });
            assert.equal(archived.archivedFiles.length, 1);
            assert.equal(project.materials[0].mimeType, 'image/gif');
            assert.equal(project.materials[0].resourceType, 'image');
            assert.equal(project.materials[0].ext, 'gif');
          }
        }
      }
    } finally {
      desktopApi.model.imageGeneration = previousGenerate;
      desktopApi.file.saveDataUrlToProject = previousSave;
    }
  } finally { await env.dispose(); }
});

test('未回显格式或错误回显 PNG 时，GIF 字节仍决定归档格式', () => {
  for (const output_format of [undefined, 'png']) {
    const result = normalizeProtocolResponse({ output_format, data: [{ b64_json: gif }] }, {
      resultBase64Path: 'data.*.b64_json', resultFormatPath: 'output_format',
    });
    assert.equal(result.files[0].mimeType, 'image/gif');
    assert.equal(extensionForGeneratedFile(result.files[0], 'png'), 'gif');
    assert.equal(result.files[0].b64Json, gif);
  }
});

test('SVG 和无后缀链接使用回执格式，data URL 与 JPEG 使用实际 MIME', () => {
  const result = normalizeProtocolResponse({ output_format: 'svg', data: [{ url: 'https://example.com/download?id=1' }] }, {
    resultUrlPath: 'data.*.url', resultFormatPath: 'output_format',
  });
  assert.equal(result.files[0].mimeType, 'image/svg+xml');
  assert.equal(extensionForGeneratedFile(result.files[0], 'png'), 'svg');
  assert.equal(extensionForGeneratedFile({ dataUrl: `data:image/gif;base64,${gif}` }, 'png'), 'gif');
  assert.equal(extensionForGeneratedFile({ mimeType: 'image/jpeg' }, 'png'), 'jpg');
  assert.equal(extensionForGeneratedFile({ name: 'notes.md', mimeType: 'text/markdown' }), 'md');
  assert.equal(extensionForGeneratedFile({ name: 'photo.jpeg', mimeType: 'image/jpeg' }), 'jpeg');
});

test('GIF 预览读取原始动画，避免 JPEG 缩略图抹掉后续帧', async () => {
  const env = await createRendererEnv();
  try {
    const { desktopApi } = await env.load('services/desktopApi');
    const { acquireMediaPreview } = await env.load('services/mediaPreviewCache');
    const previousRead = desktopApi.file.readArrayBuffer;
    const previousPreview = desktopApi.file.readImagePreview;
    desktopApi.file.readImagePreview = async () => { assert.fail('GIF must bypass JPEG thumbnails'); };
    desktopApi.file.readArrayBuffer = async () => Uint8Array.from(Buffer.from(gif, 'base64')).buffer;
    try {
      for (const input of [{ path: '/project/loop.GIF' }, { path: '/project/opaque', mimeType: 'image/gif' }]) {
        const lease = await acquireMediaPreview({ ...input, kind: 'image' });
        try {
          const blob = await fetch(lease.url).then(r => r.blob());
          assert.equal(blob.type, 'image/gif');
          assert.equal(Buffer.from(await blob.arrayBuffer()).toString('base64'), gif);
        } finally { lease.release(); }
      }
    } finally {
      desktopApi.file.readArrayBuffer = previousRead;
      desktopApi.file.readImagePreview = previousPreview;
    }
  } finally { await env.dispose(); }
});
