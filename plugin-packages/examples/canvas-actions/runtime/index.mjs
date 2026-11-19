import { readFile } from 'node:fs/promises';

function base(context) {
  const url = new URL(context.config.baseUrl);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('This sample only supports a local mock service');
  return url;
}
async function request(path, context, body, method = 'POST') {
  const response = await fetch(new URL(path, base(context)), { method, signal: context.signal,
    headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  if (!response.ok) throw new Error(`Mock service HTTP ${response.status}`);
  return response.json();
}
export async function submit(input, context) {
  const contract = input.processingContract;
  const source = contract.inputs.source[0];
  let bytes;
  if (source.filePath) bytes = await readFile(source.filePath);
  else {
    const response = await fetch(source.url, { signal: context.signal });
    if (!response.ok) throw new Error(`Input HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  return request('/tasks', context, { submissionId: input.submissionId, type: source.type,
    copies: contract.parameters.copies, data: bytes.toString('base64') });
}
export function poll(input, context) { return request(`/tasks/${encodeURIComponent(input.remoteTaskId)}`, context, null, 'GET'); }
export function cancel(input, context) { return request(`/tasks/${encodeURIComponent(input.remoteTaskId)}/cancel`, context, {}); }
