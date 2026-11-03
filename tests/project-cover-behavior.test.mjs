import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';
let env;
let cover;
before(async () => { env = await createRendererEnv({ storage: new Map(), withWindow: true }); ({ projectCoverSource: cover } = await env.load('utils/projectCover')); });
after(async () => { await env.dispose(); });
test('封面来自画布节点当前真实图片，重复读取保持稳定', () => {
  const project = { nodes: [{ id: 'n', type: 'image', selectedOutputNodeId: 'b', generatedOutputs: [{ id: 'a', resourceType: 'image', filePath: '/old.png' }, { id: 'b', resourceType: 'image', filePath: '/current.png' }] }] };
  assert.equal(cover(project), '/current.png');
  assert.equal(cover(project), '/current.png');
});
test('文本与视频工程不伪造封面，独立素材库图片不冒充画布内容', () => {
  assert.equal(cover({ nodes: [{ id: 'video', resourceType: 'video', filePath: '/video.mp4' }, { type: 'text', content: 'hello' }], materials: [{ nodeId: 'other', filePath: '/library.png' }] }), '');
  assert.equal(cover(null), '');
});
test('关联到画布的素材以及上传图片可以作为封面', () => {
  assert.equal(cover({ nodes: [{ id: 'n', type: 'image' }], materials: [{ id: 'm', nodeId: 'n', filePath: '/real.webp' }] }), '/real.webp');
  assert.equal(cover({ nodes: [{ id: 'n', uploadedFile: { filePath: '/upload.png', resourceType: 'image' } }] }), '/upload.png');
});
test('浏览器项目树携带封面路径，不需要逐卡片再次读取工程', async () => {
  const { desktopApi } = await env.load('services/desktopApi');
  const directory = await desktopApi.project.createFolder('browser/projects', '封面测试');
  await desktopApi.project.save(directory, { name: '封面测试', nodes: [{ type: 'resource', resourceType: 'image', url: 'data:image/png;base64,real' }] });
  const entries = await desktopApi.project.listRoot('browser/projects');
  assert.equal(entries.find(item => item.name === '封面测试').coverSource, 'data:image/png;base64,real');
});
