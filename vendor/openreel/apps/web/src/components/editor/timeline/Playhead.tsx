import React, { useCallback, useEffect, useRef } from "react";
import { playheadLiveTime } from "../../../stores/playhead-live-time";

interface PlayheadProps {
  position: number;
  pixelsPerSecond: number;
  scrollX: number;
  headerOffset: number;
  /** 播放中指针由自己的 rAF 逐帧画，不等 store 的节流提交。 */
  playing?: boolean;
  /** 画布卡片里的紧凑指针：更细的线、只到标尺高的小提手、品牌色。 */
  compact?: boolean;
}

// 参考剪辑台（MiniMax）：完整剪辑台是 2px 前景墨色竖线 + 9×24 圆角提手；
// 画布卡片是 1.5px 品牌色细线 + 9×28（标尺高）提手。颜色随主题换向，不写死 #1d1d1f。
export const Playhead: React.FC<PlayheadProps> = ({
  position,
  pixelsPerSecond,
  scrollX,
  headerOffset,
  playing = false,
  compact = false,
}) => {
  const ref = useRef<HTMLDivElement | null>(null);

  // 位置只写 transform：把它放进 React 进度状态会让整条时间线每帧重渲染，指针就卡。
  const paint = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const seconds = playing ? playheadLiveTime.seconds : position;
    const pixelPosition = seconds * pixelsPerSecond - scrollX;
    element.style.transform = `translateX(${pixelPosition}px)`;
    element.style.visibility = pixelPosition < 0 ? "hidden" : "visible";
  }, [playing, position, pixelsPerSecond, scrollX]);

  useEffect(() => {
    paint();
    if (!playing) return;
    let frame = 0;
    const step = () => {
      paint();
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [paint]);

  const initial = position * pixelsPerSecond - scrollX;

  return (
    <div
      ref={ref}
      className="absolute top-0 bottom-0 z-50 pointer-events-none"
      style={{
        left: headerOffset,
        transform: `translateX(${initial}px)`,
        visibility: initial < 0 ? "hidden" : "visible",
        willChange: "transform",
      }}
    >
      {/* vertical line */}
      <div
        className="absolute"
        style={{
          top: 0,
          bottom: 0,
          left: 0,
          width: compact ? 1.5 : 2,
          transform: `translateX(${compact ? -0.75 : -1}px)`,
          borderRadius: "9999px",
          background: compact ? "var(--brand-accent)" : "var(--fg)",
        }}
      />
      {/* rounded thumb at the top */}
      <div
        className="absolute"
        style={{
          top: 0,
          left: -4.5,
          width: 9,
          height: compact ? 28 : 24,
          background: compact ? "var(--brand-accent)" : "var(--fg)",
          borderRadius: 4.5,
        }}
      />
    </div>
  );
};
