export interface CropRect { x: number; y: number; width: number; height: number }

export function cropPixels(width: number, height: number, crop: CropRect) {
  if (![width, height, crop.x, crop.y, crop.width, crop.height].every(Number.isFinite)
    || width <= 0 || height <= 0 || crop.width <= 0 || crop.height <= 0) throw new Error('Invalid image crop');
  const clamp = (value: number) => Math.max(0, Math.min(1, value));
  const x = Math.round(clamp(crop.x) * width), y = Math.round(clamp(crop.y) * height);
  const w = Math.round(clamp(crop.x + crop.width) * width) - x;
  const h = Math.round(clamp(crop.y + crop.height) * height) - y;
  if (w < 1 || h < 1) throw new Error('Image crop is empty');
  return { x, y, width: w, height: h };
}

export async function cropImage(blob: Blob, crop: CropRect): Promise<Blob> {
  const image = await createImageBitmap(blob);
  try {
    const rect = cropPixels(image.width, image.height, crop);
    const canvas = new OffscreenCanvas(rect.width, rect.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is unavailable');
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
    return await canvas.convertToBlob({ type: 'image/png' });
  } finally { image.close(); }
}

export async function captureVideoFrame(url: string, seconds: number): Promise<Blob> {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid video time');
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous'; video.preload = 'metadata'; video.muted = true; video.playsInline = true;
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timeout); video.onloadedmetadata = null; video.onseeked = null; video.onerror = null; video.removeAttribute('src'); video.load(); };
    const fail = () => { cleanup(); reject(new Error('Video frame capture failed')); };
    const timeout = setTimeout(fail, 30_000);
    video.onerror = fail;
    video.onloadedmetadata = () => {
      if (!Number.isFinite(video.duration) || seconds >= video.duration) { fail(); return; }
      video.currentTime = Math.min(Math.max(.001, seconds), Math.max(0, video.duration - .001));
    };
    video.onseeked = () => {
      try {
        const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight);
        const context = canvas.getContext('2d');
        if (!context) { fail(); return; }
        context.drawImage(video, 0, 0);
        void canvas.convertToBlob({ type: 'image/png' }).then(blob => { cleanup(); resolve(blob); }, fail);
      } catch { fail(); }
    };
    video.src = url;
  });
}
