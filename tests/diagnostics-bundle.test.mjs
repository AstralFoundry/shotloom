/**
 * 诊断包：环形缓冲、脱敏、结构、覆盖度与导出前的预览。
 */
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let log;
let redaction;
let bundleModule;
let service;
let store;

const storage = new Map();

before(async () => {
  env = await createRendererEnv({ storage, withWindow: true });
  log = await env.load('domain/diagnostics/DiagnosticsLog');
  redaction = await env.load('domain/diagnostics/Redaction');
  bundleModule = await env.load('domain/diagnostics/Bundle');
  service = await env.load('services/diagnosticsService');
  ({ store } = await env.load('store/projectStore'));
});

beforeEach(() => {
  storage.clear();
  service.clearDiagnosticEvents();
});

after(async () => {
  await env?.dispose();
});

function event(overrides = {}) {
  return {
    id: `e-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    level: 'info',
    category: 'runtime',
    name: 'test',
    ...overrides,
  };
}

test('环形缓冲：过期事件被丢弃，条数与体积有上限', () => {
  const now = Date.parse('2026-11-06T12:00:00.000Z');
  const stale = event({ at: now - log.DIAGNOSTIC_LIMITS.ttlMs - 1 });
  const fresh = event({ at: now - 1000 });
  assert.deepEqual(log.pruneDiagnosticEvents([stale, fresh], now).map((item) => item.id), [fresh.id]);

  const many = Array.from({ length: log.DIAGNOSTIC_LIMITS.maxEvents + 40 }, (_, index) => event({ at: now - index }));
  const pruned = log.pruneDiagnosticEvents(many, now);
  assert.equal(pruned.length, log.DIAGNOSTIC_LIMITS.maxEvents);

  const big = Array.from({ length: 4 }, (_, index) => event({ at: now - index, name: 'x'.repeat(200 * 1024) }));
  const byBytes = log.pruneDiagnosticEvents(big, now);
  assert.ok(byBytes.length < big.length, '体积超限时应淘汰');
  assert.ok(
    byBytes.reduce((sum, item) => sum + log.diagnosticEventBytes(item), 0) <= log.DIAGNOSTIC_LIMITS.maxBytes,
  );
});

test('环形缓冲：超额时先淘汰 debug/info，错误记录留到最后', () => {
  const now = Date.parse('2026-11-06T12:00:00.000Z');
  const events = [];
  for (let index = 0; index < 600; index += 1) {
    events.push(event({ at: now - index, level: index % 100 === 0 ? 'error' : 'info', name: `e${index}` }));
  }
  const pruned = log.pruneDiagnosticEvents(events, now);
  assert.equal(pruned.length, log.DIAGNOSTIC_LIMITS.maxEvents);
  const errorsBefore = events.filter((item) => item.level === 'error').length;
  const errorsAfter = pruned.filter((item) => item.level === 'error').length;
  assert.ok(errorsAfter >= Math.min(errorsBefore, pruned.length), '错误记录应保留');
});

test('脱敏：提示词、密钥、请求头、URL 查询串与本地路径都不导出', () => {
  const redacted = redaction.redactValue({
    model: 'gpt-image-2',
    prompt: '机密提示词',
    requestPayload: { Authorization: 'Bearer secret' },
    headers: { cookie: 'session=abc' },
    apiKey: 'sk-live-1',
    endpoint: 'https://api.example.com/v1/images?token=abc#frag',
    file: '/Users/nono/secret/cover.png',
    nested: { text: 'nested secret', keep: 42 },
  });

  assert.equal(redacted.model, 'gpt-image-2');
  assert.equal('prompt' in redacted, false);
  assert.equal('requestPayload' in redacted, false);
  assert.equal('headers' in redacted, false);
  assert.equal('apiKey' in redacted, false);
  assert.equal(redacted.endpoint, 'https://api.example.com/v1/images');
  assert.equal(redacted.file, '<path>/cover.png');
  assert.deepEqual(redacted.nested, { keep: 42 });
});

test('诊断包结构：固定文件清单 + 每个来源的覆盖度', () => {
  const now = Date.parse('2026-11-06T12:00:00.000Z');
  const bundle = bundleModule.buildDiagnosticsBundle({
    events: [event({ at: now, name: '启动', data: { prompt: '不应出现', step: 'boot' } })],
    tasks: [{ id: 't1', status: 'failed', error: 'timeout', requestPayload: { prompt: 'secret' } }],
    runtime: { platform: 'darwin', locale: 'zh-CN' },
    modelConfig: { providers: [{ provider: 'openai', configured: true }] },
    project: { id: 'p1', name: '项目' },
  }, now);

  assert.deepEqual(
    Object.keys(bundle.files).sort(),
    ['README.txt', 'coverage.json', 'events.jsonl', 'manifest.json', 'models.json', 'runtime.json', 'tasks.jsonl'],
  );
  const events = bundle.files['events.jsonl'].split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(events.length, 1);
  assert.equal(events[0].name, '启动');
  assert.equal('prompt' in events[0].data, false);
  assert.equal(events[0].data.step, 'boot');

  const tasks = bundle.files['tasks.jsonl'].split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.equal('requestPayload' in tasks[0], false);
  assert.equal(tasks[0].error, 'timeout');

  const coverage = JSON.parse(bundle.files['coverage.json']);
  assert.deepEqual(coverage.map((entry) => entry.source), ['events', 'tasks', 'runtime', 'models', 'project']);
  assert.ok(coverage.every((entry) => entry.status !== 'truncated'));
  assert.equal(bundle.truncated, false);
  assert.ok(bundle.bytes > 0);
});

test('诊断包：任务超过 200 条时截断并标注覆盖度', () => {
  const tasks = Array.from({ length: 240 }, (_, index) => ({ id: `t${index}`, status: 'completed' }));
  const bundle = bundleModule.buildDiagnosticsBundle({
    events: [], tasks, runtime: {}, modelConfig: {}, project: null,
  }, Date.parse('2026-11-06T12:00:00.000Z'));

  assert.equal(bundle.truncated, true);
  const coverage = JSON.parse(bundle.files['coverage.json']);
  const taskCoverage = coverage.find((entry) => entry.source === 'tasks');
  assert.equal(taskCoverage.status, 'truncated');
  assert.equal(taskCoverage.count, 200);
  assert.equal(coverage.find((entry) => entry.source === 'project').status, 'missing');
});

test('服务：记录事件后可预览数量与体积，浏览器环境导出如实失败', async () => {
  service.recordDiagnosticEvent({ level: 'error', category: 'task', name: '生成失败', data: { apiKey: 'secret', nodeId: 'n1' } });
  service.recordDiagnosticEvent({ category: 'navigation', name: '打开项目' });

  store.project = { ...store.project, id: 'p1', name: '项目', nodes: [], edges: [], tasks: [] };
  const preview = service.previewDiagnostics();

  assert.equal(preview.eventCount, 2);
  assert.equal(preview.taskCount, 0);
  assert.ok(preview.bytes > 0);
  assert.ok(preview.files.includes('events.jsonl'));
  assert.equal(preview.files.includes('tasks.jsonl'), true);

  const events = service.listDiagnosticEvents();
  assert.equal(JSON.stringify(events).includes('secret'), false, '事件数据在导出与预览前已脱敏');

  const exported = await service.exportDiagnosticsBundle();
  assert.equal(exported.ok, false, '浏览器替身不支持打包，必须如实失败');
});

test('设置页入口：先预览再确认，导出走真实服务', async () => {
  const { readSource } = await import('./helpers/sourceContract.mjs');
  const panel = readSource('renderer/src/app/views/SettingsPanel.tsx');
  const feature = readSource('renderer/src/app/views/SettingsFeature.tsx');

  assert.match(panel, /exportDiagnostics: \(\) => void \| Promise<void>/);
  assert.match(panel, /controller\.exportDiagnostics\(\)/);
  assert.match(feature, /previewDiagnostics\(\)/);
  assert.match(feature, /confirmAction\(/);
  assert.match(feature, /exportDiagnosticsBundle\(\)/);
  const previewIndex = feature.indexOf('previewDiagnostics()');
  const exportIndex = feature.indexOf('exportDiagnosticsBundle()');
  assert.ok(previewIndex > 0 && exportIndex > previewIndex, '必须先预览再导出');
});
