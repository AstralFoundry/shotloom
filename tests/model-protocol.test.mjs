import assert from 'node:assert/strict';
import test from 'node:test';
import {
  firstProtocolValue,
  normalizeProtocolResponse,
  protocolInlineImage,
  protocolKlingContents,
  protocolMediaContent,
  protocolMessageVariables,
  readProtocolPath,
  renderProtocolTemplate,
} from '../renderer/src/utils/modelProtocol.mjs';
import { modelApiUrl, modelJsonRequestBody, multipartArrayFieldName } from '../renderer/src/utils/modelRequestBody.mjs';

test('multipart 图片字段按输入数量切换单值和数组语法', () => {
  assert.equal(multipartArrayFieldName('image', 1), 'image');
  assert.equal(multipartArrayFieldName('image', 2), 'image[]');
  assert.equal(multipartArrayFieldName('image[]', 3), 'image[]');
});

test('声明式协议把文本、图片和参数变量编译进请求体', () => {
  const body = renderProtocolTemplate({
    model: '{{model}}',
    messages: '{{messages}}',
    image_urls: '{{imageUrls}}',
    duration: '{{params.duration}}',
    optional: '{{missing}}',
  }, {
    model: 'claude-test',
    messages: [{ role: 'user', content: '你好' }],
    imageUrls: ['https://example.com/a.png'],
    params: { duration: 5 },
  });
  assert.deepEqual(body, {
    model: 'claude-test',
    messages: [{ role: 'user', content: '你好' }],
    image_urls: ['https://example.com/a.png'],
    duration: 5,
  });
});

test('其他供应商可把视频和音频输入映射到独立请求字段', () => {
  assert.deepEqual(renderProtocolTemplate({
    reference_video: '{{videoUrl}}',
    voice_samples: '{{audioUrls}}',
  }, {
    videoUrl: 'https://example.com/reference.mp4',
    audioUrls: ['https://example.com/a.wav', 'https://example.com/b.mp3'],
  }), {
    reference_video: 'https://example.com/reference.mp4',
    voice_samples: ['https://example.com/a.wav', 'https://example.com/b.mp3'],
  });
});

test('Google Veo 内联图片拆分 MIME 和 Base64 请求字段', () => {
  assert.deepEqual(protocolInlineImage('data:image/PNG;base64,aGVsbG8='), {
    bytesBase64Encoded: 'aGVsbG8=',
    mimeType: 'image/png',
  });
  assert.equal(protocolInlineImage('https://example.com/image.png'), undefined);
});

test('方舟参考图内容按声明角色编译且保留纯文生视频', () => {
  assert.deepEqual(protocolMediaContent({ prompt: '电影感运镜' }), [
    { type: 'text', text: '电影感运镜' },
  ]);
  assert.deepEqual(protocolMediaContent({
    prompt: '保持角色一致',
    imageUrls: ['https://example.com/a.png', 'https://example.com/b.png'],
    imageRole: 'reference_image',
  }), [
    { type: 'text', text: '保持角色一致' },
    { type: 'image_url', image_url: { url: 'https://example.com/a.png' }, role: 'reference_image' },
    { type: 'image_url', image_url: { url: 'https://example.com/b.png' }, role: 'reference_image' },
  ]);
});

test('声明式多模态内容映射视频和参考音频的厂商角色', () => {
  assert.deepEqual(protocolMediaContent({
    prompt: '沿用参考音色与节奏',
    imageUrls: ['https://example.com/person.png'],
    imageRole: 'reference_image',
    videoUrls: ['https://example.com/motion.mp4'],
    videoRole: 'reference_video',
    audioUrls: ['data:audio/wav;base64,aGVsbG8='],
    audioRole: 'reference_audio',
  }), [
    { type: 'text', text: '沿用参考音色与节奏' },
    { type: 'image_url', image_url: { url: 'https://example.com/person.png' }, role: 'reference_image' },
    { type: 'video_url', video_url: { url: 'https://example.com/motion.mp4' }, role: 'reference_video' },
    { type: 'audio_url', audio_url: { url: 'data:audio/wav;base64,aGVsbG8=' }, role: 'reference_audio' },
  ]);
});

test('MiniMax H3 首帧图编译为 V2 content 数组', () => {
  assert.deepEqual(protocolMediaContent({
    prompt: '镜头缓慢推近',
    imageUrls: ['data:image/png;base64,aGVsbG8='],
    imageRole: 'first_frame',
  }), [
    { type: 'text', text: '镜头缓慢推近' },
    {
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,aGVsbG8=' },
      role: 'first_frame',
    },
  ]);
});

test('首尾帧内容使用每个槽位自己的供应商角色', () => {
  assert.deepEqual(protocolMediaContent({
    prompt: '从白天过渡到夜晚',
    imageItems: [
      { url: 'https://example.com/first.png', role: 'first_frame' },
      { url: 'https://example.com/last.png', role: 'last_frame' },
    ],
  }), [
    { type: 'text', text: '从白天过渡到夜晚' },
    { type: 'image_url', image_url: { url: 'https://example.com/first.png' }, role: 'first_frame' },
    { type: 'image_url', image_url: { url: 'https://example.com/last.png' }, role: 'last_frame' },
  ]);
});

test('Kling API 2.0 协议生成首帧和多参考图 contents', () => {
  assert.deepEqual(protocolKlingContents({
    prompt: '镜头缓慢推进',
    imageUrls: ['https://example.com/start.png'],
  }), [
    { type: 'prompt', text: '镜头缓慢推进' },
    { type: 'first_frame', url: 'https://example.com/start.png' },
  ]);
  assert.deepEqual(protocolKlingContents({
    prompt: '参考角色与场景',
    imageUrls: ['https://example.com/a.png', 'https://example.com/b.png'],
    imageType: 'refer_image',
  }), [
    { type: 'prompt', text: '参考角色与场景' },
    { type: 'refer_image', url: 'https://example.com/a.png', id: 'image_1' },
    { type: 'refer_image', url: 'https://example.com/b.png', id: 'image_2' },
  ]);
});

test('原生 Claude 协议把 system 与消息数组分开', () => {
  assert.deepEqual(protocolMessageVariables([
    { role: 'system', content: '规则一' },
    { role: 'system', content: '规则二' },
    { role: 'user', content: '你好' },
  ]), {
    messages: [
      { role: 'system', content: '规则一' },
      { role: 'system', content: '规则二' },
      { role: 'user', content: '你好' },
    ],
    nonSystemMessages: [{ role: 'user', content: '你好' }],
    system: '规则一\n\n规则二',
  });
});

test('声明式路径支持 Claude 文本、图片数组和异步视频结果', () => {
  assert.equal(firstProtocolValue({ content: [{ text: '完成' }] }, 'content.0.text'), '完成');
  assert.deepEqual(
    readProtocolPath({ data: [{ url: 'https://example.com/1.png' }, { url: 'https://example.com/2.png' }] }, 'data.*.url'),
    ['https://example.com/1.png', 'https://example.com/2.png'],
  );
  assert.deepEqual(
    normalizeProtocolResponse({ output: { video_url: 'https://example.com/v.mp4' } }, { resultUrlPath: 'output.video_url' }),
    { files: [{ url: 'https://example.com/v.mp4' }], url: 'https://example.com/v.mp4', raw: { output: { video_url: 'https://example.com/v.mp4' } } },
  );
  assert.deepEqual(
    normalizeProtocolResponse({ data: [{ b64_json: 'aGVsbG8=' }] }, { resultBase64Path: 'data.*.b64_json' }).files,
    [{ b64Json: 'aGVsbG8=' }],
  );
  assert.deepEqual(
    normalizeProtocolResponse(
      { video: { uri: 'https://example.com/authenticated.mp4' } },
      { provider: 'google', auth: { type: 'header', name: 'x-goog-api-key' }, resultUrlPath: 'video.uri', resultDownloadAuth: true },
    ).files,
    [{
      url: 'https://example.com/authenticated.mp4',
      metadata: { downloadAuth: { providerId: 'google', headers: undefined, auth: { type: 'header', name: 'x-goog-api-key' } } },
    }],
  );
});

test('协议控制字段不会泄漏进厂商请求 JSON', () => {
  assert.deepEqual(modelJsonRequestBody({
    model: 'test', prompt: 'hello', __providerId: 'custom',
    __headers: { 'anthropic-version': '2023-06-01' }, __auth: { type: 'header', name: 'x-api-key' },
  }), { model: 'test', prompt: 'hello' });
});

test('厂商根地址与官方原生接口路径只拼接一次', () => {
  assert.equal(
    modelApiUrl({}, '/models/veo-3.1-generate-preview:predictLongRunning', 'root', 'google'),
    'https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning',
  );
  assert.equal(
    modelApiUrl({ qwen: { baseUrl: 'https://workspace.ap-southeast-1.maas.aliyuncs.com' } }, '/api/v1/services/aigc/multimodal-generation/generation', 'root', 'qwen'),
    'https://workspace.ap-southeast-1.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  );
  assert.equal(
    modelApiUrl({}, '/text-to-video/kling-3.0', 'root', 'kling'),
    'https://api-singapore.klingai.com/text-to-video/kling-3.0',
  );
  assert.equal(
    modelApiUrl({}, '/v2/video_generation', 'root', 'minimax'),
    'https://api.minimax.io/v2/video_generation',
  );
});
