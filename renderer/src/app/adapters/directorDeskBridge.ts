// 3D 导演台是 vendored 第三方应用，只通过 renderer/director-desk.html 以 iframe 运行，
// 与产品之间唯一的通道就是 postMessage。这里拥有那份私有协议：消息名、消息构造、
// 来源校验和回执整形都只写一次，画布组件只消费类型化的回调。
// 上游对端见项目根目录 vendor/storyai-3d-director-desk/src/editor/io/hostBridge.ts。

export type DirectorDeskTheme = "light" | "dark";

export type DirectorDeskPanorama = {
  edgeId: string;
  sourceNodeId: string;
  name: string;
  url: string;
};

export type DirectorDeskCapture = { dataUrl: string; fileName: string };

export type DirectorDeskHandlers = {
  onReady(): void;
  onInteraction(): void;
  onExitInteraction(): void;
  onDeleteNode(): void;
  onPanoramaRemoved(edgeId: string): void;
  onProjectChanged(project: Record<string, unknown>): void;
  onCaptures(captures: DirectorDeskCapture[]): void;
};

const messageType = {
  session: "storyai:director-desk-session",
  panorama: "storyai:director-desk-panorama",
  panoramaClear: "storyai:director-desk-panorama-clear",
  ready: "storyai:director-desk-ready",
  interaction: "storyai:director-desk-interaction",
  exitInteraction: "storyai:director-desk-exit-interaction",
  close: "storyai:director-desk-close",
  deleteNode: "storyai:director-desk-delete-node",
  panoramaRemoved: "storyai:director-desk-panorama-removed",
  projectChanged: "storyai:director-desk-project-changed",
  capturesSent: "storyai:director-desk-captures-sent",
};

export function directorDeskFrameSrc(instanceId: string, theme: DirectorDeskTheme) {
  // embedded 样式由导演台自己的 URL 参数决定，宿主只声明实例与主题。
  return `./director-desk.html?instanceId=${encodeURIComponent(instanceId)}&theme=${theme}`;
}

/** 整页工作区入口（侧栏「3D导演台」）：和画布节点共用同一个导演台文档。 */
export function directorDeskWorkspaceSrc(instanceId = ''): string {
  return `./director-desk.html?theme=light&workspace=${encodeURIComponent(instanceId)}`;
}

function post(frame: HTMLIFrameElement | null, message: { type: string; payload?: unknown }) {
  frame?.contentWindow?.postMessage(message, window.location.origin);
}

export function sendDirectorDeskSession(
  frame: HTMLIFrameElement | null,
  session: { instanceId: string; theme: DirectorDeskTheme; project: unknown },
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
    if (message.type === messageType.deleteNode) return handlers.onDeleteNode();
    if (message.type === messageType.panoramaRemoved) {
      return handlers.onPanoramaRemoved(String(payload.edgeId ?? ""));
    }
    if (message.type === messageType.projectChanged) {
      if (isRecord(payload.project)) handlers.onProjectChanged(payload.project);
      return;
    }
    if (message.type === messageType.capturesSent) handlers.onCaptures(readCaptures(payload.captures));
  };
  window.addEventListener("message", handleMessage);
  return () => window.removeEventListener("message", handleMessage);
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
    captures.push({ dataUrl, fileName });
  });
  return captures;
}
