import { useCallback, useEffect, useRef } from 'react';
import { create } from 'zustand';
import {
  directorDeskAgentProtocol,
  sendDirectorDeskProjectSaved,
  sendDirectorDeskSceneLoad,
  sendDirectorDeskSession,
  subscribeDirectorDesk,
} from '../adapters/directorDeskBridge';
import { useAppStore } from '../store/appStore';
import { useDirectorSceneHandoffStore } from '../store/directorSceneHandoffStore';
import { registerDirectorDeskFrame } from '../../services/directorDeskAgentRuntime';
import { store, touchProject } from '../../store/projectStore';
import { nodeActions } from '../adapters/canvasAdapter';

/**
 * 整页 3D 导演台工作区（侧栏「3D导演台」入口）：iframe 运行 vendored 导演台，
 * 与画布节点共用同一份 postMessage 协议，只是宿主换成整页容器。
 * 场景按工程存本地草稿，导演台运行时本身不碰产品存储。
 *
 * 与画布节点是两份独立文档，所以「从节点带入 / 发送到节点」走
 * directorSceneHandoffStore 中转，而不是假装它们共享状态。
 */
const STORAGE_PREFIX = 'shotloom:director-workspace:';

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

export function DirectorWorkspace({ src, onReady }: { src: (instanceId: string) => string; onReady?: () => void }) {
  const projectId = useAppStore((state) => state.currentProject?.id ?? 'local');
  const frameRef = useRef<HTMLIFrameElement>(null);
  /** Latest document this instance reported, used when sending it to a canvas node. */
  const latestDocument = useRef<unknown>(null);
  const storageKey = `${STORAGE_PREFIX}${projectId}`;
  useEffect(() => registerDirectorDeskFrame(frameRef.current, directorDeskAgentProtocol), []);

  // Publish a reader so the surrounding shell can move this scene onto a canvas node.
  useEffect(() => {
    useDirectorWorkspaceExport.getState().setRequest(() => latestDocument.current);
    return () => useDirectorWorkspaceExport.getState().setRequest(null);
  }, []);

  // 会话：导演台就绪后把本工程的草稿灌进去（没有草稿时用空项目，由导演台自己建默认场景）。
  const sendSession = useCallback(() => {
    let project: unknown = store.project.directorWorkspaceProject ?? null;
    try {
      const raw = project ? null : window.localStorage.getItem(storageKey);
      if (raw) project = JSON.parse(raw);
      if (project && (project as { format?: string; version?: number }).format !== 'director-desk') {
        project = null;
      }
    } catch {
      project = null;
    }
    sendDirectorDeskSession(frameRef.current, { instanceId: `workspace-${projectId}`, theme: 'light', project });
  }, [projectId, storageKey]);

  /**
   * Push a scene handed over from a canvas node into this workspace.
   *
   * Applied after the desk reports ready: sending before the bridge is listening would drop
   * the message, and the hand-off is consumed once so a remount cannot replay it.
   */
  const applyHandoff = useCallback(() => {
    const handoff = useDirectorSceneHandoffStore.getState().takeHandoff();
    if (!handoff) return;
    sendDirectorDeskSceneLoad(frameRef.current, handoff.document, handoff.label);
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeDirectorDesk(() => frameRef.current, {
      onReady: () => {
        sendSession();
        applyHandoff();
        onReady?.();
      },
      onInteraction: () => undefined,
      // 整页工作区里导演台自己的按钮就是工作区按钮：不需要额外转发。
      onExitInteraction: () => undefined,
      onPanoramaRemoved: () => undefined,
      onProjectChanged: (project) => {
        latestDocument.current = project;
        store.project.directorWorkspaceProject = project;
        touchProject();
        try { window.localStorage.removeItem(storageKey); } catch { /* browser storage unavailable */ }
        // 回执「已保存」，导演台顶栏的同步状态才能落回稳定态。
        sendDirectorDeskProjectSaved(frameRef.current);
      },
      onCaptures: async (captures) => {
        for (const capture of captures) {
          const result = await nodeActions.exportDirectorAsset('', capture.dataUrl, capture.fileName, capture.kind);
          if (!result) throw new Error('未能创建导出节点');
        }
      },
    });
    return unsubscribe;
  }, [applyHandoff, onReady, sendSession, storageKey]);

  return (
    <section className="director-workspace" aria-label="3D导演台" data-director-workspace="true">
      <iframe
        ref={frameRef}
        className="director-workspace-frame"
        src={src(`workspace-${projectId}`)}
        title="3D导演台"
        onLoad={sendSession}
      />
    </section>
  );
}
