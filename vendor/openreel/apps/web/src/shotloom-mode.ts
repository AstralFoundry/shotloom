import type { ExportPreflightIssue } from "@openreel/core";
import { createTranslator } from "../../../../../renderer/src/i18n/index";
import type { ClipStudioHost } from "./embedded/runtime-types";
import { useSyncExternalStore } from "react";

/**
 * Shotloom 宿主模式的唯一开关。
 *
 * OpenReel 的会话环境由 `?shotloom=1` 标记：不注册 Service Worker、
 * 不进入欢迎页、不跑自己的恢复/自动保存，并且只有引擎与全部桥接就绪后
 * 才向宿主回 ready。产品行为不要散落成新的 URLSearchParams 判断。
 */
export const isShotloomMode =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("shotloom");

// Each embedded runtime has its own module graph and translator configuration.
export let shotloomMessage = createTranslator('zh-CN');
// Standalone upstream UI stays English; embedded factories configure before mounting.
let editorLocale: 'en-US' | 'zh-CN' = 'en-US';
export function getEditorLocale() { return editorLocale; }
export let editorMessage = createTranslator('en-US');
export function configureShotloomLocale(locale?: string) {
  editorLocale = locale === 'en-US' ? 'en-US' : 'zh-CN';
  shotloomMessage = createTranslator(editorLocale);
  editorMessage = shotloomMessage;
}

/** Translate structured export facts; upstream detail remains an opaque parameter. */
export function exportPreflightMessage(issue: ExportPreflightIssue): string {
  switch (issue.code) {
    case "prores-desktop": return editorMessage("editor.export.preflight.prores-desktop");
    case "range": return editorMessage("editor.export.preflight.range");
    case "destination": return editorMessage("editor.export.preflight.destination");
    case "busy": return editorMessage("editor.export.preflight.busy");
    case "audio-empty": return editorMessage("editor.export.preflight.audio-empty");
    case "no-audio": return editorMessage("editor.export.preflight.no-audio");
    case "library": return editorMessage("editor.export.preflight.library");
    case "webcodecs": return editorMessage("editor.export.preflight.webcodecs");
    case "missing-media": return editorMessage("editor.export.preflight.missing-media", { files: issue.names.join(", ") });
    case "audio-library": return editorMessage("editor.export.preflight.audio-library", { format: issue.format });
    case "empty-timeline": return editorMessage("editor.export.preflight.empty-timeline");
    case "dimensions": return editorMessage("editor.export.preflight.dimensions");
    case "frame-rate": return editorMessage("editor.export.preflight.frame-rate");
    case "bitrate": return editorMessage("editor.export.preflight.bitrate");
    case "desktop-encoder": return editorMessage("editor.export.preflight.desktop-encoder");
    case "container": return editorMessage("editor.export.preflight.container", { codec: issue.codec, format: issue.format });
    case "video-encoder": return editorMessage("editor.export.preflight.video-encoder", { codec: issue.codec, width: issue.width, height: issue.height });
    case "audio-encoder": return editorMessage("editor.export.preflight.audio-encoder", { format: issue.format });
    case "probe-failed": return issue.detail === null
      ? editorMessage("editor.export.preflight.probe-unavailable")
      : editorMessage("editor.export.preflight.probe-failed", { detail: issue.detail });
  }
}

const inspectorCountKeys = {
  clips: ["editor.inspector.count.clipsOne", "editor.inspector.count.clipsMany"],
  selectedClips: ["editor.inspector.count.selectedClipsOne", "editor.inspector.count.selectedClipsMany"],
  instances: ["editor.inspector.count.instancesOne", "editor.inspector.count.instancesMany"],
  tracks: ["editor.inspector.count.tracksOne", "editor.inspector.count.tracksMany"],
  points: ["editor.inspector.count.pointsOne", "editor.inspector.count.pointsMany"],
  models: ["editor.inspector.count.modelsOne", "editor.inspector.count.modelsMany"],
  angles: ["editor.inspector.count.anglesOne", "editor.inspector.count.anglesMany"],
  cuts: ["editor.inspector.count.cutsOne", "editor.inspector.count.cutsMany"],
  particles: ["editor.inspector.count.particlesOne", "editor.inspector.count.particlesMany"],
  templates: ["editor.inspector.count.templatesOne", "editor.inspector.count.templatesMany"],
  placeholders: ["editor.inspector.count.placeholdersOne", "editor.inspector.count.placeholdersMany"],
  music: ["editor.inspector.count.musicOne", "editor.inspector.count.musicMany"],
  effects: ["editor.inspector.count.effectsOne", "editor.inspector.count.effectsMany"],
  actions: ["editor.inspector.count.actionsOne", "editor.inspector.count.actionsMany"],
  redo: ["editor.inspector.count.redoOne", "editor.inspector.count.redoMany"],
} as const;

/** Count phrases own their English plural form and Chinese unit. */
export function editorItemCount(kind: keyof typeof inspectorCountKeys, count: number): string {
  return editorMessage(inspectorCountKeys[kind][count === 1 ? 0 : 1], { count });
}

let ingestHostFiles: ((files: Array<{name: string; mime?: string; bytes: ArrayBuffer}>) => Promise<void>) | undefined;
let hostUI: ClipStudioHost["ui"] | undefined;
export function bindShotloomHost(ui: ClipStudioHost["ui"], ingest?: typeof ingestHostFiles) { hostUI = ui; ingestHostFiles = ingest; }
export async function requestShotloomFiles(files: Array<{name: string; mime?: string; bytes: ArrayBuffer}>) { if (!ingestHostFiles) throw new Error(shotloomMessage('editor.runtime.hostNotReady')); await ingestHostFiles(files); }
export function requestShotloomRelink(id: string) { void hostUI?.requestRelink(id); }
let editorReady = false;
let readyWaiters: Array<() => void> = [];

export function markShotloomEditorReady(): void {
  if (!isShotloomMode || editorReady) return;
  editorReady = true;
  const waiters = readyWaiters;
  readyWaiters = [];
  for (const waiter of waiters) waiter();
}

export function whenShotloomEditorReady(listener: () => void): void {
  if (editorReady) listener();
  else readyWaiters.push(listener);
}

export function isShotloomEditorReady(): boolean {
  return editorReady;
}

export type ShotloomPresentation = "canvas" | "editor";
/** Initial presentation is applied before the editor React tree mounts. */
export const shotloomInitialPresentation: ShotloomPresentation =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("presentation") === "canvas"
    ? "canvas"
    : "editor";
let presentation: ShotloomPresentation = shotloomInitialPresentation;
let active = presentation !== "canvas";
export function isShotloomActive() { return active; }
export function setShotloomActive(next: boolean) {
  active = next;
  document.body.classList.toggle("shotloom-background", document.hidden);
  document.body.classList.toggle("shotloom-active", active);
}
const presentationListeners = new Set<() => void>();
export function syncShotloomPresentationClass(): void {
  document.body.classList.toggle("shotloom-canvas", presentation === "canvas");
  document.body.classList.toggle("shotloom-background", document.hidden);
}
if (isShotloomMode) document.addEventListener("visibilitychange", () => {
  document.body.classList.toggle("shotloom-background", document.hidden);
});
export function setShotloomPresentation(next: ShotloomPresentation): void {
  if (presentation === next) return;
  presentation = next;
  syncShotloomPresentationClass();
  for (const listener of presentationListeners) listener();
}
export function useShotloomPresentation(): ShotloomPresentation {
  return useSyncExternalStore(
    (listener) => { presentationListeners.add(listener); return () => { presentationListeners.delete(listener); }; },
    () => presentation,
    () => presentation,
  );
}
export function requestShotloomExpand(): void { hostUI?.requestExpand(); }
export function requestShotloomImport(): void { void hostUI?.requestImport(); }
export function requestShotloomExport(button?: HTMLElement): void {
  const rect = (button ?? document.activeElement)?.getBoundingClientRect();
  void hostUI?.requestExport(rect ? { anchor: { x: rect.right, y: rect.bottom, top: rect.top } } : {});
}
