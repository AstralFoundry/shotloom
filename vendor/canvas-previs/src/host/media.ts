/**
 * Video transcoding host port.
 *
 * Screen recordings arrive as WebM; downstream canvas nodes and some players only accept MP4.
 * The default is the upstream offline FFmpeg.wasm transcoder, loaded only on export.
 * Hosts may supply an alternative implementation with the same fps/duration contract.
 */
export type PrevisTranscodeProgress = { phase: "loading" | "encoding"; progress: number };

export type PrevisTranscodeOptions = {
    /** Target frame rate; the engine records at the shot's fps. */
    fps?: number;
    /** Shot duration in seconds, used for progress estimation. */
    duration?: number;
    onProgress?: (progress: PrevisTranscodeProgress) => void;
    signal?: AbortSignal;
};

export type PrevisTranscode = (blob: Blob, options?: PrevisTranscodeOptions) => Promise<Blob>;

let transcode: PrevisTranscode | null = null;

export function setPrevisVideoTranscoder(next: PrevisTranscode | null) {
    transcode = next;
}

/** Transcode using the host implementation or the bundled upstream encoder. */
export async function transcodeVideoToMp4(blob: Blob, options: PrevisTranscodeOptions = {}): Promise<Blob> {
    if (blob.type.split(";")[0] === "video/mp4") return blob;
    if (transcode) return transcode(blob, options);
    const engine = await import("@/lib/previs/canvas-video-transcode");
    return engine.transcodeVideoToMp4(blob, {
        ...options,
        onProgress: (progress) => options.onProgress?.({ phase: progress.phase === "loading" ? "loading" : "encoding", progress: progress.progress }),
    });
}
