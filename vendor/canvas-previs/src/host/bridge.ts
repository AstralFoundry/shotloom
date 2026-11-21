import type { PrevisScene } from "@/types/previs";

/**
 * Host bridge between the world engine and Shotloom.
 *
 * The engine runs in an iframe built from `vendor/canvas-previs`; everything that
 * crosses the boundary is plain JSON, never live objects. This file owns the protocol on the
 * engine side — message names mirror `renderer/src/app/adapters/previsBridge.ts`, which is the
 * only host reader. Every message is validated before it touches engine state.
 */

export type PrevisBridgeContentNode = {
    id: string;
    title: string;
    metadata?: { content?: string; storageKey?: string; url?: string };
};

export type PrevisBridgeInit = {
    instanceId: string;
    artifactScope?: string;
    locale?: string;
    brandName?: string;
    canvasId?: string;
    /** Existing scene document straight from the host, or null for a fresh one. */
    scene?: PrevisScene | null;
    /** Canvas image nodes the engine may use as billboards or a 360° backdrop. */
    imageNodes?: PrevisBridgeContentNode[];
};

/** One rendered artifact handed back to the host canvas as a data URL. */
export type PrevisBridgeCapture = { dataUrl: string; fileName: string; kind: "image" | "video"; prompt?: string; renderMode?: string };

/**
 * Host → engine messages. Scene changes, captures and close/error travel the other way
 * through `previsBridge`, so they are not handlers here.
 */
export type PrevisBridgeHandlers = {
    onInit(init: PrevisBridgeInit, replace?: boolean): void;
    onImages(imageNodes: PrevisBridgeContentNode[]): void;
};

const PREFIX = "shotloom:previs";
const pending = new Map<string, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();

function request(suffix: string, payload: Record<string, unknown>): Promise<void> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            pending.delete(requestId);
            reject(new Error("宿主未确认操作结果，请检查画布后重试"));
        }, 120_000);
        pending.set(requestId, { resolve, reject, timer });
        send(suffix, { ...payload, requestId });
    });
}

type HostMessage =
    | { type: "shotloom:previs-init"; payload: PrevisBridgeInit }
    | { type: "shotloom:previs-scene"; payload: { scene: PrevisScene | null } }
    | { type: "shotloom:previs-images"; payload: { imageNodes: PrevisBridgeContentNode[] } };

function send(suffix: string, payload: Record<string, unknown> = {}) {
    if (window.parent === window) return;
    window.parent.postMessage({ type: `${PREFIX}-${suffix}`, payload }, window.location.origin);
}

function isScene(value: unknown): value is PrevisScene {
    return Boolean(value) && typeof value === "object" && Array.isArray((value as PrevisScene).objects) && Array.isArray((value as PrevisScene).shots);
}

export function installPrevisBridge(handlers: PrevisBridgeHandlers) {
    // The latest init is kept so incremental messages (scene swap, image list) keep the rest.
    let current: PrevisBridgeInit | null = null;

    const receive = (event: MessageEvent) => {
        if (event.origin !== window.location.origin || event.source !== window.parent) return;
        if (event.data?.type === `${PREFIX}-result`) {
            const result = event.data.payload;
            const job = pending.get(result?.requestId);
            if (!job) return;
            pending.delete(result.requestId);
            clearTimeout(job.timer);
            if (result.ok === true) job.resolve();
            else job.reject(new Error(String(result.error || "宿主操作失败，请重试")));
            return;
        }
        const data = event.data as HostMessage | null;
        if (!data || typeof data.type !== "string" || !data.type.startsWith(PREFIX)) return;
        if (!data.payload || typeof data.payload !== "object") return;
        if (data.type === "shotloom:previs-init") {
            current = { ...data.payload, scene: isScene(data.payload.scene) ? data.payload.scene : null, imageNodes: Array.isArray(data.payload.imageNodes) ? data.payload.imageNodes : [] };
            handlers.onInit(current);
            return;
        }
        if (!current) return;
        if (data.type === "shotloom:previs-scene") {
            current = { ...current, scene: isScene(data.payload.scene) ? data.payload.scene : null };
            handlers.onInit(current, true);
            return;
        }
        if (data.type === "shotloom:previs-images") {
            current = { ...current, imageNodes: Array.isArray(data.payload.imageNodes) ? data.payload.imageNodes : [] };
            handlers.onImages(current.imageNodes ?? []);
        }
    };
    window.addEventListener("message", receive);
    return () => {
        window.removeEventListener("message", receive);
        for (const job of pending.values()) {
            clearTimeout(job.timer);
            job.reject(new Error("世界引擎会话已关闭"));
        }
        pending.clear();
    };
}

/** Engine → host messages. */
export const previsBridge = {
    ready(instanceId: string) {
        send("ready", { instanceId });
    },
    sceneChanged(scene: PrevisScene) {
        send("scene-changed", { scene, sceneId: scene.id, updatedAt: scene.updatedAt });
    },
    captures(captures: PrevisBridgeCapture[]) {
        return captures.length ? request("captures", { captures }) : Promise.resolve();
    },
    addToCanvas(capture: PrevisBridgeCapture) {
        return request("add-canvas", { capture });
    },
    addPrompt(title: string, prompt: string) {
        return request("add-prompt", { title, prompt });
    },
    flush() {
        return request("flush", {});
    },
    error(message: string) {
        send("error", { message });
    },
    close() {
        send("close");
    },
};
