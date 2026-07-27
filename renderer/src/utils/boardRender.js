const BOARD_WIDTH = 640;
const BOARD_HEIGHT = 360;
const GRID_SIZE = 40;
const imageCache = new Map();

export function ensureBoardData(node) {
  if (!node.boardData || typeof node.boardData !== 'object') {
    node.boardData = { strokes: [] };
  }
  if (!Array.isArray(node.boardData.strokes)) node.boardData.strokes = [];
  if (!Array.isArray(node.boardData.texts)) node.boardData.texts = [];
  if (!Array.isArray(node.boardData.images)) node.boardData.images = [];
  if (node.boardData.crop && !normalizeCrop(node.boardData.crop)) delete node.boardData.crop;
  return node.boardData;
}

export function renderBoardToCanvas(canvas, boardData = {}, options = {}) {
  if (!canvas) return;
  canvas.width = BOARD_WIDTH;
  canvas.height = BOARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = '#eef2f7';
  ctx.lineWidth = 1;
  for (let x = GRID_SIZE; x < canvas.width; x += GRID_SIZE) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = GRID_SIZE; y < canvas.height; y += GRID_SIZE) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }

  const strokes = Array.isArray(boardData.strokes) ? boardData.strokes : [];
  for (const stroke of strokes) drawStroke(ctx, stroke);

  const images = Array.isArray(boardData.images) ? boardData.images : [];
  for (const item of images) drawImage(ctx, item, () => renderBoardToCanvas(canvas, boardData, options));

  const texts = Array.isArray(boardData.texts) ? boardData.texts : [];
  for (const item of texts) drawText(ctx, item);

  if (options.showCrop !== false) drawCrop(ctx, boardData.crop);
}

export function boardToDataUrl(boardData = {}) {
  const canvas = document.createElement('canvas');
  renderBoardToCanvas(canvas, boardData, { showCrop: false });
  const crop = normalizeCrop(boardData.crop);
  if (!crop) return canvas.toDataURL('image/png');
  const cropped = document.createElement('canvas');
  cropped.width = crop.width;
  cropped.height = crop.height;
  cropped.getContext('2d').drawImage(
    canvas,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height,
  );
  return cropped.toDataURL('image/png');
}

export function normalizeCrop(crop) {
  if (!crop || typeof crop !== 'object') return null;
  const x = clamp(Math.round(Number(crop.x) || 0), 0, BOARD_WIDTH - 1);
  const y = clamp(Math.round(Number(crop.y) || 0), 0, BOARD_HEIGHT - 1);
  const width = clamp(Math.round(Number(crop.width) || 0), 1, BOARD_WIDTH - x);
  const height = clamp(Math.round(Number(crop.height) || 0), 1, BOARD_HEIGHT - y);
  if (width < 4 || height < 4) return null;
  return { x, y, width, height };
}

export function cropFromPoints(start, end) {
  const x1 = clamp(Math.round(Number(start?.x) || 0), 0, BOARD_WIDTH);
  const y1 = clamp(Math.round(Number(start?.y) || 0), 0, BOARD_HEIGHT);
  const x2 = clamp(Math.round(Number(end?.x) || 0), 0, BOARD_WIDTH);
  const y2 = clamp(Math.round(Number(end?.y) || 0), 0, BOARD_HEIGHT);
  return normalizeCrop({
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function drawCrop(ctx, crop) {
  const rect = normalizeCrop(crop);
  if (!rect) return;
  ctx.save();
  ctx.fillStyle = 'rgba(47, 111, 147, 0.08)';
  ctx.strokeStyle = '#2f6f93';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 5]);
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

function drawStroke(ctx, stroke) {
  const points = Array.isArray(stroke.points) ? stroke.points : [];
  if (!points.length) return;
  ctx.strokeStyle = stroke.color || '#1f2937';
  ctx.lineWidth = stroke.width || 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.stroke();
}

function drawImage(ctx, item, onLoad) {
  const src = String(item.src || item.url || '').trim();
  if (!src) return;
  const rect = {
    x: Number(item.x) || 0,
    y: Number(item.y) || 0,
    width: Number(item.width) || 180,
    height: Number(item.height) || 120,
  };
  const image = imageForSource(src, onLoad);
  if (image?.complete && image.naturalWidth > 0) {
    ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
    return;
  }
  ctx.save();
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.fillStyle = '#64748b';
  ctx.font = '700 14px sans-serif';
  ctx.fillText(item.title || 'Image', rect.x + 10, rect.y + 10);
  ctx.restore();
}

function imageForSource(src, onLoad) {
  if (imageCache.has(src)) return imageCache.get(src);
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.onload = () => onLoad?.();
  image.onerror = () => onLoad?.();
  image.src = src;
  imageCache.set(src, image);
  return image;
}

function drawText(ctx, item) {
  const text = String(item.text || '').trim();
  if (!text) return;
  const fontSize = Number.isFinite(Number(item.fontSize)) ? Number(item.fontSize) : 24;
  ctx.fillStyle = item.color || '#1f2937';
  ctx.font = `700 ${fontSize}px sans-serif`;
  ctx.textBaseline = 'top';
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    ctx.fillText(line, Number(item.x) || 0, (Number(item.y) || 0) + index * fontSize * 1.25);
  });
}
