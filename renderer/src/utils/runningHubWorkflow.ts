import { t } from '../i18n/index.ts';
import type { ModelRuntimeContract } from '../domain/catalog/ModelCatalog';
type AnyRecord = Record<string, any>;

export function buildRunningHubMinimaxH3Workflow(template: AnyRecord, input: AnyRecord, contract: Pick<ModelRuntimeContract, 'allowedDurations' | 'inputConstraints' | 'requestTemplate'>) {
  const duration = Number(input.duration);
  if (!contract.allowedDurations.includes(duration)) {
    throw new Error(t("runningHub.invalidDuration", { durations: contract.allowedDurations.join(', ') }));
  }
  const mapping = (contract.requestTemplate as AnyRecord)?.workflowInputs;
  const aspectRatio = mapping?.aspectRatio?.[input.aspectRatio];
  const megapixels = mapping?.resolution?.[input.resolution];
  if (!aspectRatio || !Number.isFinite(megapixels)) {
    throw new Error(t("runningHub.missingWorkflow"));
  }
  for (const kind of ['images', 'videos', 'audios'] as const) {
    const max = contract.inputConstraints[kind]?.max || 0;
    if (input[kind].length > max) throw new Error(t("runningHub.tooManyInputs", { kind, max }));
  }
  if (!String(input.prompt || '').trim() && !input.images.length && !input.videos.length && !input.audios.length) {
    throw new Error(t("runningHub.promptRequired"));
  }

  const workflow: AnyRecord = structuredClone(template);
  workflow['25'].inputs.value = String(input.prompt || '');
  workflow['28'].inputs.value = duration;
  workflow['26'].inputs.aspect_ratio = aspectRatio;
  workflow['26'].inputs.megapixels = megapixels;

  input.images.forEach((fileName: string, index: number) => {
    const nodeId = String(100 + index);
    workflow[nodeId] = {
      inputs: { image: fileName },
      class_type: 'LoadImage',
      _meta: { title: 'Load Image' },
    };
    workflow['31'].inputs[`ref_images.ref_image_${index}`] = [nodeId, 0];
  });
  input.videos.forEach((fileName: string, index: number) => {
    const nodeId = String(120 + index);
    workflow[nodeId] = {
      inputs: {
        video: fileName,
        force_rate: 0,
        custom_width: 0,
        custom_height: 0,
        frame_load_cap: 0,
        skip_first_frames: 0,
        select_every_nth: 1,
      },
      class_type: 'VHS_LoadVideo',
      _meta: { title: 'Load Video (Upload)' },
    };
    workflow['31'].inputs[`ref_videos.ref_video_${index}`] = [nodeId, 0];
  });
  input.audios.forEach((fileName: string, index: number) => {
    const nodeId = String(140 + index);
    workflow[nodeId] = {
      inputs: { audio: fileName },
      class_type: 'LoadAudio',
      _meta: { title: 'Load Audio' },
    };
    workflow['31'].inputs[`ref_audios.ref_audio_${index}`] = [nodeId, 0];
  });
  return workflow;
}

export function runningHubOutputUrl(payload: any) {
  const data = payload?.data ?? payload;
  const outputs = Array.isArray(data)
    ? data
    : Array.isArray(data?.outputs)
      ? data.outputs
      : Array.isArray(data?.results)
        ? data.results
        : [];
  for (const output of outputs) {
    const url = output?.url || output?.fileUrl || output?.videoUrl || output?.video_url
      || output?.downloadUrl || output?.download_url;
    const type = String(output?.outputType || output?.fileType || output?.type || '').toLowerCase();
    if (url && (type === 'mp4' || type === 'video/mp4' || /\.mp4(?:[?#]|$)/i.test(url))) return url;
  }
  return '';
}

function queryText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function runningHubTaskState(payload: any) {
  if (payload?.code !== undefined && Number(payload.code) !== 0) {
    return {
      status: 'failed',
      progress: 0,
      error: queryText(payload.msg) || queryText(payload.message) || queryText(payload.errorMessage) || t('runningHub.queryFailed'),
    };
  }
  const detail: AnyRecord = Array.isArray(payload?.data) ? payload.data[0] : payload?.data || payload || {};
  const errorCode = queryText(payload?.errorCode || detail?.errorCode || detail?.error_code);
  const rawStatus = queryText(payload?.status || detail?.status || detail?.taskStatus || detail?.task_status).toUpperCase();
  const error = queryText(payload?.errorMessage || detail?.errorMessage || detail?.error_message || detail?.error || detail?.failedReason);
  if (errorCode && errorCode !== '0') return { status: 'failed', progress: 0, error: error || errorCode };
  if (['FAILED', 'ERROR', 'CANCELED', 'CANCELLED'].includes(rawStatus) || error) {
    return { status: 'failed', progress: 0, error: error || t("task.failed") };
  }
  const url = runningHubOutputUrl(payload);
  if (['SUCCESS', 'SUCCEEDED', 'COMPLETED'].includes(rawStatus) || url) {
    return url
      ? { status: 'completed', progress: 100, url }
      : { status: 'failed', progress: 100, error: t("runningHub.missingVideo") };
  }
  return {
    status: rawStatus === 'QUEUED' || rawStatus === 'PENDING' ? 'queued' : 'running',
    progress: Number(detail?.progress) || 0,
  };
}
