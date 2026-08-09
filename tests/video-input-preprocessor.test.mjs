import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const taskService = readFileSync(
  new URL('../renderer/src/services/modelTaskService.js', import.meta.url),
  'utf8',
);

test('视频任务直接提交用户连接或上传的原始图片输入', () => {
  assert.doesNotMatch(taskService, /preprocessVideoModelInputs|videoInputPreprocessing/);
  assert.doesNotMatch(taskService, /applyColoredPencil|colored.?pencil|彩铅/i);
  assert.match(taskService, /modelInputs: payload\.modelInputs/);
  assert.ok(
    taskService.indexOf('const contract = requireModelContract(payload)')
      < taskService.indexOf('const req = transport.compileRequest(context)'),
  );
});

test('自动视频输入预处理模块已移除，手动彩铅不进入生成任务入口', () => {
  assert.doesNotMatch(taskService, /videoInputPreprocessor/);
  assert.doesNotMatch(taskService, /mimeType:\s*['"]image\/png['"]/);
  assert.doesNotMatch(taskService, /remoteUrl:\s*['"]{2}/);
});
