import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { submit, poll, cancel } from '../plugin-packages/vendor.starrouter/runtime/index.mjs';

test('Starrouter 1849 submits a local video Data URL and returns credential-free authenticated download metadata', async t => {
  const root = mkdtempSync(join(tmpdir(), 'shotloom-starrouter-processing-'));
  const video = join(root, 'source.mp4');
  const bytes = Buffer.from('transport fixture, not an encoded video'); writeFileSync(video, bytes);
  const requests = [];
  let state = 'running';
  const server = createHttpServer(async (request, response) => {
    assert.equal(request.headers.authorization, 'Bearer test-key');
    let body = ''; for await (const chunk of request) body += chunk;
    requests.push({ path: request.url, method: request.method, ...(body ? { body: JSON.parse(body) } : {}) });
    response.setHeader('Content-Type', 'application/json');
    if (request.url.endsWith('/cancel')) state = 'cancelled';
    response.end(JSON.stringify({ id: 'task_1849', status: state, progress: 35 }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true, force: true }); });
  const context = { config: { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${server.address().port}/v1` } };
  const input = { submissionId: 'test-submission', processingContract: { connectionId: 'starrouter.processing',
    capability: { id: 'video-upscale' }, inputs: { source: [{ filePath: video }] } } };
  const submitted = await submit(input, context);
  assert.equal(submitted.remoteTaskId, 'task_1849');
  assert.deepEqual(requests[0], { path: '/comfly/v1/videos', method: 'POST', body: {
    model: 'comfly/1849', metadata: { input_video: `data:video/mp4;base64,${bytes.toString('base64')}` },
  } });
  const query = { ...input, remoteTaskId: submitted.remoteTaskId };
  state = 'completed';
  const completed = await poll(query, context);
  assert.equal(completed.status, 'completed');
  assert.deepEqual(completed.result.outputs.result[0].metadata.downloadAuth, {
    providerId: 'starrouter.processing', endpointPath: '/comfly/v1/videos/task_1849/content', endpointScope: 'origin',
    endpointMethod: 'GET', auth: { type: 'bearer' },
  });
  assert.equal(JSON.stringify(completed).includes('test-key'), false);
  assert.equal((await cancel(query, context)).status, 'cancelled');
  assert.deepEqual(requests.slice(-2).map(r => [r.method, r.path]), [
    ['POST', '/comfly/v1/videos/task_1849/cancel'], ['GET', '/comfly/v1/videos/task_1849'],
  ]);
});

test('Starrouter runtime rejects malformed task receipts and reports HTTP 200 error envelopes', async t => {
  const input = { remoteTaskId: 'task_original', processingContract: { connectionId: 'starrouter.processing' } };
  const context = { config: { apiKey: 'test-key', baseUrl: 'https://starrouter.io' } };
  const fetchMock = t.mock.method(globalThis, 'fetch');
  for (const [body, error] of [
    [{ id: 'task_other', status: 'completed' }, /invalid task ID/],
    [{ id: 'task_original', status: 'invented' }, /Unknown Starrouter task status/],
    [{ error: { message: 'Model permission denied' } }, /Model permission denied/],
  ]) {
    fetchMock.mock.mockImplementationOnce(async () => new Response(JSON.stringify(body), { status: 200 }));
    await assert.rejects(poll(input, context), error);
  }
});
