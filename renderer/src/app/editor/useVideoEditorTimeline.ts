import { useEffect, useRef, useState } from "react";

export interface VideoEditorTimelineViewport {
  left: number;
  width: number;
}

export function useVideoEditorTimeline(duration: number) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const zoomTouchedRef = useRef(false);
  const [zoom, setZoom] = useState(64);
  const [viewport, setViewport] = useState<VideoEditorTimelineViewport>({
    left: 0,
    width: 1200,
  });

  useEffect(() => {
    if (!duration || zoomTouchedRef.current) return;
    const timelineWidth = timelineRef.current?.clientWidth || window.innerWidth;
    const availableWidth = Math.max(1, timelineWidth - 112 - 24);
    setZoom(Math.max(24, Math.min(180, availableWidth / duration)));
  }, [duration]);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    const sync = () => setViewport({
      left: timeline.scrollLeft,
      width: timeline.clientWidth,
    });
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(timeline);
    return () => observer.disconnect();
  }, []);

  const changeZoom = (nextZoom: number) => {
    zoomTouchedRef.current = true;
    setZoom(nextZoom);
  };

  return {
    timelineRef,
    zoom,
    viewport,
    changeZoom,
    setViewport,
  };
}
