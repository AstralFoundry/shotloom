import { useEffect, useState } from "react";
import { formatEditorTime } from "./videoEditorFormat";

export function VideoEditorRuler({ duration, zoom }: { duration: number; zoom: number }) {
  const step = zoom >= 100 ? 1 : zoom >= 48 ? 5 : 10;
  const ticks = [];
  for (let value = 0; value <= duration; value += step) ticks.push(value);
  return (
    <div className="ov-ruler">
      {ticks.map((value) => (
        <span key={value} style={{ left: 112 + value * zoom }}>
          <i />
          {formatEditorTime(value)}
        </span>
      ))}
    </div>
  );
}

export function VideoFilmstripThumbnail({
  src,
  start,
  end,
  displayWidth,
  clipLeft,
  viewportLeft,
  viewportWidth,
  zoom,
  fps,
  speed,
  fallback,
}: {
  src?: string;
  start: number;
  end: number;
  displayWidth: number;
  clipLeft: number;
  viewportLeft: number;
  viewportWidth: number;
  zoom: number;
  fps: number;
  speed: number;
  fallback?: string;
}) {
  const [thumbnail, setThumbnail] = useState("");
  const tileWidth = 88;
  const visibleStart = Math.max(0, viewportLeft - clipLeft);
  const visibleEnd = Math.min(
    displayWidth,
    viewportLeft + viewportWidth - clipLeft,
  );
  const firstSlot = Math.max(0, Math.floor(visibleStart / tileWidth));
  const lastSlot = Math.max(firstSlot, Math.ceil(visibleEnd / tileWidth));
  const sampleCount = visibleEnd > visibleStart ? lastSlot - firstSlot : 0;

  useEffect(() => {
    if (!src || !sampleCount) {
      setThumbnail("");
      return;
    }
    setThumbnail("");
    let cancelled = false;
    const video = document.createElement("video");
    const sampleWidth = 160;
    const sampleHeight = 90;
    const canvas = document.createElement("canvas");
    canvas.width = sampleWidth * sampleCount;
    canvas.height = sampleHeight;
    const context = canvas.getContext("2d");
    let sampleIndex = 0;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";

    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("loadeddata", loaded);
      video.removeEventListener("seeked", captureSample);
      video.removeEventListener("error", failed);
      video.removeAttribute("src");
      video.load();
    };
    const finish = (value: string) => {
      if (!cancelled) setThumbnail(value);
      cleanup();
    };
    const captureSample = () => {
      if (!context || !video.videoWidth || !video.videoHeight) return finish("");
      try {
        context.drawImage(
          video,
          sampleIndex * sampleWidth,
          0,
          sampleWidth,
          sampleHeight,
        );
        sampleIndex += 1;
        if (sampleIndex >= sampleCount) {
          finish(canvas.toDataURL("image/jpeg", .76));
          return;
        }
        seekNextSample();
      } catch {
        finish("");
      }
    };
    const seekNextSample = () => {
      const sourceEnd = Math.min(
        Math.max(start, end || video.duration),
        Math.max(0, video.duration - .001),
      );
      const timelineOffset = (firstSlot + sampleIndex) * tileWidth / zoom;
      const unalignedTarget = start + timelineOffset * speed;
      const target = Math.min(
        Math.max(0, video.duration - .001),
        Math.min(sourceEnd, Math.round(unalignedTarget * fps) / fps),
      );
      if (Math.abs(video.currentTime - target) <= .001) captureSample();
      else video.currentTime = target;
    };
    const loaded = () => seekNextSample();
    const failed = () => finish("");
    const timer = window.setTimeout(failed, 15_000);
    video.addEventListener("loadeddata", loaded, { once: true });
    video.addEventListener("seeked", captureSample);
    video.addEventListener("error", failed, { once: true });
    video.src = src;
    video.load();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [end, firstSlot, fps, sampleCount, speed, src, start, zoom]);

  if (!sampleCount) return null;
  const image = thumbnail || fallback;
  return (
    <span
      className="ov-clip-filmstrip-window"
      style={{ left: firstSlot * tileWidth, width: sampleCount * tileWidth }}
    >
      {image
        ? <img className="ov-clip-filmstrip" src={image} alt="" draggable={false} />
        : <span className="ov-clip-frame-loading" />}
    </span>
  );
}
