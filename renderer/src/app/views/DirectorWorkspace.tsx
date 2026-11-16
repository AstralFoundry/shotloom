import { getResolvedAppTheme, subscribeAppTheme } from '../../services/appTheme';
import { useCallback, useEffect, useRef } from 'react';
import { getLocale, t } from '@/i18n';
import { create } from 'zustand';
import { installDirectorDeskHostChrome } from '../adapters/directorDeskHostChrome';
import {
  directorDeskAgentProtocol,
  sendDirectorDeskProjectSaved,
  sendDirectorDeskPanorama,
  sendDirectorDeskSession,
  sendDirectorDeskTheme,
  subscribeDirectorDesk,
} from '../adapters/directorDeskBridge';
import { useAppStore } from '../store/appStore';
import { registerDirectorDeskFrame, markDirectorDeskReady } from '../../services/directorDeskAgentRuntime';
import { store, touchProject } from '../../store/projectStore';
import { showToast } from '../../store/notificationStore';
import { nodeActions } from '../adapters/canvasAdapter';
import { desktopApi } from '../../services/desktopApi';
import { getAgentProjectFenceKey } from '../../services/agentProjectIdentity';
import { recordDiagnosticEvent } from '../../services/diagnosticsService';

/**
 * 导演台的可见工作区与后台运行时共用协议、持久化和导出处理。
 * nodeId 绑定节点场景，省略时绑定独立工作区草稿；后台挂载不改变导航。
 */
const STORAGE_PREFIX = 'shotloom:director-workspace:';
type WorkspaceBackup = { savedAt: number; project: Record<string, unknown> };

function readWorkspaceBackup(key: string): WorkspaceBackup | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || 'null');
    if (value && Number.isFinite(value.savedAt) && value.project?.format === 'director-desk') return value;
  } catch { /* browser storage unavailable or corrupt */ }
  return null;
}

/**
 * Lets the workspace's own toolbar ask this iframe for its current document.
 *
 * The document lives inside the iframe, so the only way out is a message round-trip. A tiny
 * store keeps that request out of React props plumbing between distant views.
 */
interface WorkspaceExportState {
  request: (() => unknown | null) | null;
  setRequest: (handler: (() => unknown | null) | null) => void;
}
export const useDirectorWorkspaceExport = create<WorkspaceExportState>((set) => ({
  request: null,
  setRequest: (handler) => set({ request: handler }),
}));

export function DirectorWorkspace({ src, nodeId, background = false, onReady, onExit, onOpenAgent }: { nodeId?: string | undefined; background?: boolean; src: (instanceId: string, theme?: 'light' | 'dark') => string; onReady?: () => void; onExit?: () => void; onOpenAgent?: (entityId?: string) => void }) {
  const projectId = useAppStore((state) => state.currentProject?.id ?? 'local');
  const frameRef = useRef<HTMLIFrameElement>(null);
  const initialTheme = useRef(getResolvedAppTheme());
  useEffect(() => subscribeAppTheme(() => sendDirectorDeskTheme(frameRef.current, getResolvedAppTheme())), []);
  /** Latest document this instance reported, used when sending it to a canvas node. */
  const latestDocument = useRef<unknown>(null);
  const storageKey = `${STORAGE_PREFIX}${projectId}`;
  useEffect(() => registerDirectorDeskFrame(frameRef.current, directorDeskAgentProtocol, nodeId, { background, ready: false }), [nodeId, background]);
  useEffect(() => {
    recordDiagnosticEvent({ category: 'runtime', name: 'director-workspace-mounted', data: { projectId } });
    return () => { recordDiagnosticEvent({ category: 'runtime', name: 'director-workspace-unmounted', data: { projectId } }); };
  }, [projectId]);

  // Publish a reader so the surrounding shell can move this scene onto a canvas node.
  useEffect(() => {
    if (nodeId || background) return;
    useDirectorWorkspaceExport.getState().setRequest(() => latestDocument.current);
    return () => useDirectorWorkspaceExport.getState().setRequest(null);
  }, [nodeId, background]);

  // 会话：导演台就绪后把本工程的草稿灌进去（没有草稿时用空项目，由导演台自己建默认场景）。
  const sendSession = useCallback(() => {
    const node = nodeId ? store.project.nodes.find((item: { id: string }) => item.id === nodeId) : undefined;
    let project: unknown = nodeId ? node?.directorData?.project ?? null : store.project.directorWorkspaceProject ?? null;
    const backup = nodeId ? null : readWorkspaceBackup(storageKey);
    if (backup && backup.savedAt > Number(store.project.directorWorkspaceSavedAt || 0)) {
      project = backup.project;
      store.project.directorWorkspaceProject = backup.project;
      store.project.directorWorkspaceSavedAt = backup.savedAt;
      touchProject();
    }
    if (project && (project as { format?: string }).format !== 'director-desk') project = null;
    sendDirectorDeskSession(frameRef.current, { instanceId: nodeId || `workspace-${projectId}`, artifactScope: projectId, theme: getResolvedAppTheme(), locale: getLocale(), project });
    if (nodeId) void nodeActions.getDirectorIncomingImages(nodeId).then(images => {
      const image = images.at(-1);
      sendDirectorDeskPanorama(frameRef.current, image ? { edgeId: image.edgeId, sourceNodeId: image.nodeId, name: image.name, url: image.url } : null);
    });
  }, [projectId, storageKey, nodeId]);

  useEffect(() => {
    const unsubscribe = subscribeDirectorDesk(() => frameRef.current, {
      onReady: () => {
        sendSession();
        onReady?.();
      },
      onInteraction: () => undefined,
      onExitInteraction: () => onExit?.(),
      onOpenAgent: (entityId) => onOpenAgent?.(entityId),
      onPanoramaRemoved: () => undefined,
      onProjectChanged: (project) => {
        markDirectorDeskReady(frameRef.current);
        latestDocument.current = project;
        if (nodeId) {
          const node = store.project.nodes.find((item: { id: string }) => item.id === nodeId);
          if (node) nodeActions.update(nodeId, { directorData: { ...node.directorData, project }, updatedAt: new Date().toISOString() });
          sendDirectorDeskProjectSaved(frameRef.current);
          return;
        }
        const savedAt = Date.now();
        try { window.localStorage.setItem(storageKey, JSON.stringify({ savedAt, project })); } catch { /* browser storage unavailable */ }
        store.project.directorWorkspaceProject = project;
        store.project.directorWorkspaceSavedAt = savedAt;
        touchProject();
        // 回执「已保存」，导演台顶栏的同步状态才能落回稳定态。
        sendDirectorDeskProjectSaved(frameRef.current);
      },
      onCover: async dataUrl => {
        if (!nodeId) return;
        const fence = getAgentProjectFenceKey();
        const node = store.project.nodes.find((item: { id: string }) => item.id === nodeId);
        const project = node?.directorData?.project;
        const saved = await desktopApi.file.saveDataUrlToProject(dataUrl, `director-cover-${nodeId}-${Date.now()}.png`);
        const path = String(saved?.filePath || saved?.path || '');
        if (path && fence === getAgentProjectFenceKey() && node?.directorData?.project === project) {
          nodeActions.update(nodeId, { directorData: { ...node.directorData, coverPath: path } });
        }
      },
      onCaptures: async (captures) => {
        const outputs = [];
        for (const capture of captures) {
          const result = await nodeActions.exportDirectorAsset(nodeId || '', capture.dataUrl, capture.fileName, capture.kind, capture.directorContext);
          if (!result) throw new Error('未能创建导出节点');
          outputs.push(result);
        }
        return outputs;
      },
      onError: (error) => showToast(t('director.loadFailed', { error }), 'error'),
    });
    return unsubscribe;
  }, [onExit, onOpenAgent, onReady, sendSession, storageKey, nodeId]);

  return (
    <section className="director-workspace" aria-label="3D导演台" data-director-workspace="true">
      <iframe
        ref={frameRef}
        className="director-workspace-frame"
        src={src(nodeId || `workspace-${projectId}`, initialTheme.current)}
        title="3D导演台"
        onLoad={() => {
          installDirectorDeskHostChrome(frameRef.current);
          sendSession();
        }}
      />
    </section>
  );
}
