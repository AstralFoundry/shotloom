import { useCallback, useEffect, useRef, useState } from "react";
import { App as AntApp } from "antd";
import { createRoot } from "react-dom/client";

import "./index.css";
import { CanvasPrevisWorkbench } from "@/components/previs/canvas-previs-workbench";
import { setPrevisBrandName } from "@/host/appearance";
import { installPrevisBridge, previsBridge, type PrevisBridgeContentNode, type PrevisBridgeInit } from "@/host/bridge";
import { createPrevisScene } from "@/lib/previs/previs-scene";
import type { PrevisScene } from "@/types/previs";

/**
 * Shotloom host shell for the world engine.
 *
 * The engine's workbench is a modal component that owns its scene document and reports every
 * change through callbacks. Inside the iframe there is no canvas behind it, so this shell
 * mounts it permanently open and forwards its scene to Shotloom over the bridge.
 */

const BOOT_PARAMS = new URLSearchParams(window.location.search);
const INSTANCE_ID = BOOT_PARAMS.get("instanceId") || `previs-${Date.now().toString(36)}`;

function toContentNodes(nodes: PrevisBridgeContentNode[] | undefined) {
    return (nodes ?? []).map((node) => ({
        id: node.id,
        title: node.title,
        metadata: { content: node.metadata?.content ?? node.metadata?.url, storageKey: node.metadata?.storageKey },
    }));
}

function PrevisHostApp() {
    const [scene, setScene] = useState<PrevisScene | null>(null);
    const [imageNodes, setImageNodes] = useState<ReturnType<typeof toContentNodes>>([]);
    const sceneIdRef = useRef<string | null>(null);

    /** Adopt a host scene exactly once per scene id; same-id echoes must not rebuild the session. */
    const adopt = useCallback((init: PrevisBridgeInit) => {
        if (init.brandName) setPrevisBrandName(init.brandName);
        setImageNodes(toContentNodes(init.imageNodes));
        const incomingId = init.scene?.id ?? null;
        if (incomingId && incomingId !== sceneIdRef.current) {
            sceneIdRef.current = incomingId;
            setScene(init.scene ?? null);
            return;
        }
        setScene((current) => {
            if (current) return current;
            const next = init.scene ?? createPrevisScene("未命名场景");
            sceneIdRef.current = next.id;
            return next;
        });
    }, []);

    useEffect(() => {
        const dispose = installPrevisBridge({
            onInit: adopt,
            onSceneChanged: (next) => {
                setScene((current) => (current && current.id === next.id ? next : current));
                previsBridge.sceneChanged(next);
            },
            onReady: () => previsBridge.ready(INSTANCE_ID),
            onClose: () => previsBridge.close(),
            onError: (message) => previsBridge.error(message),
        });
        previsBridge.ready(INSTANCE_ID);
        return dispose;
    }, [adopt]);

    const handleClose = useCallback(() => previsBridge.close(), []);
    const noop = useCallback(async () => undefined, []);
    const noopNode = useCallback(() => undefined, []);

    if (!scene) {
        return (
            <div className="previs-host-boot" role="status">
                <span className="previs-host-boot__dot" aria-hidden="true" />
                正在载入世界引擎…
            </div>
        );
    }

    return (
        <AntApp>
            <div className="previs-host-root">
                <CanvasPrevisWorkbench
                    open
                    canvasId={BOOT_PARAMS.get("canvasId") || undefined}
                    scene={scene}
                    imageNodes={imageNodes}
                    onboardingScope={BOOT_PARAMS.get("onboardingScope") || "shotloom-world-engine"}
                    onClose={handleClose}
                    onChange={setScene}
                    onApply={noop}
                    onAddToCanvas={noop}
                    onDeleteImageNode={noopNode}
                />
            </div>
        </AntApp>
    );
}

const container = document.getElementById("previs-root");
if (!container) throw new Error("缺少 #previs-root 挂载点");
createRoot(container).render(<PrevisHostApp />);
