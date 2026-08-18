import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nodeChatAttachmentKey,
  resolveNodeChatImageAttachment,
} from '../renderer/src/services/nodeChatAttachment.mjs';

test('节点加入对话时携带当前选中的图片产物', () => {
  const attachment = resolveNodeChatImageAttachment({
    id: 'image-node',
    title: '角色定妆照',
    generatedOutputs: [
      { id: 'old', selected: false, filePath: '/project/old.png', resourceType: 'image' },
      { id: 'current', selected: true, filePath: '/project/current.webp', resourceType: 'image' },
    ],
  });
  assert.deepEqual(attachment, {
    name: '角色定妆照',
    fileName: '角色定妆照',
    mimeType: 'image/webp',
    resourceType: 'image',
    nodeId: 'image-node',
    path: '/project/current.webp',
    filePath: '/project/current.webp',
  });
  assert.equal(nodeChatAttachmentKey(attachment), '/project/current.webp');
});

test('上传图片和远程图片也能转换为 Agent 视觉附件', () => {
  assert.equal(
    resolveNodeChatImageAttachment({
      id: 'upload',
      uploadedFile: { path: '/project/reference.jpg', resourceType: 'image' },
    })?.mimeType,
    'image/jpeg',
  );
  assert.equal(
    resolveNodeChatImageAttachment({
      id: 'remote',
      generatedOutputs: [{ selected: true, url: 'https://cdn.example.com/output.png' }],
    })?.url,
    'https://cdn.example.com/output.png',
  );
});

test('视频、音频和文本节点不会伪装成图片附件', () => {
  assert.equal(resolveNodeChatImageAttachment({
    id: 'video',
    generatedOutputs: [{ selected: true, filePath: '/project/output.mp4', resourceType: 'video' }],
  }), null);
  assert.equal(resolveNodeChatImageAttachment({ id: 'empty' }), null);
});
