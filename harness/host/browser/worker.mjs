import { MemoryVfs, setActiveVfs, WorkerModuleLoader, setActiveModuleLoader, createNodeBuiltins, REPLACED_PREFIXES, alsCausality, installProcessGlobal, loadVfsImage } from './runtime.js';
import { readFiles, commitFiles, scopeKey } from './local-storage.mjs';
import { createDurableVfsSink } from './durable-vfs.mjs';
import { installBrowserNodeCompat } from './node-compat.mjs';
import { factories } from './modules.mjs';

let service, sink, flushTimer, fatal;
const pending = new Map();
const failure = error => error instanceof Error ? error.message : String(error);
function hostCall(method, payload, signal) {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const abort = () => { pending.delete(id); self.postMessage({ type: 'host-abort', id }); reject(signal.reason); };
    const finish = callback => value => { signal?.removeEventListener('abort', abort); callback(value); };
    if (signal?.aborted) return abort();
    pending.set(id, { resolve: finish(resolve), reject: finish(reject) });
    signal?.addEventListener('abort', abort, { once: true });
    self.postMessage({ type: 'host-request', id, method, payload });
  });
}
async function* model(payload, signal) {
  const { body, controlId } = await hostCall('model', payload, signal);
  const reader = body.getReader(), decoder = new TextDecoder();
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  let buffer = '', complete = false;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const frame = JSON.parse(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
        if (frame.version !== 1) throw new Error('Agent 模型协议不匹配');
        if (frame.error) throw new Error(frame.error.message);
        if (frame.done) complete = true; else yield frame.chunk;
      }
      if (buffer.length > 32 * 1024 * 1024) throw new Error('Agent 模型流过大');
      if (done) { if (!complete || buffer) throw new Error('Agent 模型连接中断'); break; }
    }
  } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); self.postMessage({ type: 'host-release', id: controlId }); }
}
async function boot(scope) {
  if (service) throw new Error('Worker already initialized');
  // 锁覆盖同账号同工程的全部角色，避免两个标签页同时改写本地日志与业务回执。
  let acquired;
  const ready = new Promise((resolve, reject) => { acquired = { resolve, reject }; });
  void navigator.locks.request(`shotloom-agent:${scopeKey(scope)}`, { ifAvailable: true }, async lock => {
    if (!lock) { acquired.reject(new Error('此工程的 Agent 正在另一个窗口运行，请先关闭该窗口的工程')); return; }
    acquired.resolve();
    await new Promise(() => {});
  }).catch(acquired.reject);
  await ready;
  installProcessGlobal({ cwd: '/dsh/state', env: { DSH_HOME: '/dsh/state' } });
  sink = createDurableVfsSink({ commit: changes => commitFiles(scope, changes), onFailure(error) {
    fatal = error; clearInterval(flushTimer); self.postMessage({ type: 'fatal', error: 'Agent 本地存储失败，已停止执行。请释放空间后重试。' });
  } });
  const vfs = new MemoryVfs({ sink });
  const response = await fetch('./image.tar.gz');
  if (!response.ok || !response.body) throw new Error('Agent 运行包加载失败');
  const bytes = new Uint8Array(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  loadVfsImage(bytes, '/dsh', vfs);
  for (const row of await readFiles(scope)) {
    if (!row.path.startsWith('/dsh/state/') || row.path.split('/').includes('..')) throw new Error('Agent 本地记录路径无效');
    vfs.seed(row.path, row.data); sink.remember(row.path);
  }
  setActiveVfs(vfs);
  const builtins = createNodeBuiltins();
  installBrowserNodeCompat(builtins);
  const loader = new WorkerModuleLoader({ vfs, staticModules: builtins, staticModulePrefixes: REPLACED_PREFIXES, alsCausality });
  loader.compile = (_source, path) => {
    if (!Object.hasOwn(factories, path)) throw new Error(`Agent module is not in the build: ${path}`);
    return factories[path];
  };
  setActiveModuleLoader(loader);
  const host = globalThis.shotloomBrowserHost = {
    barrier: () => sink.barrier(),
    async beforeEffect() { if (fatal) throw fatal; await host.flush?.(); await sink.barrier(); },
    tool: (request, signal) => hostCall('tool', request, signal), model,
    send: value => self.postMessage({ type: 'event', value }),
  };
  // 附件模块与官方上传入口共享同一持久化屏障。
  globalThis.canvasBrowserHost = host;
  service = await loader.createRequire('/dsh/entry.js')('@shotloom/browser-agent').boot();
  flushTimer = setInterval(() => { void host.beforeEffect().catch(error => { fatal = error; self.postMessage({ type: 'fatal', error: failure(error) }); }); }, 300);
}
self.addEventListener('message', event => {
  const message = event.data;
  if (message.type === 'host-result') {
    const request = pending.get(message.id); pending.delete(message.id);
    if (message.error) request?.reject(new Error(message.error)); else request?.resolve(message.value);
    return;
  }
  void (async () => {
    if (fatal) throw fatal;
    let value;
    if (message.type === 'boot') await boot(message.payload);
    else if (message.type === 'send') { await service.receive(message.payload); return; }
    else if (message.type === 'bind') value = await service.bind(message.payload);
    else if (message.type === 'archive') value = await service.archive(message.payload.projectKey, message.payload.sessionIds, message.payload.archived);
    else throw new Error('Unknown Worker operation');
    self.postMessage({ type: 'result', id: message.id, value });
  })().catch(error => {
    if (message.type === 'send') self.postMessage({ type: 'event', value: { requestId: message.payload.requestId, kind: 'error', error: failure(error) } });
    else self.postMessage({ type: 'result', id: message.id, error: failure(error) });
  });
});
