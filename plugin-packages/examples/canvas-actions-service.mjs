import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

/** Local test transport only; copies the input bytes and performs no AI processing. */
export function createCanvasActionsService() {
  const tasks = new Map();
  const submissions = new Map();
  let submissionsCount = 0;
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (req.method === 'POST' && url.pathname === '/tasks') {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 20 * 1024 * 1024) { res.writeHead(413).end(); return; }
        }
        const input = JSON.parse(body);
        if (!input.submissionId || !['video', 'image'].includes(input.type) || ![1, 2, 3].includes(input.copies)) { res.writeHead(400).end(); return; }
        let task = tasks.get(submissions.get(input.submissionId));
        if (!task) {
          const id = randomUUID();
          task = { id, input, status: 'running', polls: 0 };
          tasks.set(id, task); submissions.set(input.submissionId, id); submissionsCount++;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ remoteTaskId: task.id, status: task.status, progress: 10 }));
        return;
      }
      const parts = url.pathname.split('/').filter(Boolean);
      const task = tasks.get(parts[1]);
      if (!task) { res.writeHead(404).end(); return; }
      if (parts[0] === 'media') {
        res.setHeader('Content-Type', task.input.type === 'video' ? 'video/mp4' : 'image/png');
        res.end(Buffer.from(task.input.data, 'base64')); return;
      }
      if (parts[0] !== 'tasks') { res.writeHead(404).end(); return; }
      if (req.method === 'POST' && parts[2] === 'cancel') task.status = 'cancelled';
      else if (req.method !== 'GET') { res.writeHead(405).end(); return; }
      else if (++task.polls >= 2 && task.status !== 'cancelled') task.status = 'completed';
      const ext = task.input.type === 'video' ? 'mp4' : 'png';
      const origin = `http://127.0.0.1:${server.address().port}`;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ remoteTaskId: task.id, status: task.status, progress: task.status === 'completed' ? 100 : 50,
        ...(task.status === 'completed' ? { result: { outputs: { result: Array.from({ length: task.input.copies }, (_, index) => ({
          url: `${origin}/media/${task.id}/${index}.${ext}`, mimeType: task.input.type === 'video' ? 'video/mp4' : 'image/png', name: `copy-${index}.${ext}`,
        })) } } } : {}) }));
    } catch { res.writeHead(500).end(); }
  });
  return { server, submissionsCount: () => submissionsCount };
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file://').href) {
  const { server } = createCanvasActionsService();
  server.listen(19392, '127.0.0.1', () => console.log('Local canvas action sample listening on http://127.0.0.1:19392 (no AI processing)'));
}
