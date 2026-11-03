import { t } from '../i18n/index.ts';
import { isRecord } from './typeGuards.ts';
// 供应商协议是目录里的松散 JSON；本模块只按声明的路径模板读写，不做语义猜测。
type AnyRecord = Record<string, any>;

const TEMPLATE_RE = /^{{\s*([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_-]+)*)\s*}}$/;
const PLACEHOLDER_RE = /{{\s*([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_-]+)*)\s*}}/g;
const BLOCKED_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);

export function readProtocolPath(value: unknown, path = ''): unknown[] {
  let current: unknown[] = [value];
  for (const segment of String(path).split('.').filter(Boolean)) {
    if (BLOCKED_SEGMENTS.has(segment)) return [];
    const next: unknown[] = [];
    for (const item of current) {
      if (segment === '*' && Array.isArray(item)) next.push(...item);
      else if (Array.isArray(item) && /^\d+$/.test(segment)) {
        if (item[Number(segment)] !== undefined) next.push(item[Number(segment)]);
      } else if (isRecord(item) && Object.hasOwn(item as object, segment)) next.push((item as AnyRecord)[segment]);
    }
    current = next;
  }
  return current;
}

export function firstProtocolValue(value: unknown, path = '') {
  return readProtocolPath(value, path)[0];
}

export function renderProtocolTemplate(value: unknown, variables: AnyRecord = {}): unknown {
  if (typeof value === 'string') {
    const whole = TEMPLATE_RE.exec(value);
    if (whole) {
      const resolved = firstProtocolValue(variables, whole[1] as string);
      return resolved === undefined ? undefined : structuredClone(resolved);
    }
    if (!value.includes('{{')) return value;
    let missing = false;
    const rendered = value.replace(PLACEHOLDER_RE, (_placeholder: string, path: string) => {
      const resolved = firstProtocolValue(variables, path);
      if (resolved === undefined) { missing = true; return ''; }
      return String(resolved);
    });
    return missing ? undefined : rendered;
  }
  if (Array.isArray(value)) {
    return value.map(item => renderProtocolTemplate(item, variables)).filter(item => item !== undefined);
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value as AnyRecord).flatMap(([key, item]) => {
      const rendered = renderProtocolTemplate(item, variables);
      return rendered === undefined ? [] : [[key, rendered]];
    }));
  }
  return value;
}

export function protocolMessageVariables(messages: AnyRecord[] = []) {
  const values = Array.isArray(messages) ? messages : [];
  const system = values
    .filter(message => message?.role === 'system' && typeof message.content === 'string')
    .map(message => String(message.content).trim()).filter(Boolean).join('\n\n');
  return {
    messages: values,
    nonSystemMessages: values.filter(message => message?.role !== 'system'),
    system: system || undefined,
  };
}

/**
 * Compile a provider's media content array from its declarative item templates
 * (mode.contentTemplate). Each media ref renders one item; the text item renders
 * once when a prompt is present. Per-slot roles are resolved upstream, so item
 * templates only reference {{url}} / {{role}} / {{slot}} / {{index}}.
 */
export function renderProtocolContentTemplate(
  contentTemplate: unknown,
  { text = '', images = [], videos = [], audios = [] }: {
    text?: unknown;
    images?: Array<{ url: string; role?: string; slot?: string }>;
    videos?: Array<{ url: string; role?: string; slot?: string }>;
    audios?: Array<{ url: string; role?: string; slot?: string }>;
  } = {},
) {
  if (!contentTemplate) return undefined;
  const template = contentTemplate as AnyRecord;
  const items: unknown[] = [];
  const prompt = typeof text === 'string' ? text.trim() : '';
  if (template.text !== undefined && prompt) {
    const rendered = renderProtocolTemplate(template.text, { text: prompt });
    if (rendered !== undefined) items.push(rendered);
  }
  for (const [index, ref] of images.entries()) {
    if (!ref?.url) continue;
    const inlineImage = protocolInlineImage(ref.url);
    const rendered = renderProtocolTemplate(template.image, {
      url: ref.url,
      inlineData: inlineImage ? { mimeType: inlineImage.mimeType, data: inlineImage.bytesBase64Encoded } : undefined,
      role: ref.role || undefined, slot: ref.slot || undefined, index: index + 1,
    });
    if (rendered !== undefined) items.push(rendered);
  }
  for (const [index, ref] of videos.entries()) {
    if (!ref?.url) continue;
    const rendered = renderProtocolTemplate(template.video, {
      url: ref.url, role: ref.role || undefined, slot: ref.slot || undefined, index: index + 1,
    });
    if (rendered !== undefined) items.push(rendered);
  }
  for (const [index, ref] of audios.entries()) {
    if (!ref?.url) continue;
    const rendered = renderProtocolTemplate(template.audio, {
      url: ref.url, role: ref.role || undefined, slot: ref.slot || undefined, index: index + 1,
    });
    if (rendered !== undefined) items.push(rendered);
  }
  return items.length ? items : undefined;
}

export function protocolInlineImage(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const match = /^data:([^;,]+);base64,([a-zA-Z0-9+/=\s]+)$/.exec(value.trim());
  if (!match) return undefined;
  return {
    bytesBase64Encoded: (match[2] as string).replace(/\s+/g, ''),
    mimeType: (match[1] as string).toLowerCase(),
  };
}

export function normalizeProtocolResponse(data: any, protocol: AnyRecord = {}) {
  const configuredMimeType = String(protocol.resultMimeType || '').trim();
  const configuredExtension = String(protocol.resultFileExtension || '').trim().replace(/^\./, '');
  const fileMetadata: AnyRecord = {
    ...(configuredMimeType ? { mimeType: configuredMimeType } : {}),
    ...(configuredExtension ? { name: `result.${configuredExtension}` } : {}),
  };
  const urls: string[] = protocol.resultUrlPath
    ? readProtocolPath(data, protocol.resultUrlPath).filter((value: unknown) => typeof value === 'string' && /^https?:\/\//i.test(value)) as string[]
    : [];
  const textValue = protocol.resultTextPath ? firstProtocolValue(data, protocol.resultTextPath) : undefined;
  const base64Values = protocol.resultBase64Path
    ? readProtocolPath(data, protocol.resultBase64Path).filter((value: unknown) => typeof value === 'string' && value.trim())
    : [];
  const hexValues = protocol.resultHexPath
    ? readProtocolPath(data, protocol.resultHexPath)
      .filter((value: unknown) => typeof value === 'string' && value.trim())
      .map(protocolHexToBase64)
    : [];
  const responseBodyBase64 = protocol.resultBody?.encoding === 'binary'
    && typeof data?.__responseBodyBase64 === 'string'
    && data.__responseBodyBase64.trim()
    ? data.__responseBodyBase64.trim()
    : '';
  const responseMimeType = String(data?.__responseContentType || '').split(';')[0]?.trim() || '';
  const responseBodyFile = responseBodyBase64 ? {
    b64Json: responseBodyBase64,
    mimeType: protocol.resultBody.mimeType || responseMimeType || 'application/octet-stream',
    name: `result.${String(protocol.resultBody.fileExtension || 'bin').replace(/^\./, '')}`,
  } : null;
  const downloadMetadata = protocol.resultDownloadAuth ? {
    downloadAuth: {
      providerId: protocol.provider,
      headers: protocol.headers,
      auth: protocol.auth,
    },
  } : undefined;
  const inlineResultPaths: string[] = [protocol.resultBase64Path, protocol.resultHexPath].filter(Boolean);
  if (responseBodyBase64) inlineResultPaths.push('__responseBodyBase64');
  return {
    ...(urls.length || base64Values.length || hexValues.length || responseBodyFile ? {
      files: [
        ...urls.map(url => ({ url, ...fileMetadata, ...(downloadMetadata ? { metadata: downloadMetadata } : {}) })),
        ...base64Values.map(b64Json => ({ b64Json, ...fileMetadata })),
        ...hexValues.map(b64Json => ({ b64Json, ...fileMetadata })),
        ...(responseBodyFile ? [responseBodyFile] : []),
      ],
      ...(urls[0] ? { url: urls[0] } : {}),
    } : {}),
    ...(typeof textValue === 'string' && textValue.trim() ? { text: textValue.trim() } : {}),
    raw: redactProtocolResultValues(data, inlineResultPaths),
  };
}

function redactProtocolResultValues(data: unknown, paths: string[]) {
  let result = data;
  for (const path of paths) {
    result = redactProtocolPath(result, String(path).split('.'), 0);
  }
  return result;
}

function redactProtocolPath(value: unknown, segments: string[], index: number): unknown {
  if (index >= segments.length) return '[媒体数据已提取]';
  if (value === null || value === undefined) return value;
  const segment = segments[index] as string;
  if (Array.isArray(value)) {
    if (segment === '*') return value.map(item => redactProtocolPath(item, segments, index + 1));
    const position = Number(segment);
    if (!Number.isInteger(position) || position < 0 || position >= value.length) return value;
    const copy = [...value];
    copy[position] = redactProtocolPath(copy[position], segments, index + 1);
    return copy;
  }
  if (typeof value !== 'object' || !Object.hasOwn(value, segment)) return value;
  return {
    ...(value as AnyRecord),
    [segment]: redactProtocolPath((value as AnyRecord)[segment], segments, index + 1),
  };
}

export function protocolHexToBase64(value: unknown) {
  const hex = String(value || '').replace(/\s+/g, '');
  if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error(t("model.response.invalidHexMedia"));
  }
  let binary = '';
  for (let offset = 0; offset < hex.length; offset += 2) {
    binary += String.fromCharCode(Number.parseInt(hex.slice(offset, offset + 2), 16));
  }
  return btoa(binary);
}

export function protocolResultEndpointFile(protocol: AnyRecord = {}, remoteTaskId = '', raw: AnyRecord = {}) {
  const endpoint = protocol.resultEndpoint;
  if (!endpoint?.path) return null;
  const encodedTaskId = String(remoteTaskId).split('/').map(encodeURIComponent).join('/');
  return {
    files: [{
      name: `result.${endpoint.fileExtension || 'bin'}`,
      mimeType: endpoint.mimeType || 'application/octet-stream',
      metadata: {
        downloadAuth: {
          providerId: protocol.provider,
          endpointPath: endpoint.path.replace('{taskId}', encodedTaskId),
          endpointScope: endpoint.scope || 'root',
          endpointMethod: endpoint.method || 'GET',
          headers: protocol.headers,
          auth: protocol.auth,
        },
      },
    }],
    raw,
  };
}
