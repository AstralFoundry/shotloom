/**
 * 诊断事件：环形缓冲与脱敏。
 */
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

let env;
let log;
let redaction;
let service;

const storage = new Map();

before(async () => {
  env = await createRendererEnv({ storage, withWindow: true });
  log = await env.load('domain/diagnostics/DiagnosticsLog');
  redaction = await env.load('domain/diagnostics/Redaction');
  service = await env.load('services/diagnosticsService');
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

test('服务：事件在持久化前脱敏', () => {
  service.recordDiagnosticEvent({ level: 'error', category: 'task', name: '生成失败', data: { apiKey: 'secret', nodeId: 'n1' } });
  const events = service.listDiagnosticEvents();
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].data, { nodeId: 'n1' });
  assert.equal(JSON.stringify([...storage.values()]).includes('secret'), false);
});

test('Web 和原生设置移除诊断包入口及导出行为', async () => {
  const { readSource } = await import('./helpers/sourceContract.mjs');
  for (const file of ['renderer/src/app/views/SettingsPanel.tsx', 'renderer/src/app/views/SettingsFeature.tsx', 'mobile/native/src/NativeSettings.tsx', 'renderer/src/services/diagnosticsService.ts']) {
    assert.doesNotMatch(readSource(file), /settings\.diagnostics|exportDiagnostics|previewDiagnostics|collectDiagnosticsBundle|shotloom-native-diagnostics/);
  }
});
