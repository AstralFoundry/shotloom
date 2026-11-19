import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { zipSync } from 'fflate';
import { createRendererEnv } from './helpers/rendererSsr.mjs';
import { createCanvasActionsService } from '../plugin-packages/examples/canvas-actions-service.mjs';

const sampleDir = resolve('plugin-packages/examples/canvas-actions');
const manifest = JSON.parse(readFileSync(join(sampleDir, 'manifest.json'), 'utf8'));
const bundleRoot = mkdtempSync(join(tmpdir(), 'shotloom-canvas-plugin-module-'));
const bundled = await build({ stdin: { contents: "export * from './electron/core/plugins';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false });
const bundlePath = join(bundleRoot, 'plugins.mjs');
writeFileSync(bundlePath, bundled.outputFiles[0].text);
const native = await import(pathToFileURL(bundlePath));
test.after(() => rmSync(bundleRoot, { recursive: true, force: true }));

function archive(root, value = manifest) {
  const file = join(root, `${value.version}.shotloom-plugin`);
  writeFileSync(file, zipSync({ 'manifest.json': new TextEncoder().encode(JSON.stringify(value)),
    'runtime/index.mjs': readFileSync(join(sampleDir, 'runtime/index.mjs')) }));
  return file;
}
async function setup(t, packageManifest = manifest) {
  const root = mkdtempSync(join(tmpdir(), 'shotloom-canvas-plugin-'));
  const runtime = join(root, 'runtime'); mkdirSync(runtime);
  symlinkSync(process.execPath, join(runtime, process.platform === 'win32' ? 'node.exe' : 'node'));
  const nativeEnv = { appData: root, databaseFile: join(root, 'app.sqlite'), runtimeRoot: runtime, distributionDir: join(root, 'distribution'), appVersion: '0.9.2' };
  const service = createCanvasActionsService();
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const env = await createRendererEnv({ storage: new Map(), withWindow: true });
  t.after(async () => { await env.dispose(); await new Promise(resolve => service.server.close(resolve)); rmSync(root, { recursive: true, force: true }); });
  const source = archive(root, packageManifest);
  const checked = await native.inspectProviderPackage(nativeEnv, source, 'npm');
  let state = await native.installProviderPackage(nativeEnv, source, checked.digest, true, 'npm');
  state.connections[0].baseUrl = `http://127.0.0.1:${service.server.address().port}`;
  state = await native.configureProviderPlugins(nativeEnv, { connections: state.connections, registryUrl: '' });
  const registry = await env.load('domain/provider/plugins/ProviderPlugins'); registry.setProviderPluginSnapshot(state);
  const { desktopApi } = await env.load('services/desktopApi');
  desktopApi.platform = 'electron';
  desktopApi.providerPlugins.call = args => native.callProviderPlugin(nativeEnv, args);
  desktopApi.providerPlugins.cancel = id => native.cancelPluginCall(id);
  const { store } = await env.load('store/projectStore');
  store.projectDir = root; store.filePath = join(root, 'project.sqlite');
  store.project.nodes = []; store.project.edges = []; store.project.tasks = []; store.project.materials = [];
  const video = join(root, 'input.mp4'); writeFileSync(video, Buffer.from('test media bytes (transport fixture, not an encoded video)'));
  store.project.nodes.push({ id: 'video', type: 'videoGeneration', title: 'Video', x: 0, y: 0, uploadedFile: { filePath: video } });
  const polls = [];
  window.setInterval = fn => { polls.push(fn); return polls.length; };
  const saved = [];
  desktopApi.project.save = async (_directory, project) => { saved.push(structuredClone(project)); return { project, filePath: store.filePath }; };
  desktopApi.project.captureSnapshot = async () => null;
  desktopApi.notifyTask = async () => {};
  desktopApi.file.downloadUrlToProject = async (url, name) => {
    const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
    const path = join(root, name); writeFileSync(path, bytes);
    return { filePath: path, name, size: bytes.length };
  };
  const actions = await env.load('store/pluginActionStore');
  const tasks = await env.load('store/taskStore');
  const key = 'plugin:example.canvas-actions:video-copy';
  const request = { key, connectionId: 'connection.canvas-actions', inputs: { source: ['video'] }, parameters: { copies: 2 } };
  return { root, nativeEnv, env, registry, state, desktopApi, store, saved, polls, actions, tasks, request, service };
}

test('one installed package contributes multiple capabilities and preserves toolbar preferences while absent', async t => {
  const f = await setup(t);
  const capabilities = await f.env.load('domain/provider/plugins/PluginCapabilities');
  const toolbar = await f.env.load('utils/canvasNodeToolbar');
  const validator = await f.env.load('store/providerPluginStore');
  validator.validateProviderPackage(manifest);
  assert.equal(capabilities.registeredCapabilities().length, 2);
  assert.equal(capabilities.capabilitiesForNode(f.store.project.nodes[0], f.store.project).length, 1);
  assert.ok(toolbar.nodeToolbarToolIds('video').includes(f.request.key));
  assert.equal(f.actions.prepareCanvasPluginAction(f.request).ready, true);
  assert.equal(f.actions.prepareCanvasPluginAction({ ...f.request, inputs: {} }).ready, false);
  assert.equal(f.actions.prepareCanvasPluginAction({ ...f.request, parameters: { copies: 9 } }).ready, false);
  f.registry.setProviderPluginSnapshot({ ...f.state, plugins: f.state.plugins.map(p => ({ ...p, enabled: false })) });
  assert.equal(capabilities.registeredCapabilities().length, 0);
  assert.deepEqual(toolbar.normalizeCanvasToolbarCustomization({ pinned: { video: [f.request.key] } }).pinned.video, [f.request.key]);
  f.registry.setProviderPluginSnapshot(f.state);
  assert.ok(toolbar.nodeToolbarToolIds('video').includes(f.request.key));
  assert.ok(f.registry.providerManifestErrors({ ...manifest, apiVersion: 1 }).some(e => e.includes('apiVersion 2')));
});

test('named video and audio inputs retain selected media and enforce conditional parameters', async t => {
  const combined = structuredClone(manifest);
  combined.capabilities[0].inputs.push({ id: 'voice', label: 'Voice audio', type: 'audio', required: true });
  combined.capabilities[0].parameters.push(
    { id: 'advanced', label: 'Advanced settings', type: 'boolean', default: false },
    { id: 'strength', label: 'Strength', type: 'number', required: true, minimum: 0, maximum: 1,
      visibleWhen: { parameter: 'advanced', equals: true } },
  );
  const f = await setup(t, combined);
  const audio = join(f.root, 'voice.wav'); writeFileSync(audio, 'audio transport fixture');
  f.store.project.nodes.push({ id: 'voice', type: 'audioGeneration', title: 'Voice', uploadedFile: { filePath: audio } });
  assert.equal(f.actions.prepareCanvasPluginAction(f.request).ready, false);
  const request = { ...f.request, inputs: { source: ['video'], voice: ['voice'] } };
  const prepared = f.actions.prepareCanvasPluginAction(request);
  assert.equal(prepared.ready, true);
  assert.equal(prepared.contract.inputs.voice[0].filePath, audio);
  assert.equal(prepared.contract.parameters.advanced, false);
  assert.equal(f.actions.prepareCanvasPluginAction({ ...request, inputs: { source: ['voice'], voice: ['video'] } }).ready, false);
  assert.equal(f.actions.prepareCanvasPluginAction({ ...request, parameters: { advanced: true } }).ready, false);
  assert.equal(f.actions.prepareCanvasPluginAction({ ...request, parameters: { advanced: true, strength: 0.5 } }).ready, true);
  f.store.project.nodes.find(node => node.id === 'voice').uploadedFile.filePath = join(f.root, 'replacement.wav');
  assert.equal(prepared.contract.inputs.voice[0].filePath, audio, 'prepared input binds the selected media version');
  assert.equal(f.service.submissionsCount(), 0, 'preparation never submits remote work');
});

test('real native module host submits once, polls and archives multiple linked outputs through the task pipeline', async t => {
  const f = await setup(t);
  const started = await f.actions.runCanvasPluginAction(f.request, 'action-integration-1');
  await waitFor(() => f.store.project.tasks[0]?.remoteTaskId);
  assert.equal(f.saved[0].tasks[0].remoteTaskId, undefined, 'task persisted before dispatch');
  assert.equal(f.service.submissionsCount(), 1);
  await f.actions.runCanvasPluginAction(f.request, 'action-integration-1');
  assert.equal(f.service.submissionsCount(), 1);
  const task = f.store.project.tasks[0];
  assert.equal(task.id, started.taskId);
  assert.deepEqual(started.sourceNodeIds, ['video']);
  assert.equal(f.store.project.nodes.length, 1, 'processing creates no canvas node');
  assert.equal(f.store.project.edges.length, 0);
  await waitFor(() => f.polls.length);
  await f.polls[0]();
  assert.equal(task.status, 'running');
  await f.polls[0]();
  assert.equal(task.status, 'completed');
  assert.equal(task.result.archivedFiles.length, 2);
  assert.equal(task.result.resultNodes.length, 2);
  assert.equal(f.store.project.nodes.length, 3);
  assert.equal(f.store.project.edges.length, 2);
  assert.deepEqual(readFileSync(task.result.archivedFiles[0].path), readFileSync(join(f.root, 'input.mp4')));
  const { archiveGeneratedOutput } = await f.env.load('services/generatedResultArchive');
  const node = task.processingNodeSnapshot;
  await archiveGeneratedOutput({ project: f.store.project, node, task, output: task.result.output });
  assert.equal(f.store.project.nodes.length, 3, 'archive replay is idempotent');
  assert.ok(!JSON.stringify(task.requestPayload).includes('apiKey'));
  f.tasks.stopActiveTaskPolling();
});

test('native host validates pinned capability data, connection ownership and changed submission inputs', async t => {
  const f = await setup(t);
  const contract = f.actions.prepareCanvasPluginAction(f.request).contract;
  const args = { requestId: crypto.randomUUID(), reference: contract.reference, providerId: contract.connectionId, method: 'submit', input: { processingContract: contract, submissionId: 'native-dedup-1' } };
  const first = await native.callProviderPlugin(f.nativeEnv, args);
  assert.equal((await native.callProviderPlugin(f.nativeEnv, { ...args, requestId: crypto.randomUUID() })).remoteTaskId, first.remoteTaskId);
  await assert.rejects(native.callProviderPlugin(f.nativeEnv, { ...args, input: { ...args.input, processingContract: { ...contract, capability: { ...contract.capability, operation: 'other' } } } }), /pinned processing/);
  await assert.rejects(native.callProviderPlugin(f.nativeEnv, { ...args, providerId: 'another-connection' }), /Connection/);
  await assert.rejects(native.callProviderPlugin(f.nativeEnv, { ...args, input: { ...args.input, processingContract: { ...contract, parameters: { copies: 1 } } } }), /inputs changed/);
});

test('persist failure dispatches nothing and Agent execution respects the user switch', async t => {
  const f = await setup(t);
  f.desktopApi.project.save = async () => { throw new Error('disk unavailable'); };
  await assert.rejects(f.actions.runCanvasPluginAction(f.request, 'persist-failure-1'), /persist processing/);
  assert.equal(f.service.submissionsCount(), 0);
  const { registerPluginActionTools } = await f.env.load('agent/tools/pluginActionTools');
  const { allAgentTools } = await f.env.load('agent/core/toolRegistry');
  const { settingsStore } = await f.env.load('store/settingsStore');
  const { getAgentProjectIdentity } = await f.env.load('services/agentProjectIdentity');
  registerPluginActionTools(); settingsStore.agentCanRunNodes = false;
  const identity = getAgentProjectIdentity();
  const context = { projectKey: identity.projectKey, projectInstanceId: identity.instanceId, projectGeneration: identity.generation, capabilities: { nodeExecution: true } };
  const run = allAgentTools().find(t => t.id === 'run_plugin_action');
  assert.equal(run.isAvailable(context), false);
  await assert.rejects(run.execute({ ...f.request, submissionId: 'agent-blocked-1' }, context), /disabled/);
});

test('deleting the source retains background task and saves materials without recreating canvas nodes', async t => {
  const f = await setup(t);
  const started = await f.actions.runCanvasPluginAction(f.request, 'deleted-node-1');
  await waitFor(() => f.polls.length);
  const { deleteNodeById } = await f.env.load('store/nodeStore');
  deleteNodeById('video');
  assert.equal(f.store.project.tasks.length, 1);
  await f.polls[0](); await f.polls[0]();
  assert.equal(f.store.project.tasks[0].status, 'completed');
  assert.equal(f.store.project.materials.length, 2);
  assert.equal(f.store.project.nodes.length, 0);
});

test('archive failure can be recovered without resubmitting remote processing', async t => {
  const f = await setup(t);
  const download = f.desktopApi.file.downloadUrlToProject;
  f.desktopApi.file.downloadUrlToProject = async () => { throw new Error('disk full'); };
  await f.actions.runCanvasPluginAction(f.request, 'archive-failure-1');
  await waitFor(() => f.polls.length);
  await f.polls[0](); await f.polls[0]();
  const task = f.store.project.tasks[0];
  assert.equal(task.status, 'failed');
  assert.equal(task.result.archiveError, 'disk full');
  f.desktopApi.file.downloadUrlToProject = download;
  assert.equal(f.tasks.recoverPluginProcessingTask(task.id), true);
  await waitFor(() => task.status === 'completed');
  assert.equal(f.service.submissionsCount(), 1);
  assert.equal(f.store.project.materials.length, 2);
});

test('processing cancellation keeps polling until the service actually confirms it', async t => {
  const f = await setup(t);
  await f.actions.runCanvasPluginAction(f.request, 'cancel-confirmation-1');
  await waitFor(() => f.polls.length);
  const task = f.store.project.tasks[0];
  const call = f.desktopApi.providerPlugins.call;
  let attempts = 0;
  f.desktopApi.providerPlugins.call = async args => {
    if (args.method === 'cancel' && ++attempts === 1) return { remoteTaskId: task.remoteTaskId, status: 'running' };
    if (args.method === 'cancel' && attempts === 2) throw new Error('cancel endpoint unavailable');
    return call(args);
  };
  assert.equal(f.tasks.cancelTask(task.id), true);
  await waitFor(() => attempts === 1);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(task.status, 'running', 'accepted but unconfirmed cancellation must not stop polling');
  assert.equal(f.tasks.cancelTask(task.id), true);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(task.status, 'running', 'failed cancellation must not stop polling');
  assert.equal(f.tasks.cancelTask(task.id), true);
  await waitFor(() => task.status === 'cancelled');
  assert.equal(f.service.submissionsCount(), 1);
});

test('updates and disablement do not replace a running task contract', async t => {
  const f = await setup(t);
  await f.actions.runCanvasPluginAction(f.request, 'pinned-version-1');
  await waitFor(() => f.polls.length);
  const contract = f.store.project.tasks[0].requestPayload.processingContract;
  const updated = structuredClone(manifest); updated.version = '1.1.0'; updated.capabilities[0].name = 'Changed action';
  const source = archive(f.root, updated);
  const checked = await native.inspectProviderPackage(f.nativeEnv, source, 'npm');
  await native.installProviderPackage(f.nativeEnv, source, checked.digest, true, 'npm');
  const state = await native.mutateProviderPlugin(f.nativeEnv, 'enable', { id: manifest.id, enabled: false });
  f.registry.setProviderPluginSnapshot(state);
  assert.equal(f.actions.prepareCanvasPluginAction(f.request).ready, false);
  await f.polls[0](); await f.polls[0]();
  assert.equal(f.store.project.tasks[0].status, 'completed');
  assert.equal(contract.reference.version, '1.0.0');
});

test('switching to another instance of the same project during download never writes output there', async t => {
  const f = await setup(t);
  await f.actions.runCanvasPluginAction(f.request, 'project-switch-1');
  await waitFor(() => f.polls.length);
  await f.polls[0]();
  const original = f.store.project;
  const originalDownload = f.desktopApi.file.downloadUrlToProject;
  f.desktopApi.file.downloadUrlToProject = async (...args) => {
    const result = await originalDownload(...args);
    f.store.project = { ...original, nodes: [], tasks: [], materials: [], edges: [] };
    return result;
  };
  await f.polls[0]();
  assert.equal(f.store.project.materials.length, 0);
  assert.equal(f.store.project.nodes.length, 0);
  assert.equal(original.materials.length, 0);
  f.tasks.stopActiveTaskPolling();
});

async function waitFor(condition) {
  const until = Date.now() + 10000;
  while (!condition()) {
    if (Date.now() > until) throw new Error('Condition timed out');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}


test('background processing resumes without canvas context nodes and folds legacy cards into direct links', async t => {
  const f = await setup(t);
  await f.actions.runCanvasPluginAction(f.request, 'background-resume-1');
  await waitFor(() => f.polls.length);
  const task = f.store.project.tasks[0];
  f.tasks.stopActiveTaskPolling();
  const previousPolls = f.polls.length;
  assert.equal(f.tasks.resumeRemoteTasks(), 1);
  await waitFor(() => f.polls.length > previousPolls);
  await waitFor(() => task.status === 'completed' || task.progress >= 50);
  if (task.status !== 'completed') await f.polls.at(-1)();
  await waitFor(() => task.status === 'completed');
  assert.equal(f.service.submissionsCount(), 1);
  assert.equal(f.store.project.nodes.length, 3);
  assert.ok(f.store.project.edges.every(edge => edge.source === 'video'));

  // Recreate the legacy saved graph to exercise migration on the next resume.
  f.store.project.nodes.push(JSON.parse(JSON.stringify(task.processingNodeSnapshot)));
  for (const edge of f.store.project.edges) edge.source = task.nodeId;
  f.store.project.edges.push({ id: 'legacy-input', source: 'video', target: task.nodeId, kind: 'reference' });
  for (const node of f.store.project.nodes.filter(node => node.generatedFrom)) node.generatedFrom.nodeId = task.nodeId;
  delete task.sourceNodeIds;
  f.tasks.resumeRemoteTasks();
  assert.equal(f.store.project.nodes.length, 3);
  assert.equal(f.store.project.edges.length, 2);
  assert.ok(f.store.project.edges.every(edge => edge.source === 'video'));
  assert.ok(f.store.project.nodes.filter(node => node.generatedFrom).every(node => node.generatedFrom.nodeId === 'video'));
  assert.deepEqual(task.sourceNodeIds, ['video']);
  f.tasks.resumeRemoteTasks();
  assert.equal(f.store.project.edges.length, 2, 'migration is idempotent');
  f.tasks.stopActiveTaskPolling();
});
