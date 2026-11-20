import { readFile, writeFile, mkdir, cp, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { packVfsImage } from '@deepseek-ai/dsh-experimental-webworker-packer';
import { WRAPPER_PARAMS } from '@deepseek-ai/dsh-experimental-webworker-runtime';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, '../../renderer/public/harness/worker');
const staging = resolve(root, 'node_modules/.shotloom-browser-agent');
await mkdir(staging, { recursive: true });
await mkdir(output, { recursive: true });
await cp(resolve(root, '../../renderer/src/agent/content'), join(staging, 'content'), { recursive: true });
await cp(resolve(root, '../../AGENTS.md'), join(staging, 'content/AGENTS.md'));
const stub = 'export function openDatabase(){throw new Error("SQLite is unavailable in Worker")} export class HostCrud{} export class SessionCrud{} export class DomainCrud{}';
const bundle = await build({ entryPoints: [join(root, 'browser/index.mjs')], outfile: join(staging, 'index.mjs'), bundle: true, format: 'esm', platform: 'neutral', target: 'es2022', metafile: true,
  external: ['@deepseek-ai/*', 'node:*'],
  plugins: [{ name: 'browser-storage-and-model', setup(builder) {
    builder.onResolve({ filter: /^@deepseek-ai\/dsh-(?:subprocess-local|sandbox-local|bash-sandbox|shell-env|tool-bash)$/ }, args => ({ path: args.path, namespace: 'worker-unavailable' }));
    builder.onLoad({ filter: /.*/, namespace: 'worker-unavailable' }, () => ({ contents: 'export default class Unavailable { constructor(){ throw new Error("Native process execution is unavailable in Worker") } }', loader: 'js' }));
    builder.onResolve({ filter: /(?:db\/connection|crud\/(?:hostCrud|sessionCrud|domainCrud))\.js$/ }, () => ({ path: 'sqlite', namespace: 'worker-stub' }));
    builder.onLoad({ filter: /.*/, namespace: 'worker-stub' }, () => ({ contents: stub, loader: 'js' }));
    builder.onResolve({ filter: /^@deepseek-ai\/dsh-attachment-local$/ }, () => ({ path: join(root, 'browser/attachments.mjs') }));
    builder.onResolve({ filter: /^@deepseek-ai\/dsh-session-query-sqlite$/ }, () => ({ path: '@deepseek-ai/dsh-session-query', external: true }));
    builder.onResolve({ filter: /^@deepseek-ai\/dsh-llm-pi-ai$/ }, () => ({ path: join(root, 'browser/model.mjs') }));
  } }],
});
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const imported = new Set(Object.values(bundle.metafile.outputs).flatMap(row => row.imports.map(item => item.path.split('/').slice(0, 2).join('/'))));
const dependencies = Object.fromEntries(Object.entries(manifest.dependencies).filter(([name]) => imported.has(name)));
await writeFile(join(staging, 'package.json'), JSON.stringify({ name: '@shotloom/browser-agent', version: '0.0.0', type: 'module', exports: './index.mjs', files: ['index.mjs'], dependencies }));
const workspaces = new Map([['@shotloom/browser-agent', staging]]);
for (const row of await readdir(join(root, 'node_modules/@deepseek-ai'), { withFileTypes: true })) {
  if (row.isDirectory() && !row.name.includes('experimental') && !/^dsh-client-(?!connection|file-upload)/.test(row.name)) workspaces.set(`@deepseek-ai/${row.name}`, join(root, 'node_modules/@deepseek-ai', row.name));
}
// 官方加载器提前求值 Zod 循环导入；先把 Zod 各入口合成同一模块，保持 schema 身份。
const require = createRequire(import.meta.url);
const zodRoot = join(staging, 'zod');
await mkdir(zodRoot, { recursive: true });
const zodManifest = JSON.parse(await readFile(require.resolve('zod/package.json'), 'utf8'));
const subpaths = Object.keys(zodManifest.exports).filter(key => key !== './package.json' && !key.includes('*'));
const zodBundle = await build({ stdin: { contents: subpaths.map((key, index) => `export * as namespace${index} from '${key === '.' ? 'zod' : 'zod/' + key.slice(2)}'`).join('\n'), resolveDir: root }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022' });
await writeFile(join(zodRoot, 'all.mjs'), zodBundle.outputFiles[0].text);
const exportsMap = {};
for (const [index, key] of subpaths.entries()) {
  const namespace = await import(key === '.' ? 'zod' : 'zod/' + key.slice(2));
  const entry = `entry-${index}.mjs`;
  await writeFile(join(zodRoot, entry), `import {namespace${index} as source} from './all.mjs'\n` + Object.keys(namespace).map((name, index) => name === 'default' ? 'export default source.default' : `const value${index} = source[${JSON.stringify(name)}]; export {value${index} as ${name}}`).join('\n'));
  exportsMap[key] = './' + entry;
}
await writeFile(join(zodRoot, 'package.json'), JSON.stringify({ name: 'zod', version: zodManifest.version, type: 'module', exports: exportsMap, files: ['*.mjs'] }));
workspaces.set('zod', zodRoot);
const image = packVfsImage({ config: '- name: "@shotloom/browser-agent"\n', profile: 'shotloom-browser', workspaces, resolveFrom: root,
  entries: ['@shotloom/browser-agent'], emptyDirectories: ['state/', 'tmp/', 'workspace/', 'home/'],
  configTrees: [{ mount: 'content', directory: join(staging, 'content'), scanRoster: false }],
});
if (image.missing.length) throw new Error(`Worker image missing dependencies: ${image.missing.join(', ')}`);
await writeFile(join(output, 'image.tar.gz'), image.image);
// 提前生成函数体，Worker 只加载构建产物，生产 CSP 无需允许字符串求值。
const factories = Object.entries(image.files).filter(([path]) => /\.(?:[cm]?js)$/.test(path)).map(([path, bytes]) =>
  `${JSON.stringify('/dsh/' + path)}: function(${WRAPPER_PARAMS.join(',')}) {\n${new TextDecoder().decode(bytes)}\n}`);
await writeFile(join(output, 'modules.mjs'), `export const factories = {\n${factories.join(',\n')}\n};\n`);
const runtime = await readFile(require.resolve('@deepseek-ai/dsh-experimental-webworker-runtime/worker'), 'utf8');
const exports = ['MemoryVfs', 'setActiveVfs', 'WorkerModuleLoader', 'setActiveModuleLoader', 'createNodeBuiltins', 'REPLACED_PREFIXES', 'alsCausality', 'installProcessGlobal', 'loadVfsImage'];
for (const name of exports) if (!new RegExp(`\\b${name}\\b`).test(runtime)) throw new Error(`Official Worker interface changed: ${name}`);
await writeFile(join(output, 'runtime.js'), runtime + `\nexport {${exports.join(',')}};\n`);
for (const name of ['worker.mjs', 'durable-vfs.mjs', 'node-compat.mjs', 'local-storage.mjs']) await cp(join(root, 'browser', name), join(output, name));
console.log(`Built Worker image: ${image.image.length} bytes, ${image.packages.size} packages`);
