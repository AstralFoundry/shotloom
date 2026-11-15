// Local-only demonstration service. No external APIs or credentials are used.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
const tasks = new Map();
const submissions = new Map();
createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type, authorization');
  res.setHeader('content-type', 'application/json');
  if (req.method === 'OPTIONS') { res.end(); return; }
  let text = ''; for await (const chunk of req) text += chunk;
  try {
    const input = text ? JSON.parse(text) : {};
    if (req.url === '/v1/chat/completions') {
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: `Mock: ${input.messages?.at(-1)?.content || ''}` } }] })); return;
    }
    if (req.url === '/models') { res.end(JSON.stringify([{ id: 'demo-chat' }])); return; }
    if (req.url === '/tasks' && req.method === 'POST') {
      const id = submissions.get(input.submissionId) || randomUUID();
      if (!tasks.has(id)) tasks.set(id, { remoteTaskId: id, status: 'running', progress: 10, prompt: input.prompt, started: Date.now() });
      if (input.submissionId) submissions.set(input.submissionId, id);
      res.end(JSON.stringify(tasks.get(id))); return;
    }
    const [, , id, action] = req.url.split('/');
    const task = tasks.get(id);
    if (!task) { res.statusCode = 404; res.end(JSON.stringify({ error: 'Unknown task' })); return; }
    if (action === 'cancel') task.status = 'cancelled';
    else if (task.status === 'running' && Date.now() - task.started > 2000) Object.assign(task, { status: 'completed', progress: 100, result: { text: `Mock: ${task.prompt}` } });
    res.end(JSON.stringify(task));
  } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error: error.message })); }
}).listen(19391, '127.0.0.1', () => console.log('Mock provider: http://127.0.0.1:19391 (Ctrl+C to stop)'));
