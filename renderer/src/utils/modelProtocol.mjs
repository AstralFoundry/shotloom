const TEMPLATE_RE = /^{{\s*([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_-]+)*)\s*}}$/;
const BLOCKED_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function readProtocolPath(value, path = '') {
  let current = [value];
  for (const segment of String(path).split('.').filter(Boolean)) {
    if (BLOCKED_SEGMENTS.has(segment)) return [];
    const next = [];
    for (const item of current) {
      if (segment === '*' && Array.isArray(item)) next.push(...item);
      else if (Array.isArray(item) && /^\d+$/.test(segment)) {
        if (item[Number(segment)] !== undefined) next.push(item[Number(segment)]);
      } else if (isRecord(item) && Object.hasOwn(item, segment)) next.push(item[segment]);
    }
    current = next;
  }
  return current;
}

export function firstProtocolValue(value, path = '') {
  return readProtocolPath(value, path)[0];
}

export function renderProtocolTemplate(value, variables = {}) {
  if (typeof value === 'string') {
    const match = TEMPLATE_RE.exec(value);
    if (!match) return value;
    const resolved = firstProtocolValue(variables, match[1]);
    return resolved === undefined ? undefined : structuredClone(resolved);
  }
  if (Array.isArray(value)) {
    return value.map(item => renderProtocolTemplate(item, variables)).filter(item => item !== undefined);
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      const rendered = renderProtocolTemplate(item, variables);
      return rendered === undefined ? [] : [[key, rendered]];
    }));
  }
  return value;
}

export function protocolMessageVariables(messages = []) {
  const values = Array.isArray(messages) ? messages : [];
  const system = values
    .filter(message => message?.role === 'system' && typeof message.content === 'string')
    .map(message => message.content.trim()).filter(Boolean).join('\n\n');
  return {
    messages: values,
    nonSystemMessages: values.filter(message => message?.role !== 'system'),
    system: system || undefined,
  };
}

/**
 * Compile a provider-neutral multimodal content array. Provider-specific type
 * and role names are supplied by the model catalog.
 * @param {{
 *   prompt?: unknown,
 *   imageUrls?: string[], imageItems?: Array<{url:string, role?:string}>, imageType?: unknown, imageRole?: unknown,
 *   videoUrls?: string[], videoType?: unknown, videoRole?: unknown,
 *   audioUrls?: string[], audioType?: unknown, audioRole?: unknown
 * }} options
 */
export function protocolMediaContent({
  prompt = '',
  imageUrls = [], imageItems = [], imageType = 'image_url', imageRole = '',
  videoUrls = [], videoType = 'video_url', videoRole = '',
  audioUrls = [], audioType = 'audio_url', audioRole = '',
} = {}) {
  const text = typeof prompt === 'string' ? prompt.trim() : '';
  const mediaItems = (urls, type, role, field) => {
    const normalizedType = typeof type === 'string' && type.trim() ? type.trim() : field;
    const normalizedRole = typeof role === 'string' ? role.trim() : '';
    return (Array.isArray(urls) ? urls : [])
      .filter(url => typeof url === 'string' && url.trim())
      .map(url => ({
        type: normalizedType,
        [field]: { url: url.trim() },
        ...(normalizedRole ? { role: normalizedRole } : {}),
      }));
  };
  const normalizedImageType = typeof imageType === 'string' && imageType.trim() ? imageType.trim() : 'image_url';
  const compiledImageItems = Array.isArray(imageItems) && imageItems.length
    ? imageItems.filter(item => item?.url).map(item => ({
      type: normalizedImageType,
      image_url: { url: item.url.trim() },
      ...(item.role ? { role: String(item.role).trim() } : {}),
    }))
    : mediaItems(imageUrls, imageType, imageRole, 'image_url');
  return [
    ...(text ? [{ type: 'text', text }] : []),
    ...compiledImageItems,
    ...mediaItems(videoUrls, videoType, videoRole, 'video_url'),
    ...mediaItems(audioUrls, audioType, audioRole, 'audio_url'),
  ];
}

export function protocolInlineImage(value) {
  if (typeof value !== 'string') return undefined;
  const match = /^data:([^;,]+);base64,([a-zA-Z0-9+/=\s]+)$/.exec(value.trim());
  if (!match) return undefined;
  return {
    bytesBase64Encoded: match[2].replace(/\s+/g, ''),
    mimeType: match[1].toLowerCase(),
  };
}

/**
 * Compile Kling API 2.0's typed `contents` array.
 * `first_frame` is used by the regular image-to-video endpoints, while
 * `refer_image` is used by Kling Omni's multi-reference endpoint.
 * @param {{ prompt?: unknown, imageUrls?: string[], imageType?: string }} options
 */
export function protocolKlingContents({ prompt = '', imageUrls = [], imageType = 'first_frame' } = {}) {
  const text = typeof prompt === 'string' ? prompt.trim() : '';
  const urls = Array.isArray(imageUrls)
    ? imageUrls.filter(url => typeof url === 'string' && url.trim()).map(url => url.trim())
    : [];
  const referenceImages = imageType === 'refer_image';
  return [
    ...(text ? [{ type: 'prompt', text }] : []),
    ...urls.map((url, index) => ({
      type: referenceImages ? 'refer_image' : 'first_frame',
      url,
      ...(referenceImages ? { id: `image_${index + 1}` } : {}),
    })),
  ];
}

export function normalizeProtocolResponse(data, protocol = {}) {
  const urls = protocol.resultUrlPath
    ? readProtocolPath(data, protocol.resultUrlPath).filter(value => typeof value === 'string' && /^https?:\/\//i.test(value))
    : [];
  const textValue = protocol.resultTextPath ? firstProtocolValue(data, protocol.resultTextPath) : undefined;
  const base64Values = protocol.resultBase64Path
    ? readProtocolPath(data, protocol.resultBase64Path).filter(value => typeof value === 'string' && value.trim())
    : [];
  const downloadMetadata = protocol.resultDownloadAuth ? {
    downloadAuth: {
      providerId: protocol.provider,
      headers: protocol.headers,
      auth: protocol.auth,
    },
  } : undefined;
  return {
    ...(urls.length || base64Values.length ? {
      files: [
        ...urls.map(url => ({ url, ...(downloadMetadata ? { metadata: downloadMetadata } : {}) })),
        ...base64Values.map(b64Json => ({ b64Json })),
      ],
      ...(urls[0] ? { url: urls[0] } : {}),
    } : {}),
    ...(typeof textValue === 'string' && textValue.trim() ? { text: textValue.trim() } : {}),
    raw: data,
  };
}
