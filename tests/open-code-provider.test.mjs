import assert from 'node:assert/strict';
import test from 'node:test';
import { agentReasoningFallback, resolveOpenCodeProvider } from '../renderer/src/agent/runtime/openCodeProvider.mjs';

test('自定义 Agent 文本模型从目录 endpoint 计算 OpenAI-compatible Base URL', () => {
  assert.deepEqual(resolveOpenCodeProvider('startrouter', 'https://starrouter.io', {
    method: 'POST', path: '/v1/chat/completions', scope: 'root',
  }), {
    npm: '@ai-sdk/openai-compatible',
    baseURL: 'https://starrouter.io/v1',
  });
  assert.equal(resolveOpenCodeProvider('google', 'https://generativelanguage.googleapis.com/v1beta', {
    method: 'POST', path: '/openai/chat/completions', scope: 'root',
  }).baseURL, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(resolveOpenCodeProvider('custom', 'https://example.com', {
    method: 'POST', path: '/chat/completions', scope: 'v1',
  }).baseURL, 'https://example.com/v1');
});

test('接口明确拒绝工具与 reasoning_effort 组合时只采用其给出的 none 回退', () => {
  assert.equal(agentReasoningFallback(new Error(
    "Function tools with reasoning_effort are not supported for gpt-5.5 in /v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'.",
  )), 'none');
  assert.equal(agentReasoningFallback(new Error('reasoning request failed')), '');
});

test('原生 Provider 保持各自 SDK，自定义非 Chat Completions 协议明确失败', () => {
  assert.deepEqual(resolveOpenCodeProvider('openai', 'https://api.openai.com/v1/', {}), {
    npm: '@ai-sdk/openai', baseURL: 'https://api.openai.com/v1',
  });
  assert.deepEqual(resolveOpenCodeProvider('anthropic', 'https://api.anthropic.com/', {}), {
    npm: '@ai-sdk/anthropic', baseURL: 'https://api.anthropic.com',
  });
  assert.throws(() => resolveOpenCodeProvider('custom', 'https://example.com', {
    method: 'POST', path: '/v1/responses', scope: 'root',
  }), /POST \/chat\/completions/);
});
