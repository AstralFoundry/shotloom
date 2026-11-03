import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let desktopApi;
const browserStorage = new Map();

before(async () => {
  env = await createRendererEnv({ storage: browserStorage });
  ({ desktopApi } = await env.load('services/desktopApi'));
});

after(async () => {
  await env?.dispose();
});

test('浏览器预览保存并重新打开画布时保留节点资源与文件夹层级', async () => {
  const folderDir = await desktopApi.project.createFolder('browser/projects', '短片');
  const project = {
    schema: 'shotloom-project',
    schemaVersion: 2,
    name: '第一幕',
    nodes: [{ id: 'image-1', type: 'image', resource: 'data:image/png;base64,AAAA' }],
    edges: [],
  };

  const saved = await desktopApi.project.save(folderDir, project);
  const reopened = await desktopApi.project.readFile(saved.filePath);
  const tree = await desktopApi.project.listRoot('browser/projects');

  assert.deepEqual(reopened, project);
  assert.equal(tree[0].kind, 'project');
  assert.equal(tree[0].projectDir, folderDir);
  assert.equal(tree[0].filePath, saved.filePath);
});
