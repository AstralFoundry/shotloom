import { readFile, mkdir, cp, writeFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { orderByModuleGraph, bootInjections } from '@deepseek-ai/dsh-client-modules';
import { renderIndexInjections } from '@deepseek-ai/dsh-host-webserver';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'client-dist');
const selected = ['ui-chat', 'ui-trajectory', 'ui-tool', 'ui-subagent', 'ui-plan', 'ui-approval', 'ui-permission-presets', 'ui-user-questions', 'ui-attachment', 'ui-model-selection', 'ui-goal', 'ui-skill', 'ui-theme', 'modules'];
const pending = selected.map(name => `@deepseek-ai/dsh-client-${name}`);
const entries = new Map();
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(join(root, '../../renderer/public/shotloom-logo.png'), join(dist, 'shotloom-logo.png'));
while (pending.length) {
  const id = pending.pop().replace(/\/client$/, '');
  if (entries.has(id)) continue;
  const pkgRoot = dirname(fileURLToPath(import.meta.resolve(`${id}/package.json`)));
  const pkg = JSON.parse(await readFile(join(pkgRoot, 'package.json'), 'utf8'));
  const manifest = pkg.dsh?.client && { ...pkg.dsh.client,
    // alpha.2 ui-subagent lists this preloaded library as a plugin dependency.
    inject: id === '@deepseek-ai/dsh-client-ui-subagent'
      ? pkg.dsh.client.inject?.filter(name => name !== '@deepseek-ai/dsh-client-ui-primitives')
      : pkg.dsh.client.inject,
  };
  if (!manifest) throw new Error(`${id} has no official client manifest`);
  let bytes = await readFile(join(pkgRoot, 'lib/client.js'));
  // 0.2.1-alpha.2 has no slot for ContextMeter. Keep the official component,
  // hooks and dialog, but portal it out of the composer's scrolling layer.
  // WKWebView can leave fixed descendants of that layer invisible until clicked.
  if (id === '@deepseek-ai/dsh-client-ui-conversation') {
    const source = bytes.toString('utf8');
    const marker = 'function ContextMeter({ useProjection, t }) {';
    if (source.split(marker).length !== 2) throw new Error('Official ContextMeter layout seam changed; review the portal adapter');
    bytes = Buffer.from(source.replace(marker, `function ContextMeter(props) {
      const [target, setTarget] = (0, react.useState)(null);
      (0, react.useLayoutEffect)(() => { setTarget(document.getElementById('shotloom-context-meter')); }, []);
      const component = (0, react_jsx_runtime.jsx)(ShotloomOfficialContextMeter, props);
      return target ? (0, react_dom.createPortal)(component, target) : null;
    }
    function ShotloomOfficialContextMeter({ useProjection, t }) {`));
  }
  const rev = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  entries.set(id, { id, url: `/plugins/??${id}/client.js&rev=${rev}`, rev, ...manifest });
  pending.push(...manifest.inject ?? [], ...manifest.external ?? []);
  await cp(join(pkgRoot, 'lib'), join(dist, 'plugins', id), { recursive: true });
  await writeFile(join(dist, 'plugins', id, 'client.js'), bytes);
}
const rows = orderByModuleGraph([...entries.values()]);
const graph = {
  rev: createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16),
  entries: rows,
  batches: rows.map(row => ({ phase: row.id.endsWith('/dsh-client-modules') ? 'bootstrap' : 'application', url: row.url, rev: row.rev, entries: [row.id] })),
};
await writeFile(join(dist, 'boot.json'), JSON.stringify(graph, null, 2));
const injections = bootInjections(graph);
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shotloom Agent</title><link rel="stylesheet" href="./client.css"></head><body><div id="root"></div><script type="module" src="./client.js"></script></body></html>';
await writeFile(join(dist, 'index.html'), renderIndexInjections(html, injections));
await build({
  absWorkingDir: root, entryPoints: ['client/main.tsx'], outfile: join(dist, 'client.js'),
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic',
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file' },
  define: { 'process.env.NODE_ENV': '"production"', 'process.versions.node': '"0.0.0"', 'process.execArgv': '[]', 'process.env.CORDIS_SHARED': 'undefined' },
  plugins: [{ name: 'official-css-modules', setup(builder) {
    // Same browser seam used by the official Web carrier; Node loading is unreachable.
    builder.onResolve({ filter: /^node:module$/ }, () => ({ path: 'node-module', namespace: 'browser-seam' }));
    builder.onLoad({ filter: /.*/, namespace: 'browser-seam' }, () => ({ contents: 'export function createRequire() { throw new Error("Node module loading is unavailable in chat"); }', loader: 'js' }));
    builder.onLoad({ filter: /\.module\.css$/ }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'local-css' }));
  } }],
});
console.log(`Built official chat carrier: ${rows.length} client modules`);
