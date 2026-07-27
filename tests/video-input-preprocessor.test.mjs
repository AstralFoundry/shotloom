import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const preprocessor = readFileSync(
  new URL('../renderer/src/services/videoInputPreprocessor.js', import.meta.url),
  'utf8',
);
const taskService = readFileSync(
  new URL('../renderer/src/services/modelTaskService.js', import.meta.url),
  'utf8',
);

test('视频任务在请求编译前自动彩铅化全部图片输入', () => {
  assert.match(taskService, /await preprocessVideoModelInputs\(payload\)/);
  assert.ok(
    taskService.indexOf('await preprocessVideoModelInputs(payload)')
      < taskService.indexOf('const contract = requireModelContract(payload)'),
  );
  assert.match(preprocessor, /payload\.nodeType !== 'videoGeneration'/);
  assert.match(preprocessor, /Promise\.all\(images\.map\(preprocessImageRef\)\)/);
  assert.match(preprocessor, /Promise\.all\(referenceImages\.map\(preprocessImageRef\)\)/);
  assert.match(preprocessor, /desktopApi\.file\.applyColoredPencil/);
});

test('视频内部彩铅不创建画布节点并强制提交处理后的本地 PNG', () => {
  assert.doesNotMatch(preprocessor, /project\.nodes|addCanvasEdge|selectedOutputNodeId/);
  assert.match(preprocessor, /mimeType: 'image\/png'/);
  assert.match(preprocessor, /remoteUrl: ''/);
  assert.match(preprocessor, /processedImageCache/);
  assert.match(preprocessor, /automatic: true/);
});
