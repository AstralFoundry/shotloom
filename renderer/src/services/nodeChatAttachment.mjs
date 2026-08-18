const IMAGE_MIME_BY_EXTENSION = {
  avif: 'image/avif',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function value(source, ...keys) {
  for (const key of keys) {
    const item = source?.[key];
    if (typeof item === 'string' && item.trim()) return item.trim();
  }
  return '';
}

function imageMime(source, location) {
  const declared = value(source, 'mimeType', 'type').toLowerCase();
  if (declared.startsWith('image/')) return declared;
  const dataMime = location.match(/^data:(image\/[^;,]+)/i)?.[1];
  if (dataMime) return dataMime.toLowerCase();
  const extension = location.split(/[?#]/)[0].split('.').pop()?.toLowerCase() || '';
  if (IMAGE_MIME_BY_EXTENSION[extension]) return IMAGE_MIME_BY_EXTENSION[extension];
  const resourceType = value(source, 'resourceType', 'mediaType').toLowerCase();
  return resourceType === 'image' ? 'image/png' : '';
}

function attachmentFromCandidate(candidate, node) {
  if (!candidate || typeof candidate !== 'object') return null;
  const path = value(candidate, 'filePath', 'path');
  const rawUrl = value(candidate, 'url', 'previewUrl', 'resourceUrl');
  const location = path || rawUrl;
  if (!location) return null;
  const mimeType = imageMime(candidate, location);
  if (!mimeType) return null;
  const remote = /^(?:data:|https?:\/\/)/i.test(rawUrl) ? rawUrl : '';
  const filePath = path || (!remote ? rawUrl : '');
  const fallbackName = location.split(/[\\/]/).pop()?.split(/[?#]/)[0] || 'canvas-image.png';
  const fileName = value(candidate, 'fileName', 'name', 'title')
    || value(node, 'title')
    || fallbackName;
  return {
    name: fileName,
    fileName,
    mimeType,
    resourceType: 'image',
    nodeId: value(node, 'id'),
    ...(filePath ? { path: filePath, filePath } : {}),
    ...(remote ? { url: remote } : {}),
  };
}

/** Resolve the image currently shown by a canvas node into a Copilot attachment. */
export function resolveNodeChatImageAttachment(node) {
  if (!node || typeof node !== 'object') return null;
  const outputs = Array.isArray(node.generatedOutputs) ? node.generatedOutputs : [];
  const selectedOutput = outputs.find((item) => item?.selected) || outputs[0];
  const candidates = [selectedOutput, node.uploadedFile, node];
  for (const candidate of candidates) {
    const attachment = attachmentFromCandidate(candidate, node);
    if (attachment) return attachment;
  }
  return null;
}

export function nodeChatAttachmentKey(attachment) {
  return value(attachment, 'filePath', 'path', 'url', 'fileName', 'name');
}
