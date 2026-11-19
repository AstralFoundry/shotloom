import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';

const MAX_INPUT_BYTES = 100 * 1024 * 1024;
function endpoint(context, path) {
  const base = new URL(context.config.baseUrl);
  if (!['https:', 'http:'].includes(base.protocol)) throw new Error('Starrouter requires an HTTP(S) service address');
  return new URL(path, base.origin);
}
async function request(context, path, body, allowEmpty = false) {
  if (!context.config.apiKey) throw new Error('Configure the Starrouter API key in this plugin connection');
  const response = await fetch(endpoint(context, path), {
    method: body === undefined ? 'GET' : 'POST', signal: context.signal,
    headers: { Authorization: `Bearer ${context.config.apiKey}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const data = allowEmpty && !text.trim() && response.ok ? {} : JSON.parse(text);
  if (!response.ok || data.error || data.success === false || data.starrouter_error_source) {
    throw new Error(`Starrouter HTTP ${response.status}: ${data.error?.message || data.message || 'Request failed'}`);
  }
  return data;
}
async function inputVideo(media) {
  if (media?.filePath) {
    const info = await stat(media.filePath);
    if (!info.isFile() || !info.size || info.size > MAX_INPUT_BYTES) throw new Error('Starrouter input video must be a nonempty file no larger than 100 MiB');
    const mime = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska' }[extname(media.filePath).toLowerCase()];
    if (!mime) throw new Error('Use an MP4, MOV, WebM or MKV input video');
    const bytes = await readFile(media.filePath);
    if (!bytes.length || bytes.length > MAX_INPUT_BYTES) throw new Error('Starrouter input video exceeds the 100 MiB limit');
    return `data:${mime};base64,${bytes.toString('base64')}`;
  }
  const url = new URL(media?.url);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Starrouter requires a public HTTP(S) video URL');
  return url.toString();
}
function normalize(data, input) {
  const id = data.id;
  if (typeof id !== 'string' || !id || (input.remoteTaskId && id !== input.remoteTaskId)) throw new Error('Starrouter returned an invalid task ID');
  const status = ({ pending: 'queued', queued: 'queued', running: 'running', processing: 'running', in_progress: 'running',
    completed: 'completed', failed: 'failed', canceled: 'cancelled', cancelled: 'cancelled' })[data.status];
  if (!status) throw new Error(`Unknown Starrouter task status: ${String(data.status)}`);
  return {
    remoteTaskId: id, status, progress: Number.isFinite(data.progress) ? data.progress : 0,
    ...(data.error ? { error: data.error.message || data.error.code || 'Starrouter task failed' } : {}),
    ...(status === 'completed' ? { result: { outputs: { result: [{ mimeType: 'video/mp4', name: 'upscaled.mp4',
      metadata: { downloadAuth: { providerId: input.processingContract.connectionId,
        endpointPath: `/comfly/v1/videos/${encodeURIComponent(id)}/content`, endpointScope: 'origin', endpointMethod: 'GET', auth: { type: 'bearer' } } },
    }] } } } : {}),
  };
}
export async function submit(input, context) {
  const contract = input.processingContract;
  if (contract.capability.id !== 'video-upscale') throw new Error('Unknown Starrouter processing capability');
  const input_video = await inputVideo(contract.inputs.source[0]);
  // Starrouter does not document submission-key idempotency. The native host journals
  // this submission before dispatch and never automatically repeats an uncertain POST.
  return normalize(await request(context, '/comfly/v1/videos', { model: 'comfly/1849', metadata: { input_video } }), input);
}
export async function poll(input, context) {
  return normalize(await request(context, `/comfly/v1/videos/${encodeURIComponent(input.remoteTaskId)}`), input);
}
export async function cancel(input, context) {
  await request(context, `/comfly/v1/videos/${encodeURIComponent(input.remoteTaskId)}/cancel`, {}, true);
  // An accepted cancellation request is not proof that execution stopped.
  return poll(input, context);
}
