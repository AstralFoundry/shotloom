import assert from 'node:assert/strict';
import test from 'node:test';
import { tool } from '@opencode-ai/plugin/tool';
import shotloomToolsPlugin from '../scripts/runtime/shotloom-tools-plugin.mjs';

const definition = {
  name: 'canvas_create_node', description: 'Create a real canvas node',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['action'],
    properties: {
      action: { type: 'object', required: ['type'], properties: {
        type: { type: 'string', enum: ['create_gen_node'] },
        inputLinks: { type: 'array', items: { type: 'object', properties: {
          slot: { type: 'string', enum: ['firstFrame', 'lastFrame'] },
        } } },
      } },
      comment: { type: 'string' },
    },
  },
};

test('native tools retain required fields, nested action schemas and input slots', async () => {
  const plugin = await shotloomToolsPlugin({}, { tools: [definition] });
  const native = plugin.tool.shotloom_canvas_create_node;
  const schema = tool.schema.toJSONSchema(tool.schema.object(native.args), { io: 'input' });
  assert.deepEqual(schema.properties, definition.inputSchema.properties);
  assert.deepEqual(schema.required, definition.inputSchema.required);
  assert.equal(native.description, definition.description);
});

test('native tools carry run identity, preserve receipts and propagate cancellation', async (t) => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    requests.push({ url, init });
    assert.equal(init.headers.Authorization, 'Bearer transport-token');
    if (url.endsWith('/context')) return Response.json({ requestId: 'run-1', sessionId: 'root' });
    const body = JSON.parse(init.body);
    assert.equal(body.requestId, 'run-1');
    assert.equal(body.name, definition.name);
    return Response.json({ success: true, toolCallId: 'tool-1', nodeId: 'real-node' });
  });
  const plugin = await shotloomToolsPlugin({
    directory: '/workspace', client: { session: { get: async ({ path }) => {
      return { data: { id: path.id, ...(path.id === 'child' ? { parentID: 'root' } : {}) } };
    } } },
  }, { tools: [definition], endpoint: 'http://127.0.0.1:1234', token: 'transport-token' });
  const native = plugin.tool.shotloom_canvas_create_node;
  const controller = new AbortController();
  const context = { sessionID: 'root', abort: controller.signal };
  await assert.rejects(native.execute({}, context), /no active run/);
  await plugin['chat.message']({ sessionID: 'root' });
  const args = { action: { type: 'create_gen_node', inputLinks: [{ slot: 'firstFrame' }] } };
  const result = JSON.parse(await native.execute(args, { ...context, sessionID: 'child' }));
  assert.deepEqual(result, { success: true, toolCallId: 'tool-1', nodeId: 'real-node' });
  assert.deepEqual(JSON.parse(requests.at(-1).init.body).arguments, args);
  assert.equal(requests.at(-1).init.signal, controller.signal);
  controller.abort();
  const count = requests.length;
  await assert.rejects(native.execute(args, context), { name: 'AbortError' });
  assert.equal(requests.length, count);
});

test('transport errors reach the Agent instead of becoming success receipts', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => url.endsWith('/context')
    ? Response.json({ requestId: 'run-1', sessionId: 'root' })
    : Response.json({ error: 'Unknown or expired Shotloom Agent run' }, { status: 409 }));
  const plugin = await shotloomToolsPlugin({}, {
    tools: [definition], endpoint: 'http://127.0.0.1:1234', token: 'token',
  });
  await plugin['chat.message']({ sessionID: 'root' });
  await assert.rejects(plugin.tool.shotloom_canvas_create_node.execute({}, {
    sessionID: 'root', abort: new AbortController().signal,
  }), /Unknown or expired/);
});
