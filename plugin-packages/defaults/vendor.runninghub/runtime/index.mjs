import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { buildRunningHubMinimaxH3Workflow, runningHubTaskState } from './workflow.mjs';
import { createTranslator } from './messages.mjs';
const template = JSON.parse(await readFile(new URL('./workflow.json', import.meta.url), 'utf8'));
const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
async function request(path, context, body, multipart = false) {
  const url = new URL(path, context.config.baseUrl);
  const response = await fetch(url, { method: 'POST', signal: context.signal,
    headers: multipart ? { Authorization: `Bearer ${context.config.apiKey || ''}` } : { Authorization: `Bearer ${context.config.apiKey || ''}`, 'Content-Type': 'application/json' },
    body: multipart ? body : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`RunningHub HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.code !== undefined && Number(payload.code) !== 0) throw new Error(payload.msg || payload.message || payload.errorMessage || `RunningHub code ${payload.code}`);
  return payload;
}
async function upload(ref, context) {
  const mimeType = ref.mimeType || mimeTypes[extname(ref.filePath || ref.fileName || '').toLowerCase()] || 'application/octet-stream';
  const source = ref.remoteUrl || ref.url || ref.previewUrl;
  let blob;
  if (ref.filePath) blob = new Blob([await readFile(ref.filePath)], { type: mimeType });
  else if (source) {
    const response = await fetch(source, { signal: context.signal });
    if (!response.ok) throw new Error(`RunningHub input download HTTP ${response.status}`);
    blob = await response.blob();
  } else throw new Error('RunningHub input requires a local file or accessible URL');
  const data = new FormData(); data.append('file', blob, ref.fileName || basename(ref.filePath || 'asset.bin'));
  const response = await request('/openapi/v2/media/upload/binary', context, data, true);
  if (!response.data?.fileName) throw new Error('RunningHub upload did not return fileName');
  return response.data.fileName;
}
export async function submit(input, context) {
  const images = [], videos = [], audios = [];
  for (const [kind, target] of [['images', images], ['videos', videos], ['audios', audios]]) {
    for (const ref of input.modelInputs?.[kind] || []) target.push(await upload(ref, context));
  }
  const contract = input.modelContract;
  const params = input.params || {};
  const workflow = buildRunningHubMinimaxH3Workflow(template, {
    prompt: input.prompt, duration: params.duration || input.duration || contract.defaultDuration,
    aspectRatio: params.aspectRatio || input.aspectRatio, resolution: params.resolution || input.resolution, images, videos, audios,
  }, contract, createTranslator(context.config.locale));
  const workflowId = contract.requestTemplate?.workflowId;
  if (!workflowId) throw new Error('RunningHub workflowId is missing from the operation');
  const payload = await request(contract.endpoint.path, context, { workflowId, workflow: JSON.stringify(workflow), addMetadata: false, apiKey: context.config.apiKey });
  if (!payload.data?.taskId) throw new Error('RunningHub did not return taskId');
  return { remoteTaskId: payload.data.taskId, status: 'queued', progress: 0, raw: payload };
}
export async function poll(input, context) {
  const payload = await request(input.modelContract.taskEndpoint.path, context, { taskId: input.remoteTaskId });
  const state = runningHubTaskState(payload, createTranslator(context.config.locale));
  return { remoteTaskId: input.remoteTaskId, status: state.status, progress: state.progress, ...(state.error ? { error: state.error } : {}),
    ...(state.url ? { result: { files: [{ url: state.url, name: 'result.mp4', mimeType: 'video/mp4' }], raw: payload } } : {}),
  };
}
