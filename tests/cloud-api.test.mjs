import assert from 'node:assert/strict';
import test from 'node:test';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

test('embedded preferences do not wait for upstream services and account refresh preserves edits', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud', withWindow: true });
  const original = globalThis.fetch;
  const calls = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  globalThis.fetch = async url => {
    calls.push(url);
    if (url === '/api/settings') return Response.json({ success: true, data: { locale: 'en-US', agentCanRunNodes: false, agentPreferredTextModel: 'custom-model' } });
    await gate;
    return Response.json({ success: true, data: url === '/api/models' ? { publications: [], upstreamModels: [] } : { app_quota: 123 } });
  };
  try {
    const { loadAppSettings, refreshCloudAccountSettings, settingsStore } = await env.load('store/settingsStore');
    await Promise.race([loadAppSettings({ preferencesOnly: true }), new Promise((_, reject) => setTimeout(() => reject(new Error('Preferences are blocked by upstream requests')), 1000))]);
    assert.deepEqual(calls, ['/api/settings']);
    assert.equal(settingsStore.agentPreferredTextModel, 'custom-model');
    assert.equal(settingsStore.apiKeyValid, false, 'generation stays unavailable until model authorization is loaded');
    const pending = refreshCloudAccountSettings();
    settingsStore.agentCanRunNodes = true;
    release();
    await pending;
    assert.equal(settingsStore.agentCanRunNodes, true, 'late account responses cannot overwrite user edits');
    assert.equal(settingsStore.agentPreferredTextModel, 'custom-model');
    assert.equal(settingsStore.rawQuota, 123);
    assert.equal(calls.filter(url => url === '/api/settings').length, 1);
  } finally { release(); globalThis.fetch = original; await env.dispose(); }
});

test('upstream account and model failures preserve stored preferences and allow workspace initialization', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud', withWindow: true });
  const originalFetch = globalThis.fetch;
  let expired = 0;
  window.dispatchEvent = () => { expired++; return true; };
  globalThis.fetch = async url => {
    if (url === '/api/settings') return Response.json({ success: true, data: { locale: 'en-US', agentCanRunNodes: false } });
    if (url === '/api/auth/me') return Response.json({ success: true, data: { id: 'user' } });
    return Response.json({ success: false, message: 'Gateway authorization unavailable' }, { status: url === '/api/models' ? 401 : 502 });
  };
  try {
    const { createCloudApi } = await env.load('services/cloudApi');
    const api = createCloudApi({ project: {}, file: {}, settings: {} });
    const settings = await api.settings.get();
    assert.equal(settings.locale, 'en-US');
    assert.equal(settings.agentCanRunNodes, false);
    assert.equal(settings.apiKeyValid, false);
    assert.match(settings.accountSyncError, /Gateway authorization unavailable/);
    assert.deepEqual(settings.upstreamModels, []);
    assert.ok(Object.values(settings.providerConfigs).every(provider => !provider.allowedModelIds.length));
    assert.equal(expired, 0);
    const { loadAppSettings, settingsStore } = await env.load('store/settingsStore');
    await loadAppSettings();
    assert.equal(settingsStore.agentCanRunNodes, false);
    assert.match(settingsStore.accountSyncError, /Gateway authorization unavailable/);
    globalThis.fetch = async () => Response.json({ success: false, message: 'Preferences unavailable' }, { status: 503 });
    await assert.rejects(api.settings.get(), /Preferences unavailable/, 'stored preferences remain required');
  } finally { globalThis.fetch = originalFetch; await env.dispose(); }
});

test('model relay and agent connection errors verify the application session before expiring it', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud', withWindow: true });
  const originalFetch = globalThis.fetch;
  let expired = 0, checked = 0;
  window.dispatchEvent = () => { expired++; return true; };
  globalThis.fetch = async url => {
    if (url === '/api/auth/me') { checked++; return Response.json({ success: true, data: { id: 'user' } }); }
    if (url === '/api/agent/connect') return Response.json({ success: true, data: { id: 'connection' } });
    return Response.json({ success: false, message: 'Upstream unavailable' }, { status: 401 });
  };
  try {
    const { createCloudApi } = await env.load('services/cloudApi');
    const api = createCloudApi({ project: {}, file: {}, settings: {} });
    await assert.rejects(api.model.chatCompletion({ model: 'fixture', messages: [] }));
    assert.equal(expired, 0, 'a model token failure cannot expire the application');
    const { connectCloudHarness } = await env.load('app/agent-session/cloudHarnessTransport');
    await assert.rejects(connectCloudHarness());
    assert.equal(expired, 0);
    assert.equal(checked, 2);
  } finally { globalThis.fetch = originalFetch; await env.dispose(); }
});

test('cloud settings install published upstream models as the runtime catalog without persisting server configuration', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud' });
  const originalFetch = globalThis.fetch;
  const models = [
    { id: 'speech-2.8-hd', owned_by: 'minimax', supported_endpoint_types: ['audio-speech'] },
    { id: 'upstream-only-model', owned_by: 'upstream', supported_endpoint_types: ['openai'] },
  ];
  const publications = models.map((model, index) => ({ ...model, available: true, name: model.id,
    type: index ? 'textGeneration' : 'audioGeneration', template_id: index ? 'newapi-chat-completions' : 'starrouter-speech-2.8-hd',
    sort_order: index, published: true, revision: 1 }));
  globalThis.fetch = async url => {
    if (url === '/api/models') return Response.json({ success: true, data: { publications, upstreamModels: models } });
    if (url === '/api/settings') return Response.json({ success: true, data: {} });
    if (url === '/api/auth/account') return Response.json({ success: true, data: {} });
    assert.fail(`Unexpected request: ${url}`);
  };
  try {
    const { createCloudApi } = await env.load('services/cloudApi');
    const settings = await createCloudApi({ project: {}, file: {}, settings: {} }).settings.get();
    assert.deepEqual(settings.upstreamModels, models);
    const { getCatalogModels, getModelIdsByType, modelCatalog, resolveModelRuntimeContract } = await env.load('domain/catalog/ModelCatalog');
    assert.deepEqual(getCatalogModels().map(model => model.id), models.map(model => model.id));
    const contract = resolveModelRuntimeContract('textGeneration', 'upstream-only-model');
    assert.equal(contract.upstreamModel, 'upstream-only-model');
    const { getProviderAdapter } = await env.load('domain/provider/adapters/index');
    const compiled = getProviderAdapter(contract.provider).compileRequest({ taskType: 'textGeneration', model: contract.modelId, modelContract: contract, prompt: 'hello' });
    assert.equal(compiled.protocolVariables.model, 'upstream-only-model');
    assert.equal(compiled.endpointPath, '/chat/completions');
    modelCatalog.replacePublishedModels([...getCatalogModels(), { ...getCatalogModels()[1], id: 'zero-order-text', sortOrder: 0 }]);
    assert.equal(getModelIdsByType('textGeneration')[0], 'zero-order-text');
    const { loadAppSettings, settingsStore, saveAppSettings } = await env.load('store/settingsStore');
    await loadAppSettings();
    assert.equal(getCatalogModels().some(model => model.id === 'zero-order-text'), false);
    assert.deepEqual(settingsStore.upstreamModels, models);
    globalThis.fetch = async (url, init) => {
      if (url === '/api/settings' && init.method === 'PUT') {
        assert.equal('upstreamModels' in JSON.parse(init.body), false);
        return Response.json({ success: true, data: {} });
      }
      return url === '/api/models' ? Response.json({ success: true, data: { publications, upstreamModels: models } }) : Response.json({ success: true, data: {} });
    };
    await saveAppSettings({ agentAutoEval: true });
    assert.deepEqual(settingsStore.upstreamModels, models);
  } finally { globalThis.fetch = originalFetch; await env.dispose(); }
});

test('a fresh cloud client restores only the project reference from the workspace URL', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud', withWindow: true });
  const id = 'a0000000-0000-4000-8000-000000000001';
  window.location = { search: `?route=tasks&project=${id}` };
  try {
    const { createCloudApi } = await env.load('services/cloudApi');
    const local = { project: {}, file: {}, settings: {} };
    const client = createCloudApi(local);
    assert.equal(await client.project.getWindowProjectDir(), `cloud/projects/${id}`);
    await client.project.setWindowProjectDir(null);
    assert.equal(await client.project.getWindowProjectDir(), null, 'clearing a binding must not restore the URL again');
    const nested = `cloud/projects/folders/b0000000-0000-4000-8000-000000000001/${id}`;
    window.location.search = `?route=tasks&project=${encodeURIComponent(nested)}`;
    assert.equal(await createCloudApi(local).project.getWindowProjectDir(), nested, 'folder paths keep the Agent project identity stable');
    window.location.search = '?project=invalid';
    assert.equal(await createCloudApi(local).project.getWindowProjectDir(), null);
  } finally { await env.dispose(); }
});

test('cloud director models use signed Storage objects across save, a fresh client, bundle read and clipboard', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud' });
  const originalFetch = globalThis.fetch;
  const id = 'a0000000-0000-4000-8000-000000000001';
  const directory = `cloud/projects/${id}`;
  const objects = new Map();
  let saved;
  let clipboard;
  let uploads = 0;
  globalThis.fetch = async (url, init = {}) => {
    let data;
    if (url === '/api/files/upload-url') { uploads++; data = { url: `https://storage.example/${JSON.parse(init.body).key}` }; }
    else if (url.startsWith('https://storage.example/') && init.method === 'PUT') { assert.equal(init.credentials, 'omit'); objects.set(url, init.body); return new Response(null); }
    else if (url.startsWith('/api/files/sign?')) data = { url: `https://storage.example/${new URLSearchParams(url.split('?')[1]).get('key')}` };
    else if (url.startsWith('https://storage.example/')) { assert.equal(init.credentials, 'omit'); return new Response(objects.get(url)); }
    else if (url === `/api/project/${id}/bundle`) data = { project: saved, snapshots: [], records: [] };
    else if (url === `/api/project/${id}`) {
      if (init.method === 'PUT') { saved = JSON.parse(init.body); saved.storageRevision = 1; }
      data = structuredClone(saved);
    } else if (url === '/api/clipboard/director-test') {
      if (init.method === 'PUT') clipboard = JSON.parse(init.body);
      data = clipboard;
    } else assert.fail(`Unexpected request: ${url}`);
    return Response.json({ success: true, data });
  };
  const originalNavigator = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async () => {} } } });
  try {
    const { createCloudApi } = await env.load('services/cloudApi');
    const local = { project: { readBundle: () => assert.fail('cloud bundle read must not touch local SQLite') }, file: {}, settings: {} };
    const project = { id, nodes: [{ id: 'director', directorData: { project: { resources: [{ id: `model-${'c'.repeat(64)}`, package: { version: 1, format: 'obj', entry: 'cube.obj', files: [{ path: 'cube.obj', data: 'diAwIDAgMAo=' }] } }] } } }] };
    const first = createCloudApi(local);
    const result = await first.project.save(directory, project);
    assert.deepEqual(result.project.nodes, project.nodes);
    assert.equal(saved.nodes[0].directorData.project.resources[0].package.storage, 'shotloom-director-model');
    assert.equal(JSON.stringify(saved).includes('diAwIDAgMAo='), false);
    assert.equal(uploads, 1);
    const fresh = createCloudApi(local);
    assert.deepEqual((await fresh.project.readFile(`${directory}/project.sqlite`)).nodes, project.nodes);
    assert.deepEqual((await fresh.project.readBundle(directory)).project.nodes, project.nodes);
    await fresh.clipboard.stageWorkflow({ snapshotId: 'director-test', nodes: project.nodes, edges: [], resources: [] });
    assert.equal(clipboard.nodes[0].directorData.project.resources[0].package.storage, 'shotloom-director-model');
    assert.deepEqual((await fresh.clipboard.loadStagedPayload('director-test')).nodes, project.nodes);
    assert.equal(uploads, 1, 'loading and staging must reuse the uploaded package');
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNavigator });
    await env.dispose();
  }
});

test('cloud session archive and immediate undo reach the server in order on browser clients', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud' });
  const originalFetch = globalThis.fetch;
  const writes = [];
  let finishArchive;
  const archiveStarted = new Promise(resolve => { finishArchive = resolve; });
  let releaseArchive;
  const archiveGate = new Promise(resolve => { releaseArchive = resolve; });
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/agent/sessions/archive');
    assert.equal(init.credentials, 'include');
    const input = JSON.parse(init.body);
    writes.push(input);
    if (input.archived) { finishArchive(); await archiveGate; }
    return Response.json({ success: true, data: { sessionIds: ['session'] } });
  };
  try {
    const { setHarnessSessionsArchived } = await env.load('services/harnessArchive');
    const archive = setHarnessSessionsArchived('project', ['session'], true);
    await archiveStarted;
    const undo = setHarnessSessionsArchived('project', ['session'], false);
    assert.equal(writes.length, 1);
    releaseArchive();
    await Promise.all([archive, undo]);
    assert.deepEqual(writes, [
      { projectKey: 'project', sessionIds: ['session'], archived: true },
      { projectKey: 'project', sessionIds: ['session'], archived: false },
    ]);
  } finally { releaseArchive(); globalThis.fetch = originalFetch; await env.dispose(); }
});

for (const mode of ['project', 'nested folder']) test(`cloud ${mode} copies preserve editor snapshots and records`, async () => {
  const env = await createRendererEnv({ storageMode: 'cloud' });
  const originalFetch = globalThis.fetch;
  const projectId = 'a0000000-0000-4000-8000-000000000001';
  const folderId = 'a0000000-0000-4000-8000-000000000002';
  const nestedId = 'a0000000-0000-4000-8000-000000000003';
  const createdFolders = [];
  const writes = [];
  const bundle = {
    project: { schema: 'shotloom-project', schemaVersion: 2, id: projectId, name: 'Original', nodes: [{ id: 'clip' }], cloudFolderId: nestedId, storageRevision: 7,
      harnessSessions: [{ id: 'conversation', title: 'Original chat', agentId: 'canvas-primary', harnessSessionId: 'source-host-session' }],
      trashedHarnessSessions: [{ id: 'trashed', editorNodeId: 'clip', harnessSessionId: 'source-trashed-session' }], activeHarnessSessionId: 'conversation' },
    snapshots: [{ nodeId: 'clip', payload: { tracks: [{ id: 'track', clips: ['retained'] }] } }],
    records: Array.from({ length: 1105 }, (_, i) => ({ nodeId: 'clip', key: `record-${i}`, payload: { i } })),
  };
  globalThis.fetch = async (url, init) => {
    let data;
    if (url === '/api/library-folders' && init.method === 'POST') {
      const id = crypto.randomUUID();
      createdFolders.push({ id, ...JSON.parse(init.body) });
      data = { id };
    } else if (url === '/api/library-folders') data = [{ id: folderId, name: 'Folder', parentId: null }, { id: nestedId, name: 'Nested', parentId: folderId }];
    else if (url === '/api/projects') data = [bundle.project];
    else if (url === `/api/project/${projectId}/bundle`) data = structuredClone(bundle);
    else {
      assert.match(url, /^\/api\/project\/[0-9a-f-]+\/bundle$/);
      assert.equal(init.method, 'PUT');
      const value = JSON.parse(init.body);
      writes.push(value);
      data = { ...value.project, storageRevision: 1 };
    }
    return Response.json({ success: true, data });
  };
  try {
    const { createCloudApi } = await env.load('services/cloudApi');
    const api = createCloudApi({ project: {}, file: {}, settings: {} });
    if (mode === 'project') {
      const result = await api.project.cloneFolder(`cloud/projects/folders/${nestedId}/${projectId}`, 'Copy');
      assert.equal(result.project.name, 'Copy');
      assert.equal(writes[0].project.cloudFolderId, nestedId);
    } else {
      await api.project.cloneLibraryFolder(`cloud/projects/folders/${folderId}`);
      assert.equal(createdFolders.length, 2);
      assert.equal(createdFolders[1].parentId, createdFolders[0].id);
      assert.equal(writes[0].project.cloudFolderId, createdFolders[1].id);
    }
    assert.equal(writes.length, 1);
    assert.notEqual(writes[0].project.id, projectId);
    assert.equal(writes[0].project.storageRevision, 0);
    assert.deepEqual(writes[0].project.harnessSessions, [{ id: 'conversation', title: 'Original chat', agentId: 'canvas-primary' }]);
    assert.deepEqual(writes[0].project.trashedHarnessSessions, [{ id: 'trashed', editorNodeId: 'clip' }]);
    assert.equal(writes[0].project.activeHarnessSessionId, 'conversation');
    assert.equal(bundle.project.harnessSessions[0].harnessSessionId, 'source-host-session');
    assert.deepEqual(writes[0].snapshots, bundle.snapshots);
    assert.deepEqual(writes[0].records, bundle.records);
    assert.equal(bundle.project.storageRevision, 7);
  } finally { globalThis.fetch = originalFetch; await env.dispose(); }
});

test('cloud file existence uses an authenticated signature and omits credentials at Storage', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud' });
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push([url, init.credentials]);
    if (url === '/api/files/sign?bucket=media&key=existing.mp4') {
      assert.equal(init.credentials, 'include');
      return Response.json({ success: true, data: { url: 'https://storage.example/signed.mp4' } });
    }
    assert.equal(url, 'https://storage.example/signed.mp4');
    assert.equal(init.method, 'HEAD');
    assert.equal(init.credentials, 'omit');
    return new Response(null, { status: 200 });
  };
  try {
    const { createCloudApi } = await env.load('services/cloudApi');
    const api = createCloudApi({ project: {}, file: {}, settings: {} });
    assert.equal(await api.file.pathExists('cloud://media/existing.mp4'), true);
    assert.equal(requests.length, 2);
  } finally { globalThis.fetch = originalFetch; await env.dispose(); }
});

test('cloud clipboard stages durable references without invoking native SQLite staging', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud' });
  const originalFetch = globalThis.fetch;
  const writes = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/clipboard/snapshot-1');
    const saved = JSON.parse(init.body);
    assert.equal(saved.resources[0].stagedPath, 'cloud://media/existing.mp4');
    assert.deepEqual(saved.nodes, [{ id: 'clip' }]);
    return Response.json({ success: true, data: null });
  };
  try {
    const { createCloudApi } = await env.load('services/cloudApi');
    const api = createCloudApi({ project: {}, file: {}, settings: {}, clipboard: {
      stageWorkflow: () => { throw new Error('Must not write native database'); },
    }, nativeMedia: { clipboardWrite: async id => writes.push(id) } });
    await api.clipboard.stageWorkflow({ snapshotId: 'snapshot-1', nodes: [{ id: 'clip' }], edges: [], resources: [{ path: 'cloud://media/existing.mp4' }] });
    assert.deepEqual(writes, ['snapshot-1']);
  } finally { globalThis.fetch = originalFetch; await env.dispose(); }
});

test('an open workspace retains its original account binding and nested project location', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud' });
  const originalFetch = globalThis.fetch;
  const projectId = 'a0000000-0000-4000-8000-000000000001';
  const folderId = 'a0000000-0000-4000-8000-000000000002';
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.headers['x-shotloom-user'], 'original-owner');
    return Response.json({ success: true, data: { cloudFolderId: folderId, nodes: [] } });
  };
  try {
    const { bindCloudUser } = await env.load('services/cloudRequest');
    assert.equal(bindCloudUser('original-owner'), true);
    assert.equal(bindCloudUser('different-owner'), false);
    assert.equal(bindCloudUser('original-owner'), true);
    const { createCloudApi } = await env.load('services/cloudApi');
    const api = createCloudApi({ project: {}, file: {}, settings: {} });
    const opened = await api.project.openFolder(`cloud/projects/folders/${folderId}/${projectId}`);
    assert.equal(opened.projectDir, `cloud/projects/folders/${folderId}/${projectId}`);
  } finally { globalThis.fetch = originalFetch; await env.dispose(); }
});

test('cloud project saves preserve revisions and never fall back to local persistence', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud' });
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return Response.json({ success: true, data: { ...JSON.parse(init.body), storageRevision: 4 } });
  };
  try {
    const { createCloudApi, cloudProjectId } = await env.load('services/cloudApi');
    const api = createCloudApi({ project: {}, file: {}, settings: {} });
    const directory = await api.project.createFolder('unused', 'test');
    const project = { name: 'cloud', nodes: [], storageRevision: 3 };
    const result = await api.project.save(directory, project);
    assert.match(result.filePath, /\/project\.sqlite$/);
    assert.equal(result.project.storageRevision, 4);
    assert.equal(JSON.parse(requests[0].init.body).storageRevision, 3);
    assert.equal(requests[0].url, `/api/project/${cloudProjectId(directory)}`);
    assert.throws(() => cloudProjectId('cloud/projects/../../settings'));
  } finally { globalThis.fetch = originalFetch; await env.dispose(); }
});

test('cloud uploads send bytes directly to Storage and persist a stable bucket/path reference', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud' });
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    if (String(url).startsWith('data:')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } });
    if (url === '/api/files/upload-url') return Response.json({ success: true, data: { url: 'https://storage.example/signed?token=private' } });
    if (String(url).startsWith('https://storage.example')) return new Response('{}');
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const { createCloudApi } = await env.load('services/cloudApi');
    const api = createCloudApi({ project: {}, file: {}, settings: {} });
    const saved = await api.file.saveDataUrlToProject('data:image/png;base64,AQID', 'frame.png');
    assert.match(saved.path, /^cloud:\/\/media\/[a-f0-9-]+\.png$/);
    assert.ok(!JSON.stringify(saved).includes('token='));
    const upload = requests.at(-1);
    assert.equal(upload.init.method, 'PUT');
    assert.equal(upload.init.credentials, 'omit');
    assert.equal(upload.init.body.size, 3);
    assert.equal(requests.filter(request => request.url.startsWith('/api/')).length, 1);
  } finally { globalThis.fetch = originalFetch; await env.dispose(); }
});

test('private media reads authenticate for a signature and omit cookies on the Storage fetch', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud' });
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    if (url === '/api/files/sign?bucket=media&key=clip.mp4') return Response.json({ success: true, data: { url: 'https://storage.example/signed' } });
    if (url === 'https://storage.example/signed') return new Response('media');
    throw new Error('Unexpected request');
  };
  try {
    const { createCloudApi } = await env.load('services/cloudApi');
    const api = createCloudApi({ project: {}, file: {}, settings: {} });
    assert.equal((await api.file.readArrayBuffer('cloud://media/clip.mp4')).byteLength, 5);
    assert.equal(requests[0].init.credentials, 'include');
    assert.equal(requests[1].init.credentials, 'omit');
    assert.equal(requests[1].init.headers, undefined);
  } finally { globalThis.fetch = originalFetch; await env.dispose(); }
});

test('cloud relay consumes SSE fragments without buffering the completed response', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud' });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
    const text = 'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n';
    controller.enqueue(new TextEncoder().encode(text.slice(0, 18)));
    controller.enqueue(new TextEncoder().encode(text.slice(18))); controller.close();
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
  try {
    const { createCloudApi } = await env.load('services/cloudApi');
    const api = createCloudApi({ project: {}, file: {}, settings: {} });
    const deltas = [];
    const result = await api.model.chatCompletionStream({ model: 'example', stream: true }, text => deltas.push(text));
    assert.deepEqual(deltas, ['hello']);
    assert.equal(result.choices[0].message.content, 'hello');
  } finally { globalThis.fetch = originalFetch; await env.dispose(); }
});

test('external generated media uses the authenticated download route, then signed direct upload', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud' });
  const originalFetch = globalThis.fetch;
  const source = 'https://cdn.example/result.png?signature=secret';
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    if (String(url).startsWith('/api/files/remote?')) return new Response('image', { headers: { 'Content-Type': 'image/png' } });
    if (url === '/api/files/upload-url') return Response.json({ success: true, data: { url: 'https://storage.example/upload' } });
    if (url === 'https://storage.example/upload') return new Response('{}');
    throw new Error('Unexpected request');
  };
  try {
    const { createCloudApi } = await env.load('services/cloudApi');
    const api = createCloudApi({ project: {}, file: {}, settings: {} });
    const saved = await api.file.downloadUrlToProject(source, 'result.png');
    assert.match(saved.path, /^cloud:\/\/media\/[a-f0-9-]+\.png$/);
    assert.equal(requests[0].url, `/api/files/remote?url=${encodeURIComponent(source)}`);
    assert.equal(requests[0].init.credentials, 'include');
    assert.equal(requests.at(-1).init.body.size, 5);
    assert.equal(requests.at(-1).init.credentials, 'omit');
  } finally { globalThis.fetch = originalFetch; await env.dispose(); }
});

test('desktop cloud import copies legacy media and editor records into a new project without saving locally', async () => {
  const env = await createRendererEnv({ storageMode: 'cloud' });
  const originalFetch = globalThis.fetch;
  const directory = 'C:/Users/test/projects/old';
  const original = { schema: 'shotloom-project', schemaVersion: 2, id: 'legacy', name: 'Legacy',
    library: { rootDir: 'old' }, nodes: [{ id: 'clip', filePath: 'assets/clip.mp4' }] };
  const bundle = { project: original, snapshots: [{ nodeId: 'clip', payload: { tracks: [] } }], records: [{ nodeId: 'clip', key: 'view', payload: { zoom: 2 } }] };
  let payload;
  const uploads = [];
  globalThis.fetch = async (url, init) => {
    if (url === '/api/files/upload-url') return Response.json({ success: true, data: { url: 'https://storage.example/upload' } });
    if (url.endsWith('/bundle')) {
      payload = JSON.parse(init.body);
      return Response.json({ success: true, data: { ...payload.project, storageRevision: 1 } });
    }
    if (url.includes('/snapshot/')) return Response.json({ success: true, data: null });
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    const { createCloudApi } = await env.load('services/cloudApi');
    const api = createCloudApi({ project: { openFolderDialog: async () => ({ projectDir: directory, project: original }),
      readBundle: async path => { assert.equal(path, directory); return bundle; } }, file: {}, settings: {},
      nativeMedia: { upload: async (source, url) => { uploads.push({ source, url }); return { size: 5 }; } },
    });
    const result = await api.project.openFolderDialog();
    assert.match(result.projectDir, /^cloud\/projects\/[a-f0-9-]+$/);
    assert.notEqual(result.project.id, 'legacy');
    assert.match(payload.project.nodes[0].filePath, /^cloud:\/\/media\/[a-f0-9-]+\.mp4$/);
    assert.equal(payload.project.library, undefined);
    assert.deepEqual(payload.records, bundle.records);
    assert.equal(uploads[0].source, `${directory}/assets/clip.mp4`);
    assert.equal(original.nodes[0].filePath, 'assets/clip.mp4');
    assert.equal(await api.project.setEditorSnapshot(result.projectDir, 'clip', { tracks: [] }), true);
  } finally { globalThis.fetch = originalFetch; await env.dispose(); }
});
