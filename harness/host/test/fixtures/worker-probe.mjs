const scope = { userId: 'worker-probe', projectKey: 'worker-probe' };
const binding = { projectKey: scope.projectKey, conversationId: 'probe-conversation', agentId: 'canvas-primary' };
const replies = new Map(), callbacks = new Map();
export const probe = window.probe = { errors: [], models: 0, tools: 0, images: 0, events: [], sessionId: '', ready: false };
let worker, mounted;
function call(type, payload) {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => { replies.set(id, { resolve, reject }); worker.postMessage({ type, id, payload }); });
}
function respondModel(id, chunks) {
  const body = new ReadableStream({ start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(JSON.stringify({ version: 1, chunk }) + '\n'));
    controller.enqueue(new TextEncoder().encode(JSON.stringify({ version: 1, done: true }) + '\n')); controller.close();
  } });
  worker.postMessage({ type: 'host-result', id, value: { body } }, [body]);
}
probe.start = async () => {
  probe.ready = false;
  worker = new Worker('/harness/worker/worker.mjs', { type: 'module' });
  worker.onerror = event => probe.errors.push(event.message);
  worker.onmessage = event => {
    const message = event.data; probe.events.push(message);
    if (message.type === 'result') {
      const reply = replies.get(message.id); replies.delete(message.id);
      message.error ? reply?.reject(new Error(message.error)) : reply?.resolve(message.value);
    } else if (message.type === 'event') callbacks.get(message.value.requestId)?.(message.value);
    else if (message.type === 'fatal') probe.errors.push(message.error);
    else if (message.type === 'host-request' && message.method === 'tool') {
      if (message.payload.phase !== 'authorize') probe.tools++;
      worker.postMessage({ type: 'host-result', id: message.id, value: message.payload.phase === 'authorize'
        ? { success: true, approvalRequired: false } : { requestId: message.payload.requestId, sessionId: probe.sessionId, toolName: message.payload.toolName,
          result: { success: true, sessionId: 'director-runtime-probe', revision: 1, proof: 'real-tool-bridge' } } });
    } else if (message.type === 'host-request' && message.method === 'model') {
      probe.models++;
      probe.images += message.payload.images.length;
      const hasTool = message.payload.request.messages.some(message => message.role === 'tool');
      if (hasTool) {
        const receipt = JSON.parse(message.payload.request.messages.findLast(message => message.role === 'tool').content.find(block => block.type === 'text').text);
        if (receipt.sessionId !== 'director-runtime-probe' || receipt.revision !== 1 || receipt.toolName) {
          probe.errors.push('Worker leaked the Harness receipt instead of the director runtime snapshot');
          worker.postMessage({ type: 'host-result', id: message.id, error: probe.errors.at(-1) });
          return;
        }
      }
      respondModel(message.id, hasTool ? [
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: 'Worker tool roundtrip passed' },
        { type: 'block-end', index: 0, block: { type: 'text', text: 'Worker tool roundtrip passed' } },
        { type: 'finish', reason: { kind: 'stop' } },
      ] : [
        { type: 'block-start', index: 0, blockType: 'tool-call' },
        { type: 'tool-call-delta', index: 0, id: 'probe-call', name: 'probe_inspect', argumentsDelta: '{}' },
        { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'probe-call', name: 'probe_inspect', arguments: '{}' } },
        { type: 'finish', reason: { kind: 'tool-calls' } },
      ]);
    }
  };
  await call('boot', scope);
  const bound = await call('bind', { binding, tools: [{ name: 'probe_inspect', description: 'Inspect test project', parameters: { type: 'object', properties: {} }, roles: ['canvas-primary'], effect: 'read' }], skills: [],
    providers: { probe: { key: 'ephemeral-test-key', profile: { api: 'openai-completions', displayName: 'Probe', models: [{ id: 'probe', name: 'Probe', input: ['text', 'image'], contextWindow: 100000, maxTokens: 1024 }] } } },
    defaultModel: { provider: 'probe', model: 'probe' },
  });
  probe.sessionId = bound.sessionId;
  const client = await import('/harness/client.js');
  mounted = await client.mount(document.getElementById('chat'), { async send(message, receive) {
    callbacks.set(message.requestId, receive); worker.postMessage({ type: 'send', payload: message });
  } }, { ...bound, agentId: binding.agentId, locale: 'en-US', readReference: async () => ({}), preview() {}, navigate() {},
    status(phase, error) { if (error) probe.errors.push(error); if (phase === 'ready') probe.ready = true; }, subscribeMention: () => () => {} });
};
probe.rpc = (endpoint, args) => {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    callbacks.set(requestId, event => {
      if (event.kind === 'error') reject(new Error(event.error));
      if (event.kind === 'result') {
        const result = JSON.parse(atob(event.value.body)).result;
        if (result.ok) resolve(result.value); else reject(new Error(JSON.stringify(result.error)));
        callbacks.delete(requestId);
      }
    });
    worker.postMessage({ type: 'send', payload: { kind: 'fetch', requestId, payload: { path: '/api/' + endpoint, method: 'POST', headers: { 'content-type': 'application/json' },
      body: btoa(JSON.stringify({ type: 'client-request', rpcId: requestId, method: endpoint, payload: { args } })) } } });
  });
};
probe.prompt = () => probe.rpc('session/prompt', { request: { sessionId: probe.sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: 'Inspect this project' }] } });
probe.archive = archived => call('archive', { projectKey: scope.projectKey, sessionIds: [probe.sessionId], archived });
probe.imagePrompt = async () => {
  const canvas = new OffscreenCanvas(16, 16), context = canvas.getContext('2d');
  context.fillStyle = 'red'; context.fillRect(0, 0, 16, 16);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const data = btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
  return probe.rpc('session/prompt', { request: { sessionId: probe.sessionId, requestId: crypto.randomUUID(), mode: 'queue', content: [{ type: 'text', text: 'Observe this image' }, { type: 'image', data, mediaType: 'image/png', name: 'red.png' }] } });
};
probe.stop = () => { mounted?.dispose(); worker?.terminate(); };
probe.files = async () => {
  const request = indexedDB.open('shotloom-agent-worker-v1');
  const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  try {
    const tx = db.transaction('files'), read = tx.objectStore('files').getAll();
    return await new Promise((resolve, reject) => { tx.oncomplete = () => resolve(read.result.map(row => ({ path: row.path, content: new TextDecoder().decode(row.data) }))); tx.onerror = () => reject(tx.error); });
  } finally { db.close(); }
};
probe.start().catch(error => probe.errors.push(error.stack));
