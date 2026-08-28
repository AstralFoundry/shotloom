import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveOpenCodeProvider } from '../renderer/src/agent/runtime/openCodeProvider.mjs';

test('自定义 Agent 文本模型从目录 endpoint 计算 OpenAI-compatible Base URL', () => {
  assert.deepEqual(resolveOpenCodeProvider('startrouter', 'https://starrouter.io', {
    method: 'POST', path: '/v1/chat/completions', scope: 'root',
  }, 'openai-chat-completions'), {
    npm: '@ai-sdk/openai-compatible',
    baseURL: 'https://starrouter.io/v1',
  });
  assert.equal(resolveOpenCodeProvider('google', 'https://generativelanguage.googleapis.com/v1beta', {
    method: 'POST', path: '/openai/chat/completions', scope: 'root',
  }, 'openai-chat-completions').baseURL, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(resolveOpenCodeProvider('custom', 'https://example.com', {
    method: 'POST', path: '/chat/completions', scope: 'v1',
  }, 'openai-chat-completions').baseURL, 'https://example.com/v1');
  assert.equal(resolveOpenCodeProvider('custom', 'https://example.com/v1', {
    method: 'POST', path: '/gateway/chat/completions', scope: 'origin',
  }, 'openai-chat-completions').baseURL, 'https://example.com/gateway');
});

test('Agent 传输契约明确选择 Chat Completions 或 Responses SDK', () => {
  const endpoint = { method: 'POST', path: '/v1/responses', scope: 'root' };
  assert.deepEqual(resolveOpenCodeProvider('custom', 'https://example.com', endpoint, 'openai-responses'), {
    npm: '@ai-sdk/openai', baseURL: 'https://example.com/v1',
  });
});

test('Provider 默认传输保持注册 SDK，声明协议与 endpoint 不匹配时失败', () => {
  assert.deepEqual(resolveOpenCodeProvider('openai', 'https://api.openai.com/v1/', {}), {
    npm: '@ai-sdk/openai', baseURL: 'https://api.openai.com/v1',
  });
  assert.deepEqual(resolveOpenCodeProvider('anthropic', 'https://api.anthropic.com/', {}), {
    npm: '@ai-sdk/anthropic', baseURL: 'https://api.anthropic.com',
  });
  assert.throws(() => resolveOpenCodeProvider('custom', 'https://example.com', {
    method: 'POST', path: '/v1/responses', scope: 'root',
  }, 'openai-chat-completions'), /endpoint.*不匹配/);
});
