import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env, store, api;
const calls = [];
before(async () => {
  env = await createRendererEnv({ storage: new Map(), withWindow: true });
  ({ store } = await env.load('store/projectStore'));
  const { createTauriApi } = await env.load('services/tauriApi');
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" } },
    invoke: async (command, args) => {
      calls.push({ command, args });
      if (command === 'file_resolve_unique_path') return `${args.directory}/${args.name}`;
      if (command === 'generation_download') return { filePath: args.request.target };
      return null;
    },
  };
  api = createTauriApi({});
});
after(async () => env?.dispose());

test('媒体落盘只读取当前公共项目对象，切换后不使用旧会话目录', async () => {
  localStorage.setItem('shotloom-session', JSON.stringify({ projectDir: '/old-project', project: {} }));
  store.projectDir = '/current-project';
  store.project = {};
  const first = await api.file.downloadUrlToProject('https://cdn.example.com/clip.mp4', 'clip.mp4');
  assert.equal(first.filePath, '/current-project/assets/clip.mp4');
  store.projectDir = '/next-project';
  store.project = { library: { assetRootDir: '/shared-assets' } };
  const next = await api.file.downloadUrlToProject('https://cdn.example.com/frame.png', 'frame.png');
  assert.equal(next.filePath, '/shared-assets/frame.png');
  assert.equal(calls.some((call) => JSON.stringify(call).includes('/old-project')), false);
});

test('没有当前工程目录时拒绝落盘，不能退回旧会话', async () => {
  store.projectDir = null;
  store.project = {};
  const count = calls.length;
  await assert.rejects(api.file.downloadUrlToProject('https://cdn.example.com/a.png', 'a.png'), /保存|项目|目录/);
  assert.equal(calls.length, count);
});
