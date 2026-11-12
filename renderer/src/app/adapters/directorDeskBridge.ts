// 3D 导演台从 vendor/shotloom-director-desk 独立构建，通过 iframe 运行，
// 与产品之间唯一的通道就是 postMessage。这里拥有那份私有协议：消息名、消息构造、
// 来源校验和回执整形都只写一次，画布组件只消费类型化的回调。
// 对端见 vendor/shotloom-director-desk/src/app/host-bridge.ts。

export type DirectorDeskTheme = "light" | "dark";

export type DirectorDeskPanorama = {
  edgeId: string;
  sourceNodeId: string;
  name: string;
  url: string;
};

export type DirectorDeskCapture = { dataUrl: string; fileName: string; kind: 'image' | 'video' };

/** Compact description the canvas card can render without opening the desk. */
export type DirectorDeskSummary = {
  actors: number;
  cameras: number;
  shots: number;
  duration: number;
};
export const directorDeskAgentProtocol = {
  request: 'storyai:director-desk-agent-request',
  result: 'storyai:director-desk-agent-result',
};

export type DirectorDeskHandlers = {
  onReady(): void;
  onInteraction(): void;
  onExitInteraction(): void;
  onOpenAgent?(): void;
  onPanoramaRemoved(edgeId: string): void;
  onProjectChanged(project: Record<string, unknown>): void;
  onCaptures(captures: DirectorDeskCapture[]): void | Promise<void>;
  /** Scene totals, sent on ready and after every edit. */
  onSceneSummary?(summary: DirectorDeskSummary): void;
  /** What the director currently has selected, for card and chat context. */
  onSelectionChanged?(selection: { id: string; name: string; kind: string }): void;
  /**
   * The desk could not apply what the host sent (most importantly, the saved scene). The desk
   * keeps the host's data untouched in that case, so the user must hear about it rather than
   * see an empty starter scene and assume the work is gone.
   */
  onError?(error: string): void;
};

const messageType = {
  session: "storyai:director-desk-session",
  panorama: "storyai:director-desk-panorama",
  panoramaClear: "storyai:director-desk-panorama-clear",
  ready: "storyai:director-desk-ready",
  interaction: "storyai:director-desk-interaction",
  exitInteraction: "storyai:director-desk-exit-interaction",
  close: "storyai:director-desk-close",
  openAgent: "storyai:director-desk-open-agent",
  panoramaRemoved: "storyai:director-desk-panorama-removed",
  projectChanged: "storyai:director-desk-project-changed",
  capturesSent: "storyai:director-desk-captures-sent",
  sceneSummary: "storyai:director-desk-scene-summary",
  selectionChanged: "storyai:director-desk-selection-changed",
  sceneLoad: "storyai:director-desk-scene-load",
  error: "storyai:director-desk-error",
};

/**
 * Push a whole scene document into the desk.
 *
 * The full-page workspace and a canvas node keep separate copies of a scene, so moving work
 * between them needs an explicit hand-off; there is no shared store to sync.
 */
export function sendDirectorDeskSceneLoad(
  frame: HTMLIFrameElement | null,
  document: unknown,
  label?: string,
) {
  post(frame, { type: messageType.sceneLoad, payload: { document, ...(label ? { label } : {}) } });
}

export function directorDeskFrameSrc(instanceId: string, theme: DirectorDeskTheme) {
  // embedded 样式由导演台自己的 URL 参数决定，宿主只声明实例与主题。
  return `./director-desk-app/index.html?instanceId=${encodeURIComponent(instanceId)}&theme=${theme}`;
}

/** 整页工作区入口（侧栏「3D导演台」）：和画布节点共用同一个导演台文档。 */
export function directorDeskWorkspaceSrc(instanceId = ''): string {
  return `./director-desk-app/index.html?theme=light&workspace=${encodeURIComponent(instanceId)}`;
}

function post(frame: HTMLIFrameElement | null, message: { type: string; payload?: unknown }) {
  frame?.contentWindow?.postMessage(plainMessage(message), window.location.origin);
}

/**
 * Only plain data may cross into the iframe.
 *
 * Project state lives in the domain store, whose reads hand back deep Proxies, and the
 * structured clone behind postMessage cannot copy a Proxy: it throws DataCloneError
 * synchronously. The session message carries the node's saved scene, so that throw meant
 * the desk never received it and silently opened its starter scene after every reload —
 * while the node still held the real one on disk. Everything sent here is persisted as
 * JSON anyway, so a JSON round trip loses nothing.
 */
function plainMessage<T>(message: T): T {
  return JSON.parse(JSON.stringify(message)) as T;
}

export function sendDirectorDeskSession(
  frame: HTMLIFrameElement | null,
  session: { instanceId: string; theme: DirectorDeskTheme; locale: 'zh-CN' | 'en-US'; project: unknown },
) {
  post(frame, { type: messageType.session, payload: session });
}

// 没有上游图片时必须显式清除，否则导演台会一直留着上一次的全景图。
export function sendDirectorDeskPanorama(
  frame: HTMLIFrameElement | null,
  panorama: DirectorDeskPanorama | null,
) {
  if (!panorama) {
    post(frame, { type: messageType.panoramaClear });
    return;
  }
  post(frame, {
    type: messageType.panorama,
    payload: {
      edgeId: panorama.edgeId,
      sourceNodeId: panorama.sourceNodeId,
      imageUrl: panorama.url,
      fileName: panorama.name,
    },
  });
}

/** 宿主已把项目写回节点/草稿，回执给导演台，让它把「同步中」恢复成「已保存」。 */
export function sendDirectorDeskProjectSaved(frame: HTMLIFrameElement | null) {
  post(frame, { type: "storyai:director-desk-project-saved" });
}

// 详情窗口会随开合挂载和卸载，所以按取值器读取当前 frame，注册期间换窗口也不会漏消息。
export function subscribeDirectorDesk(
  getFrame: () => HTMLIFrameElement | null,
  handlers: DirectorDeskHandlers,
) {
  const handleMessage = (event: MessageEvent) => {
    // 只接受同源且确实来自当前导演台窗口的消息；其他 iframe 或扩展发来同名消息不算协议。
    if (event.origin !== window.location.origin || event.source !== getFrame()?.contentWindow) return;
    const message = event.data as { type?: unknown; payload?: Record<string, unknown> } | null;
    if (!message || typeof message.type !== "string") return;
    const payload = message.payload ?? {};
    if (message.type === messageType.ready) return handlers.onReady();
    if (message.type === messageType.interaction) return handlers.onInteraction();
    // 详情窗口没有自己的标题栏，导演台顶栏的 × 与退出交互走同一个收起动作。
    if (message.type === messageType.exitInteraction || message.type === messageType.close) {
      return handlers.onExitInteraction();
    }
    if (message.type === messageType.openAgent) return handlers.onOpenAgent?.();
    if (message.type === messageType.panoramaRemoved) {
      return handlers.onPanoramaRemoved(String(payload.edgeId ?? ""));
    }
    if (message.type === messageType.projectChanged) {
      if (isRecord(payload.project)) handlers.onProjectChanged(payload.project);
      return;
    }
    if (message.type === messageType.capturesSent) {
      const requestId = typeof payload.requestId === 'string' ? payload.requestId : '';
      const source = event.source as Window | null;
      void Promise.resolve().then(() => handlers.onCaptures(readCaptures(payload.captures)))
        .then(() => {
          if (requestId) source?.postMessage({ type: 'storyai:director-desk-captures-saved', payload: { requestId, success: true } }, window.location.origin);
        })
        .catch((error) => {
          if (requestId) source?.postMessage({ type: 'storyai:director-desk-captures-saved', payload: { requestId, success: false, error: String(error) } }, window.location.origin);
        });
      return;
    }
    if (message.type === messageType.sceneSummary) {
      const summary = readSummary(payload.summary);
      if (summary) handlers.onSceneSummary?.(summary);
      return;
    }
    if (message.type === messageType.selectionChanged) {
      handlers.onSelectionChanged?.({
        id: String(payload.id ?? ""),
        name: String(payload.name ?? ""),
        kind: String(payload.kind ?? ""),
      });
      return;
    }
    if (message.type === messageType.error) {
      handlers.onError?.(String(payload.error ?? ""));
      return;
    }
  };
  window.addEventListener("message", handleMessage);
  return () => window.removeEventListener("message", handleMessage);
}

function readSummary(value: unknown): DirectorDeskSummary | null {
  if (!isRecord(value)) return null;
  const num = (input: unknown) => (typeof input === "number" && Number.isFinite(input) ? input : 0);
  return {
    actors: num(value.actors),
    cameras: num(value.cameras),
    shots: num(value.shots),
    duration: num(value.duration),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readCaptures(value: unknown): DirectorDeskCapture[] {
  if (!Array.isArray(value)) return [];
  const captures: DirectorDeskCapture[] = [];
  value.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    const dataUrl = typeof entry.dataUrl === "string" ? entry.dataUrl : "";
    if (!dataUrl) return;
    const fileName =
      typeof entry.fileName === "string" && entry.fileName
        ? entry.fileName
        : `director-desk-capture-${index + 1}.png`;
    captures.push({ dataUrl, fileName, kind: entry.kind === 'video' ? 'video' : 'image' });
  });
  return captures;
}
