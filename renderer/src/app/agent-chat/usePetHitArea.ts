import { useEffect, useRef } from 'react';

// A downsampled alpha mask keeps transparent video pixels from capturing canvas gestures.
const SAMPLE_WIDTH = 96;
const SAMPLE_HEIGHT = 54;
const ALPHA_THRESHOLD = 48;

function sampleAlpha(context: CanvasRenderingContext2D, frame: HTMLImageElement | HTMLVideoElement) {
  const width = frame instanceof HTMLVideoElement ? frame.videoWidth : frame.naturalWidth;
  const height = frame instanceof HTMLVideoElement ? frame.videoHeight : frame.naturalHeight;
  if (!width || !height) return undefined;
  const scale = Math.min(SAMPLE_WIDTH / width, SAMPLE_HEIGHT / height);
  const sampleWidth = width * scale;
  const sampleHeight = height * scale;
  context.clearRect(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
  try {
    context.drawImage(frame, (SAMPLE_WIDTH - sampleWidth) / 2, (SAMPLE_HEIGHT - sampleHeight) / 2, sampleWidth, sampleHeight);
    return context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data;
  } catch { return undefined; }
}

export function usePetHitArea() {
  const media = useRef<HTMLSpanElement>(null);
  const hit = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const surface = media.current;
    const target = hit.current;
    const launcher = surface?.parentElement;
    if (!surface || !target || !launcher) return;
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_WIDTH;
    canvas.height = SAMPLE_HEIGHT;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;

    const updateTrim = () => {
      // Use the fixed poster so changing animations cannot move a parked pet.
      const poster = surface.querySelector('img');
      const { width, height } = target.getBoundingClientRect();
      const alpha = poster && sampleAlpha(context, poster);
      if (!width || !height || !alpha) return;

      let left = SAMPLE_WIDTH;
      let right = -1;
      let top = SAMPLE_HEIGHT;
      for (let row = 0; row < SAMPLE_HEIGHT; row++) {
        for (let col = 0; col < SAMPLE_WIDTH; col++) {
          if ((alpha[(row * SAMPLE_WIDTH + col) * 4 + 3] ?? 0) < ALPHA_THRESHOLD) continue;
          left = Math.min(left, col);
          right = Math.max(right, col);
          top = Math.min(top, row);
        }
      }
      // Leave room for motion outside the poster and the centered status badge.
      const captionWidth = parseFloat(getComputedStyle(launcher).getPropertyValue('--agent-pet-caption-max')) || width;
      const badgeClearance = Math.max(0, (width - captionWidth) / 2);
      const trim = (samples: number, dimension: number, total: number) =>
        right < 0 ? 0 : Math.max(0, dimension * (samples / total - .06));
      launcher.style.setProperty('--agent-pet-left-bleed', `${Math.min(badgeClearance, trim(left, width, SAMPLE_WIDTH))}px`);
      launcher.style.setProperty('--agent-pet-right-bleed', `${Math.min(badgeClearance, trim(SAMPLE_WIDTH - 1 - right, width, SAMPLE_WIDTH))}px`);
      launcher.style.setProperty('--agent-pet-top-bleed', `${trim(top, height, SAMPLE_HEIGHT)}px`);
    };

    let lastFrame = '';
    const update = () => {
      if (document.hidden) return;
      const frame = surface.querySelector<HTMLVideoElement>('video.is-playing') ?? surface.querySelector('img');
      if (!frame) return;
      const { width: targetWidth, height: targetHeight } = target.getBoundingClientRect();
      const frameKey = `${frame.currentSrc}:${frame instanceof HTMLVideoElement ? frame.currentTime : ''}:${targetWidth}:${targetHeight}`;
      if (frameKey === lastFrame) return;
      const alpha = sampleAlpha(context, frame);
      if (!alpha || !targetWidth || !targetHeight) {
        target.style.removeProperty('--agent-pet-hit-area');
        lastFrame = '';
        return;
      }
      lastFrame = frameKey;

      const paths: string[] = [];
      for (let row = 0; row < SAMPLE_HEIGHT; row++) {
        const top = Math.round(row * targetHeight / SAMPLE_HEIGHT);
        const bottom = Math.round((row + 1) * targetHeight / SAMPLE_HEIGHT);
        let start = -1;
        for (let col = 0; col <= SAMPLE_WIDTH; col++) {
          const opaque = col < SAMPLE_WIDTH && (alpha[(row * SAMPLE_WIDTH + col) * 4 + 3] ?? 0) >= ALPHA_THRESHOLD;
          if (opaque && start < 0) start = col;
          if (!opaque && start >= 0) {
            const left = Math.round(start * targetWidth / SAMPLE_WIDTH);
            const right = Math.round(col * targetWidth / SAMPLE_WIDTH);
            paths.push(`M${left} ${top}H${right}V${bottom}H${left}Z`);
            start = -1;
          }
        }
      }
      if (paths.length) target.style.setProperty('--agent-pet-hit-area', `path("${paths.join('')}")`);
      else target.style.removeProperty('--agent-pet-hit-area');
    };

    const measure = () => { updateTrim(); update(); };
    const resize = new ResizeObserver(measure);
    resize.observe(target);
    surface.addEventListener('load', measure, true);
    const timer = window.setInterval(update, 100);
    return () => {
      window.clearInterval(timer);
      surface.removeEventListener('load', measure, true);
      resize.disconnect();
    };
  }, []);

  return { media, hit };
}
