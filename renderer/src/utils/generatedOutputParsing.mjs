const URL_KEYS = ['url', 'image_url', 'video_url', 'audio_url', 'result_url', 'fileUrl', 'file_url', 'downloadUrl', 'download_url', 'outputUrl', 'output_url', 'assetUrl', 'asset_url', 'resourceUrl', 'resource_url'];
const PREVIEW_URL_KEYS = ['previewUrl', 'preview_url', 'thumbnailUrl', 'thumbnail_url', 'coverUrl', 'cover_url', 'posterUrl', 'poster_url'];
const OBJECT_KEY_KEYS = ['objectKey', 'storageKey', 'key'];
const CHILD_KEYS = ['data', 'output', 'result', 'content', 'text', 'message', 'media', 'artifact', 'artifacts', 'files', 'fileUrls', 'assets', 'outputs', 'images', 'videos', 'audios', 'items'];
const TEXT_KEYS = ['text', 'content', 'message', 'resultText', 'outputText'];

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function pickFirstString(value, keys) {
  for (const key of keys) {
    if (typeof value?.[key] === 'string' && value[key].trim()) return value[key].trim();
  }
  return '';
}

function normalizeFileLike(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const url = pickFirstString(value, URL_KEYS);
  const previewUrl = pickFirstString(value, PREVIEW_URL_KEYS);
  const objectKey = pickFirstString(value, OBJECT_KEY_KEYS);
  const base64Value = value.b64Json ?? value.b64_json;
  const b64Json = typeof base64Value === 'string' && base64Value.trim() ? base64Value.trim() : '';
  const dataUrl = typeof value.dataUrl === 'string' && value.dataUrl.startsWith('data:') ? value.dataUrl : '';
  const downloadEndpoint = value.metadata?.downloadAuth?.endpointPath || '';
  if (!isHttpUrl(url) && !isHttpUrl(previewUrl) && !objectKey && !b64Json && !dataUrl && !downloadEndpoint) return null;
  return {
    url: isHttpUrl(url) ? url : '', previewUrl: isHttpUrl(previewUrl) ? previewUrl : '', objectKey, b64Json, dataUrl,
    name: value.name || value.fileName || value.filename || value.title || '',
    mimeType: value.mimeType || value.contentType || '', resourceType: value.resourceType || value.type || '',
    metadata: value.metadata || null, downloadEndpoint, cloudCache: value.cloudCache || null, raw: value,
  };
}

function collectFiles(value, files = []) {
  if (!value) return files;
  if (typeof value === 'string') {
    if (isHttpUrl(value)) files.push({ url: value.trim() });
    else (value.match(/https?:\/\/[^\s<>()"']+/gi) || []).forEach((url) => files.push({ url: url.replace(/[.,;!?]+$/, '') }));
    return files;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectFiles(item, files));
    return files;
  }
  if (typeof value !== 'object') return files;
  const fileLike = normalizeFileLike(value);
  if (fileLike) files.push(fileLike);
  CHILD_KEYS.forEach((key) => { if (value[key]) collectFiles(value[key], files); });
  return files;
}

export function extractGeneratedFiles(output) {
  const seen = new Set();
  return collectFiles(output).filter((file) => {
    const key = file.url || file.objectKey || file.previewUrl || file.dataUrl || file.b64Json || file.downloadEndpoint;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractGeneratedText(output) {
  if (typeof output === 'string' && output.trim() && !isHttpUrl(output)) return output.trim();
  if (!output || typeof output !== 'object' || Array.isArray(output)) return '';
  for (const key of TEXT_KEYS) {
    if (typeof output[key] === 'string' && output[key].trim()) return output[key].trim();
  }
  return '';
}

/** 成功归档后压缩持久化响应，避免 Base64 媒体重复塞进项目 JSON。 */
export function compactGeneratedOutput(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return null;
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => compactGeneratedOutput(item, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (['b64Json', 'b64_json', 'dataUrl', 'base64'].includes(key) && typeof item === 'string') {
      return [key, `[已归档，原始数据 ${item.length} 字符]`];
    }
    return [key, compactGeneratedOutput(item, seen)];
  }));
}
