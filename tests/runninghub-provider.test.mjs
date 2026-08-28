import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildRunningHubMinimaxH3Workflow,
  runningHubOutputUrl,
  runningHubTaskState,
} from '../renderer/src/utils/runningHubWorkflow.mjs';

const catalog = JSON.parse(readFileSync(new URL('../renderer/src/config/model-catalog-v2.json', import.meta.url), 'utf8'));
const template = JSON.parse(readFileSync(new URL('../renderer/src/config/runninghub-minimax-h3-workflow.json', import.meta.url), 'utf8'));
const registrySource = readFileSync(new URL('../renderer/src/domain/provider/ProviderRegistry.ts', import.meta.url), 'utf8');
const transportSource = readFileSync(new URL('../renderer/src/domain/provider/RunningHubTransport.ts', import.meta.url), 'utf8');
const gatewaySource = readFileSync(new URL('../src-tauri/src/commands/generation_gateway.rs', import.meta.url), 'utf8');

test('RunningHub 是可配置的内置厂商且密钥由网关注入请求体', () => {
  assert.match(registrySource, /id: 'runninghub'[\s\S]*defaultBaseUrl: 'https:\/\/www\.runninghub\.ai'/);
  assert.match(gatewaySource, /kind == "body"/);
  assert.match(gatewaySource, /body_with_auth/);
  assert.doesNotMatch(transportSource, /getProviderCredentials|settingsStore\.providerConfigs/);
});

test('RunningHub MiniMax H3 目录公开真实多模态输入与异步接口', () => {
  const model = catalog.models.find((item) => item.id === 'runninghub-minimax-h3-reference-to-video');
  assert.ok(model);
  assert.equal(model.provider, 'runninghub');
  const mode = model.modes[0];
  assert.deepEqual(mode.inputSlots, ['reference', 'inputVideo', 'referenceAudio']);
  assert.equal(mode.inputConstraints.images.max, 9);
  assert.equal(mode.inputConstraints.videos.max, 2);
  assert.equal(mode.inputConstraints.audios.max, 2);
  assert.deepEqual(mode.outputConstraints.durations, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  assert.deepEqual(mode.endpoint, { method: 'POST', path: '/task/openapi/create', scope: 'origin' });
  assert.deepEqual(mode.taskEndpoint, { method: 'POST', path: '/openapi/v2/query', scope: 'origin' });
  assert.deepEqual(mode.taskRequestTemplate, { taskId: '{{taskId}}' });
  assert.deepEqual(mode.auth, { type: 'body', name: 'apiKey' });
  assert.equal(mode.statusPath, 'status');
  assert.equal(mode.errorPath, 'errorMessage');
  assert.equal(mode.resultUrlPath, 'results.*.url');
});

test('RunningHub 工作流把参数和上传后的多媒体文件名写入稳定节点', () => {
  const workflow = buildRunningHubMinimaxH3Workflow(template, {
    prompt: '镜头向前推进',
    duration: 8,
    aspectRatio: '9:16',
    resolution: '2K',
    images: ['character.png'],
    videos: ['motion.mp4'],
    audios: ['voice.wav'],
  });
  assert.equal(workflow['25'].inputs.value, '镜头向前推进');
  assert.equal(workflow['28'].inputs.value, 8);
  assert.equal(workflow['26'].inputs.aspect_ratio, '9:16 (Portrait Widescreen)');
  assert.equal(workflow['26'].inputs.megapixels, 2);
  assert.equal(workflow['100'].inputs.image, 'character.png');
  assert.deepEqual(workflow['31'].inputs['ref_images.ref_image_0'], ['100', 0]);
  assert.equal(workflow['120'].inputs.video, 'motion.mp4');
  assert.deepEqual(workflow['31'].inputs['ref_videos.ref_video_0'], ['120', 0]);
  assert.equal(workflow['140'].inputs.audio, 'voice.wav');
  assert.deepEqual(workflow['31'].inputs['ref_audios.ref_audio_0'], ['140', 0]);
  assert.equal(template['25'].inputs.value, '');
});

test('RunningHub 查询结果只接受真实 MP4 输出', () => {
  assert.equal(runningHubOutputUrl({ data: [{ url: 'https://cdn.example/result.mp4' }] }), 'https://cdn.example/result.mp4');
  assert.equal(runningHubOutputUrl({ data: { outputs: [{ fileUrl: 'https://cdn.example/file', fileType: 'video/mp4' }] } }), 'https://cdn.example/file');
  assert.equal(runningHubOutputUrl({ status: 'SUCCESS', results: [{ url: 'https://cdn.example/current.mp4' }] }), 'https://cdn.example/current.mp4');
  assert.equal(runningHubOutputUrl({ data: [{ url: 'https://cdn.example/preview.png' }] }), '');
});

test('RunningHub 当前顶层查询响应映射为统一任务状态', () => {
  assert.deepEqual(runningHubTaskState({
    taskId: '123', status: 'RUNNING', errorCode: '', errorMessage: '', results: null,
  }), { status: 'running', progress: 0 });
  assert.deepEqual(runningHubTaskState({
    taskId: '123', status: 'SUCCESS', errorCode: '', results: [{ url: 'https://cdn.example/final.mp4' }],
  }), { status: 'completed', progress: 100, url: 'https://cdn.example/final.mp4' });
  assert.deepEqual(runningHubTaskState({
    taskId: '', status: '', errorCode: '1004', errorMessage: 'Task not found', results: null,
  }), { status: 'failed', progress: 0, error: 'Task not found' });
});

test('RunningHub 示例目录已移除，产品只保留运行时实现和工作流模板', () => {
  assert.equal(existsSync(new URL('../runninghub', import.meta.url)), false);
  assert.equal(existsSync(new URL('../renderer/src/config/runninghub-minimax-h3-workflow.json', import.meta.url)), true);
});
