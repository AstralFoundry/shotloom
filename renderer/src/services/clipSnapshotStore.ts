import { t } from '../i18n/index.ts';
import { assertNativeSnapshot } from '../domain/editor/NativeSnapshot';
import { desktopApi } from "./desktopApi.ts";
import type { OpenReelNativeState } from "../../../vendor/openreel/apps/web/src/embedded/runtime-types";

const SNAPSHOT_DIR = "project.sqlite#editor";
// Failed drafts outlive the React editor that produced them. A remount may
// recover them, while writes to the same file remain ordered across writers.
const drafts = new Map<string, OpenReelNativeState>();
const fileWrites = new Map<string, Promise<unknown>>();
const readers = new Map<string, () => Promise<OpenReelNativeState>>();
export type SnapshotSaveStatus = "dirty" | "saving" | "saved" | "failed";

/** Capture the engine's latest revision before copying, including edits not yet posted to the host. */
export function registerClipSnapshotReader(directory: string, nodeId: string, read: () => Promise<OpenReelNativeState>) {
  const path = snapshotAbsolutePath(directory, nodeId);
  readers.set(path, read);
  return () => { if (readers.get(path) === read) readers.delete(path); };
}

function safeNodeId(nodeId: string) {
  return String(nodeId || "editor").replace(/[\\/:*?"<>|]/g, "-");
}

export function snapshotRelativePath(nodeId: string) {
  return `${SNAPSHOT_DIR}/${safeNodeId(nodeId)}`;
}

export function snapshotAbsolutePath(projectDir: string, nodeId: string) {
  const dir = String(projectDir || "").replace(/[\\/]$/, "");
  return `${dir}/${snapshotRelativePath(nodeId)}`;
}

export async function readNativeSnapshot(
  projectDir: string,
  nodeId: string,
  expected = false,
): Promise<OpenReelNativeState | null> {
  if (!projectDir) return null;
  const path = snapshotAbsolutePath(projectDir, nodeId);
  const reader = readers.get(path);
  if (reader) {
    const live = await reader();
    assertNativeSnapshot(live);
    return JSON.parse(JSON.stringify(live));
  }
  const draft = drafts.get(path);
  if (draft) return JSON.parse(JSON.stringify(draft));
  const parsed: unknown = await desktopApi.project.getEditorSnapshot(projectDir, nodeId);
  if (parsed == null) {
    if (expected) throw new Error(t("editor.snapshot.missing"));
    return null;
  }
  assertNativeSnapshot(parsed);
  return parsed;

}

export async function writeNativeSnapshot(
  projectDir: string,
  nodeId: string,
  native: OpenReelNativeState,
): Promise<string | null> {
  if (!projectDir || !native) return null;
  assertNativeSnapshot(native);
  const path = snapshotAbsolutePath(projectDir, nodeId);
  const captured = structuredClone(native);
  const previous = fileWrites.get(path) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const written = await desktopApi.project.setEditorSnapshot(projectDir, nodeId, captured);
    if (!written) throw new Error(t("editor.snapshot.writeFailed"));
    return snapshotRelativePath(nodeId);
  });
  fileWrites.set(path, operation);
  try { return await operation; }
  finally { if (fileWrites.get(path) === operation) fileWrites.delete(path); }
}

export function createSnapshotWriter(
  projectDir: string,
  nodeId: string,
  delay = 800,
  onError: (error: Error) => void = (error) => console.error("[openreel] snapshot write failed", error),
  onStatus: (status: SnapshotSaveStatus) => void = () => {},
) {
  const path = snapshotAbsolutePath(projectDir, nodeId);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: OpenReelNativeState | null = drafts.get(path) || null;
  let writing: Promise<void> = Promise.resolve();

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    // Serialise writes even when another flush has already consumed pending.
    // A failed write retains its draft; an explicit flush can retry it.
    writing = writing.catch(() => {}).then(async () => {
      while (pending) {
        const snapshot = pending;
        pending = null;
        if (drafts.get(path) !== snapshot) continue;
        try {
          onStatus("saving");
          await writeNativeSnapshot(projectDir, nodeId, snapshot);
          if (drafts.get(path) === snapshot) drafts.delete(path);
          onStatus(pending || drafts.has(path) ? "dirty" : "saved");
        } catch (cause) {
          if (!pending && drafts.get(path) === snapshot) pending = snapshot;
          const error = cause instanceof Error ? cause : new Error(String(cause));
          onStatus("failed");
          onError(error);
          throw error;
        }
      }
    });
    return writing;
  };

  const schedule = (snapshot: OpenReelNativeState) => {
    pending = JSON.parse(JSON.stringify(snapshot));
    drafts.set(path, pending!);
    onStatus("dirty");
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void flush().catch(() => {}); }, delay);
  };

  return { schedule, flush, dispose: flush };
}
