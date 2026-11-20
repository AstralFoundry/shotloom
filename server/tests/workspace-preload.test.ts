import assert from 'node:assert/strict';
import test from 'node:test';
import { collectWorkspacePreloads, workspacePreloadFiles, workspacePreloadHtml } from '../src/lib/workspacePreload';
import { runInNewContext } from 'node:vm';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('prewarm uses metadata shipped with the current HTML even if a deployment retained an older manifest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shotloom-preload-'));
  try {
    await mkdir(join(directory, '.vite'));
    await writeFile(join(directory, '.vite/manifest.json'), JSON.stringify({ 'index.html': { file: 'assets/main-old.js' } }));
    await writeFile(join(directory, 'index.html'), '<script type="module" src="./assets/main-new.js"></script><script id="shotloom-workspace-preloads" type="application/json">["assets/main-new.js","assets/workbench-new.js"]</script>');
    assert.deepEqual(await workspacePreloadFiles(pathToFileURL(directory + '/')), ['assets/main-new.js', 'assets/workbench-new.js']);
    await writeFile(join(directory, 'index.html'), '<script type="module" src="./assets/main-new.js"></script>');
    assert.deepEqual(await workspacePreloadFiles(pathToFileURL(directory + '/')), [], 'stale manifests cannot report successful warming of old code');
    await writeFile(join(directory, '.vite/manifest.json'), JSON.stringify({ 'index.html': { file: 'assets/main-new.js' } }));
    assert.deepEqual(await workspacePreloadFiles(pathToFileURL(directory + '/')), ['assets/main-new.js'], 'matching legacy builds remain supported');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('workspace warming follows static build dependencies without loading optional editors or remote URLs', () => {
  const chunks = {
    'index.html': { file: 'assets/main-123.js', imports: ['react'], css: ['assets/main-123.css'] },
    '_ReactWorkbench-123.js': { name: 'ReactWorkbench', file: 'assets/workbench-123.js', imports: ['react', 'project', 'invalid'], dynamicImports: ['editor'] },
    'src/app/ui/antd/AntdProvider.tsx': { name: 'AntdProvider', file: 'assets/provider-123.js', imports: ['react'] },
    react: { file: 'assets/react-123.js' }, project: { file: 'assets/project-123.js', imports: ['react', 'project'] },
    invalid: { file: 'https://other.example/code.js' }, editor: { file: 'assets/editor-123.js' },
  };
  const files = collectWorkspacePreloads(chunks);
  assert.deepEqual(files, ['assets/main-123.js', 'assets/main-123.css', 'assets/react-123.js', 'assets/workbench-123.js', 'assets/project-123.js', 'assets/provider-123.js']);
  assert.deepEqual(collectWorkspacePreloads({}), []);
});

test('cookies are ready before downloads finish; preload completion counts HTTP failures', async () => {
  const messages: { type: string; loaded?: number; failed?: string[] }[] = [];
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const html = workspacePreloadHtml('user', ['assets/main.js', 'assets/missing.css']);
  runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)![1]!, {
    window: { ReactNativeWebView: { postMessage: (value: string) => messages.push(JSON.parse(value)) } },
    fetch: async (path: string) => { await gate; return new Response('', { status: path.endsWith('css') ? 404 : 200 }); },
  });
  assert.deepEqual(messages.map(item => item.type), ['workspace-cookie-ready']);
  finish(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(messages.map(item => item.type), ['workspace-cookie-ready', 'workspace-session-ready']);
  assert.equal(messages[1]!.loaded, 1);
  assert.deepEqual(messages[1]!.failed, ['assets/missing.css']);
  assert.equal(workspacePreloadHtml('</script>', []).includes('const userId="</script>"'), false);
});
