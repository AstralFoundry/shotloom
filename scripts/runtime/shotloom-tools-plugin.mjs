import { tool } from '@opencode-ai/plugin/tool';

// Preserve the registry's parameter schemas; validation and
// business permissions remain in Shotloom's executor, not in this transport.
export default async function shotloomToolsPlugin({ client, directory }, options) {
  const { endpoint, token, tools } = options;
  const runs = new Map();
  async function request(path, init = {}) {
    const response = await fetch(`${endpoint}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Shotloom tool transport: HTTP ${response.status}`);
    return result;
  }
  async function sessionRun(sessionID) {
    const visited = new Set();
    let id = sessionID;
    while (id && !visited.has(id)) {
      if (runs.has(id)) return runs.get(id);
      visited.add(id);
      const response = await client.session.get({ path: { id }, query: { directory } });
      const session = response.data ?? response;
      id = session.parentID;
    }
    throw new Error('Shotloom tool transport has no active run for this session');
  }
  return {
    'chat.message': async ({ sessionID }) => {
      const run = await request('/context');
      if (run.sessionId === sessionID) runs.set(sessionID, run.requestId);
    },
    tool: Object.fromEntries(tools.map((definition) => {
      const required = new Set(definition.inputSchema.required || []);
      const args = Object.fromEntries(Object.entries(definition.inputSchema.properties || {}).map(([key, schema]) => [
        key, (required.has(key) ? tool.schema.any().nonoptional() : tool.schema.any().optional()).meta(schema),
      ]));
      return [`shotloom_${definition.name}`, tool({
        description: definition.description,
        args,
        async execute(arguments_, context) {
          context.abort.throwIfAborted();
          const requestId = await sessionRun(context.sessionID);
          const result = await request('/execute', {
            method: 'POST', signal: context.abort,
            body: JSON.stringify({ requestId, name: definition.name, arguments: arguments_ }),
          });
          return JSON.stringify(result);
        },
      })];
    })),
  };
}
