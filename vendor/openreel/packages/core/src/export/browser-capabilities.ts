import { CODEC_MAP, type VideoExportSettings } from "./types";
import type { Project } from "../types/project";

type MediaBunnyModule = typeof import("mediabunny");

/** Structured facts let clients translate their own UI without parsing error text. */
export type ExportPreflightIssue =
  | { code: "empty-timeline" | "dimensions" | "frame-rate" | "bitrate" | "desktop-encoder" }
  | { code: "prores-desktop" | "range" | "destination" | "busy" | "audio-empty" | "no-audio" | "library" | "webcodecs" }
  | { code: "missing-media"; names: readonly string[] }
  | { code: "audio-library"; format: string }
  | { code: "container"; codec: string; format: string }
  | { code: "video-encoder"; codec: string; width: number; height: number }
  | { code: "audio-encoder"; format: string }
  | { code: "probe-failed"; detail: string | null };

export function formatExportPreflightIssue(issue: ExportPreflightIssue): string {
  switch (issue.code) {
    case "prores-desktop": return "ProRes export requires the desktop encoder. Choose H.264 / MP4 for browser export.";
    case "range": return "Choose an In/Out range inside the timeline, with Out after In.";
    case "destination": return "No writable stream provided. Export requires a file destination.";
    case "busy": return "An export is already running. Wait for it to finish or cancel it before retrying.";
    case "audio-empty": return "Timeline is empty. Add clips before exporting.";
    case "no-audio": return "No audio to export";
    case "library": return "MediaBunny library failed to load. Please refresh the page and try again.";
    case "webcodecs": return "Video export requires WebCodecs API which is not supported in your browser. Please use Chrome, Edge, or another WebCodecs-compatible browser.";
    case "missing-media": return `Relink the original media before exporting: ${issue.names.join(", ")}`;
    case "audio-library": return `Audio export to ${issue.format} format requires MediaBunny. WAV format is available as a fallback.`;
    case "empty-timeline": return "Add a clip, text, or graphics to the timeline before exporting.";
    case "dimensions": return "Choose a valid width and height for your video.";
    case "frame-rate": return "Choose a valid frame rate for your video.";
    case "bitrate": return "Choose a valid video bitrate.";
    case "desktop-encoder": return "ProRes, transparency, and high bit depth export require the desktop encoder. Choose H.264 for browser export.";
    case "container": return `${issue.codec} cannot be exported in ${issue.format}. Choose VP9 for WebM or H.264 for MP4.`;
    case "video-encoder": return `This browser cannot encode ${issue.codec} at ${issue.width}×${issue.height}. Try H.264 / MP4, VP9 / WebM, or a smaller resolution.`;
    case "audio-encoder": return `This browser cannot encode audio for ${issue.format}. Try WebM with Opus audio or another browser.`;
    case "probe-failed": return `Could not check browser export support: ${issue.detail ?? "encoder unavailable"}`;
  }
}

export interface BrowserExportCapability {
  supported: boolean;
  reason: string | null;
  issue?: ExportPreflightIssue;
  audioCodec?: string;
}

export function getVideoExportValidationIssue(settings: VideoExportSettings, duration: number): ExportPreflightIssue | null {
  if (!Number.isFinite(duration) || duration <= 0) return { code: "empty-timeline" };
  if (![settings.width, settings.height].every((value) => Number.isInteger(value) && value > 0)) return { code: "dimensions" };
  if (!Number.isFinite(settings.frameRate) || settings.frameRate <= 0) return { code: "frame-rate" };
  if (!Number.isFinite(settings.bitrate) || settings.bitrate <= 0) return { code: "bitrate" };
  return null;
}

export function getVideoExportValidationError(settings: VideoExportSettings, duration: number): string | null {
  const issue = getVideoExportValidationIssue(settings, duration);
  return issue ? formatExportPreflightIssue(issue) : null;
}

function unsupported(issue: ExportPreflightIssue): BrowserExportCapability {
  return { supported: false, issue, reason: formatExportPreflightIssue(issue) };
}

/** Check the originals, even when preview playback uses a proxy. */
export function getMissingExportMedia(project: Project, range?: VideoExportSettings["range"]): string[] {
  const referenced = new Set(project.timeline.tracks.flatMap((track) => track.clips
    .filter((clip) => !range || (clip.startTime < range.endTime && clip.startTime + clip.duration > range.startTime))
    .filter((clip) => {
      // Motion's timeline clip is generated from its persisted composition;
      // it has no external source Blob to relink. Verify both real records
      // rather than exempting any media id with a "motion-" prefix.
      const instance = project.motionInstances?.find(item => item.id === clip.metadata?.motionInstanceId);
      return !instance || clip.mediaId !== `motion-${instance.id}`
        || clip.metadata?.motionCompositionId !== instance.compositionId
        || !project.motionCompositions?.some(item => item.id === instance.compositionId);
    })
    .map((clip) => clip.mediaId)));
  return [...referenced].flatMap((id) => {
    const item = project.mediaLibrary.items.find((candidate) => candidate.id === id);
    if (!item) return [id];
    if (["video", "audio", "image"].includes(item.type) && (!item.blob || item.isPlaceholder)) return [item.name || id];
    return [];
  });
}

/** Probe the selected codec and container, without silently changing the video codec. */
export async function checkBrowserExportCapability(
  settings: VideoExportSettings,
  mediaBunny?: MediaBunnyModule,
  includeAudio = true,
): Promise<BrowserExportCapability> {
  if (settings.preserveAlpha || settings.codec === "prores" || (settings.colorDepth ?? 8) > 8 || (settings.pixelFormat && settings.pixelFormat !== "yuv420")) {
    return unsupported({ code: "desktop-encoder" });
  }
  try {
    const library = mediaBunny ?? await import("mediabunny");
    const format = settings.format === "webm" ? new library.WebMOutputFormat() : settings.format === "mov" ? new library.MovOutputFormat() : new library.Mp4OutputFormat();
    const codec = CODEC_MAP[settings.codec];
    if (!format.getSupportedVideoCodecs().includes(codec)) {
      return unsupported({ code: "container", codec: settings.codec.toUpperCase(), format: settings.format.toUpperCase() });
    }
    const video = await library.getFirstEncodableVideoCodec([codec], {
      width: settings.width, height: settings.height, bitrate: settings.bitrate * 1000,
    });
    if (video !== codec) return unsupported({ code: "video-encoder", codec: settings.codec.toUpperCase(), width: settings.width, height: settings.height });
    if (!includeAudio) return { supported: true, reason: null };
    const audioCodec = await library.getFirstEncodableAudioCodec(format.getSupportedAudioCodecs(), {
      numberOfChannels: settings.audioSettings.channels,
      sampleRate: settings.audioSettings.sampleRate,
      bitrate: settings.audioSettings.bitrate * 1000,
    });
    if (!audioCodec) return unsupported({ code: "audio-encoder", format: settings.format.toUpperCase() });
    return { supported: true, reason: null, audioCodec };
  } catch (error) {
    return unsupported({ code: "probe-failed", detail: error instanceof Error ? error.message : null });
  }
}
