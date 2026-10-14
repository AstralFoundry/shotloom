/**
 * 行为测试：把 Agent 运行入口真实抛出的错误文本交给分类器，验证用户看到的诊断结论。
 *
 * 分类器只依赖真实错误文本，所以这里直接加载模块真实调用，
 * 而不是断言源码里有哪些规则。
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

let server;
let diagnoseRuntimeFailure;
let RuntimeDiagnosticError;

before(async () => {
  const rendererRoot = fileURLToPath(new URL('../renderer', import.meta.url));
  server = await createServer({
    configFile: false,
    root: rendererRoot,
    resolve: { alias: { '@': path.join(rendererRoot, 'src') } },
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });
  ({ diagnoseRuntimeFailure, RuntimeDiagnosticError } = await server.ssrLoadModule(
    '/src/agent/runtime/runtimeDiagnostics.ts',
  ));
});

after(async () => {
  await server?.close();
});

const cases = [
  ['文本模型未在模型目录中配置：glm-4v', 'agent_model_unsupported'],
  ['kimi-k2 的 Agent 协议不是 OpenAI Chat Completions', 'agent_model_unsupported'],
  ['gpt-4o 未声明支持 Agent 工具调用', 'agent_model_unsupported'],
  ['DeepSeek API Key 未配置，Agent 无法启动', 'agent_model_configuration'],
  ['GLM-4.6 已在 智谱 设置中停用，Agent 无法启动', 'agent_model_configuration'],
  ['HTTP 401 unauthorized', 'agent_model_configuration'],
  ['Request timed out after 300000ms', 'agent_model_timeout'],
  ['fetch failed: connection refused', 'agent_model_network'],
  ['Error: out of memory', 'agent_resource_exhausted'],
  ['模型响应被截断', 'agent_failed'],
];

test('运行失败按真实错误文本分类，并给出可直接执行的下一步', () => {
  for (const [raw, code] of cases) {
    const diagnosis = diagnoseRuntimeFailure(new Error(raw));
    assert.equal(diagnosis.code, code, `分类错误：${raw}`);
    assert.ok(diagnosis.title && diagnosis.primaryAction && diagnosis.suggestions.length, `${code} 缺少可执行建议`);
    assert.equal(diagnosis.message, raw);
  }
});

test('诊断保留运行入口抛出的原文，超长文本只截断不丢失原因', () => {
  const long = `agent loop failed: ${'x'.repeat(900)}`;
  const diagnosis = diagnoseRuntimeFailure(new Error(long));
  assert.equal(diagnosis.message.length, 500);
  assert.ok(diagnosis.message.startsWith('agent loop failed:'));
  assert.equal(diagnosis.code, 'agent_failed');
});

test('诊断错误既能向上层暴露结构，也保持 Error 语义', () => {
  const error = new RuntimeDiagnosticError(diagnoseRuntimeFailure(new Error('HTTP 403 forbidden')));
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'RuntimeDiagnosticError');
  assert.equal(error.message, 'HTTP 403 forbidden');
  assert.equal(error.diagnosis.code, 'agent_model_configuration');
});
