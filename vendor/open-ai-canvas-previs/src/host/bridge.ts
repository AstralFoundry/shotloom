import type { PrevisScene } from "@/types/previs";

/**
 * Host bridge between the world engine and Shotloom.
 *
 * The engine runs in an iframe built from `vendor/open-ai-canvas-previs`; everything that
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
export type PrevisBridgeCapture = { dataUrl: string; fileName: string; kind: "image" | "video" };

export type PrevisBridgeHandlers = {
    onInit(init: PrevisBridgeInit): void;
    onSceneChanged(scene: PrevisScene): void;
    onReady?(): void;
    onClose?(): void;
    onError?(message: string): void;
    /** Beauty/depth/normal/pose screenshots and clay/depth videos written back to the host. */
    onCaptures?(captures: PrevisBridgeCapture[]): void;
    /** A single screenshot the user asked to add to the canvas. */
    onAddToCanvas?(capture: PrevisBridgeCapture): void;
};

const PREFIX = "shotloom:previs";

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
        if (event.origin !== window.location.origin) return;
        const data = event.data as HostMessage | null;
        if (!data || typeof data.type !== "string" || !data.type.startsWith(PREFIX)) return;
        if (data.type === "shotloom:previs-init") {
            current = { ...data.payload, scene: isScene(data.payload.scene) ? data.payload.scene : null, imageNodes: Array.isArray(data.payload.imageNodes) ? data.payload.imageNodes : [] };
            handlers.onInit(current);
            return;
        }
        if (!current) return;
        if (data.type === "shotloom:previs-scene") {
            current = { ...current, scene: isScene(data.payload.scene) ? data.payload.scene : null };
            handlers.onInit(current);
            return;
        }
        if (data.type === "shotloom:previs-images") {
            current = { ...current, imageNodes: Array.isArray(data.payload.imageNodes) ? data.payload.imageNodes : [] };
            handlers.onInit(current);
        }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
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
        if (captures.length) send("captures", { captures });
    },
    addToCanvas(capture: PrevisBridgeCapture) {
        send("add-canvas", { capture });
    },
    error(message: string) {
        send("error", { message });
    },
    close() {
        send("close");
    },
};
