import { useCallback, useEffect, useRef } from 'react';
import { sendDirectorDeskProjectSaved, sendDirectorDeskSession, subscribeDirectorDesk } from '../adapters/directorDeskBridge';
import { useAppStore } from '../store/appStore';

/**
 * 整页 3D 导演台工作区（侧栏「3D导演台」入口）：iframe 运行 vendored 导演台，
 * 与画布节点共用同一份 postMessage 协议，只是宿主换成整页容器。
 * 场景按工程存本地草稿，导演台运行时本身不碰产品存储。
 */
const STORAGE_PREFIX = 'shotloom:director-workspace:';

export function DirectorWorkspace({ src, onReady }: { src: (instanceId: string) => string; onReady?: () => void }) {
  const projectId = useAppStore((state) => state.currentProject?.id ?? 'local');
  const frameRef = useRef<HTMLIFrameElement>(null);
  const storageKey = `${STORAGE_PREFIX}${projectId}`;

  // 会话：导演台就绪后把本工程的草稿灌进去（没有草稿时用空项目，由导演台自己建默认场景）。
  const sendSession = useCallback(() => {
    let project: unknown = null;
    try {
      const raw = window.localStorage.getItem(storageKey);
      project = raw ? JSON.parse(raw) : null;
    } catch {
      project = null;
    }
    sendDirectorDeskSession(frameRef.current, { instanceId: `workspace-${projectId}`, theme: 'light', project });
  }, [projectId, storageKey]);

  useEffect(() => {
    const unsubscribe = subscribeDirectorDesk(() => frameRef.current, {
      onReady: () => {
        sendSession();
        onReady?.();
      },
      onInteraction: () => undefined,
      // 整页工作区里导演台自己的按钮就是工作区按钮：不需要额外转发。
      onExitInteraction: () => undefined,
      onDeleteNode: () => undefined,
      onPanoramaRemoved: () => undefined,
      onProjectChanged: (project) => {
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(project));
        } catch {
          // 草稿写不进去不影响本次编辑，画布节点那条链路仍会持久化。
        }
        // 回执「已保存」，导演台顶栏的同步状态才能落回稳定态。
        sendDirectorDeskProjectSaved(frameRef.current);
      },
      onCaptures: (captures) => {
        for (const capture of captures) {
          const link = document.createElement('a');
          link.href = capture.dataUrl;
          link.download = capture.fileName;
          link.click();
        }
      },
    });
    return unsubscribe;
  }, [onReady, sendSession, storageKey]);

  return (
    <section className="director-workspace" aria-label="3D导演台" data-director-workspace="true">
      <iframe ref={frameRef} className="director-workspace-frame" src={src(`workspace-${projectId}`)} title="3D导演台" onLoad={sendSession} />
    </section>
  );
}
