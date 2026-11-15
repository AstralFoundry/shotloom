import { loadLegacyModelCatalog } from './helpers/modelCatalog.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRendererEnv } from './helpers/rendererSsr.mjs';
import { readSource } from './helpers/sourceContract.mjs';

const protocolExample = JSON.parse(readSource('plugin-packages/examples/openai-compatible/manifest.json'));
const exampleConnections = JSON.parse(readSource('plugin-packages/examples/openai-compatible-connections.json'));
// Keep the old package format exercised for saved projects and pinned tasks.
const declarative = { ...protocolExample, kind: undefined, providers: exampleConnections.map(connection => ({
  ...connection, id: connection.id.replace('connection.', ''), models: connection.models.map(model => ({ ...model, protocolPlugin: undefined, protocolModes: undefined, protocol: 'chat', modes: undefined })),
})) };
const executable = JSON.parse(readSource('plugin-packages/examples/async-module/manifest.json'));
const empty = () => ({ plugins: [], connections: [], disabledBuiltins: [], registryUrl: '' });

test('plugin installation, custom connections, pinned contracts and rollback use the real registry', async () => {
  const env = await createRendererEnv({ storage: new Map(), withWindow: true });
  try {
    const registry = await env.load('domain/provider/plugins/ProviderPlugins');
    const catalog = await env.load('domain/catalog/ModelCatalog');
    const plugins = await env.load('store/providerPluginStore');
    const { createBrowserProviderPlugins } = await env.load('services/browserProviderPlugins');
    const bridge = createBrowserProviderPlugins();
    const source = JSON.stringify(declarative);
    const inspection = await bridge.manage('inspect', { source });
    const first = await bridge.manage('install', { source, digest: inspection.digest });
    registry.setProviderPluginSnapshot(first);
    assert.equal(catalog.getModelInfo('example-primary-chat').provider, 'example-primary');
    plugins.validateProviderPackage(declarative);
    const connection = { id: 'connection.test', name: 'My server', pluginId: declarative.id, presetId: 'example-primary' };
    registry.setProviderPluginSnapshot({ ...first, connections: [connection] });
    const contract = catalog.resolveModelRuntimeContract('textGeneration', 'connection.test::example-primary-chat');
    assert.equal(contract.upstreamModel, 'demo-chat');
    assert.deepEqual(contract.pluginRef, { id: declarative.id, version: '1.0.0', providerId: 'example-primary' });
    const upgraded = structuredClone(declarative); upgraded.version = '1.1.0';
    const nextSource = JSON.stringify(upgraded);
    const next = await bridge.manage('inspect', { source: nextSource });
    registry.setProviderPluginSnapshot(await bridge.manage('install', { source: nextSource, digest: next.digest }));
    assert.equal(registry.resolvePluginProvider(contract.pluginRef).plugin.version, '1.0.0');
    const changedOld = JSON.stringify({ ...declarative, name: 'Changed old version' });
    const changed = await bridge.manage('inspect', { source: changedOld });
    await assert.rejects(bridge.manage('install', { source: changedOld, digest: changed.digest }), /immutable/);
    const rolled = await bridge.manage('rollback', { id: declarative.id, version: '1.0.0' });
    assert.equal(rolled.plugins.find(plugin => plugin.manifest.id === declarative.id).manifest.version, '1.0.0');
    assert.equal(rolled.plugins.find(plugin => plugin.manifest.id === declarative.id).source, source);
    assert.equal(rolled.plugins.find(plugin => plugin.manifest.id === declarative.id).history[0].source, nextSource);
    registry.setProviderPluginSnapshot(await bridge.manage('remove', { id: declarative.id }));
    assert.equal(registry.registeredProviders().some(p => p.id === 'example-primary'), false);
    assert.ok(registry.resolvePluginProvider(contract.pluginRef));
    await assert.rejects(bridge.manage('inspect', { source: JSON.stringify(executable) }), /desktop/);
    const duplicate = structuredClone(declarative); duplicate.id = 'another.plugin';
    registry.setProviderPluginSnapshot(first);
    assert.throws(() => plugins.validateProviderPackage(duplicate), /Duplicate provider/);
    assert.ok(registry.providerManifestErrors({ ...declarative, shotloom: '>=99.0.0' }).length);
    registry.setProviderPluginSnapshot(empty());
  } finally { await env.dispose(); }
});

test('trusted module host submits, polls and cancels against an actual local service', async () => {
  const tasks = new Map();
  const service = createHttpServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    res.setHeader('content-type', 'application/json');
    if (req.url === '/tasks' && req.method === 'POST') {
      const input = JSON.parse(body); const id = 'task-1';
      tasks.set(id, { remoteTaskId: id, status: 'running', progress: 25, prompt: input.prompt });
      res.end(JSON.stringify(tasks.get(id)));
    } else if (req.url === '/tasks/task-1/cancel') {
      tasks.get('task-1').status = 'cancelled'; res.end('{}');
    } else if (req.url === '/tasks/task-1') {
      const task = tasks.get('task-1');
      res.end(JSON.stringify(task.status === 'cancelled' ? task : { ...task, status: 'completed', result: { text: task.prompt } }));
    } else if (req.url === '/models') res.end(JSON.stringify([{ id: 'demo-chat' }]));
    else { res.statusCode = 404; res.end('{}'); }
  });
  await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
  async function invoke(method, input) {
    const child = spawn(process.execPath, ['--input-type=module', '--eval', readSource('scripts/provider-plugin-host.mjs'), path.resolve('plugin-packages/examples/async-module/runtime/index.mjs'), method], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.end(JSON.stringify({ input, config: { baseUrl: `http://127.0.0.1:${service.address().port}` } }));
    let output = ''; for await (const chunk of child.stdout) output += chunk;
    const result = JSON.parse(output); if (result.error) throw new Error(result.error); return result.result;
  }
  try {
    const submitted = await invoke('submit', { prompt: 'Plugin integration', submissionId: 'stable-1' });
    assert.equal(submitted.remoteTaskId, 'task-1');
    assert.equal((await invoke('poll', submitted)).result.text, 'Plugin integration');
    await invoke('cancel', submitted);
    assert.equal((await invoke('poll', submitted)).status, 'cancelled');
    assert.equal((await invoke('models', {}))[0].id, 'demo-chat');
    await assert.rejects(invoke('missing', {}), /does not implement/);
  } finally { await new Promise(resolve => service.close(resolve)); }
});

test('protocol packages share transport across connections while models own capabilities and upstream ids', async () => {
  const env = await createRendererEnv({ storage: new Map(), withWindow: true });
  try {
    const registry = await env.load('domain/provider/plugins/ProviderPlugins');
    const catalog = await env.load('domain/catalog/ModelCatalog');
    const adapters = await env.load('domain/provider/adapters/index');
    const store = await env.load('store/providerPluginStore');
    const { createBrowserProviderPlugins } = await env.load('services/browserProviderPlugins');
    const bridge = createBrowserProviderPlugins();
    store.validateProviderPackage(protocolExample);
    store.validateProviderPackage(registry.allProviderPlugins().find(item => item.manifest.id === 'protocol.openai.images').manifest);
    assert.equal(protocolExample.providers.length, 0);
    const source = JSON.stringify(protocolExample);
    const inspected = await bridge.manage('inspect', { source });
    const installed = await bridge.manage('install', { source, digest: inspected.digest });
    const connections = structuredClone(exampleConnections);
    connections[1].baseUrl = 'http://localhost:19392/v1';
    connections[1].models[0].upstreamModel = 'my-chat-v2';
    // Model capability edits cannot inject or replace plugin wire contracts.
    connections[1].models[0].modes[0].endpoint = { method: 'POST', path: '/wrong' };
    registry.setProviderPluginSnapshot({ ...installed, connections });
    const contracts = connections.map(connection => catalog.resolveModelRuntimeContract('textGeneration', `${connection.id}::${connection.models[0].id}`));
    assert.deepEqual(contracts[0].pluginRef, contracts[1].pluginRef);
    assert.equal(contracts[1].upstreamModel, 'my-chat-v2');
    assert.equal(contracts[1].endpoint.path, '/chat/completions');
    assert.equal(adapters.getProviderAdapter(connections[1].id, contracts[1].pluginRef).baseUrl, connections[1].baseUrl);
    const request = adapters.getProviderAdapter(connections[1].id, contracts[1].pluginRef).compileRequest({ modelContract: contracts[1], prompt: 'hello', params: {} });
    assert.equal(request.protocolVariables.model, 'my-chat-v2');
    assert.equal(request.protocolTemplate.model, '{{model}}');
    const bound = registry.bindProtocolModel(protocolExample, ['chat']);
    assert.equal(bound.type, 'textGeneration');
    assert.equal(bound.modes[0].inputConstraints.text.maxTokens, 8192);
    const before = registry.registeredModels().length;
    connections[0].enabled = false;
    registry.setProviderPluginSnapshot({ ...installed, connections });
    assert.equal(registry.registeredModels().length, before - 1);
    installed.plugins.find(plugin => plugin.manifest.id === protocolExample.id).enabled = false;
    registry.setProviderPluginSnapshot({ ...installed, connections });
    assert.equal(registry.registeredModels().some(model => model.provider.startsWith('connection.example')), false);
    assert.ok(registry.resolvePluginProvider(contracts[0].pluginRef));
  } finally { await env.dispose(); }
});

test('installed default packages preserve historical model identities and compiled endpoints', async () => {
  const env = await createRendererEnv();
  try {
    const registry = await env.load('domain/provider/plugins/ProviderPlugins');
    const modelCatalogV2 = loadLegacyModelCatalog();
    const catalog = await env.load('domain/catalog/ModelCatalog');
    const adapters = await env.load('domain/provider/adapters/index');
    assert.ok(registry.registeredModels().length >= modelCatalogV2.models.length);
    for (const model of modelCatalogV2.models) {
      for (const mode of model.modes) {
        const contract = catalog.modelCatalog.buildRuntimeContract(registry.registeredModels().find(item => item.id === model.id), mode.id);
        assert.ok(contract, `${model.id}/${mode.id}`);
        assert.equal(contract.provider, model.provider);
        assert.equal(contract.endpoint.path, mode.endpoint.path);
        assert.equal(contract.endpoint.method, mode.endpoint.method);
        assert.ok(contract.pluginRef.id.startsWith('protocol.'));
        assert.equal(adapters.getProviderAdapter(model.provider, contract.pluginRef).baseUrl, registry.providerConnections().find(item => item.id === model.provider).baseUrl);
      }
    }
    for (const { manifest } of registry.allProviderPlugins()) {
      assert.equal(manifest.kind, 'protocol');
      assert.deepEqual(manifest.providers, []);
      assert.ok(manifest.protocols.length);
    }
    assert.ok(registry.resolvePluginProvider({ id: 'builtin.openai', version: '1.0.0', providerId: 'openai' }));
  } finally { await env.dispose(); }
});
