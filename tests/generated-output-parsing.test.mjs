import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compactGeneratedOutput,
  extractGeneratedFiles,
} from '../renderer/src/utils/generatedOutputParsing.mjs';

test('归档解析同时接受协议层 b64Json 和供应商 b64_json', () => {
  assert.deepEqual(extractGeneratedFiles({ files: [{ b64Json: 'YWJj' }] })
    .map((file) => file.b64Json), ['YWJj']);
  assert.deepEqual(extractGeneratedFiles({ data: [{ b64_json: 'ZGVm' }] })
    .map((file) => file.b64Json), ['ZGVm']);
});

test('成功归档后会压缩所有支持的 Base64 字段', () => {
  assert.deepEqual(compactGeneratedOutput({
    files: [{ b64Json: 'YWJj' }],
    raw: { data: [{ b64_json: 'ZGVm' }], dataUrl: 'data:image/png;base64,YQ==' },
  }), {
    files: [{ b64Json: '[已归档，原始数据 4 字符]' }],
    raw: {
      data: [{ b64_json: '[已归档，原始数据 4 字符]' }],
      dataUrl: '[已归档，原始数据 26 字符]',
    },
  });
});

test('没有公开 URL 的鉴权结果端点仍会被识别为生成文件', () => {
  const [file] = extractGeneratedFiles({ files: [{
    name: 'result.mp4',
    mimeType: 'video/mp4',
    metadata: { downloadAuth: { endpointPath: '/v1/videos/task-1/content' } },
  }] });
  assert.equal(file.downloadEndpoint, '/v1/videos/task-1/content');
  assert.equal(file.name, 'result.mp4');
});
