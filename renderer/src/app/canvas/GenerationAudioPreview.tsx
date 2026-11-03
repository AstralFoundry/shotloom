import { t } from '@/i18n';
import { useRef, useState } from "react";
import { desktopApi } from "../../services/desktopApi.ts";
import { IconSymbol } from "../components/IconSymbol";
import { showToast } from "../../store/notificationStore";

const WAVEFORM_BARS = [
  20, 38, 64, 42, 76, 48, 30, 58, 82, 46, 68, 34, 72, 52, 88, 40,
  62, 28, 54, 78, 44, 70, 36, 84, 50, 66, 32, 74, 46, 90, 56, 38,
  68, 42, 80, 34, 60, 48, 86, 54, 30, 72, 44, 64, 38, 78, 52, 28,
  70, 46, 82, 36, 58, 74, 42, 66, 32, 76, 48, 62, 40, 84, 54, 30,
];

export function formatMediaTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const seconds = Math.floor(value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function GenerationAudioPreview({
  src,
  filePath,
  fileName,
  onError,
}: {
  src: string;
  filePath: string;
  fileName: string;
  onError: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const progress = duration > 0 ? currentTime / duration : 0;

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) await audio.play().catch(() => undefined);
    else audio.pause();
  }

  async function saveAudio() {
    if (!filePath) return showToast(t("ui.GenerationAudioPreview.text.91bfd3bc"));
    try {
      const buffer = await desktopApi.file.readArrayBuffer(filePath);
      const result = await desktopApi.file.saveArrayBuffer(fileName || "audio.m4a", buffer);
      if (result) showToast(t("ui.GenerationAudioPreview.text.28850169"));
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : t("ui.GenerationAudioPreview.text.47c1898e"));
    }
  }

  return (
    <div className="audio-waveform-player nowheel">
      <button
        type="button"
        className="audio-waveform"
        aria-label={t("ui.GenerationAudioPreview.arialabel.c228d814")}
        onClick={(event) => {
          const audio = audioRef.current;
          if (!audio || !(duration > 0)) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          audio.currentTime = Math.max(0, Math.min(duration, (event.clientX - bounds.left) / bounds.width * duration));
          setCurrentTime(audio.currentTime);
        }}
      >
        {WAVEFORM_BARS.map((height, index) => (
          <span
            key={index}
            className={index / WAVEFORM_BARS.length <= progress ? "played" : ""}
            style={{ height: `${height}%` }}
          />
        ))}
      </button>
      <div className="audio-waveform-controls">
        <span>{formatMediaTime(currentTime)} / {formatMediaTime(duration)}</span>
        <button type="button" className="audio-waveform-play nodrag nopan" title={playing ? t("ui.GenerationAudioPreview.text.130448bc") : t("ui.GenerationAudioPreview.text.21925350")} onClick={() => void togglePlayback()}>
          {playing ? <IconSymbol name="pause" /> : <i className="audio-play-glyph" aria-hidden />}
        </button>
        <button type="button" className="audio-waveform-download nodrag nopan" title={t("ui.GenerationAudioPreview.title.4f79f549")} onClick={() => void saveAudio()}>
          <IconSymbol name="download" />
        </button>
      </div>
      <audio
        ref={audioRef}
        className="nodrag nopan nowheel audio-waveform-native"
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(Number(event.currentTarget.duration) || 0)}
        onDurationChange={(event) => setDuration(Number(event.currentTarget.duration) || 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={onError}
      />
    </div>
  );
}
