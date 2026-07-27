import "./styles/index.css";
import { useEffect, useState } from "react";
import { ArrowUp, LoaderCircle, X } from "lucide-react";
import { DirectorDeskShell } from "./app/layout/DirectorDeskShell";
import { DirectorCanvas } from "./editor/canvas/DirectorCanvas";
import { requestViewportCapture } from "./editor/io/captureBridge";
import {
  clearDirectorDeskHostBridge,
  initDirectorDeskHostBridge,
  postDirectorDeskCapturesToHost,
} from "./editor/io/hostBridge";
import { buildCaptureFileName } from "./editor/io/screenshotExport";
import { useDirectorStore } from "./editor/store/directorStore";

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;

  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export default function App() {
  const [exportingPhoto, setExportingPhoto] = useState(false);
  const embeddedInCanvas = new URLSearchParams(window.location.search).get("embedded") === "canvas";
  const viewMode = useDirectorStore((state) => state.viewMode);
  const setViewMode = useDirectorStore((state) => state.setViewMode);

  useEffect(() => {
    initDirectorDeskHostBridge();
    window.parent?.postMessage({ type: "storyai:director-desk-ready" }, window.location.origin);
    return clearDirectorDeskHostBridge;
  }, []);

  function handleClose() {
    window.parent?.postMessage({ type: "storyai:director-desk-close" }, window.location.origin);
  }

  async function handleExportPhoto() {
    if (exportingPhoto) return;
    setExportingPhoto(true);
    try {
      const results = await requestViewportCapture({
        preset: "current",
        source: "capture-panel",
      });
      postDirectorDeskCapturesToHost(
        results.map((result, index) => ({
          dataUrl: result.dataUrl,
          fileName: buildCaptureFileName(result, index),
        }))
      );
    } finally {
      setExportingPhoto(false);
    }
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isEditableShortcutTarget(event.target)) return;
      if (!event.metaKey && !event.ctrlKey) return;

      const key = event.key.toLowerCase();
      if (key === "c") {
        event.preventDefault();
        useDirectorStore.getState().copySelectedObjects();
        return;
      }

      if (key === "v") {
        event.preventDefault();
        useDirectorStore.getState().pasteClipboardObjects();
        return;
      }

      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        useDirectorStore.getState().undo();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="top-bar-left">
          <h1 className="top-bar-title">3D导演台</h1>
        </div>
        <div className="top-bar-center">
          <div className="mode-toggle ui-segmented" role="group" aria-label="视角切换">
            <button
              className={`mode-toggle-button ui-segmented-item ${viewMode === "director" ? "ui-segmented-item-active" : ""}`}
              aria-pressed={viewMode === "director"}
              type="button"
              onClick={() => setViewMode("director")}
            >
              导演视角
            </button>
            <button
              className={`mode-toggle-button ui-segmented-item ${viewMode === "camera" ? "ui-segmented-item-active" : ""}`}
              aria-pressed={viewMode === "camera"}
              type="button"
              onClick={() => setViewMode("camera")}
            >
              机位视角
            </button>
          </div>
        </div>
        <div className="top-bar-actions">
          <button
            className="top-bar-export-button"
            type="button"
            aria-label="导出为照片"
            title="导出为照片"
            disabled={exportingPhoto}
            onClick={() => void handleExportPhoto()}
          >
            {exportingPhoto ? (
              <LoaderCircle className="top-bar-export-spinner" aria-hidden="true" size={17} strokeWidth={2} />
            ) : (
              <ArrowUp aria-hidden="true" size={17} strokeWidth={2} />
            )}
          </button>
          {!embeddedInCanvas ? (
            <button
              className="top-bar-action-button"
              type="button"
              aria-label="关闭"
              title="关闭"
              onClick={handleClose}
            >
              <X aria-hidden="true" size={16} strokeWidth={1.8} />
            </button>
          ) : null}
        </div>
      </header>
      <DirectorDeskShell>
        <DirectorCanvas />
      </DirectorDeskShell>
    </div>
  );
}
