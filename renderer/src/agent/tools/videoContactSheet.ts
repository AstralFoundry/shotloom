export type VideoFramePreview = { seconds: number; dataUrl: string };

/** Compose actual decoded frames; the caption belongs to the frame it describes. */
export async function videoContactSheet(frames: VideoFramePreview[]): Promise<string> {
  const dense = frames.length > 16;
  const columns = Math.min(frames.length, dense ? 6 : 4);
  const rows = Math.ceil(frames.length / columns);
  const cellWidth = dense ? 216 : frames.length > 8 ? 256 : 320;
  const imageHeight = Math.round(cellWidth * 9 / 16);
  const gap = dense ? 4 : 6;
  const canvas = document.createElement('canvas');
  canvas.width = columns * cellWidth + (columns + 1) * gap;
  canvas.height = rows * imageHeight + (rows + 1) * gap;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create video contact sheet canvas');
  context.fillStyle = '#17191d';
  context.fillRect(0, 0, canvas.width, canvas.height);

  for (const [index, frame] of frames.entries()) {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const item = new Image();
      item.onload = () => resolve(item);
      item.onerror = () => reject(new Error(`Unable to decode video frame at ${frame.seconds}s`));
      item.src = frame.dataUrl;
    });
    const x = gap + (index % columns) * (cellWidth + gap);
    const y = gap + Math.floor(index / columns) * (imageHeight + gap);
    context.fillStyle = '#000';
    context.fillRect(x, y, cellWidth, imageHeight);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const scale = Math.min(cellWidth / width, imageHeight / height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    context.drawImage(image, x + (cellWidth - drawWidth) / 2, y + (imageHeight - drawHeight) / 2, drawWidth, drawHeight);
    const label = `${frame.seconds}s`;
    context.font = '600 12px sans-serif';
    const badgeWidth = Math.ceil(context.measureText(label).width) + 14;
    context.fillStyle = 'rgba(0, 0, 0, 0.76)';
    context.fillRect(x, y + imageHeight - 22, badgeWidth, 22);
    context.fillStyle = '#fff';
    context.textBaseline = 'middle';
    context.fillText(label, x + 7, y + imageHeight - 11);
  }
  return canvas.toDataURL('image/jpeg', 0.9);
}
