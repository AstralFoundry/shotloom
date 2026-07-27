import { desktopApi } from '@/services/desktopApi';
import { uid } from '@/utils/format';

const processedImageCache = new Map();

function sourceKey(ref = {}) {
  return String(ref.filePath || ref.remoteUrl || ref.url || ref.previewUrl || ref.materialId || ref.nodeId || '');
}

function preferredName(prefix, ref = {}) {
  const base = String(ref.fileName || ref.title || 'image')
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]+/g, '-')
    .slice(0, 40) || 'image';
  return `${prefix}-${base}-${uid().slice(0, 8)}.png`;
}

async function localSourcePath(ref) {
  if (ref.filePath) return ref.filePath;
  const remoteUrl = String(ref.remoteUrl || ref.url || ref.previewUrl || '');
  if (!/^https?:\/\//i.test(remoteUrl)) {
    throw new Error(`${ref.title || ref.fileName || '图片'}没有可读取的本地文件或远程地址`);
  }
  const downloaded = await desktopApi.file.downloadUrlToProject(
    remoteUrl,
    preferredName('video-input-source', ref),
  );
  const path = downloaded?.filePath || downloaded?.path || '';
  if (!path) throw new Error(`${ref.title || ref.fileName || '图片'}下载到本地失败`);
  return path;
}

async function preprocessImageRef(ref = {}) {
  const key = sourceKey(ref);
  if (!key) throw new Error('视频图片输入缺少可处理的文件引用');
  if (!processedImageCache.has(key)) {
    processedImageCache.set(key, (async () => {
      const source = await localSourcePath(ref);
      const file = await desktopApi.file.applyColoredPencil(
        source,
        preferredName('video-input-colored-pencil', ref),
      );
      const filePath = file?.filePath || file?.path || '';
      if (!filePath) throw new Error(`${ref.title || ref.fileName || '图片'}彩铅预处理没有生成文件`);
      return {
        filePath,
        fileName: file.name || filePath.split(/[\\/]/).pop() || 'video-input-colored-pencil.png',
      };
    })().catch((error) => {
      processedImageCache.delete(key);
      throw error;
    }));
  }
  const output = await processedImageCache.get(key);
  return {
    ...ref,
    ...output,
    resourceType: 'image',
    mimeType: 'image/png',
    // The remote URL points at the unprocessed original. Clearing it forces
    // every provider transport to encode and submit the local processed PNG.
    url: '',
    previewUrl: '',
    remoteUrl: '',
    objectKey: '',
  };
}

export async function preprocessVideoModelInputs(payload = {}) {
  if (payload.nodeType !== 'videoGeneration') return payload;
  const modelInputs = payload.modelInputs || {};
  const images = Array.isArray(modelInputs.images) ? modelInputs.images : [];
  const referenceImages = Array.isArray(modelInputs.referenceImages) ? modelInputs.referenceImages : [];
  if (!images.length && !referenceImages.length) return payload;
  try {
    const [processedImages, processedReferences] = await Promise.all([
      Promise.all(images.map(preprocessImageRef)),
      Promise.all(referenceImages.map(preprocessImageRef)),
    ]);
    payload.modelInputs = {
      ...modelInputs,
      images: processedImages,
      referenceImages: processedReferences,
    };
    payload.videoInputPreprocessing = {
      style: 'colored-pencil',
      count: processedImages.length + processedReferences.length,
      automatic: true,
    };
    return payload;
  } catch (error) {
    throw new Error(`视频图片自动彩铅预处理失败：${error?.message || String(error)}`);
  }
}

export function clearVideoInputPreprocessorCache() {
  processedImageCache.clear();
}
