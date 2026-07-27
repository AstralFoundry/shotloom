import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('OpenCode 是唯一 Agent Runtime 并固定 SDK 与 sidecar 版本', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.dependencies['@opencode-ai/sdk'], '1.18.4');
  assert.equal(pkg.dependencies['opencode-ai'], '1.18.4');
  assert.equal(existsSync(new URL('../renderer/src/agent/runtime/AgentRuntime.ts', import.meta.url)), false);
  assert.match(read('renderer/src/agent/index.ts'), /import\('\.\/runtime\/OpenCodeRuntime'\)/);
});

test('Tauri 随应用分发受保护的 OpenCode sidecar 和 MCP bridge', () => {
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.deepEqual(config.bundle.externalBin, ['binaries/opencode']);
  assert.ok(config.bundle.resources.includes('resources/opencode-LICENSE.txt'));
  const rust = read('src-tauri/src/commands/agent_runtime.rs');
  assert.match(rust, /OPENCODE_SERVER_PASSWORD/);
  assert.match(rust, /"--pure"/);
  assert.match(rust, /"enabled": false/);
  assert.match(rust, /global\/health/);
  assert.match(rust, /\.no_proxy\(\)/);
  assert.match(rust, /configuration_key/);
  assert.match(rust, /Bearer/);
  assert.match(rust, /tools\/list/);
  assert.match(rust, /tools\/call/);
  assert.match(rust, /agent_runtime_request/);
  assert.match(rust, /agent_runtime_subscribe/);
  assert.match(rust, /runtime-relative path/);
  assert.match(rust, /child_proxy_environment/);
  assert.match(rust, /scutil/);
  assert.match(rust, /NO_PROXY/);
  assert.doesNotMatch(rust, /pub auth_token/);
  assert.match(read('src-tauri/src/lib.rs'), /RunEvent::Exit[\s\S]*state\.shutdown/);
});

test('OpenCode Runtime 使用持久 Session、子 Agent、Contract 与本地域工具桥', () => {
  const runtime = read('renderer/src/agent/runtime/OpenCodeRuntime.ts');
  assert.match(runtime, /openCodeSessionId/);
  assert.match(runtime, /session\.created/);
  assert.match(runtime, /parentID/);
  assert.match(runtime, /agentProfiles/);
  assert.match(runtime, /contractsForAgentType/);
  assert.match(runtime, /activateOpenCodeToolBridge/);
  assert.match(runtime, /ensureMcpConnected/);
  assert.match(runtime, /mcp\.disconnect/);
  assert.match(runtime, /routeSkill/);
  assert.match(runtime, /agent: 'intent-router'/);
  assert.match(runtime, /report_outcome/);
  assert.match(runtime, /@ai-sdk\/openai/);
  assert.doesNotMatch(runtime, /Runtime requirement: call report_outcome/);
  assert.match(runtime, /hasAppliedActions/);
  assert.doesNotMatch(runtime, /没有提交可核验的终态结果|Agent 没有返回文字内容/);
  assert.match(runtime, /Agent 没有提交完整终态说明/);
  assert.doesNotMatch(runtime, /client\.config\.update/);
  assert.match(runtime, /agent_runtime_start[\s\S]*\{ configuration \}/);
  assert.match(runtime, /agent_runtime_request/);
  assert.match(runtime, /agent_runtime_subscribe/);
  assert.doesNotMatch(runtime, /@tauri-apps\/plugin-http/);
  assert.doesNotMatch(runtime, /client\.event\.subscribe/);
});

test('Agent 凭据读取不把 CommonJS require 带进 WebView', () => {
  const settings = read('renderer/src/store/settingsStore.js');
  assert.doesNotMatch(settings, /\brequire\s*\(/);
  assert.match(settings, /import \{ getConfiguredProviders, getProviderDefinition \}/);
});
