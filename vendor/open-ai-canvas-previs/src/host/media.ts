/**
 * Video transcoding host port.
 *
 * Screen recordings arrive as WebM; downstream canvas nodes and some players only accept MP4.
 * The host provides a transcoder (ffmpeg.wasm in the browser app) and owns fps/duration
 * handling. Without one the recording is returned untouched with its original mime type,
 * never silently relabelled as MP4.
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

/** Transcode to MP4 when the host can, otherwise pass the original recording through. */
export async function transcodeVideoToMp4(blob: Blob, options: PrevisTranscodeOptions = {}): Promise<Blob> {
    if (blob.type === "video/mp4" || !transcode) return blob;
    return transcode(blob, options);
}
