import { editorMessage } from "../../shotloom-mode";
import "./ai-workspace.css";
import React, { useEffect, useState, useRef, useCallback } from "react";
import { ToolcraftText as Text, ToolcraftButton as Button } from "@openreel/ui";

import { Toolbar } from "./Toolbar";
import { EditorActionRail } from "./EditorActionRail";
import { AssetsPanel } from "./AssetsPanel";
import { Preview } from "./Preview";
import { InspectorPanel } from "./InspectorPanel";
import { Timeline } from "./Timeline";
import { KeyframeEditorPanel } from "./KeyframeEditorPanel";
import { AudioMixer } from "../audio-mixer";
import { KeyboardShortcutsOverlay } from "./KeyboardShortcutsOverlay";
import { PanelErrorBoundary } from "../ErrorBoundary";
import { SpotlightTour, MoGraphTour } from "./tour";
import { useProjectStore } from "../../stores/project-store";
import { SHORTCUTS_MODAL_ID, useUIStore } from "../../stores/ui-store";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useEditorInitialization } from "../../hooks/useEditorInitialization";
import { useCompactEditor } from "../../hooks/useCompactEditor";
import { isShotloomMode, useShotloomPresentation } from "../../shotloom-mode";
import "./editor-responsive.css";

const ChatPanel = React.lazy(() =>
  import("./chat/ChatPanel").then((module) => ({ default: module.ChatPanel })),
);

// Timeline area (bottom band) is sized as a container-height fraction so the
// top workspace (media | stage | inspector) gets the rest. The grid
// from the mockup is `1fr var(--tl-height)` rows — by default
// timeline is 58vh which leaves the top row with ~38–42vh of stage.
const DEFAULT_TIMELINE_VH = 42;
const MIN_TIMELINE_VH = 22;
const MAX_TIMELINE_VH = 70;
// Compact mode: timeline takes most of the height, leaving a small preview.
const COMPACT_TIMELINE_VH = 80;

const DEFAULT_MEDIA_W = 460;
const MIN_MEDIA_W = 320;
const MAX_MEDIA_W = 640;

const DEFAULT_INSPECTOR_W = 360;
const MIN_INSPECTOR_W = 280;
const MAX_INSPECTOR_W = 560;

const DEFAULT_CHAT_W = 380;
const MIN_CHAT_W = 320;
const MAX_CHAT_W = 560;

const MIN_STAGE_W = 380;
const RESIZE_HANDLE = 4;

type ResizeTarget = "timeline" | "media" | "inspector" | "chat";

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), Math.max(min, max));
};

/**
 * Auto-save initialization hook
 */
const useAutoSave = () => {
  const initializeAutoSave = useProjectStore((state) => state.initializeAutoSave);

  useEffect(() => {
    // 宿主负责保存工程快照，iframe 不再写 OpenReel 自己的 IndexedDB 自动存档。
    if (isShotloomMode) return;
    initializeAutoSave().catch(console.error);
  }, [initializeAutoSave]);
};

/**
 * Main Editor Interface — v2 cinematic layout.
 *
 * Grid (per mockup):
 *
 *   ┌─────────────── topbar ───────────────┐
 *   │                                      │
 *   │  media │   stage   │   inspector     │  ← top row (auto-fit)
 *   │   460  │   1fr     │      360        │
 *   ├──────────────────────────────────────┤
 *   │             timeline                 │  ← `tl-height` (%)
 *   └──────────────────────────────────────┘
 *
 * Column widths and timeline height are user-resizable via the
 * dividers between panels. Values are persisted to CSS custom
 * properties on the root grid so panels can pick them up.
 */
export const EditorInterface: React.FC = () => {
  const compact = useCompactEditor();
  const canvas = useShotloomPresentation() === "canvas";
  const [compactPanel, setCompactPanel] = useState<"timeline" | "media" | "inspector" | "chat">("timeline");
  const [hasOpenedChat, setHasOpenedChat] = useState(false);
  const { initialized, initializing, initError, initStatus, retry } =
    useEditorInitialization();

  useKeyboardShortcuts();
  useAutoSave();

  const shortcutsOverlayOpen = useUIStore(
    (state) => state.activeModal === SHORTCUTS_MODAL_ID,
  );
  const closeModal = useUIStore((state) => state.closeModal);
  const keyframeEditorOpen = useUIStore((state) => state.keyframeEditorOpen);
  const setKeyframeEditorOpen = useUIStore((state) => state.setKeyframeEditorOpen);
  const selectedItems = useUIStore((state) => state.selectedItems);
  const panels = useUIStore((state) => state.panels);
  const setPanelVisible = useUIStore((state) => state.setPanelVisible);
  const timelineMaximized = useUIStore((state) => state.timelineMaximized);
  const tracks = useProjectStore((state) => state.project.timeline.tracks);
  const updateClipKeyframes = useProjectStore((state) => state.updateClipKeyframes);

  const [selectedKeyframeIds, setSelectedKeyframeIds] = React.useState<string[]>([]);
  const [copiedKeyframes, setCopiedKeyframes] = React.useState<
    import("@openreel/core").Keyframe[]
  >([]);

  const selectedClip = React.useMemo(() => {
    const selectedIds = selectedItems.filter((item) => item.type === "clip").map((item) => item.id);
    if (selectedIds.length === 0) return null;
    const clipId = selectedIds[0];
    for (const track of tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return clip;
    }
    return null;
  }, [selectedItems, tracks]);

  // 参考剪辑台没有常驻的右侧属性列：宿主模式下 inspector 变成素材面板的「调整」标签，
  // 桌面栅格不再为它保留宽度；紧凑布局仍把它当作可切换的面板。
  const hasInspectorTarget = !isShotloomMode || compact;

  const handleUpdateKeyframe = React.useCallback(
    (
      keyframeId: string,
      updates: Partial<import("@openreel/core").Keyframe>,
    ) => {
      if (!selectedClip?.keyframes) return;
      const keyframes = selectedClip.keyframes.map((kf) =>
        kf.id === keyframeId ? { ...kf, ...updates } : kf,
      );
      updateClipKeyframes(selectedClip.id, keyframes);
    },
    [selectedClip, updateClipKeyframes],
  );

  const handleDeleteKeyframe = React.useCallback(
    (keyframeId: string) => {
      if (!selectedClip?.keyframes) return;
      const keyframes = selectedClip.keyframes.filter(
        (kf) => kf.id !== keyframeId,
      );
      updateClipKeyframes(selectedClip.id, keyframes);
      setSelectedKeyframeIds((prev) => prev.filter((id) => id !== keyframeId));
    },
    [selectedClip, updateClipKeyframes],
  );

  const handleCopyKeyframes = React.useCallback(
    (keyframeIds: string[]) => {
      if (!selectedClip?.keyframes) return;
      const toCopy = selectedClip.keyframes.filter((kf) =>
        keyframeIds.includes(kf.id),
      );
      setCopiedKeyframes(toCopy);
    },
    [selectedClip],
  );

  const handlePasteKeyframes = React.useCallback(
    (clipId: string, time: number) => {
      const targetClip = tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === clipId);
      if (!targetClip) return;
      const newKeyframes = copiedKeyframes.map((kf) => ({
        ...kf,
        id: `kf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        time: kf.time + time,
      }));
      updateClipKeyframes(clipId, [
        ...(targetClip.keyframes || []),
        ...newKeyframes,
      ]);
    },
    [copiedKeyframes, tracks, updateClipKeyframes],
  );

  const handleSelectKeyframe = React.useCallback(
    (keyframeId: string, addToSelection: boolean) => {
      if (addToSelection) {
        setSelectedKeyframeIds((prev) =>
          prev.includes(keyframeId)
            ? prev.filter((id) => id !== keyframeId)
            : [...prev, keyframeId],
        );
      } else {
        setSelectedKeyframeIds([keyframeId]);
      }
    },
    [],
  );

  // ── Layout state (resizable columns and timeline band) ──────────
  const rootRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<ResizeTarget | null>(null);
  const [mediaWidth, setMediaWidth] = useState(() => window.innerWidth < 1600 ? MIN_MEDIA_W : DEFAULT_MEDIA_W);
  const [inspectorWidth, setInspectorWidth] = useState(() => window.innerWidth < 1600 ? MIN_INSPECTOR_W : DEFAULT_INSPECTOR_W);
  const [chatWidth, setChatWidth] = useState(DEFAULT_CHAT_W);
  const [timelineVh, setTimelineVh] = useState(DEFAULT_TIMELINE_VH);

  const chatVisible = panels.agentChat?.visible ?? false;
  useEffect(() => {
    if (chatVisible) {
      setHasOpenedChat(true);
      if (compact) setCompactPanel("chat");
    }
  }, [chatVisible, compact]);
  const openCompactPanel = (panel: typeof compactPanel) => {
    setCompactPanel(panel);
    setPanelVisible("agentChat", panel === "chat");
    if (panel === "chat") setHasOpenedChat(true);
  };

  const mediaRef = useRef(mediaWidth);
  const inspectorRef = useRef(inspectorWidth);
  const chatRef = useRef(chatWidth);
  useEffect(() => {
    mediaRef.current = mediaWidth;
  }, [mediaWidth]);
  useEffect(() => {
    inspectorRef.current = inspectorWidth;
  }, [inspectorWidth]);
  useEffect(() => {
    chatRef.current = chatWidth;
  }, [chatWidth]);

  const beginResize = useCallback(
    (target: ResizeTarget) => (e: React.MouseEvent) => {
      e.preventDefault();
      resizeRef.current = target;
      document.body.style.cursor =
        target === "timeline" ? "row-resize" : "col-resize";
      document.body.style.userSelect = "none";
    },
    [],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const root = rootRef.current;
      const target = resizeRef.current;
      if (!root || !target) return;
      const bounds = root.getBoundingClientRect();
      const scaleX = bounds.width ? root.clientWidth / bounds.width : 1;
      const x = (e.clientX - bounds.left) * scaleX;
      const rect = { width: root.clientWidth, right: root.clientWidth, bottom: bounds.bottom, height: bounds.height };
      const chatOpen =
        useUIStore.getState().panels.agentChat?.visible ?? false;
      const chatOffset = chatOpen ? chatRef.current + RESIZE_HANDLE : 0;

      if (target === "media") {
        const maxByStage =
          rect.width - (chatOpen ? 0 : inspectorRef.current) - chatOffset - MIN_STAGE_W;
        setMediaWidth(
          clamp(x, MIN_MEDIA_W, Math.min(MAX_MEDIA_W, maxByStage)),
        );
        return;
      }
      if (target === "inspector") {
        const maxByStage =
          rect.width - mediaRef.current - chatOffset - MIN_STAGE_W;
        setInspectorWidth(
          clamp(
            rect.right - chatOffset - x,
            MIN_INSPECTOR_W,
            Math.min(MAX_INSPECTOR_W, maxByStage),
          ),
        );
        return;
      }
      if (target === "chat") {
        const maxByStage =
          rect.width -
          mediaRef.current -
          2 * RESIZE_HANDLE -
          MIN_STAGE_W;
        setChatWidth(
          clamp(
            rect.right - x,
            MIN_CHAT_W,
            Math.min(MAX_CHAT_W, maxByStage),
          ),
        );
        return;
      }
      // Timeline height follows the editor container, including embedded canvases.
      const vh = ((rect.bottom - e.clientY) / Math.max(1, rect.height)) * 100;
      setTimelineVh(clamp(vh, MIN_TIMELINE_VH, MAX_TIMELINE_VH));
    };

    const onUp = () => {
      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // Reflect resized panel sizes back into CSS variables so child styles
  // (timeline header padding, etc.) can react.
  useEffect(() => {
    const r = rootRef.current;
    if (!r) return;
    const tlVh = timelineMaximized ? COMPACT_TIMELINE_VH : timelineVh;
    r.style.setProperty("--media-w", `${mediaWidth}px`);
    r.style.setProperty("--inspector-w", `${inspectorWidth}px`);
    r.style.setProperty("--chat-w", `${chatWidth}px`);
    r.style.setProperty("--tl-height", `${tlVh}%`);
  }, [mediaWidth, inspectorWidth, chatWidth, timelineVh, timelineMaximized]);

  if (initializing || !initialized) {
    return (
      <div className="w-full h-full bg-bg flex items-center justify-center">
        <div className="text-center">
          {initError ? (
            <div role="alert" className="max-w-md space-y-4 px-6">
              <Text type="body" weight="bold">{editorMessage("editor.workspace.failed")}</Text>
              <Text type="supporting" className="text-status-error text-xs">{initError}</Text>
              <Button label={editorMessage("editor.workspace.retry")} onClick={retry} variant="primary" />
            </div>
          ) : (
            <div role="status">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <Text type="supporting" color="primary" className="text-fg-2 text-sm">{editorMessage("editor.workspace.initializing")}</Text>
              <Text type="supporting" color="secondary" className="text-fg-muted text-xs mt-2">{initStatus}</Text>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────
  // Grid template uses inline CSS for the resizable columns. The CSS
  // variables `--media-w`, `--inspector-w`, `--tl-height` are kept in
  // sync via the effect above so other components can use them too.
  const effectiveTimelineVh = timelineMaximized
    ? COMPACT_TIMELINE_VH
    : timelineVh;
  const gridStyle: React.CSSProperties = canvas
    ? { gridTemplateColumns: "minmax(0, 1fr)", gridTemplateRows: "calc(56.25cqw + var(--clip-preview-gap, 8px)) minmax(0, 1fr)", gridTemplateAreas: "'stage' 'timeline'" }
    : compact
    ? { gridTemplateColumns: "minmax(0, 1fr)", gridTemplateRows: "minmax(220px, 48%) minmax(0, 1fr)", gridTemplateAreas: `'stage' '${compactPanel}'` }
    : chatVisible
    ? {
        gridTemplateColumns: `${mediaWidth}px ${RESIZE_HANDLE}px minmax(0, 1fr) ${RESIZE_HANDLE}px ${chatWidth}px`,
        gridTemplateRows: `1fr ${RESIZE_HANDLE}px ${effectiveTimelineVh}%`,
        gridTemplateAreas:
          "'media mh stage ch chat' 'th th th th th' 'timeline timeline timeline timeline timeline'",
      }
    : !hasInspectorTarget
    ? {
        gridTemplateColumns: `${mediaWidth}px ${RESIZE_HANDLE}px minmax(0, 1fr)`,
        gridTemplateRows: `1fr ${RESIZE_HANDLE}px ${effectiveTimelineVh}%`,
        gridTemplateAreas:
          "'media mh stage' 'th th th' 'timeline timeline timeline'",
      }
    : {
        gridTemplateColumns: `${mediaWidth}px ${RESIZE_HANDLE}px 1fr ${RESIZE_HANDLE}px ${inspectorWidth}px`,
        gridTemplateRows: `1fr ${RESIZE_HANDLE}px ${effectiveTimelineVh}%`,
        gridTemplateAreas:
          "'media mh stage ih inspector' 'th th th th th' 'timeline timeline timeline timeline timeline'",
      };

  return (
    <div
      ref={rootRef}
      className={`editor-shell w-full h-full bg-bg text-fg overflow-hidden font-sans select-none relative z-20 flex flex-col ${compact ? "editor-compact" : ""} ${canvas ? "editor-canvas" : ""}`}
    >
      <Toolbar />

      <div className="editor-body flex-1 min-h-0 flex">
        {/* 参考剪辑台的编辑区最左侧就是素材面板，没有这条编辑器工具栏。
            宿主模式下它独有的四个入口（搜索 / 操作历史 / 关键帧编辑器 / 音频混音器）
            改挂在时间线工具条上，能力不丢。 */}
        {!isShotloomMode && (
          <div className="editor-rail" hidden={compact && compactPanel !== "media"}>
            <EditorActionRail />
          </div>
        )}
        <div
          className={`editor-workspace flex-1 min-w-0 min-h-0 grid gap-px bg-border ${chatVisible && !compact ? "ai-workspace-grid" : ""}`}
          style={gridStyle}
        >
        <div
          id="editor-panel-media"
          hidden={compact && compactPanel !== "media"}
          className="editor-panel bg-bg-1 min-w-0 min-h-0 overflow-hidden"
          style={{ gridArea: "media" }}
        >
          <PanelErrorBoundary name="Media">
            <AssetsPanel />
          </PanelErrorBoundary>
        </div>

        <div
          hidden={compact}
          className="editor-resizer bg-border hover:bg-brand-accent/30 cursor-col-resize"
          style={{ gridArea: "mh" }}
          onMouseDown={beginResize("media")}
          role="separator"
          aria-label={editorMessage("editor.workspace.resizeMedia")}
          aria-orientation="vertical"
          aria-valuenow={mediaWidth}
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); setMediaWidth((w) => clamp(w + (e.key === "ArrowRight" ? 20 : -20), MIN_MEDIA_W, MAX_MEDIA_W)); } }}
        >
          <span className="hidden" />
        </div>

        <div
          className="editor-stage bg-bg-1 min-w-0 min-h-0 overflow-hidden"
          style={{ gridArea: "stage" }}
        >
          <PanelErrorBoundary name="Stage">
            <Preview />
          </PanelErrorBoundary>
        </div>

        {!chatVisible && hasInspectorTarget && <><div
          hidden={compact}
          className="editor-resizer bg-border hover:bg-brand-accent/30 cursor-col-resize"
          style={{ gridArea: "ih" }}
          onMouseDown={beginResize("inspector")}
        >
          <span className="hidden" />
        </div>

        <div
          id="editor-panel-inspector"
          hidden={compact && compactPanel !== "inspector"}
          className="editor-panel bg-bg-1 min-w-0 min-h-0 overflow-hidden"
          style={{ gridArea: "inspector" }}
        >
          <PanelErrorBoundary name="Inspector">
            <InspectorPanel />
          </PanelErrorBoundary>
        </div></>}

        {(chatVisible || hasOpenedChat) && (
          <>
            <div
              hidden={compact || !chatVisible}
              className="ai-chat-resizer editor-resizer grid place-items-center cursor-col-resize group/h"
              style={{ gridArea: "ch" }}
              onMouseDown={beginResize("chat")}
              role="separator"
              aria-label={editorMessage("editor.workspace.resizeChat")}
              aria-orientation="vertical"
              aria-valuenow={chatWidth}
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); setChatWidth((w) => clamp(w + (e.key === "ArrowLeft" ? 20 : -20), MIN_CHAT_W, MAX_CHAT_W)); } }}
            >
              <span className="hidden" />
            </div>

            <div
              id="editor-panel-chat"
              hidden={!chatVisible || (compact && compactPanel !== "chat")}
              className="editor-panel bg-bg-1 min-w-0 min-h-0 overflow-hidden"
              style={{ gridArea: "chat" }}
            >
              <PanelErrorBoundary name="AI Editor">
                <React.Suspense
                  fallback={
                    <div className="grid h-full place-items-center text-xs text-fg-muted">
                      Loading AI Editor…
                    </div>
                  }
                >
                  <ChatPanel
                    onClose={() => { setPanelVisible("agentChat", false); if (compact) setCompactPanel("timeline"); }}
                  />
                </React.Suspense>
              </PanelErrorBoundary>
            </div>
          </>
        )}

        <div
          hidden={compact}
          className="editor-resizer bg-border hover:bg-brand-accent/30 cursor-row-resize"
          style={{ gridArea: "th" }}
          onMouseDown={beginResize("timeline")}
        >
          <span className="w-10 h-1 rounded-full bg-transparent group-hover/h:bg-accent/40 transition-colors" />
        </div>

        <div
          id="editor-panel-timeline"
          hidden={compact && compactPanel !== "timeline"}
          className="editor-panel bg-bg-1 min-w-0 min-h-0 overflow-hidden flex flex-col"
          style={{ gridArea: "timeline" }}
        >
          {panels.audioMixer?.visible && (
            <div className="shrink-0 border-b border-border">
              <PanelErrorBoundary name={editorMessage("editor.workspace.audioMixer")}>
                <AudioMixer
                  visible
                  onClose={() => setPanelVisible("audioMixer", false)}
                />
              </PanelErrorBoundary>
            </div>
          )}

          {compact && selectedItems.length > 0 && (
            <button type="button" onClick={() => openCompactPanel("inspector")} className="shrink-0 text-xs text-accent bg-accent/10">
              Edit selected clip · trim, captions, audio & effects
            </button>
          )}
          <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0 min-h-0">
              <PanelErrorBoundary name="Timeline">
                <Timeline />
              </PanelErrorBoundary>
            </div>

            {keyframeEditorOpen && (
              <div className="shrink-0 min-w-0 border-l border-border">
                <PanelErrorBoundary name={editorMessage("editor.workspace.keyframes")}>
                  <KeyframeEditorPanel
                    clip={selectedClip}
                    onClose={() => setKeyframeEditorOpen(false)}
                    onUpdateKeyframe={handleUpdateKeyframe}
                    onDeleteKeyframe={handleDeleteKeyframe}
                    onCopyKeyframes={handleCopyKeyframes}
                    onPasteKeyframes={handlePasteKeyframes}
                    selectedKeyframeIds={selectedKeyframeIds}
                    onSelectKeyframe={handleSelectKeyframe}
                    copiedKeyframes={copiedKeyframes}
                  />
                </PanelErrorBoundary>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>

      {compact && (
        <nav aria-label={editorMessage("editor.workspace.workspace")} className="editor-workspace-tabs">
          {([
            ["timeline", "editor.workspace.timeline"], ["media", "editor.workspace.media"], ["inspector", "editor.workspace.inspector"], ["chat", "editor.workspace.chat"],
          ] as const).map(([panel, label]) => (
            <button key={panel} type="button" aria-controls={`editor-panel-${panel}`} aria-pressed={compactPanel === panel}
              onClick={() => openCompactPanel(panel)} className={compactPanel === panel ? "text-brand-accent border-brand-accent" : "text-fg-3 border-transparent hover:text-fg"}>
              {editorMessage(label)}
            </button>
          ))}
        </nav>
      )}

      <KeyboardShortcutsOverlay
        isOpen={shortcutsOverlayOpen}
        onClose={closeModal}
      />

      <SpotlightTour />
      <MoGraphTour />
    </div>
  );
};

export default EditorInterface;
