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
    let source = bytes.toString('utf8');
    // The official draft runtime preserves selections outside its editor. In a
    // ShadowRoot ownerDocument.activeElement is the host, so that check would
    // incorrectly suppress every caret update and reverse typed characters.
    const focusCheck = 'root.contains(root.ownerDocument.activeElement)';
    if (source.split(focusCheck).length !== 2) throw new Error('Official draft focus seam changed; review ShadowRoot selection handling');
    source = source.replace(focusCheck, 'root.contains(root.getRootNode().activeElement)');
    const marker = 'function ContextMeter({ useProjection, t }) {';
    if (source.split(marker).length !== 2) throw new Error('Official ContextMeter layout seam changed; review the portal adapter');
    bytes = Buffer.from(source.replace(marker, `function ContextMeter(props) {
      const [target, setTarget] = (0, react.useState)(null);
      const marker = (0, react.useRef)(null);
      (0, react.useLayoutEffect)(() => { setTarget(marker.current?.getRootNode().querySelector('#shotloom-context-meter')); }, []);
      const component = (0, react_jsx_runtime.jsx)(ShotloomOfficialContextMeter, props);
      return (0, react_jsx_runtime.jsxs)(react.Fragment, {children:[(0, react_jsx_runtime.jsx)('span',{ref:marker,style:{display:'contents'}}),target ? (0, react_dom.createPortal)(component, target) : null]});
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
const registrationFiles = [];
for (const [id] of entries) {
  const relative = `plugins/${id}/native.js`;
  let source = await readFile(join(dist, 'plugins', id, 'client.js'), 'utf8');
  if (id === '@deepseek-ai/dsh-client-ui-model-selection') {
    // The official controller has a deployment default even when the native
    // product has no configured providers. Keep its picker, but never advertise
    // that unroutable fallback as the user's selected model.
    for (const [before, after] of [
      ['const modelLabel = waiting ?', 'const emptyCatalog = state.status === "ready" && choices.length === 0 && state.failures.length === 0; const modelLabel = emptyCatalog ? t("trigger.fallback") : waiting ?'],
      ['state.current === null ? t("trigger.selectAria")', '(emptyCatalog || state.current === null) ? t("trigger.selectAria")'],
    ]) {
      if (source.split(before).length !== 2) throw new Error('Official model label seam changed; review the empty catalog presentation');
      source = source.replace(before, after);
    }
  }
  // The standalone carrier has one product reference source. A shared native
  // runtime needs the same named codec scoped to its actual owning Session.
  if (id === '@deepseek-ai/dsh-client-ui-input-trigger') {
    for (const [before, after, count] of [
      ['s.trigger === src.trigger && s.name === src.name', 's.trigger === src.trigger && s.name === src.name && s.shotloomSessionId === src.shotloomSessionId', 1],
      ['live.sources.filter((s) => s.trigger === trigger)', 'live.sources.filter((s) => s.trigger === trigger && (s.shotloomSessionId === undefined || s.shotloomSessionId === id))', 1],
      ['all: () => live.sources', 'all: () => live.sources.filter(s => s.shotloomSessionId === undefined || s.shotloomSessionId === id)', 1],
      ['for (const controller of live.controllers.values)', 'for (const controller of [...live.controllers.values].filter(c => src.shotloomSessionId === undefined || c.project().sessionId === src.shotloomSessionId))', 2],
    ]) {
      if (source.split(before).length !== count + 1) throw new Error('Official input source session seam changed; review the native session adapter');
      source = source.replaceAll(before, after);
    }
  }
  await writeFile(join(dist, relative), `export default function register(window, document, globalThis = window) {\n${source}\n}`);
  registrationFiles.push(relative);
}
await writeFile(join(dist, 'native-modules.js'), registrationFiles.map((file, index) => `import r${index} from './${file}';`).join('\n') + `\nexport default [${registrationFiles.map((_, index) => `r${index}`).join(',')}];`);
await writeFile(join(dist, 'native-modules.d.ts'), 'import type { ClientBundleRegistration } from "@deepseek-ai/dsh-client-modules/client";\ndeclare const registrations: Array<(window: Window & {__ModuleLoader__: {load(row: ClientBundleRegistration):void}}, document: Document) => void>;\nexport default registrations;\n');
// A placeholder is replaced after esbuild extracts the upstream and product CSS.
await writeFile(join(dist, 'upstream.css'), '');
const buildOptions = {
  absWorkingDir: root, entryPoints: ['client/main.tsx'], outfile: join(dist, 'client.js'),
  inject: [join(root, 'client/scopedGlobals.ts')],
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic',
  loader: { '.txt': 'text', '.woff2': 'file', '.woff': 'file', '.ttf': 'file' },
  define: { 'process.env.NODE_ENV': '"production"', 'process.versions.node': '"0.0.0"', 'process.execArgv': '[]', 'process.env.CORDIS_SHARED': 'undefined' },
  plugins: [{ name: 'official-css-modules', setup(builder) {
    // The native client supplies static plugin configurations. The loader's
    // unused YAML !!js evaluator otherwise runs new Function at import time,
    // which violates the product CSP before the official UI can initialize.
    builder.onLoad({ filter: /@deepseek-ai\/cordis-plugin-loader\/lib\/index\.js$/ }, async args => {
      const source = await readFile(args.path, 'utf8');
      const evaluator = /const evaluate = new Function\("ctx", "expr", `[^`]*`\);/g;
      if ([...source.matchAll(evaluator)].length !== 1) throw new Error('Official loader expression seam changed; review CSP compatibility');
      return { contents: source.replace(evaluator, 'const evaluate = () => { throw new Error("Dynamic YAML expressions are unavailable in the native Harness client; use static plugin configuration"); };'), loader: 'js' };
    });
    // Same browser seam used by the official Web carrier; Node loading is unreachable.
    builder.onResolve({ filter: /\.css\?inline$/ }, args => ({ path: resolve(dirname(args.importer), args.path.replace('?inline', '')), namespace: 'inline-css' }));
    builder.onLoad({ filter: /.*/, namespace: 'inline-css' }, async args => ({ contents: `export default ${JSON.stringify(await readFile(args.path, 'utf8'))}`, loader: 'js' }));
    builder.onResolve({ filter: /^node:module$/ }, () => ({ path: 'node-module', namespace: 'browser-seam' }));
    builder.onLoad({ filter: /.*/, namespace: 'browser-seam' }, () => ({ contents: 'export function createRequire() { throw new Error("Node module loading is unavailable in chat"); }', loader: 'js' }));
    builder.onLoad({ filter: /\.module\.css$/ }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'local-css' }));
  } }],
};
await build(buildOptions);
await writeFile(join(dist, 'upstream.css'), await readFile(join(dist, 'client.css'), 'utf8'));
await build(buildOptions);
await cp(join(root, 'client/style.css'), join(dist, 'product.css'));
await mkdir(join(root, '../../renderer/public/harness'), { recursive: true });
await cp(dist, join(root, '../../renderer/public/harness'), { recursive: true });
console.log(`Built official chat carrier: ${rows.length} client modules`);
