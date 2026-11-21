import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import "./index.css";
import { PrevisMiniViewport } from "@/components/previs/previs-mini-viewport";
import { setPrevisLocale } from "@/host/i18n";
import type { PrevisScene } from "@/types/previs";

/**
 * Canvas card preview.
 *
 * The product canvas lives outside the engine iframe, so the node card embeds this tiny page
 * to reuse the upstream mini viewport instead of reimplementing its renderer. It mounts only
 * the lightweight top-down scene view (no workbench chrome) and receives the scene from the
 * host through `shotloom:previs-card`.
 */

const BOOT_PARAMS = new URLSearchParams(window.location.search);
if (BOOT_PARAMS.get("locale")) setPrevisLocale(BOOT_PARAMS.get("locale"));

function isScene(value: unknown): value is PrevisScene {
    return Boolean(value) && typeof value === "object" && Array.isArray((value as PrevisScene).objects) && Array.isArray((value as PrevisScene).shots);
}

function CardPreview() {
    const [scene, setScene] = useState<PrevisScene | null>(null);

    useEffect(() => {
        const receive = (event: MessageEvent) => {
            if (event.origin !== window.location.origin || event.source !== window.parent) return;
            const data = event.data as { type?: string; payload?: { scene?: unknown; locale?: string } } | null;
            if (!data || data.type !== "shotloom:previs-card") return;
            if (data.payload?.locale) setPrevisLocale(data.payload.locale);
            if (isScene(data.payload?.scene)) setScene(data.payload.scene);
        };
        window.addEventListener("message", receive);
        // Parents that mount the iframe after layout still get one handshake.
        window.parent?.postMessage({ type: "shotloom:previs-card-ready" }, window.location.origin);
        return () => window.removeEventListener("message", receive);
    }, []);

    if (!scene) return null;
    return (
        <div className="previs-card-preview-host">
            <PrevisMiniViewport scene={scene} />
        </div>
    );
}

const container = document.getElementById("previs-card-root");
if (!container) throw new Error("缺少 #previs-card-root 挂载点");
createRoot(container).render(<CardPreview />);
