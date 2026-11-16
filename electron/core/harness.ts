import { BrowserWindow } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { app } from 'electron';
import { localizedError } from './errors';
import { appDataDir } from './paths';
import { emitEvent } from '../ipc/registry';

/**
 * DeepSeek Harness 运行时：父进程通过 stdin/stdout 与新进程通信，
 * stdout 上的 `shotloom transport:` 行是会话消息，`shotloom host: native` 表示就绪。
 *
 * 工具调用走一个只监听 127.0.0.1 的本地 HTTP 桥：请求必须带随机 token 与已登记的
 * 会话绑定，桥再把请求转给渲染进程，由产品工具层执行后回填结果。
 */

type Json = Record<string, unknown>;

export interface HarnessRuntimeStatus {
  running: boolean;
  ready: boolean;
  error: string | null;
}

interface HarnessRuntimeOptions { sourceRoot?: string; dataRoot?: string }

interface ReplyRequest { kind: 'request'; resolve: (value: unknown) => void; reject: (error: string) => void; timer: NodeJS.Timeout }
interface ReplyStream { kind: 'stream'; channelId: string }
type Reply = ReplyRequest | ReplyStream;

let child: ChildProcessWithoutNullStreams | null = null;
let ready = false;
let lastError: string | null = null;
const replies = new Map<string, Reply>();
let startupLock: Promise<unknown> = Promise.resolve();

interface BridgeState {
  server: Server | null;
  port: number | null;
  token: string | null;
  bindings: Map<string, Json>;
  pending: Map<string, (value: { result?: unknown; error?: string }) => void>;
}

const bridge: BridgeState = { server: null, port: null, token: null, bindings: new Map(), pending: new Map() };

function mainWindowWebContents() {
  return BrowserWindow.getAllWindows()[0]?.webContents;
}

function broadcast(name: string, payload: unknown): void {
  const contents = mainWindowWebContents();
  if (contents) emitEvent(contents, name, payload);
}

function hostRoot(options: HarnessRuntimeOptions): string {
  if (options.sourceRoot) return options.sourceRoot;
  if (!app.isPackaged) return join(app.getAppPath(), 'electron', 'resources', 'agent-host');
  return join(process.resourcesPath, 'resources', 'agent-host');
}

function runtimeStatus(): HarnessRuntimeStatus {
  if (child && child.exitCode !== null) {
    child = null;
    ready = false;
  }
  return { running: Boolean(child), ready: child ? ready : false, error: lastError };
}

function writeNative(message: Json): void {
  if (!child?.stdin.writable) throw new Error('Agent Host is not running');
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function deliverNative(payload: string): void {
  let message: Json;
  try {
    message = JSON.parse(payload) as Json;
  } catch {
    return;
  }
  const id = typeof message.requestId === 'string' ? message.requestId : '';
  if (!id) return;
  const kind = typeof message.kind === 'string' ? message.kind : '';
  const terminal = kind === 'result' || kind === 'end' || kind === 'error';
  const reply = replies.get(id);
  if (!reply) return;
  if (terminal) {
    replies.delete(id);
    if (reply.kind === 'request') {
      clearTimeout(reply.timer);
      if (kind === 'error') reply.reject(typeof message.error === 'string' ? message.error : 'Agent Host failed');
      else reply.resolve(message.value);
    } else {
      const contents = mainWindowWebContents();
      if (contents) contents.send('shotloom:channel', { id: reply.channelId, payload: message });
    }
    return;
  }
  if (reply.kind === 'stream') {
    const contents = mainWindowWebContents();
    if (contents) contents.send('shotloom:channel', { id: reply.channelId, payload: message });
  }
}

function nativeRequest(kind: string, payload: unknown): Promise<unknown> {
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      replies.delete(requestId);
      reject('Agent Host request timed out');
    }, 60_000);
    replies.set(requestId, { kind: 'request', resolve, reject, timer });
    try {
      writeNative({ requestId, kind, payload });
    } catch (error) {
      clearTimeout(timer);
      replies.delete(requestId);
      reject(error instanceof Error ? error.message : String(error));
    }
  });
}

export function harnessStatus(): HarnessRuntimeStatus {
  return runtimeStatus();
}

async function startBridge(): Promise<void> {
  if (bridge.server) return;
  const server = createServer((request, response) => { void handleBridgeRequest(request, response); });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('bridge did not bind a port');
  bridge.server = server;
  bridge.port = address.port;
  bridge.token = randomUUID();
}

function jsonResponse(response: import('node:http').ServerResponse, code: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  response.writeHead(code, { 'content-type': 'application/json', 'content-length': body.length, connection: 'close' });
  response.end(body);
}

async function readJsonBody(request: import('node:http').IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > 8 * 1024 * 1024) throw new Error('request body too large');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Json;
}

async function handleBridgeRequest(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse): Promise<void> {
  try {
    const payload = await readJsonBody(request);
    if (payload.token !== bridge.token) throw new Error('invalid bridge token');
    if (payload.op === 'health') { jsonResponse(response, 200, { success: true }); return; }
    if (payload.op !== 'tool') throw new Error('unsupported bridge operation');
    const binding = payload.binding as Json | undefined;
    if (!binding || typeof binding !== 'object') throw new Error('missing trusted session binding');
    const sessionId = typeof binding.sessionId === 'string' ? binding.sessionId : '';
    if (!sessionId || JSON.stringify(bridge.bindings.get(sessionId)) !== JSON.stringify(binding)) {
      throw new Error('unregistered or mismatched session binding');
    }
    const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
    if (!requestId) throw new Error('missing call id');
    if (bridge.pending.has(requestId)) throw new Error('call already pending');
    const result = await new Promise<{ result?: unknown; error?: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        bridge.pending.delete(requestId);
        reject(new Error('tool bridge timeout'));
      }, 120_000);
      bridge.pending.set(requestId, (value) => { clearTimeout(timer); resolve(value); });
      // 发给渲染进程执行产品工具；回执由 harness_tool_respond 填回。
      broadcast('harness://tool-request', {
        requestId,
        toolName: payload.toolName,
        input: payload.input,
        binding,
        phase: payload.phase,
        approvedByHarness: payload.approvedByHarness,
        authorizedByFullAccess: payload.authorizedByFullAccess,
      });
    });
    bridge.pending.delete(requestId);
    if (result.error) jsonResponse(response, 200, { success: false, error: result.error });
    else jsonResponse(response, 200, { success: true, result: result.result });
  } catch (error) {
    jsonResponse(response, 400, { success: false, error: error instanceof Error ? error.message : String(error) });
  }
}

function stopChild(): void {
  if (!child) {
    ready = false;
    replies.clear();
    return;
  }
  const process_ = child;
  child = null;
  ready = false;
  try { process_.stdin.write('shutdown\n'); } catch { /* 已关闭 */ }
  const deadline = Date.now() + 3000;
  const timer = setInterval(() => {
    if (process_.exitCode !== null || Date.now() > deadline) {
      clearInterval(timer);
      if (process_.exitCode === null) process_.kill();
    }
  }, 25);
  timer.unref?.();
  replies.clear();
}

export function stopHarnessRuntime(): HarnessRuntimeStatus {
  stopChild();
  return runtimeStatus();
}

export async function startHarnessRuntime(options: HarnessRuntimeOptions = {}): Promise<HarnessRuntimeStatus> {
  const run = startupLock.then(() => doStart(options));
  startupLock = run.catch(() => undefined);
  return run;
}

async function doStart(options: HarnessRuntimeOptions): Promise<HarnessRuntimeStatus> {
  if (runtimeStatus().running) return runtimeStatus();
  const root = hostRoot(options);
  if (!existsSync(join(root, 'dist', 'main.js'))) {
    throw new Error(localizedError('native.harness.missingBuild', { path: root }, `Shotloom Agent Host 产物不存在，请运行 npm run prepare:harness：${root}`));
  }
  const dataRoot = options.dataRoot ? options.dataRoot : join(appDataDir(), 'deepseek-harness');
  mkdirSync(dataRoot, { recursive: true });
  await startBridge();
  if (!bridge.port || !bridge.token) throw new Error(localizedError('native.harness.bridgeNotReady', {}, '工具桥接尚未就绪'));
  const executable = join(root, process.platform === 'win32' ? 'node.exe' : 'node');
  const process_ = spawn(executable, [join(root, 'dist', 'main.js')], {
    cwd: root,
    env: {
      ...process.env,
      SHOTLOOM_DATA_ROOT: dataRoot,
      SHOTLOOM_BRIDGE_URL: `http://127.0.0.1:${bridge.port}`,
      SHOTLOOM_BRIDGE_TOKEN: bridge.token,
      SHOTLOOM_CONTENT_ROOT: join(root, 'content'),
      SHOTLOOM_RULES_PATH: join(root, 'AGENTS.md'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child = process_;
  ready = false;
  lastError = null;
  process_.on('error', (error) => {
    lastError = error.message;
    broadcast('harness://stderr', error.message);
  });
  let stdoutBuffer = '';
  process_.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf8');
    let index = stdoutBuffer.indexOf('\n');
    while (index >= 0) {
      const line = stdoutBuffer.slice(0, index).replace(/\r$/, '');
      stdoutBuffer = stdoutBuffer.slice(index + 1);
      if (line.startsWith('shotloom transport: ')) {
        deliverNative(line.slice('shotloom transport: '.length));
      } else {
        if (line === 'shotloom host: native') {
          ready = true;
          broadcast('harness://ready', null);
        }
        broadcast('harness://stdout', line);
      }
      index = stdoutBuffer.indexOf('\n');
    }
  });
  let stderrBuffer = '';
  process_.stderr.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString('utf8');
    const lines = stderrBuffer.split('\n');
    stderrBuffer = lines.pop() ?? '';
    for (const line of lines) broadcast('harness://stderr', line);
  });
  process_.on('exit', () => {
    if (child === process_) {
      child = null;
      ready = false;
    }
    for (const [id, reply] of replies) {
      if (reply.kind === 'request') {
        clearTimeout(reply.timer);
        reply.reject('Agent Host disconnected');
      }
      replies.delete(id);
    }
  });
  return runtimeStatus();
}

export async function restartHarnessRuntime(options: HarnessRuntimeOptions = {}): Promise<HarnessRuntimeStatus> {
  stopHarnessRuntime();
  return startHarnessRuntime(options);
}

export async function bindHarnessSession(config: Json): Promise<Json> {
  const result = await nativeRequest('bind', config) as Json;
  if (!result || typeof result !== 'object') throw new Error(localizedError('native.harness.missingSession', {}, 'Agent Host 未返回会话 ID'));
  const sessionId = typeof result.sessionId === 'string' ? result.sessionId : '';
  if (!sessionId) throw new Error(localizedError('native.harness.missingSession', {}, 'Agent Host 未返回会话 ID'));
  const binding = config.binding;
  if (!binding || typeof binding !== 'object') throw new Error(localizedError('native.harness.missingBinding', {}, '缺少会话绑定信息'));
  bridge.bindings.set(sessionId, { ...(binding as Json), sessionId });
  return result;
}

export function setHarnessSessionsArchived(projectKey: string, sessionIds: string[] | null, archived: boolean): Promise<unknown> {
  return nativeRequest('set-sessions-archived', { projectKey, sessionIds, archived });
}

export function harnessTransport(message: Json, channelId: string): void {
  const id = typeof message.requestId === 'string' ? message.requestId : '';
  const kind = typeof message.kind === 'string' ? message.kind : '';
  if (!id) throw new Error('Missing transport request ID');
  if (!kind) throw new Error('Missing transport operation');
  if (kind === 'fetch' || kind === 'stream') replies.set(id, { kind: 'stream', channelId });
  else if (kind !== 'cancel' && kind !== 'uplink') throw new Error('Invalid client transport operation');
  try {
    writeNative(message);
  } catch (error) {
    replies.delete(id);
    throw error;
  }
  if (kind === 'cancel') replies.delete(id);
}

export function respondHarnessTool(response: { requestId?: unknown; result?: unknown; error?: unknown }): void {
  const requestId = typeof response.requestId === 'string' ? response.requestId : '';
  const pending = bridge.pending.get(requestId);
  if (!pending) throw new Error('unknown or expired tool request');
  if (typeof response.error === 'string') pending({ error: response.error });
  else pending({ result: response.result });
}

export function harnessBridgeStatus(): { running: boolean; port: number | null; token: string | null } {
  return { running: bridge.port !== null, port: bridge.port, token: bridge.token };
}

export function shutdownHarnessRuntime(): void {
  stopChild();
  bridge.server?.close();
  bridge.server = null;
  bridge.port = null;
  bridge.token = null;
  bridge.bindings.clear();
}
