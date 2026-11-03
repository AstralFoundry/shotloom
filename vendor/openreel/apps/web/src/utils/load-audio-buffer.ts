import { editorMessage } from "../shotloom-mode";

export interface AudioLoadProgress {
  stage: "extracting" | "decoding";
  progress: number;
  message: string;
}

export interface LoadAudioBufferOptions {
  audioTrackIndex?: number;
  onProgress?: (progress: AudioLoadProgress) => void;
}

export const loadAudioBuffer = async (
  audioContext: AudioContext | BaseAudioContext,
  blob: Blob,
  options: LoadAudioBufferOptions = {},
): Promise<AudioBuffer | null> => {
  const audioTrackIndex = options.audioTrackIndex ?? 0;

  try {
    const { extractAudioWav } = await import("@openreel/core/media");
    options.onProgress?.({
      stage: "extracting",
      progress: 0.08,
      message: editorMessage("editor.audioLoad.extracting"),
    });
    const wavBlob = await extractAudioWav(blob, audioTrackIndex, {
      onProgress: (progress) => {
        options.onProgress?.({
          stage: "extracting",
          progress: Math.min(0.82, 0.08 + progress.progress * 0.72),
          message: editorMessage("editor.audioLoad.extracting"),
        });
      },
    });
    options.onProgress?.({
      stage: "decoding",
      progress: 0.88,
      message: editorMessage("editor.audioLoad.decodingExtracted"),
    });
    const arrayBuffer = await wavBlob.arrayBuffer();
    const decoded = await audioContext.decodeAudioData(arrayBuffer);
    options.onProgress?.({
      stage: "decoding",
      progress: 1,
      message: editorMessage("editor.audioLoad.ready"),
    });
    return decoded;
  } catch {
    options.onProgress?.({
      stage: "decoding",
      progress: 0.45,
      message: editorMessage("editor.audioLoad.fallback"),
    });
  }

  if (audioTrackIndex === 0) {
    try {
      options.onProgress?.({
        stage: "decoding",
        progress: 0.55,
        message: editorMessage("editor.audioLoad.decodingSource"),
      });
      const arrayBuffer = await blob.arrayBuffer();
      const decoded = await audioContext.decodeAudioData(arrayBuffer);
      options.onProgress?.({
        stage: "decoding",
        progress: 1,
        message: editorMessage("editor.audioLoad.ready"),
      });
      return decoded;
    } catch {
      return null;
    }
  }

  return null;
};