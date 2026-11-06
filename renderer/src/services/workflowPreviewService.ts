/**
 * 工作流模板缩略图：保存时取一张小图，管理页与模板卡片用它展示流程。
 *
 * 只保留压缩后的 JPEG data URL（或纯元信息），不复制原始媒体：
 * 图片缩到 160px 宽，视频复用已有的胶片带首帧，音频/文本只留标签。
 * 任何一步超时或解码失败都返回空，不让缩略图拖垮保存。
 */

import { desktopApi } from '@/services/desktopApi';
import { mediaPosterUrl } from '@/services/mediaPoster';
import type { WorkflowNodePreview } from '@/domain/workflow/types';

type AnyRecord = Record<string, any>;

const MAX_WIDTH = 160;
const IMAGE_TIMEOUT_MS = 1500;

export interface PreviewSource {
  nodeId: string;
  kind: WorkflowNodePreview['kind'];
  label?: string;
  sourceFile?: string;
  sourceUrl?: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(fallback); }
    }, ms);
    promise.then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(fallback);
    });
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image-decode-failed'));
    image.src = url;
  });
}

async function imageThumbnail(source: PreviewSource): Promise<string> {
  let objectUrl = '';
  try {
    let url = String(source.sourceUrl || '');
    if (source.sourceFile) {
      const bytes = await desktopApi.file.readArrayBuffer(source.sourceFile).catch(() => null);
      if (bytes && bytes.byteLength) {
        objectUrl = URL.createObjectURL(new Blob([bytes as unknown as BlobPart]));
        url = objectUrl;
      }
    }
    if (!url) return '';
    const image = await withTimeout(loadImage(url), IMAGE_TIMEOUT_MS, null as unknown as HTMLImageElement);
    if (!image) return '';
    const ratio = image.naturalHeight / Math.max(1, image.naturalWidth);
    const width = Math.min(MAX_WIDTH, image.naturalWidth || MAX_WIDTH);
    const height = Math.max(1, Math.round(width * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return '';
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.6);
  } catch {
    return '';
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/** 单个节点的缩略图；失败返回仅含元信息的 preview（保证流程条仍有占位）。 */
export async function captureNodePreview(source: PreviewSource): Promise<WorkflowNodePreview> {
  const base: WorkflowNodePreview = {
    kind: source.kind,
    ...(source.label ? { label: source.label } : {}),
  };
  if (source.kind === 'audio' || source.kind === 'text') return base;
  if (source.kind === 'video') {
    const posterSource = {
      ...(source.sourceFile ? { sourceFile: source.sourceFile } : {}),
      ...(source.sourceUrl ? { sourceUrl: source.sourceUrl } : {}),
    };
    const poster = await withTimeout(
      mediaPosterUrl(posterSource).catch(() => ''),
      IMAGE_TIMEOUT_MS * 2,
      '',
    );
    return poster ? { ...base, dataUrl: poster } : base;
  }
  const dataUrl = await imageThumbnail(source);
  return dataUrl ? { ...base, dataUrl } : base;
}

export function previewSourceForNode(node: AnyRecord, materials: AnyRecord[]): Omit<PreviewSource, 'kind'> & { kind: PreviewSource['kind'] } {
  const kind: WorkflowNodePreview['kind'] = node.type === 'videoGeneration' || String(node.resourceType || '').includes('video') ? 'video'
    : node.type === 'audioGeneration' || String(node.resourceType || '').includes('audio') ? 'audio'
      : node.type === 'textGeneration' ? 'text' : 'image';
  const material = materials.find((item) => String(item.id) === String(node.materialId));
  const output = Array.isArray(node.generatedOutputs) ? node.generatedOutputs[0] : null;
  const uploaded = node.uploadedFile || {};
  return {
    nodeId: String(node.id),
    kind,
    label: String(node.title || material?.name || uploaded.name || ''),
    ...(material?.path || uploaded.filePath || output?.filePath
      ? { sourceFile: String(material?.path || uploaded.filePath || output?.filePath) }
      : {}),
    ...(material?.url || uploaded.url || output?.url || output?.previewUrl || node.previewUrl
      ? { sourceUrl: String(material?.url || uploaded.url || output?.url || output?.previewUrl || node.previewUrl) }
      : {}),
  };
}
