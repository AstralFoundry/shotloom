import type { VideoEditorAsset, VideoEditorProject } from '../app/editor/videoEditorTypes';
import type { OpenReelActionCatalog, OpenReelActionResult, OpenReelImportedAsset, OpenReelNativeState, OpenReelNativeToolResult } from '../../../vendor/openreel/apps/web/src/embedded/runtime-types';
import { assertAgentProject, getAgentProjectFenceKey } from './agentProjectIdentity';
import type { AgentToolContext } from '../agent/core/types';

export const WORKSPACE_VIDEO_EDITOR_ID = 'workspace-video-editor';
export interface EditorSession {
  projectKey: string;
  nodeId: string;
  read: () => VideoEditorProject;
  commit: (project: VideoEditorProject) => void;
  playhead: () => number;
  selectedClipId: () => string;
  seek: (time: number) => void;
  undo: () => boolean;
  redo: () => boolean;
  canUndo: () => boolean;
  canRedo: () => boolean;
  exportProject: (project: VideoEditorProject, requestKey?: string) => Promise<unknown>;
  refreshState: () => Promise<void>;
  native: () => OpenReelNativeState | null;
  actionCatalog: () => OpenReelActionCatalog | null;
  executeActions: (
    actions: Array<{ type: string; params?: Record<string, unknown> }>,
    options: { validateOnly?: boolean; description?: string },
  ) => Promise<OpenReelActionResult>;
  importAsset: (asset: VideoEditorAsset) => Promise<OpenReelImportedAsset | null>;
  executeNativeTool: (name: string, input: Record<string, unknown>) => Promise<OpenReelNativeToolResult>;
}


const editors = new Map<string, { session: EditorSession; fenceKey: string }>();
const listeners = new Set<() => void>();
let launcher: ((nodeId: string) => void) | undefined;
export function registerVideoEditorLauncher(next: (nodeId: string) => void) {
  launcher = next;
  return () => { if (launcher === next) launcher = undefined; };
}
export function registerActiveVideoEditor(session: EditorSession) {
  const entry = { session, fenceKey: getAgentProjectFenceKey() };
  editors.set(session.nodeId, entry);
  listeners.forEach(listener => listener());
  return () => { if (editors.get(session.nodeId) === entry) editors.delete(session.nodeId); };
}
export function videoEditorSession(projectKey: string, nodeId: string) {
  const entry = editors.get(nodeId);
  return entry?.session.projectKey === projectKey && entry.fenceKey === getAgentProjectFenceKey() ? entry.session : undefined;
}

/** UI owns mounting; resolve only after the requested runtime is actually ready. */
export async function prepareVideoEditor(nodeId: string, context: AgentToolContext): Promise<EditorSession> {
  assertAgentProject(context.projectKey, context.projectInstanceId, context.projectGeneration);
  const current = videoEditorSession(context.projectKey, nodeId);
  if (current) return current;
  if (!launcher) throw new Error('Video editor launcher is unavailable');
  return new Promise((resolve, reject) => {
    const finish = (error?: Error, session?: EditorSession) => {
      clearTimeout(timer); listeners.delete(check); context.signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(session!);
    };
    const check = () => {
      try {
        assertAgentProject(context.projectKey, context.projectInstanceId, context.projectGeneration);
        const session = videoEditorSession(context.projectKey, nodeId);
        if (session) finish(undefined, session);
      } catch (error) { finish(error as Error); }
    };
    const abort = () => finish(new Error('Editor preparation was cancelled'));
    const timer = setTimeout(() => finish(new Error('Video editor did not become ready; retry after it finishes loading')), 45000);
    listeners.add(check);
    context.signal.addEventListener('abort', abort, { once: true });
    if (context.signal.aborted) { abort(); return; }
    try { launcher!(nodeId); check(); } catch (error) { finish(error as Error); }
  });
}
