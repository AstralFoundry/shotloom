import { editorMessage } from "../../shotloom-mode";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { Captions, Shuffle } from "@/icons/lucide-compat";
import { useProjectStore } from "../../stores/project-store";
import { useTimelineStore } from "../../stores/timeline-store";
import { useUIStore } from "../../stores/ui-store";
import { useEngineStore } from "../../stores/engine-store";
import type { Transform, EditingTemplatePrimitive } from "@openreel/core";
import {
  ChromaKeyEngine,
  getMediaItemCapabilities,
  type CaptionAnimationStyle,
  CAPTION_ANIMATION_STYLES,
} from "@openreel/core";
import { mergeEditingTemplateControlValues } from "./panels/EditingTemplateControls";
import {
  getAudioBridgeEffects,
  initializeAudioBridgeEffects,
  DEFAULT_NOISE_REDUCTION,
} from "../../bridges/audio-bridge-effects";
import { toast } from "../../stores/notification-store";
import {
  FONT_CATEGORIES,
  FONT_FILE_ACCEPT,
  registerCustomFont,
  useCustomFonts,
} from "./inspector/font-options";
import { getNoiseReductionPreset } from "./inspector/noise-reduction-presets";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftFileDropControl as FileInput } from "@openreel/ui";
import { ToolcraftNumberInputControl } from "@openreel/ui";
import { ToolcraftSelectableCard as SelectableCard } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import { ColorSelector } from "../../motion/components/primitives";
import {
  getTabIdsForClipType,
  type InspectorClipType,
} from "./inspector/clip-tabs.config";
import { InspectorClipHeader } from "./inspector/shell/InspectorClipHeader";
import { InspectorTabErrorBoundary } from "./inspector/shell/InspectorTabErrorBoundary";
import { InspectorSection } from "./inspector/shell/InspectorSection";
import { ColorTab } from "./inspector/tabs/ColorTab";
import { AudioTab } from "./inspector/tabs/AudioTab";
import { TransformTab } from "./inspector/tabs/TransformTab";
import { SpeedTab } from "./inspector/tabs/SpeedTab";
import { AnimateTab } from "./inspector/tabs/AnimateTab";
import { StyleTab } from "./inspector/tabs/StyleTab";
import { EffectsTab } from "./inspector/tabs/EffectsTab";
import { AiTab } from "./inspector/tabs/AiTab";
import { TransitionInspector } from "./inspector/TransitionInspector";
import { MultiClipInspector } from "./inspector/MultiClipInspector";
import { QuickEditBar } from "./QuickEditBar";
import { useInspectorNavigationStore } from "../../stores/inspector-navigation-store";

const MultiCameraPanel = React.lazy(() => import("./inspector/MultiCameraPanel"));

// Initialize engines as singletons
const chromaKeyEngine = new ChromaKeyEngine({ width: 1920, height: 1080 });

const Section = InspectorSection;

const componentToHex = (value: number): string =>
  Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, "0");

const cssColorToHex = (value: string | undefined, fallback: string): string => {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
    if (trimmed.length === 4) {
      const [, r, g, b] = trimmed;
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    return trimmed.toLowerCase();
  }

  const rgba = trimmed.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i,
  );
  if (!rgba) return fallback;

  return `#${componentToHex(Number(rgba[1]))}${componentToHex(
    Number(rgba[2]),
  )}${componentToHex(Number(rgba[3]))}`;
};

const cssColorAlpha = (
  value: string | undefined,
  fallback: "0" | "0.5" | "0.7" | "1" = "0.7",
): "0" | "0.5" | "0.7" | "1" => {
  const alpha = value?.match(/rgba?\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)/i)?.[1];
  if (alpha === "0" || alpha === "0.5" || alpha === "0.7" || alpha === "1") {
    return alpha;
  }
  return fallback;
};

const rgbaFromHex = (hex: string, alpha: string): string => {
  const value = cssColorToHex(hex, "#000000");
  const r = parseInt(value.slice(1, 3), 16);
  const g = parseInt(value.slice(3, 5), 16);
  const b = parseInt(value.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const EmptyState: React.FC = () => (
  <div className="flex-1 flex flex-col items-center justify-center p-10 text-center">
    <Text type="body" weight="semibold" display="block" className="mb-1.5 text-sm text-fg">
      No selection
    </Text>
    <Text type="supporting" display="block" className="text-xs text-fg-muted">
      Select a clip to view its properties
    </Text>
  </div>
);

const fontCategoryKeys = { "Popular": "editor.subtitleInspector.category.0", "Display & Headlines": "editor.subtitleInspector.category.1", "Elegant & Serif": "editor.subtitleInspector.category.2", "Modern & Clean": "editor.subtitleInspector.category.3", "Handwritten & Script": "editor.subtitleInspector.category.4", "Fun & Creative": "editor.subtitleInspector.category.5", "Monospace": "editor.subtitleInspector.category.6", "System": "editor.subtitleInspector.category.7" } as const;

export const InspectorPanel: React.FC = () => {
  // Stores
  const {
    getClip,
    getClipTransition,
    updateClipTransition,
    removeClipTransition,
    importSRT,
    updateSubtitle,
    getSubtitle,
    getEditingTemplate,
    updateEditingTemplateApplication,
    removeEditingTemplateApplication,
  } = useProjectStore(useShallow((state) => ({
    getClip: state.getClip,
    getClipTransition: state.getClipTransition,
    updateClipTransition: state.updateClipTransition,
    removeClipTransition: state.removeClipTransition,
    importSRT: state.importSRT,
    updateSubtitle: state.updateSubtitle,
    getSubtitle: state.getSubtitle,
    getEditingTemplate: state.getEditingTemplate,
    updateEditingTemplateApplication: state.updateEditingTemplateApplication,
    removeEditingTemplateApplication: state.removeEditingTemplateApplication,
  })));
  const project = useProjectStore((state) => state.project);
  const clearSelection = useUIStore((state) => state.clearSelection);
  const selectedItems = useUIStore((state) => state.selectedItems);
  const effectApplicationClipId = useUIStore(
    (state) => state.effectApplicationClipId,
  );
  const startEffectApplication = useUIStore(
    (state) => state.startEffectApplication,
  );
  const finishEffectApplication = useUIStore(
    (state) => state.finishEffectApplication,
  );
  const selectedClipIds = useMemo(() => selectedItems.filter((item) =>
    item.type === "clip" || item.type === "text-clip" || item.type === "shape-clip",
  ).map((item) => item.id), [selectedItems]);
  const pausePlayback = useTimelineStore((state) => state.pause);
  const lockPlayback = useTimelineStore((state) => state.lockPlayback);
  const unlockPlayback = useTimelineStore((state) => state.unlockPlayback);
  const getTitleEngine = useEngineStore((state) => state.getTitleEngine);
  const getGraphicsEngine = useEngineStore((state) => state.getGraphicsEngine);

  const [expandedRecipeApplicationId, setExpandedRecipeApplicationId] =
    useState<string | null>(null);
  const [captionWordsPerLine, setCaptionWordsPerLine] = useState(5);
  const [recipeControlValues, setRecipeControlValues] = useState<
    Record<string, Record<string, EditingTemplatePrimitive>>
  >({});
  const srtInputRef = useRef<HTMLInputElement>(null);
  const customFonts = useCustomFonts();

  useEffect(() => {
    setExpandedRecipeApplicationId(null);
    useInspectorNavigationStore.getState().clearRequest();
  }, [selectedClipIds, project.id]);

  // Check if a subtitle is selected
  const selectedSubtitleId = useMemo(() => {
    const subtitleSelection = selectedItems.find(
      (item) => item.type === "subtitle",
    );
    return subtitleSelection?.id || null;
  }, [selectedItems]);

  const selectedSubtitle = useMemo(() => {
    if (!selectedSubtitleId) return null;
    return getSubtitle(selectedSubtitleId) || null;
  }, [selectedSubtitleId, getSubtitle, project.timeline.subtitles]);

  const selectedTransitionId = useMemo(() => {
    return selectedItems.find((item) => item.type === "transition")?.id ?? null;
  }, [selectedItems]);

  const selectedTransition = useMemo(() => {
    if (!selectedTransitionId) return null;
    return getClipTransition(selectedTransitionId) ?? null;
  }, [selectedTransitionId, getClipTransition, project.modifiedAt]);

  const transitionClipA = useMemo(
    () => (selectedTransition ? getClip(selectedTransition.clipAId) ?? null : null),
    [selectedTransition, getClip, project.modifiedAt],
  );
  const transitionClipB = useMemo(
    () =>
      selectedTransition?.clipBId
        ? getClip(selectedTransition.clipBId) ?? null
        : null,
    [selectedTransition, getClip, project.modifiedAt],
  );

  const selectedTimelineClip = useMemo(() => {
    if (selectedClipIds.length !== 1) return null;
    return getClip(selectedClipIds[0]) || null;
  }, [getClip, project.modifiedAt, selectedClipIds]);

  // Get selected clip (check regular clips, text clips, and shape clips)
  const selectedClip = useMemo(() => {
    if (selectedClipIds.length !== 1) return null;
    const clipId = selectedClipIds[0];
    const titleEngine = getTitleEngine();
    const textClip = titleEngine?.getTextClip(clipId);
    if (textClip) {
      return {
        id: textClip.id,
        mediaId: `text-${textClip.id}`,
        startTime: textClip.startTime,
        duration: textClip.duration,
        inPoint: 0,
        outPoint: textClip.duration,
        transform: textClip.transform || {
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
        },
        effects: [],
        text: textClip.text,
        trackId: textClip.trackId,
      };
    }
    const graphicsEngine = getGraphicsEngine();
    const shapeClip = graphicsEngine?.getShapeClip(clipId);
    if (shapeClip) {
      return {
        id: shapeClip.id,
        mediaId: `shape-${shapeClip.id}`,
        startTime: shapeClip.startTime,
        duration: shapeClip.duration,
        inPoint: 0,
        outPoint: shapeClip.duration,
        transform: shapeClip.transform || {
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
        },
        effects: [],
        shapeType: shapeClip.shapeType,
        trackId: shapeClip.trackId,
      };
    }
    const svgClip = graphicsEngine?.getSVGClip(clipId);
    if (svgClip) {
      return {
        id: svgClip.id,
        mediaId: `svg-${svgClip.id}`,
        startTime: svgClip.startTime,
        duration: svgClip.duration,
        inPoint: 0,
        outPoint: svgClip.duration,
        transform: svgClip.transform || {
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
        },
        effects: [],
        svgContent: svgClip.svgContent,
        trackId: svgClip.trackId,
      };
    }
    const stickerClip = graphicsEngine?.getStickerClip(clipId);
    if (stickerClip) {
      return {
        id: stickerClip.id,
        mediaId: `sticker-${stickerClip.id}`,
        startTime: stickerClip.startTime,
        duration: stickerClip.duration,
        inPoint: 0,
        outPoint: stickerClip.duration,
        transform: stickerClip.transform || {
          position: { x: 0, y: 0 },
          scale: { x: 1, y: 1 },
          rotation: 0,
          anchor: { x: 0.5, y: 0.5 },
          opacity: 1,
        },
        effects: [],
        imageUrl: stickerClip.imageUrl,
        trackId: stickerClip.trackId,
      };
    }
    return getClip(clipId) ?? null;
  }, [
    selectedClipIds,
    getClip,
    getTitleEngine,
    getGraphicsEngine,
    project.modifiedAt,
  ]);

  // Force re-render trigger - increment to force recalculation of engine values
  const [updateCounter, forceUpdate] = React.useReducer((x) => x + 1, 0);

  // Get current values from engines - recalculate when updateCounter changes
  const clipId = selectedClip?.id || "";

  const chromaKeySettings = useMemo(() => {
    return clipId ? chromaKeyEngine.getSettings(clipId) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipId, updateCounter]);

  // Get updateClipTransform from store
  const updateClipTransform = useProjectStore(
    (state) => state.updateClipTransform,
  );
  const updateTextTransform = useProjectStore(
    (state) => state.updateTextTransform,
  );
  const updateShapeTransform = useProjectStore(
    (state) => state.updateShapeTransform,
  );

  // Transform handlers
  const handleTransformChange = useCallback(
    (changes: Partial<Transform>) => {
      if (!selectedClip) return;
      const titleEngine = getTitleEngine();
      const graphicsEngine = getGraphicsEngine();
      if (titleEngine?.getTextClip(selectedClip.id)) {
        updateTextTransform(selectedClip.id, changes);
        return;
      }
      if (
        graphicsEngine?.getShapeClip(selectedClip.id) ||
        graphicsEngine?.getSVGClip(selectedClip.id) ||
        graphicsEngine?.getStickerClip(selectedClip.id)
      ) {
        updateShapeTransform(selectedClip.id, changes);
        return;
      }
      void updateClipTransform(selectedClip.id, changes);
    },
    [
      getGraphicsEngine,
      getTitleEngine,
      selectedClip,
      updateClipTransform,
      updateShapeTransform,
      updateTextTransform,
    ],
  );

  // Chroma Key handlers using ChromaKeyEngine
  const handleChromaKeyToggle = useCallback(
    (enabled: boolean) => {
      if (!selectedClip) return;
      if (enabled) {
        chromaKeyEngine.enableChromaKey(selectedClip.id);
      } else {
        chromaKeyEngine.disableChromaKey(selectedClip.id);
      }
      forceUpdate();
    },
    [selectedClip],
  );

  const handleKeyColorChange = useCallback(
    (hexColor: string) => {
      if (!selectedClip) return;
      const hex = hexColor.replace("#", "");
      const r = parseInt(hex.substring(0, 2), 16) / 255;
      const g = parseInt(hex.substring(2, 4), 16) / 255;
      const b = parseInt(hex.substring(4, 6), 16) / 255;
      chromaKeyEngine.setKeyColor(selectedClip.id, { r, g, b });
      forceUpdate();
    },
    [selectedClip],
  );

  const handleToleranceChange = useCallback(
    (tolerance: number) => {
      if (!selectedClip) return;
      chromaKeyEngine.setTolerance(selectedClip.id, tolerance / 100);
      forceUpdate();
    },
    [selectedClip],
  );

  const {
    addVideoEffect,
    updateVideoEffect,
    getAudioEffects,
    updateAudioEffect,
    toggleAudioEffect,
  } = useProjectStore(useShallow((state) => ({
    addVideoEffect: state.addVideoEffect,
    updateVideoEffect: state.updateVideoEffect,
    getAudioEffects: state.getAudioEffects,
    updateAudioEffect: state.updateAudioEffect,
    toggleAudioEffect: state.toggleAudioEffect,
  })));

  const [isEnhancingAudio, setIsEnhancingAudio] = useState(false);
  const [audioEnhanced, setAudioEnhanced] = useState(false);
  const isApplyingSelectedClipEffect =
    effectApplicationClipId !== null && effectApplicationClipId === selectedClip?.id;

  const waitForEffectApplicationPaint = useCallback(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      }),
    [],
  );

  const applyClipEffectWithPlaybackLock = useCallback(
    async (
      clipId: string,
      label: string,
      apply: () => void | Promise<void>,
    ) => {
      const store = useProjectStore.getState();
      const currentClip = store.getClip(clipId) ?? store.getTextClip(clipId) ??
        store.getShapeClip(clipId) ?? store.getSVGClip(clipId) ?? store.getStickerClip(clipId);
      const track = store.project.timeline.tracks.find((candidate) => candidate.id === currentClip?.trackId);
      if (!currentClip || !track || track.locked ||
        useUIStore.getState().exportState.isExporting ||
        useUIStore.getState().effectApplicationClipId !== null ||
        useTimelineStore.getState().playbackLockedReason) return;
      const projectId = store.project.id;
      pausePlayback();
      lockPlayback(label);
      startEffectApplication(clipId, label);

      try {
        await waitForEffectApplicationPaint();
        if (useProjectStore.getState().project.id !== projectId) return;
        await apply();
        window.dispatchEvent(new CustomEvent("openreel:preview-invalidate"));
        await waitForEffectApplicationPaint();
      } finally {
        if (useUIStore.getState().effectApplicationClipId === clipId) {
          finishEffectApplication();
          if (useTimelineStore.getState().playbackLockedReason === label) unlockPlayback();
        }
      }
    },
    [
      finishEffectApplication,
      lockPlayback,
      pausePlayback,
      startEffectApplication,
      unlockPlayback,
      waitForEffectApplicationPaint,
    ],
  );

  const handleRemoveBackground = useCallback(() => {
    if (!selectedClip) return;
    void applyClipEffectWithPlaybackLock(
      selectedClip.id,
      editorMessage("editor.inspector.removingBackground"),
      () => {
        chromaKeyEngine.enableChromaKey(selectedClip.id);
        chromaKeyEngine.setKeyColor(selectedClip.id, { r: 0, g: 1, b: 0 });
        chromaKeyEngine.setTolerance(selectedClip.id, 0.35);
        forceUpdate();
      },
    );
  }, [applyClipEffectWithPlaybackLock, forceUpdate, selectedClip]);

  const handleEnhanceAudio = useCallback(async () => {
    if (!selectedClip) return;
    setIsEnhancingAudio(true);
    try {
      await applyClipEffectWithPlaybackLock(
        selectedClip.id,
        editorMessage("editor.inspector.cleaningAudio"),
        async () => {
          await initializeAudioBridgeEffects();
          const bridge = getAudioBridgeEffects();
          const noiseCleanupConfig = {
            ...DEFAULT_NOISE_REDUCTION,
            ...getNoiseReductionPreset("speech").config,
          };

          const existingNoiseReduction = getAudioEffects(selectedClip.id).find(
            (effect) => effect.type === "noiseReduction",
          );

          if (existingNoiseReduction) {
            await updateAudioEffect(
              selectedClip.id,
              existingNoiseReduction.id,
              noiseCleanupConfig as unknown as Record<string, unknown>,
            );
            await toggleAudioEffect(
              selectedClip.id,
              existingNoiseReduction.id,
              true,
            );
          } else {
            const result = bridge.applyNoiseReduction(
              selectedClip.id,
              noiseCleanupConfig,
            );

            if (!result.success) {
              throw new Error(result.error ?? editorMessage("editor.inspector.cleanupFailed"));
            }
          }

          setAudioEnhanced(true);
          setTimeout(() => setAudioEnhanced(false), 2000);
          toast.success(
            editorMessage("editor.inspector.cleaned"),
            editorMessage("editor.inspector.cleanedHelp"),
          );

          forceUpdate();
        },
      );
    } catch (error) {
      console.error("Failed to enhance audio:", error);
      toast.error(
        editorMessage("editor.inspector.cannotClean"),
        error instanceof Error
          ? error.message
          : editorMessage("editor.inspector.cannotCleanHelp"),
      );
    } finally {
      setIsEnhancingAudio(false);
    }
  }, [
    applyClipEffectWithPlaybackLock,
    selectedClip,
    forceUpdate,
    getAudioEffects,
    toggleAudioEffect,
    updateAudioEffect,
  ]);

  const handleAutoColor = useCallback(async () => {
    if (!selectedClip) return;
    await applyClipEffectWithPlaybackLock(
      selectedClip.id,
      editorMessage("editor.inspector.autoColor"),
      async () => {
        const satEffect = await addVideoEffect(selectedClip.id, "saturation");
        const contEffect = await addVideoEffect(selectedClip.id, "contrast");
        const brightEffect = await addVideoEffect(
          selectedClip.id,
          "brightness",
        );
        if (satEffect) {
          await updateVideoEffect(selectedClip.id, satEffect.id, {
            value: 1.15,
          });
        }
        if (contEffect) {
          await updateVideoEffect(selectedClip.id, contEffect.id, {
            value: 1.1,
          });
        }
        if (brightEffect) {
          await updateVideoEffect(selectedClip.id, brightEffect.id, {
            value: 5,
          });
        }
      },
    );
  }, [
    addVideoEffect,
    applyClipEffectWithPlaybackLock,
    selectedClip,
    updateVideoEffect,
  ]);

  const handleSRTImport = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      try {
        const srtContent = await file.text();
        const result = await importSRT(srtContent, {
          sourceClipId: selectedTimelineClip?.id,
          maxWordsPerLine: captionWordsPerLine,
        });

        if (result.success) {
          if (result.errors.length > 0) {
            toast.warning(
              editorMessage("editor.inspector.captionWarnings"),
              editorMessage("editor.inspector.captionSkipped", { count: result.errors.length }),
            );
          } else {
            toast.success(
              editorMessage("editor.inspector.captionsImported"),
              editorMessage("editor.inspector.captionImportHelp"),
            );
          }
        } else {
          toast.error(editorMessage("editor.inspector.captionFailed"), result.errors[0] || editorMessage("editor.inspector.noCaptions"));
        }
      } catch {
        toast.error(editorMessage("editor.inspector.captionFailed"), editorMessage("editor.inspector.cannotRead"));
      } finally {
        event.target.value = "";
      }
    },
    [captionWordsPerLine, importSRT, selectedTimelineClip?.id],
  );

  const handleSubtitleFontUpload = useCallback(
    async (file: File) => {
      if (!file || !selectedSubtitle) return;

      const result = await registerCustomFont(file);
      if (!result.success) {
        toast.error(editorMessage("editor.subtitleInspector.uploadFailed"), result.error ?? editorMessage("editor.subtitleInspector.unknown"));
      } else {
        updateSubtitle(selectedSubtitle.id, {
          style: {
            ...(selectedSubtitle.style || {}),
            fontFamily: result.fontFamily,
          } as typeof selectedSubtitle.style,
        });
        toast.success(editorMessage("editor.subtitleInspector.uploaded"), editorMessage("editor.subtitleInspector.fontReady", { font: result.fontFamily }));
      }
    },
    [selectedSubtitle, updateSubtitle],
  );

  // Default transform
  const defaultTransform: Transform = {
    position: { x: 0, y: 0 },
    scale: { x: 1, y: 1 },
    rotation: 0,
    opacity: 1,
    anchor: { x: 0.5, y: 0.5 },
    borderRadius: 0,
  };
  const transform = selectedClip?.transform || defaultTransform;

  // Derive UI state from engines
  const chromaKeyEnabled = chromaKeySettings?.enabled || false;
  const keyColor = chromaKeySettings
    ? `#${Math.round(chromaKeySettings.keyColor.r * 255)
        .toString(16)
        .padStart(2, "0")}${Math.round(chromaKeySettings.keyColor.g * 255)
        .toString(16)
        .padStart(2, "0")}${Math.round(chromaKeySettings.keyColor.b * 255)
        .toString(16)
        .padStart(2, "0")}`
    : "#00ff00";
  const tolerance = (chromaKeySettings?.tolerance || 0.3) * 100;

  /** Detect clip type from the selected item itself, not its owning track. */
  const clipType = useMemo(() => {
    if (!selectedClip) return null;

    // Check mediaId prefix first for text, shape, and SVG clips (they may not be in timeline tracks)
    if (selectedClip.mediaId.startsWith("text-")) {
      return "text";
    }

    if (selectedClip.mediaId.startsWith("shape-")) {
      return "shape";
    }

    if (selectedClip.mediaId.startsWith("svg-")) {
      return "svg";
    }

    if (
      selectedClip.mediaId.startsWith("sticker-") ||
      selectedClip.mediaId.startsWith("emoji-")
    ) {
      return "sticker";
    }

    const mediaItem = project.mediaLibrary.items.find(
      (item) => item.id === selectedClip.mediaId,
    );

    if (mediaItem?.type === "audio") {
      return "audio";
    }

    if (mediaItem?.type === "image") {
      return "image";
    }

    return "video";
  }, [selectedClip, project.mediaLibrary.items]);

  /**
   * Determine which sections to show based on clip type
   */
  const showVideoEffects =
    clipType === "video" ||
    clipType === "image" ||
    clipType === "text" ||
    clipType === "shape" ||
    clipType === "svg" ||
    clipType === "sticker";
  const showColorGrading = clipType === "video" || clipType === "image";
  const selectedMediaCapabilities = getMediaItemCapabilities(
    selectedTimelineClip
      ? project.mediaLibrary.items.find(
          (item) => item.id === selectedTimelineClip.mediaId,
        )
      : undefined,
  );
  const showAudioEffects =
    clipType === "audio" || selectedMediaCapabilities.audio;
  const showTextSection = clipType === "text";
  const showShapeSection = clipType === "shape";
  const showSVGSection = clipType === "svg";
  const selectedNoiseReductionEffect = selectedTimelineClip?.audioEffects?.find(
    (effect) => effect.type === "noiseReduction",
  );
  const noiseReductionSectionTitle = selectedNoiseReductionEffect
    ? selectedNoiseReductionEffect.enabled
      ? editorMessage("editor.inspector.noiseActive")
      : editorMessage("editor.inspector.noiseConfigured")
    : editorMessage("editor.inspector.noise");
  const appliedEditingTemplates =
    selectedTimelineClip?.metadata?.appliedTemplates || [];
  const handleRecipeControlChange = useCallback(
    (
      applicationId: string,
      controlId: string,
      value: EditingTemplatePrimitive,
    ) => {
      setRecipeControlValues((current) => ({
        ...current,
        [applicationId]: {
          ...(current[applicationId] || {}),
          [controlId]: value,
        },
      }));
    },
    [],
  );
  const handleToggleRecipeControls = useCallback(
    (applicationId: string, templateId: string, controlValues?: Record<string, unknown>) => {
      const template = getEditingTemplate(templateId);
      if (!template || !template.controls || template.controls.length === 0) {
        return;
      }

      setExpandedRecipeApplicationId((current) =>
        current === applicationId ? null : applicationId,
      );
      setRecipeControlValues((current) =>
        current[applicationId]
          ? current
          : {
              ...current,
              [applicationId]: mergeEditingTemplateControlValues(
                template,
                controlValues,
              ),
            },
      );
    },
    [getEditingTemplate],
  );
  const handleResetRecipeControls = useCallback(
    (applicationId: string, templateId: string, controlValues?: Record<string, unknown>) => {
      const template = getEditingTemplate(templateId);
      if (!template) {
        return;
      }

      setRecipeControlValues((current) => ({
        ...current,
        [applicationId]: mergeEditingTemplateControlValues(template, controlValues),
      }));
    },
    [getEditingTemplate],
  );
  const handleUpdateRecipeControls = useCallback(
    (applicationId: string, templateId: string, controlValues?: Record<string, unknown>) => {
      if (!selectedTimelineClip) {
        return;
      }

      const template = getEditingTemplate(templateId);
      if (!template) {
        toast.error(editorMessage("editor.inspector.recipeUnavailable"), editorMessage("editor.inspector.recipeUnavailableHelp"));
        return;
      }

      const nextControlValues =
        recipeControlValues[applicationId] ||
        mergeEditingTemplateControlValues(template, controlValues);
      const updated = updateEditingTemplateApplication(
        selectedTimelineClip.id,
        applicationId,
        nextControlValues,
      );

      if (!updated) {
        toast.error(editorMessage("editor.inspector.recipeFailed"), editorMessage("editor.inspector.recipeFailedHelp"));
        return;
      }

      toast.success(editorMessage("editor.inspector.recipeUpdated"), editorMessage("editor.inspector.recipeUpdatedHelp", { name: template.name }));
    },
    [
      getEditingTemplate,
      recipeControlValues,
      selectedTimelineClip,
      updateEditingTemplateApplication,
    ],
  );
  const showVideoControls = clipType === "video" || clipType === "image";
  const showTransformControls =
    clipType === "video" ||
    clipType === "image" ||
    clipType === "text" ||
    clipType === "shape" ||
    clipType === "svg" ||
    clipType === "sticker";

  const tabIds = useMemo(
    () => getTabIdsForClipType(clipType as InspectorClipType | null),
    [clipType],
  );

  return (
    <div
      data-tour="inspector"
      className="w-full min-w-0 bg-bg-1 flex flex-col h-full overflow-hidden"
    >
      {selectedClip && tabIds.length > 0 && (
        <InspectorClipHeader
          name={
            project.mediaLibrary.items.find(
              (m) => m.id === selectedClip.mediaId,
            )?.name ??
            (clipType
              ? clipType.charAt(0).toUpperCase() + clipType.slice(1)
              : "Clip")
          }
          durationSeconds={selectedClip.duration}
          typeLabel={clipType ?? "clip"}
        />
      )}

      <div className="overflow-y-auto flex-1 min-h-0 custom-scrollbar">
      <div className="py-[18px] px-5">
        {selectedTimelineClip && selectedClipIds.length === 1 && (
          <QuickEditBar clipId={selectedTimelineClip.id} onCleanAudio={handleEnhanceAudio} isCleaningAudio={isEnhancingAudio} />
        )}
        <Section title={editorMessage("editor.inspector.multicam")} sectionId="multicam">
          <InspectorTabErrorBoundary>
            <React.Suspense fallback={<p role="status">{editorMessage("editor.common.loadingCameraTools")}</p>}>
              <MultiCameraPanel key={project.id} />
            </React.Suspense>
          </InspectorTabErrorBoundary>
        </Section>
        {selectedClipIds.length > 1 ? (
          <MultiClipInspector clipIds={selectedClipIds} />
        ) : selectedClip ? (
          <InspectorTabErrorBoundary key={clipId}>
            <div className="space-y-4">
              {tabIds.includes("transform") && (
                <TransformTab
                  clipId={clipId}
                  clipType={clipType}
                  selectedClip={selectedClip}
                  showTransformControls={showTransformControls}
                  showVideoControls={showVideoControls}
                  transform={transform}
                  canvasWidth={project.settings.width}
                  canvasHeight={project.settings.height}
                  handleTransformChange={handleTransformChange}
                />
              )}

              {tabIds.includes("style") && (
                <StyleTab
                  clipId={clipId}
                  showTextSection={showTextSection}
                  showShapeSection={showShapeSection}
                  showSVGSection={showSVGSection}
                />
              )}

              {tabIds.includes("color") && (
                <ColorTab clipId={clipId} showColorGrading={showColorGrading} />
              )}

              {tabIds.includes("effects") && (
                <EffectsTab
                  clipId={clipId}
                  clipType={clipType}
                  selectedClip={selectedClip}
                  selectedTimelineClip={selectedTimelineClip}
                  showVideoControls={showVideoControls}
                  showVideoEffects={showVideoEffects}
                  showTextSection={showTextSection}
                  appliedEditingTemplates={appliedEditingTemplates}
                  getEditingTemplate={getEditingTemplate}
                  removeEditingTemplateApplication={removeEditingTemplateApplication}
                  expandedRecipeApplicationId={expandedRecipeApplicationId}
                  setExpandedRecipeApplicationId={setExpandedRecipeApplicationId}
                  recipeControlValues={recipeControlValues}
                  setRecipeControlValues={setRecipeControlValues}
                  handleRecipeControlChange={handleRecipeControlChange}
                  handleToggleRecipeControls={handleToggleRecipeControls}
                  handleResetRecipeControls={handleResetRecipeControls}
                  handleUpdateRecipeControls={handleUpdateRecipeControls}
                  chromaKeyEnabled={chromaKeyEnabled}
                  keyColor={keyColor}
                  tolerance={tolerance}
                  handleChromaKeyToggle={handleChromaKeyToggle}
                  handleKeyColorChange={handleKeyColorChange}
                  handleToleranceChange={handleToleranceChange}
                />
              )}

              {tabIds.includes("audio") && (
                <AudioTab
                  clipId={clipId}
                  clipType={clipType}
                  showAudioEffects={showAudioEffects}
                  noiseReductionSectionTitle={noiseReductionSectionTitle}
                  selectedNoiseReductionEffect={selectedNoiseReductionEffect}
                />
              )}

              {tabIds.includes("speed") && (
                <SpeedTab
                  showVideoControls={showVideoControls}
                  selectedClip={selectedClip}
                />
              )}

              {tabIds.includes("animate") && (
                <AnimateTab
                  clipId={clipId}
                  clipType={clipType}
                  showTextSection={showTextSection}
                />
              )}

              {tabIds.includes("ai") && (
                <AiTab
                  clipId={clipId}
                  clipType={clipType}
                  showVideoControls={showVideoControls}
                  showAudioEffects={showAudioEffects}
                  showVideoEffects={showVideoEffects}
                  handleSRTImport={handleSRTImport}
                  srtInputRef={srtInputRef}
                  handleRemoveBackground={handleRemoveBackground}
                  handleEnhanceAudio={handleEnhanceAudio}
                  handleAutoColor={handleAutoColor}
                  isEnhancingAudio={isEnhancingAudio}
                  audioEnhanced={audioEnhanced}
                  isApplyingSelectedClipEffect={isApplyingSelectedClipEffect}
                  captionWordsPerLine={captionWordsPerLine}
                  onCaptionWordsPerLineChange={setCaptionWordsPerLine}
                />
              )}
            </div>
          </InspectorTabErrorBoundary>
        ) : selectedTransition && transitionClipA ? (
          <div className="space-y-3">
            <Card variant="green" padding={3} className="rounded-lg border border-brand-accent/30 bg-brand-accent-soft">
              <div className="flex items-center gap-2">
                <Shuffle size={14} className="text-brand-accent" aria-hidden />
                <Text type="supporting" weight="bold" className="text-fg">
                  {selectedTransition.edge === "in"
                    ? editorMessage("editor.inspector.intro")
                    : selectedTransition.edge === "out"
                      ? editorMessage("editor.inspector.outro")
                      : editorMessage("editor.inspector.transition")}
                </Text>
              </div>
              <Text type="supporting" display="block" className="mt-1 text-[10px] text-fg-3">
                {selectedTransition.edge === "in"
                  ? editorMessage("editor.inspector.introHelp")
                  : selectedTransition.edge === "out"
                    ? editorMessage("editor.inspector.outroHelp")
                    : editorMessage("editor.inspector.transitionHelp")}
              </Text>
            </Card>
            <TransitionInspector
              clipA={transitionClipA}
              clipB={transitionClipB ?? undefined}
              edge={selectedTransition.edge}
              transition={selectedTransition}
              onTransitionUpdate={(id, updates) => {
                void updateClipTransition(id, updates);
              }}
              onTransitionRemove={(id) => {
                void removeClipTransition(id);
                clearSelection();
              }}
            />
          </div>
        ) : selectedSubtitle ? (
          <>
            {/* Subtitle Info */}
            <Card variant="green" padding={3} className="mb-4 rounded-lg border border-brand-accent/30 bg-brand-accent-soft">
              <div className="flex items-center gap-2 mb-1">
                <Captions size={14} className="text-brand-accent" aria-hidden />
                <Text type="supporting" weight="bold" className="text-brand-accent">
                  {editorMessage("editor.subtitleInspector.subtitle")}
                </Text>
              </div>
              <Text type="supporting" display="block" className="text-[10px] text-fg-3">
                {editorMessage("editor.subtitleInspector.range", { start: selectedSubtitle.startTime.toFixed(2), end: selectedSubtitle.endTime.toFixed(2) })}
              </Text>
            </Card>

            {/* Subtitle Text Editor */}
            <Section title={editorMessage("editor.subtitleInspector.content")}>
              <div className="space-y-3">
                <ToolcraftTextAreaControl
                  label={editorMessage("editor.subtitleInspector.text")}
                  isLabelHidden
                  value={selectedSubtitle.text}
                  onChange={(text) =>
                    updateSubtitle(selectedSubtitle.id, {
                      text,
                    })
                  }
                  rows={4}
                  placeholder={editorMessage("editor.subtitleInspector.enterText")}
                  width="100%"
                />
              </div>
            </Section>

            {/* Subtitle Timing */}
            <Section title={editorMessage("editor.subtitleInspector.timing")}>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    {editorMessage("editor.subtitleInspector.start")}
                  </Text>
                  <ToolcraftNumberInputControl
                    label={editorMessage("editor.subtitleInspector.start")}
                    isLabelHidden
                    step={0.1}
                    value={selectedSubtitle.startTime}
                    onChange={(value) =>
                      updateSubtitle(selectedSubtitle.id, {
                        startTime: value || 0,
                      })
                    }
                    size="sm"
                    width={80}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    {editorMessage("editor.subtitleInspector.end")}
                  </Text>
                  <ToolcraftNumberInputControl
                    label={editorMessage("editor.subtitleInspector.end")}
                    isLabelHidden
                    step={0.1}
                    value={selectedSubtitle.endTime}
                    onChange={(value) =>
                      updateSubtitle(selectedSubtitle.id, {
                        endTime: value || 0,
                      })
                    }
                    size="sm"
                    width={80}
                  />
                </div>
              </div>
            </Section>

            {/* Subtitle Position */}
            <Section title={editorMessage("editor.subtitleInspector.position")}>
              <div className="grid grid-cols-3 gap-2">
                {(["top", "center", "bottom"] as const).map((pos) => (
                  <SelectableCard
                    key={editorMessage(`editor.subtitleInspector.${pos}`)}
                    label={editorMessage(`editor.subtitleInspector.${pos}`)}
                    isSelected={(selectedSubtitle.style?.position || "bottom") === pos}
                    onChange={() =>
                      updateSubtitle(selectedSubtitle.id, {
                        style: {
                          ...(selectedSubtitle.style || {}),
                          position: pos,
                        } as typeof selectedSubtitle.style,
                      })
                    }
                    padding={2}
                    variant={(selectedSubtitle.style?.position || "bottom") === pos ? "green" : "muted"}
                    className="text-center capitalize"
                  >
                    {editorMessage(`editor.subtitleInspector.${pos}`)}
                  </SelectableCard>
                ))}
              </div>
            </Section>

            {/* Subtitle Animation Style */}
            <Section title={editorMessage("editor.subtitleInspector.animation")}>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    {editorMessage("editor.subtitleInspector.style")}
                  </Text>
                  <Selector
                    label={editorMessage("editor.subtitleInspector.animationStyle")}
                    isLabelHidden
                    value={selectedSubtitle.animationStyle || "none"}
                    onChange={(v) =>
                      updateSubtitle(selectedSubtitle.id, {
                        animationStyle: v as CaptionAnimationStyle,
                      })
                    }
                    options={CAPTION_ANIMATION_STYLES.map((style) => ({
                      value: style,
                      label: editorMessage(`editor.subtitleInspector.animation.${style}`),
                    }))}
                    size="sm"
                    width={140}
                  />
                </div>
                <Text type="supporting" color="secondary" display="block" className="text-[9px]">
                  {selectedSubtitle.animationStyle === "karaoke" &&
                    editorMessage("editor.subtitleInspector.description.karaoke")}
                  {selectedSubtitle.animationStyle === "word-highlight" &&
                    editorMessage("editor.subtitleInspector.description.word-highlight")}
                  {selectedSubtitle.animationStyle === "word-by-word" &&
                    editorMessage("editor.subtitleInspector.description.word-by-word")}
                  {selectedSubtitle.animationStyle === "bounce" &&
                    editorMessage("editor.subtitleInspector.description.bounce")}
                  {selectedSubtitle.animationStyle === "typewriter" &&
                    editorMessage("editor.subtitleInspector.description.typewriter")}
                  {(!selectedSubtitle.animationStyle ||
                    selectedSubtitle.animationStyle === "none") &&
                    editorMessage("editor.subtitleInspector.description.none")}
                </Text>
                {selectedSubtitle.animationStyle &&
                  selectedSubtitle.animationStyle !== "none" &&
                  !selectedSubtitle.words?.length && (
                    <Card variant="muted" padding={2} className="bg-amber-400/10">
                      <Text type="supporting" display="block" className="text-[9px] text-amber-400">
                      {editorMessage("editor.subtitleInspector.noWords")}
                      </Text>
                    </Card>
                  )}
                {selectedSubtitle.animationStyle &&
                  selectedSubtitle.animationStyle !== "none" &&
                  selectedSubtitle.animationStyle !== "typewriter" &&
                  selectedSubtitle.animationStyle !== "word-by-word" && (
                    <div className="pt-2 border-t border-border space-y-2">
                      <div className="flex items-center justify-between">
                        <Text type="supporting" color="secondary" className="text-[10px]">
                          {editorMessage("editor.subtitleInspector.highlight")}
                        </Text>
                        <div className="flex items-center gap-2">
                          <ColorSelector
                            value={
                              selectedSubtitle.style?.highlightColor ||
                              "#ffff00"
                            }
                            label={editorMessage("editor.subtitleInspector.selectHighlight")}
                            onChange={(highlightColor) =>
                              updateSubtitle(selectedSubtitle.id, {
                                style: {
                                  ...(selectedSubtitle.style || {}),
                                  highlightColor,
                                } as typeof selectedSubtitle.style,
                              })
                            }
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-6 gap-1">
                        {[
                          "#ffff00",
                          "#00ff00",
                          "#ff6b6b",
                          "#4ecdc4",
                          "#ff9f43",
                          "#a55eea",
                        ].map((color) => (
                          <Button
                            key={color}
                            label={color}
                            onClick={() =>
                              updateSubtitle(selectedSubtitle.id, {
                                style: {
                                  ...(selectedSubtitle.style || {}),
                                  highlightColor: color,
                                } as typeof selectedSubtitle.style,
                              })
                            }
                            variant="ghost"
                            size="sm"
                            className={`h-6 w-6 rounded border-2 p-0 transition-transform hover:scale-110 ${
                              (selectedSubtitle.style?.highlightColor ||
                                "#ffff00") === color
                                ? "border-white"
                                : "border-transparent"
                            }`}
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            </Section>

            {/* Subtitle Font Settings */}
            <Section title={editorMessage("editor.subtitleInspector.font")}>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    {editorMessage("editor.subtitleInspector.fontFamily")}
                  </Text>
                  <Selector
                    label={editorMessage("editor.subtitleInspector.fontFamilyLabel")}
                    isLabelHidden
                    value={selectedSubtitle.style?.fontFamily || "Inter"}
                    onChange={(v) =>
                      updateSubtitle(selectedSubtitle.id, {
                        style: {
                          ...(selectedSubtitle.style || {}),
                          fontFamily: v,
                        } as typeof selectedSubtitle.style,
                      })
                    }
                    options={[
                      ...Object.entries(FONT_CATEGORIES).flatMap(([category, fonts]) =>
                        fonts.map((font) => ({
                          value: font,
                          label: editorMessage("editor.subtitleInspector.categoryFont", { font, category: editorMessage(fontCategoryKeys[category as keyof typeof FONT_CATEGORIES]) }),
                        })),
                      ),
                      ...customFonts.map((font) => ({
                        value: font,
                        label: editorMessage("editor.subtitleInspector.customFont", { font }),
                      })),
                    ]}
                    size="sm"
                    width={160}
                  />
                </div>
                <FileInput
                  label={editorMessage("editor.subtitleInspector.upload")}
                  isLabelHidden
                  value={null}
                  onChange={(picked) => {
                    if (picked instanceof File) {
                      void handleSubtitleFontUpload(picked);
                    }
                  }}
                  accept={FONT_FILE_ACCEPT}
                  mode="input"
                  placeholder={editorMessage("editor.subtitleInspector.upload")}
                  width="100%"
                />
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    {editorMessage("editor.subtitleInspector.fontSize")}
                  </Text>
                  <ToolcraftNumberInputControl
                    label={editorMessage("editor.subtitleInspector.fontSize")}
                    isLabelHidden
                    min={12}
                    max={72}
                    value={selectedSubtitle.style?.fontSize || 24}
                    onChange={(value) =>
                      updateSubtitle(selectedSubtitle.id, {
                        style: {
                          ...(selectedSubtitle.style || {}),
                          fontSize: value || 24,
                        } as typeof selectedSubtitle.style,
                      })
                    }
                    size="sm"
                    width={80}
                  />
                </div>
              </div>
            </Section>

            {/* Subtitle Colors */}
            <Section title={editorMessage("editor.subtitleInspector.colors")}>
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    {editorMessage("editor.subtitleInspector.textColor")}
                  </Text>
                  <div className="flex items-center gap-2">
                    <ColorSelector
                      value={selectedSubtitle.style?.color || "#ffffff"}
                      label={editorMessage("editor.subtitleInspector.selectTextColor")}
                      onChange={(color) =>
                        updateSubtitle(selectedSubtitle.id, {
                          style: {
                            ...(selectedSubtitle.style || {}),
                            color,
                          } as typeof selectedSubtitle.style,
                        })
                      }
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <Text type="supporting" color="secondary" className="text-[10px]">
                    {editorMessage("editor.subtitleInspector.background")}
                  </Text>
                  <div className="flex items-center gap-2">
                    <ColorSelector
                      value={cssColorToHex(
                        selectedSubtitle.style?.backgroundColor,
                        "#000000",
                      )}
                      label={editorMessage("editor.subtitleInspector.selectBackground")}
                      onChange={(hex) => {
                        updateSubtitle(selectedSubtitle.id, {
                          style: {
                            ...(selectedSubtitle.style || {}),
                            backgroundColor: rgbaFromHex(
                              hex,
                              cssColorAlpha(
                                selectedSubtitle.style?.backgroundColor,
                              ),
                            ),
                          } as typeof selectedSubtitle.style,
                        });
                      }}
                    />
                    <Selector
                      label={editorMessage("editor.subtitleInspector.opacity")}
                      isLabelHidden
                      value={
                        cssColorAlpha(selectedSubtitle.style?.backgroundColor)
                      }
                      onChange={(v) => {
                        const nextAlpha = v as "0" | "0.5" | "0.7" | "1";
                        const newBg = rgbaFromHex(
                          cssColorToHex(
                            selectedSubtitle.style?.backgroundColor,
                            "#000000",
                          ),
                          nextAlpha,
                        );
                        updateSubtitle(selectedSubtitle.id, {
                          style: {
                            ...(selectedSubtitle.style || {}),
                            backgroundColor: newBg,
                          } as typeof selectedSubtitle.style,
                        });
                      }}
                      options={[
                        { value: "0", label: editorMessage("editor.subtitleInspector.none") },
                        { value: "0.5", label: "50%" },
                        { value: "0.7", label: "70%" },
                        { value: "1", label: "100%" },
                      ]}
                      size="sm"
                      width={80}
                    />
                  </div>
                </div>
              </div>
            </Section>

            {/* Delete Subtitle */}
            <div className="pt-4 border-t border-border">
              <Button
                label={editorMessage("editor.subtitleInspector.delete")}
                onClick={() => {
                  const { removeSubtitle } = useProjectStore.getState();
                  removeSubtitle(selectedSubtitle.id);
                }}
                variant="destructive"
                className="w-full border border-red-500/30 bg-red-500/20 text-red-400 hover:bg-red-500/30"
              />
            </div>
          </>
        ) : (
          <EmptyState />
        )}
      </div>
      </div>
    </div>
  );
};

export default InspectorPanel;
