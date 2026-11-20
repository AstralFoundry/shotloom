import { useCallback, useEffect, useRef, useState } from "react";
import { App as AntApp } from "antd";
import { createRoot } from "react-dom/client";

import "./index.css";
import { CanvasPrevisWorkbench } from "@/components/previs/canvas-previs-workbench";
import { setPrevisBrandName } from "@/host/appearance";
import { installPrevisBridge, previsBridge, type PrevisBridgeCapture, type PrevisBridgeContentNode, type PrevisBridgeInit } from "@/host/bridge";
import { setPrevisLocale } from "@/host/i18n";
import type { PrevisCanvasExport, PrevisScene, PrevisSceneOutput } from "@/types/previs";
import { createPrevisScene } from "@/lib/previs/previs-scene";

/**
 * Shotloom host shell for the world engine.
 *
 * The engine's workbench is a modal component that owns its scene document and reports every
 * change through callbacks. Inside the iframe there is no canvas behind it, so this shell
 * mounts it permanently open and forwards its scene, captures and exports to Shotloom over
 * the bridge.
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

function readBlob(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error ?? new Error("读取输出文件失败"));
        reader.readAsDataURL(blob);
    });
}

async function capture(blob: Blob | undefined, fileName: string, kind: PrevisBridgeCapture["kind"]): Promise<PrevisBridgeCapture | null> {
    if (!blob) return null;
    return { dataUrl: await readBlob(blob), fileName, kind };
}

function PrevisHostApp() {
    const [scene, setScene] = useState<PrevisScene | null>(null);
    const [imageNodes, setImageNodes] = useState<ReturnType<typeof toContentNodes>>([]);
    const sceneIdRef = useRef<string | null>(null);

    /** Adopt a host scene exactly once per scene id; same-id echoes must not rebuild the session. */
    const adopt = useCallback((init: PrevisBridgeInit) => {
        if (init.brandName) setPrevisBrandName(init.brandName);
        if (init.locale) setPrevisLocale(init.locale);
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
        const dispose = installPrevisBridge({ onInit: adopt });
        previsBridge.ready(INSTANCE_ID);
        return dispose;
    }, [adopt]);

    /**
     * Every committed scene edit must reach Shotloom: the canvas card and the saved project
     * are derived from this message. `setScene` alone only updates the engine's own render.
     */
    const handleSceneChange = useCallback((next: PrevisScene) => {
        setScene((current) => (current && current.id === next.id ? next : current));
        previsBridge.sceneChanged(next);
    }, []);

    const handleClose = useCallback(() => previsBridge.close(), []);
    const noopNode = useCallback(() => undefined, []);

    /** 「回写构图/白膜/深度」：把该镜头本次渲染的所有产物交回画布。 */
    const applyOutput = useCallback(async (output: PrevisSceneOutput) => {
        setScene(output.scene);
        previsBridge.sceneChanged(output.scene);
        const shotName = output.shot.name || "镜头";
        const captures = (await Promise.all([
            capture(output.beauty, `${shotName}-构图.png`, "image"),
            capture(output.depth, `${shotName}-深度.png`, "image"),
            capture(output.normal, `${shotName}-法线.png`, "image"),
            capture(output.pose, `${shotName}-骨骼.png`, "image"),
            capture(output.clayVideo, `${shotName}-白膜.mp4`, "video"),
            capture(output.depthVideo, `${shotName}-深度.mp4`, "video"),
        ])).filter((item): item is PrevisBridgeCapture => item !== null);
        previsBridge.captures(captures);
    }, []);

    /** 「加入画布」：单张截图或纯提示词，由宿主决定落成哪个节点。 */
    const addToCanvas = useCallback(async (output: PrevisCanvasExport) => {
        if (output.kind !== "screenshot") return;
        const shot = await capture(output.image, `${output.title || "构图"}.png`, "image");
        if (shot) previsBridge.addToCanvas(shot);
    }, []);

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
                    onChange={handleSceneChange}
                    onApply={applyOutput}
                    onAddToCanvas={addToCanvas}
                    onDeleteImageNode={noopNode}
                />
            </div>
        </AntApp>
    );
}

const container = document.getElementById("previs-root");
if (!container) throw new Error("缺少 #previs-root 挂载点");
createRoot(container).render(<PrevisHostApp />);
