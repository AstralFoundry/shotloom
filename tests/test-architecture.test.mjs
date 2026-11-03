/**
 * 测试自己的基础设施只有一份实现：起渲染进程模块图和读产品源码。
 *
 * 这两件事过去在每个测试文件里各抄一遍，路径基准、端口和缓存策略会各自漂移，
 * 测试也只有在仓库根目录跑才正确。契约断言仍留在各测试里按用例给出，这里只锁住装配层。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { readSource } from './helpers/sourceContract.mjs';

const script = readSource('scripts/verify-test-architecture.mjs');
const readsHelper = readSource('tests/helpers/sourceContract.mjs');
const ssrHelper = readSource('tests/helpers/rendererSsr.mjs');

function testFiles() {
  return readdirSync(new URL('.', import.meta.url)).filter((name) => name.endsWith('.test.mjs'));
}

test('读产品源码与起 SSR 各自只有一个实现，测试只能调用它们', () => {
  for (const name of testFiles()) {
    const source = readSource(`tests/${name}`);
    assert.doesNotMatch(source, /createServer\(/, `${name} 不得自己装配 Vite SSR`);
    assert.doesNotMatch(source, /readFileSync\(\s*new URL\([^)]*import\.meta\.url/,
      `${name} 不得自己拼仓库根路径读源码`);
  }
});

test('共享装配层暴露的正是测试需要的三件事', () => {
  assert.match(ssrHelper, /export async function createRendererEnv\(/);
  assert.match(ssrHelper, /server: \{ middlewareMode: true, hmr: false \}/);
  assert.match(ssrHelper, /configFile: false/);
  // 存储替身由测试自己的 Map 承接，断言完还能读回写入内容。
  assert.match(ssrHelper, /getItem: \(key\) => backing\.get\(key\) \?\? null/);
  assert.match(ssrHelper, /async dispose\(\)[\s\S]*delete globalThis\[name\]/);

  assert.match(readsHelper, /export function readSource\(/);
  assert.match(readsHelper, /export function readSources\(/);
  assert.match(readsHelper, /export function sourceExists\(/);
  assert.match(readsHelper, /sources\.set\(key, readFileSync\(new URL\(key, repoRoot\)/,
    '路径基准只能是仓库根');
});

test('门禁把重复装配挡在测试之外', () => {
  assert.match(script, /自己起 Vite SSR/);
  assert.match(script, /自己拼仓库根路径读源码/);
  // helpers 里除这两个模块外也不得再复制一套装配。
  assert.match(script, /SHARED_FILES/);
  execFileSync(process.execPath, ['scripts/verify-test-architecture.mjs'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'pipe',
  });
});
