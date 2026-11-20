// 世界引擎（open-ai-canvas 性能预演工作台）从 vendor/open-ai-canvas-previs 独立构建，
// 通过 iframe 运行，与产品之间唯一的通道就是 postMessage。这里拥有那份私有协议：
// 消息名、消息构造、来源校验和回执整形都只写一次，画布与工作区只消费类型化的回调。
// 对端见 vendor/open-ai-canvas-previs/src/host/bridge.ts。

export type PrevisWorldTheme = "light" | "dark";

/** 世界引擎场景文档。字段与 vendor 的 PrevisScene 对应；宿主只保存和转交，不解释渲染。 */
export type PrevisSceneDocument = {
  id: string;
  version: 1;
  title: string;
  background: string;
  environmentIntensity: number;
  environment?: { mode: string; [key: string]: unknown };
  world?: { timeOfDay: number; weather: string; ground: string; groundSize: number; horizon: boolean };
  gridVisible: boolean;
  objects: Array<Record<string, unknown>>;
  cameras: Array<Record<string, unknown>>;
  lights: Array<Record<string, unknown>>;
  shots: Array<Record<string, unknown>>;
  activeShotId: string;
  createdAt: string;
  updatedAt: string;
};

export type PrevisWorldImageNode = {
  id: string;
  title: string;
  metadata?: { content?: string; storageKey?: string; url?: string };
};

export type PrevisWorldCapture = { dataUrl: string; fileName: string; kind: "image" | "video" };

/** Compact description the canvas card can render without opening the engine. */
export type PrevisWorldSummary = {
  actors: number;
  props: number;
  objects: number;
  cameras: number;
  lights: number;
  shots: number;
  duration: number;
  /** Active shot name and duration, for the canvas card. */
  shotName: string;
  shotDuration: number;
};

export type PrevisWorldHandlers = {
  onReady(): void;
  onSceneChanged(scene: PrevisSceneDocument): void;
  onCaptures(captures: PrevisWorldCapture[]): void;
  onAddToCanvas(capture: PrevisWorldCapture): void;
  onClose?(): void;
  onError?(message: string): void;
};

const PREFIX = "shotloom:previs";

export function previsWorldFrameSrc(instanceId: string, theme: PrevisWorldTheme) {
  return `./previs-world-app/index.html?instanceId=${encodeURIComponent(instanceId)}&theme=${theme}`;
}

/** Canvas card preview: only the top-down mini viewport, never the workbench chrome. */
export function previsCardSrc(instanceId: string, locale: string) {
  return `./previs-world-app/card.html?instanceId=${encodeURIComponent(instanceId)}&locale=${encodeURIComponent(locale)}`;
}

export function sendPrevisCardScene(frame: HTMLIFrameElement | null, scene: PrevisSceneDocument | null, locale?: string) {
  frame?.contentWindow?.postMessage(plainMessage({ type: "shotloom:previs-card", payload: { scene, ...(locale ? { locale } : {}) } }), window.location.origin);
}

/** The card page posts this once its listener is installed; only then can it receive a scene. */
export function subscribePrevisCardReady(getFrame: () => HTMLIFrameElement | null, onReady: () => void) {
  const receive = (event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.source !== getFrame()?.contentWindow) return;
    if ((event.data as { type?: unknown } | null)?.type !== "shotloom:previs-card-ready") return;
    onReady();
  };
  window.addEventListener("message", receive);
  return () => window.removeEventListener("message", receive);
}

/**
 * Push a whole scene document into the engine.
 *
 * The workspace and a canvas node keep separate scene copies, so moving work between them
 * needs an explicit hand-off; there is no shared store to sync.
 */
export function sendPrevisScene(frame: HTMLIFrameElement | null, scene: PrevisSceneDocument | null) {
  post(frame, { type: `${PREFIX}-scene`, payload: { scene } });
}

export function sendPrevisImages(frame: HTMLIFrameElement | null, imageNodes: PrevisWorldImageNode[]) {
  post(frame, { type: `${PREFIX}-images`, payload: { imageNodes } });
}

export function sendPrevisSession(
  frame: HTMLIFrameElement | null,
  session: { instanceId: string; scene: PrevisSceneDocument | null; imageNodes?: PrevisWorldImageNode[]; brandName?: string; locale?: string },
) {
  post(frame, { type: `${PREFIX}-init`, payload: session });
}

function post(frame: HTMLIFrameElement | null, message: { type: string; payload?: unknown }) {
  frame?.contentWindow?.postMessage(plainMessage(message), window.location.origin);
}

/**
 * Only plain data may cross into the iframe.
 *
 * Project state lives in the domain store, whose reads hand back deep Proxies, and the
 * structured clone behind postMessage cannot copy a Proxy: it throws DataCloneError
 * synchronously. Everything sent here is persisted as JSON anyway, so a JSON round trip
 * loses nothing.
 */
function plainMessage<T>(message: T): T {
  return JSON.parse(JSON.stringify(message)) as T;
}

// 详情窗口会随开合挂载和卸载，所以按取值器读取当前 frame，注册期间换窗口也不会漏消息。
export function subscribePrevisWorld(getFrame: () => HTMLIFrameElement | null, handlers: PrevisWorldHandlers) {
  const handleMessage = (event: MessageEvent) => {
    // 只接受同源且确实来自当前引擎窗口的消息；其他 iframe 或扩展发来同名消息不算协议。
    if (event.origin !== window.location.origin || event.source !== getFrame()?.contentWindow) return;
    const message = event.data as { type?: unknown; payload?: Record<string, unknown> } | null;
    if (!message || typeof message.type !== "string" || !message.type.startsWith(PREFIX)) return;
    const payload = message.payload ?? {};
    if (message.type === `${PREFIX}-ready`) return handlers.onReady();
    if (message.type === `${PREFIX}-close`) return handlers.onClose?.();
    if (message.type === `${PREFIX}-scene-changed`) {
      const scene = readPrevisScene(payload.scene);
      if (scene) handlers.onSceneChanged(scene);
      return;
    }
    if (message.type === `${PREFIX}-captures`) {
      handlers.onCaptures(readCaptures(payload.captures));
      return;
    }
    if (message.type === `${PREFIX}-add-canvas`) {
      const [capture] = readCaptures([payload.capture]);
      if (capture) handlers.onAddToCanvas(capture);
      return;
    }
    if (message.type === `${PREFIX}-error`) {
      handlers.onError?.(String(payload.message ?? ""));
    }
  };
  window.addEventListener("message", handleMessage);
  return () => window.removeEventListener("message", handleMessage);
}

export function readPrevisScene(value: unknown): PrevisSceneDocument | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.objects) || !Array.isArray(value.shots) || !Array.isArray(value.cameras) || !Array.isArray(value.lights)) return null;
  if (typeof value.id !== "string" || typeof value.title !== "string") return null;
  return value as PrevisSceneDocument;
}

export function previsWorldSummary(scene: PrevisSceneDocument | null): PrevisWorldSummary | null {
  if (!scene) return null;
  const shots = scene.shots.filter(isRecord);
  const duration = shots.reduce((total, shot) => total + (typeof shot.duration === "number" && Number.isFinite(shot.duration) ? shot.duration : 0), 0);
  const active = shots.find((shot) => shot.id === scene.activeShotId) ?? shots[0];
  return {
    actors: scene.objects.filter((object) => object.kind === "actor" || object.primitive === "character").length,
    props: scene.objects.filter((object) => object.kind !== "actor" && object.primitive !== "character").length,
    objects: scene.objects.filter((object) => object.visible !== false).length,
    cameras: scene.cameras.length,
    lights: scene.lights.length,
    shots: shots.length,
    duration,
    shotName: typeof active?.name === "string" ? active.name : "",
    shotDuration: typeof active?.duration === "number" && Number.isFinite(active.duration) ? active.duration : 0,
  };
}

function readCaptures(value: unknown): PrevisWorldCapture[] {
  if (!Array.isArray(value)) return [];
  const captures: PrevisWorldCapture[] = [];
  value.forEach((entry, index) => {
    if (!isRecord(entry)) return;
    const dataUrl = typeof entry.dataUrl === "string" ? entry.dataUrl : "";
    if (!dataUrl) return;
    const fileName = typeof entry.fileName === "string" && entry.fileName ? entry.fileName : `previs-capture-${index + 1}.png`;
    captures.push({ dataUrl, fileName, kind: entry.kind === "video" ? "video" : "image" });
  });
  return captures;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
