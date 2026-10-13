import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconSymbol } from "../components/IconSymbol";
import { useMediaPreviewCache } from "../canvas/useMediaPreviewCache";
import { openMediaViewer } from "../store/overlayStore";
import { referenceClock } from "./mediaReference";
import styles from "./MediaThumb.module.css";

const kindIcon: Record<string, string> = {
  image: "image",
  video: "film",
  audio: "waveform",
  file: "file",
  text: "text",
  node: "layers",
};

const kindName: Record<string, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  file: "文件",
  text: "文本",
  node: "画布节点",
};

/**
 * 面板内的素材缩略图：图片悬停放大、点击看大图，视频点一下就地播放。
 * 引用卡和产物卡共用同一份解码、海报和失败回退逻辑，
 * 避免同一素材在两个位置表现不一致。
 */
export function MediaThumb({
  kind,
  path,
  fallbackUrl = "",
  label,
  maxSize = 320,
  fallback,
  onActivate,
}: {
  kind: string;
  path: string;
  fallbackUrl?: string;
  label: string;
  maxSize?: number;
  /** 无法显示画面时的替代内容（如文本产物正文）。 */
  fallback?: ReactNode;
  /** 覆盖默认点击行为，用于非媒体产物定位到画布节点。 */
  onActivate?: () => void;
}) {
  const previewable = kind === "image" || kind === "video";
  const preview = useMediaPreviewCache({
    path,
    fallbackUrl,
    kind,
    maxSize,
    enabled: previewable,
  });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [duration, setDuration] = useState("");
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    setFailed(false);
    setPlaying(false);
    setDuration("");
  }, [preview.url]);
  const visual = previewable && !failed && Boolean(preview.url);

  function enlarge() {
    if (!visual) return;
    openMediaViewer({
      src: preview.url,
      kind: kind as "image" | "video",
      title: label,
      filePath: path,
    });
  }

  if (kind === "video" && visual) {
    const badge = referenceClock(Number(duration));
    return (
      <div
        className={styles.thumb}
        data-kind="video"
        data-playing={playing || undefined}
        onDoubleClick={enlarge}
      >
        <video
          ref={videoRef}
          src={preview.url}
          muted
          playsInline
          preload="metadata"
          controls={playing}
          onLoadedMetadata={(event) => {
            const element = event.currentTarget;
            setDuration(String(element.duration ?? ""));
            // preload="metadata" 只读到时长，不会解码出画面；必须显式 seek 一帧才有海报。
            if (element.currentTime === 0 && element.duration > 0) {
              element.currentTime = Math.min(1 / 30, Math.max(0, element.duration - 0.04));
            }
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          // 流式播放失败时退回整段缓冲，这是画布视频节点用的同一套回退。
          onError={() => (preview.buffered ? setFailed(true) : preview.retryBuffered())}
        />
        {!playing && (
          <button
            type="button"
            className={styles.play}
            aria-label={`播放：${label}`}
            onClick={() => {
              setPlaying(true);
              void videoRef.current?.play();
            }}
          >
            <IconSymbol name="play" />
          </button>
        )}
        {!!badge && !playing && <span className={styles.badge}>{badge}</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={styles.thumb}
      data-kind={kind}
      onClick={onActivate || enlarge}
      disabled={!visual && !onActivate}
      aria-label={`${visual ? "预览" : "查看"}${kindName[kind] || "素材"}：${label}`}
    >
      {kind === "image" && visual ? (
        <img src={preview.url} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        fallback ?? <IconSymbol name={kindIcon[kind] || "file"} />
      )}
    </button>
  );
}
