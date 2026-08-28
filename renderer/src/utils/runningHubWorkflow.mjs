const ASPECT_RATIO_INPUTS = {
  '16:9': '16:9 (Widescreen)',
  '9:16': '9:16 (Portrait Widescreen)',
};

const RESOLUTION_MEGAPIXELS = {
  '480p': 0.4,
  '720p': 0.9,
  '1K': 1,
  '2K': 2,
};

export function buildRunningHubMinimaxH3Workflow(template, input) {
  const duration = Number(input.duration);
  if (!Number.isInteger(duration) || duration < 5 || duration > 15) {
    throw new Error('RunningHub MiniMax H3 时长必须为 5–15 秒');
  }
  if (!ASPECT_RATIO_INPUTS[input.aspectRatio]) {
    throw new Error('RunningHub MiniMax H3 仅支持 16:9 或 9:16');
  }
  if (!RESOLUTION_MEGAPIXELS[input.resolution]) {
    throw new Error('RunningHub MiniMax H3 分辨率必须为 480p、720p、1K 或 2K');
  }
  if (input.images.length > 9 || input.videos.length > 2 || input.audios.length > 2) {
    throw new Error('RunningHub MiniMax H3 最多支持 9 张图片、2 段视频和 2 段音频');
  }
  if (!String(input.prompt || '').trim() && !input.images.length && !input.videos.length && !input.audios.length) {
    throw new Error('RunningHub MiniMax H3 纯文本生成必须提供提示词');
  }

  const workflow = structuredClone(template);
  workflow['25'].inputs.value = String(input.prompt || '');
  workflow['28'].inputs.value = duration;
  workflow['26'].inputs.aspect_ratio = ASPECT_RATIO_INPUTS[input.aspectRatio];
  workflow['26'].inputs.megapixels = RESOLUTION_MEGAPIXELS[input.resolution];

  input.images.forEach((fileName, index) => {
    const nodeId = String(100 + index);
    workflow[nodeId] = {
      inputs: { image: fileName },
      class_type: 'LoadImage',
      _meta: { title: 'Load Image' },
    };
    workflow['31'].inputs[`ref_images.ref_image_${index}`] = [nodeId, 0];
  });
  input.videos.forEach((fileName, index) => {
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
  input.audios.forEach((fileName, index) => {
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

export function runningHubOutputUrl(payload) {
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

function queryText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function runningHubTaskState(payload) {
  if (payload?.code !== undefined && Number(payload.code) !== 0) {
    return {
      status: 'failed',
      progress: 0,
      error: queryText(payload.msg) || queryText(payload.message) || queryText(payload.errorMessage) || '任务查询失败',
    };
  }
  const detail = Array.isArray(payload?.data) ? payload.data[0] : payload?.data || payload || {};
  const errorCode = queryText(payload?.errorCode || detail?.errorCode || detail?.error_code);
  const rawStatus = queryText(payload?.status || detail?.status || detail?.taskStatus || detail?.task_status).toUpperCase();
  const error = queryText(payload?.errorMessage || detail?.errorMessage || detail?.error_message || detail?.error || detail?.failedReason);
  if (errorCode && errorCode !== '0') return { status: 'failed', progress: 0, error: error || errorCode };
  if (['FAILED', 'ERROR', 'CANCELED', 'CANCELLED'].includes(rawStatus) || error) {
    return { status: 'failed', progress: 0, error: error || '任务失败' };
  }
  const url = runningHubOutputUrl(payload);
  if (['SUCCESS', 'SUCCEEDED', 'COMPLETED'].includes(rawStatus) || url) {
    return url
      ? { status: 'completed', progress: 100, url }
      : { status: 'failed', progress: 100, error: '任务完成但未返回 MP4 视频' };
  }
  return {
    status: rawStatus === 'QUEUED' || rawStatus === 'PENDING' ? 'queued' : 'running',
    progress: Number(detail?.progress) || 0,
  };
}
