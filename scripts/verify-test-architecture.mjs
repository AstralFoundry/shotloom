#!/usr/bin/env node
/**
 * 测试架构门禁：读源码文本与起渲染进程模块图这两件事，测试只能各用一份实现。
 *
 * 契约断言本身留在 node:test 里（失败信息按用例给出，重构时也只改对应那一条），
 * 但"怎么读文件、怎么起 SSR"属于基础设施：每个测试各写一份时，路径基准、缓存和
 * 端口配置会各自漂移，测试也会脱离仓库根目录就无法运行。这里把这两条挡住。
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const testsDir = path.join(repoRoot, 'tests');
const helpersDir = path.join(testsDir, 'helpers');

// 允许直接实现基础设施的共享模块；测试文件只能调用它们。
const SHARED_READS = 'helpers/sourceContract.mjs';
const SHARED_SSR = 'helpers/rendererSsr.mjs';
const SHARED_FILES = new Set([SHARED_READS.slice('helpers/'.length), SHARED_SSR.slice('helpers/'.length)]);

/** 从 `new URL('../x', import.meta.url)` 拼路径改成按仓库根解析后会失去唯一基准。 */
const HAND_ROLLED_PATH = /readFileSync\(\s*new URL\([^)]*import\.meta\.url/;
const HAND_ROLLED_EXISTS = /existsSync\(\s*new URL\([^)]*import\.meta\.url/;
const HAND_ROLLED_SSR = /createServer\(/;

const violations = [];
for (const name of readdirSync(testsDir)) {
  if (!name.endsWith('.test.mjs')) continue;
  const file = path.join(testsDir, name);
  const source = readFileSync(file, 'utf8');
  const label = `tests/${name}`;
  if (HAND_ROLLED_PATH.test(source) || HAND_ROLLED_EXISTS.test(source)) {
    if (!source.includes(SHARED_READS)) {
      violations.push(`${label} 自己拼仓库根路径读源码（用 ${SHARED_READS} 的 readSource/sourceExists）`);
    } else {
      violations.push(`${label} 已经用了共享读取，却仍留着 new URL(…, import.meta.url) 的手工读盘`);
    }
  }
  if (HAND_ROLLED_SSR.test(source) && !source.includes(SHARED_SSR)) {
    violations.push(`${label} 自己起 Vite SSR（用 ${SHARED_SSR} 的 createRendererEnv）`);
  }
}

// 共享实现也只能有一份：helpers 里除这两个模块外不得再各起一套。
for (const name of readdirSync(helpersDir)) {
  if (!name.endsWith('.mjs') || SHARED_FILES.has(name)) continue;
  const source = readFileSync(path.join(helpersDir, name), 'utf8');
  if (HAND_ROLLED_SSR.test(source)) {
    violations.push(`tests/helpers/${name} 自己起 Vite SSR（用 ${SHARED_SSR} 的 createRendererEnv）`);
  }
}

if (violations.length) {
  console.error('测试架构检查失败：');
  for (const violation of violations) console.error(`  ✗ ${violation}`);
  console.error(`\n读产品源码走 ${SHARED_READS}，加载渲染进程模块走 ${SHARED_SSR}；`
    + '新增测试不要复制这两套基础设施。');
  process.exit(1);
}

const testFiles = readdirSync(testsDir).filter((name) => name.endsWith('.test.mjs'));
console.log(`测试架构检查通过：${testFiles.length} 个测试文件，源码读取与 SSR 装配各一份实现。`);
