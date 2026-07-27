import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extensionForGeneratedFile,
  semanticOutputFileName,
} from '../renderer/src/utils/generatedOutputNaming.mjs';

test('生成资源沿用大模型给出的节点标题', () => {
  assert.equal(semanticOutputFileName('S11 动作爆点 · 六连板', 'png'), 'S11 动作爆点 · 六连板.png');
  assert.equal(semanticOutputFileName('角色/正面:设定', 'png'), '角色-正面-设定.png');
});

test('多输出追加稳定序号并保留供应商文件扩展名', () => {
  assert.equal(extensionForGeneratedFile({ url: 'https://example.com/result/video.MP4?token=x' }, 'dat'), 'mp4');
  assert.equal(semanticOutputFileName('镜头预览', 'mp4', 1, 3), '镜头预览-2.mp4');
});
