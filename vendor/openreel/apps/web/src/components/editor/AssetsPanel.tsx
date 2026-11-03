import { editorMessage } from "../../shotloom-mode";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Image as ImageIcon, Film, Music, Plus, Upload, Trash2,
  Square, Circle, Triangle, Star, ArrowRight, Hexagon, FileCode, AlertTriangle,
  RefreshCw, Palette, Sparkles, Video,
  Type, Shapes, Wand2, LayoutTemplate, Zap, Shuffle, SlidersHorizontal,
} from "@/icons/lucide-compat";
import {
  BACKGROUND_PRESETS,
  generateBackgroundBlob,
  type BackgroundPreset,
} from "../../services/background-generator";
import type { ShapeType, TextStyle } from "@openreel/core";
import { useProjectStore } from "../../stores/project-store";
import { useUIStore } from "../../stores/ui-store";
import { useTimelineStore } from "../../stores/timeline-store";
import type { MediaItem } from "@openreel/core";
import { AspectRatioMatchDialog } from "./dialogs/AspectRatioMatchDialog";
import { AIGenTab } from "./AIGenTab";
import { RecipesTab } from "./panels/RecipesTab";
import { TemplatesTab } from "./panels/TemplatesTab";
import {
  EffectsPanel,
  TransitionsPanel,
} from "./panels/EffectsTransitionsPanel";
import { useTtsAudioStore } from "../../stores/tts-store";
import { toast } from "../../stores/notification-store";
import { saveFileHandle, saveDirectoryHandle } from "../../services/media-storage";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { isShotloomMode, requestShotloomImport, requestShotloomFiles, requestShotloomRelink } from "../../shotloom-mode";
import { ToolcraftSelectableCard as SelectableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { KieAIImageDialog } from "./kieai/KieAIImageDialog";
import { loadMediaBlob } from "../../services/media-storage";
import { useKieAIStore } from "../../stores/kieai-store";
import { StickerPickerPanel } from "./inspector/StickerPickerPanel";
import { InspectorPanel } from "./InspectorPanel";
import { insertTimelineOverlay } from "../../stores/project/insert-timeline-overlay";
import { PreviewProxyBadge, PreviewProxyControls } from "./PreviewProxyControls";

const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
};

/**
 * Media Item Thumbnail Component
 * Shows thumbnail with metadata below (not overlaid)
 */
type MediaViewMode = "large" | "small" | "list";
type AssetsTab =
  | "media"
  | "text"
  | "graphics"
  | "effects"
  | "transitions"
  | "adjust"
  | "ai"
  | "recipes"
  | "templates";

const ASSETS_TABS: ReadonlyArray<{
  value: AssetsTab;
  label: string;
  description: string;
}> = [
  {
    value: "media",
    get label() { return editorMessage("editor.assets.media"); },
    get description() { return editorMessage("editor.assets.mediaHelp"); },
  },
  {
    value: "text",
    get label() { return editorMessage("editor.assets.text"); },
    get description() { return editorMessage("editor.assets.textHelp"); },
  },
  {
    value: "graphics",
    get label() { return editorMessage("editor.assets.graphics"); },
    get description() { return editorMessage("editor.assets.graphicsHelp"); },
  },
  {
    value: "effects",
    get label() { return editorMessage("editor.assets.effects"); },
    get description() { return editorMessage("editor.assets.effectsHelp"); },
  },
  {
    value: "transitions",
    get label() { return editorMessage("editor.assets.transitions"); },
    get description() { return editorMessage("editor.assets.transitionsHelp"); },
  },
  {
    value: "adjust",
    get label() { return editorMessage("editor.assets.adjust"); },
    get description() { return editorMessage("editor.assets.adjustHelp"); },
  },
  {
    value: "ai",
    get label() { return editorMessage("editor.assets.ai"); },
    get description() { return editorMessage("editor.assets.aiHelp"); },
  },
  {
    value: "recipes",
    get label() { return editorMessage("editor.assets.recipes"); },
    get description() { return editorMessage("editor.assets.recipesHelp"); },
  },
  {
    value: "templates",
    get label() { return editorMessage("editor.assets.templates"); },
    get description() { return editorMessage("editor.assets.templatesHelp"); },
  },
] as const;

export const DEFAULT_TITLE_STYLE: Partial<TextStyle> = {
  fontSize: 96,
  fontWeight: 800,
  letterSpacing: -1,
};

export const TEXT_STYLE_PRESETS: ReadonlyArray<{
  name: string;
  text: string;
  style: Partial<TextStyle>;
}> = [
  { get name() { return editorMessage("editor.assets.heading"); }, get text() { return editorMessage("editor.assets.heading"); }, style: { fontSize: 72, fontWeight: 700 } },
  { get name() { return editorMessage("editor.assets.subtitle"); }, get text() { return editorMessage("editor.assets.subtitleText"); }, style: { fontSize: 36, fontWeight: 400 } },
  {
    get name() { return editorMessage("editor.assets.lowerThird"); },
    get text() { return editorMessage("editor.assets.nameHere"); },
    style: {
      fontSize: 32,
      fontWeight: 600,
      textAlign: "left",
      verticalAlign: "bottom",
      backgroundColor: "rgba(0, 0, 0, 0.7)",
    },
  },
  {
    get name() { return editorMessage("editor.assets.caption"); },
    get text() { return editorMessage("editor.assets.captionText"); },
    style: {
      fontSize: 24,
      fontWeight: 400,
      verticalAlign: "bottom",
      shadowColor: "rgba(0, 0, 0, 0.8)",
      shadowBlur: 4,
      shadowOffsetX: 1,
      shadowOffsetY: 1,
    },
  },
  {
    get name() { return editorMessage("editor.assets.hero"); },
    get text() { return editorMessage("editor.assets.heroText"); },
    style: {
      fontSize: 112,
      fontWeight: 900,
      letterSpacing: -2,
      lineHeight: 0.95,
      strokeWidth: 3,
    },
  },
  {
    get name() { return editorMessage("editor.assets.quote"); },
    get text() { return editorMessage("editor.assets.quoteText"); },
    style: {
      fontSize: 54,
      fontWeight: 600,
      fontStyle: "italic",
      lineHeight: 1.25,
      shadowColor: "rgba(0, 0, 0, 0.65)",
      shadowBlur: 10,
      shadowOffsetY: 4,
    },
  },
  {
    get name() { return editorMessage("editor.assets.outline"); },
    get text() { return editorMessage("editor.assets.outlineText"); },
    style: {
      fontSize: 80,
      fontWeight: 900,
      letterSpacing: 2,
      strokeColor: "#111827",
      strokeWidth: 5,
    },
  },
  {
    get name() { return editorMessage("editor.assets.badge"); },
    get text() { return editorMessage("editor.assets.badgeText"); },
    style: {
      fontSize: 28,
      fontWeight: 800,
      letterSpacing: 3,
      backgroundColor: "rgba(17, 24, 39, 0.88)",
    },
  },
];

const mediaViewLabels = {"small": "editor.assets.view.small", "large": "editor.assets.view.large", "list": "editor.assets.view.list"} as const;

const backgroundCategoryLabels = {"all": "editor.assets.backgroundCategory.all", "solid": "editor.assets.backgroundCategory.solid", "gradient": "editor.assets.backgroundCategory.gradient", "mesh": "editor.assets.backgroundCategory.mesh", "pattern": "editor.assets.backgroundCategory.pattern"} as const;

const backgroundNameKeys = {
  "solid-black": "editor.assets.background.solid-black",
  "solid-white": "editor.assets.background.solid-white",
  "solid-slate": "editor.assets.background.solid-slate",
  "solid-zinc": "editor.assets.background.solid-zinc",
  "solid-red": "editor.assets.background.solid-red",
  "solid-blue": "editor.assets.background.solid-blue",
  "solid-green": "editor.assets.background.solid-green",
  "solid-purple": "editor.assets.background.solid-purple",
  "gradient-sunset": "editor.assets.background.gradient-sunset",
  "gradient-ocean": "editor.assets.background.gradient-ocean",
  "gradient-forest": "editor.assets.background.gradient-forest",
  "gradient-lavender": "editor.assets.background.gradient-lavender",
  "gradient-midnight": "editor.assets.background.gradient-midnight",
  "gradient-rose": "editor.assets.background.gradient-rose",
  "gradient-gold": "editor.assets.background.gradient-gold",
  "gradient-noir": "editor.assets.background.gradient-noir",
  "radial-spotlight": "editor.assets.background.radial-spotlight",
  "radial-glow": "editor.assets.background.radial-glow",
  "mesh-aurora": "editor.assets.background.mesh-aurora",
  "mesh-nebula": "editor.assets.background.mesh-nebula",
  "mesh-candy": "editor.assets.background.mesh-candy",
  "mesh-sunset-beach": "editor.assets.background.mesh-sunset-beach",
  "pattern-grid-dark": "editor.assets.background.pattern-grid-dark",
  "pattern-grid-light": "editor.assets.background.pattern-grid-light",
  "pattern-dots-dark": "editor.assets.background.pattern-dots-dark",
  "pattern-dots-light": "editor.assets.background.pattern-dots-light",
  "pattern-noise-dark": "editor.assets.background.pattern-noise-dark",
  "waves-ocean": "editor.assets.background.waves-ocean",
  "waves-sunset": "editor.assets.background.waves-sunset",
  "aurora-borealis": "editor.assets.background.aurora-borealis"
} as const;
function backgroundName(preset: BackgroundPreset): string {
  const key = backgroundNameKeys[preset.id as keyof typeof backgroundNameKeys];
  return key ? editorMessage(key) : preset.name;
}

const TAB_ICONS: Record<AssetsTab, React.ElementType> = {
  media: Video,
  text: Type,
  graphics: Shapes,
  effects: Zap,
  transitions: Shuffle,
  adjust: SlidersHorizontal,
  ai: Sparkles,
  recipes: Wand2,
  templates: LayoutTemplate,
};

// 宿主模式的标签集合就是参考剪辑台的那 6 个：AI 生成/配方/工程模板是本站额外能力，
// 而 inspector 在参考里是素材面板的第 6 个标签「调整」，不是常驻右侧属性列。
const HOST_HIDDEN_TABS: ReadonlySet<AssetsTab> = new Set([
  "ai",
  "recipes",
  "templates",
]);
const STANDALONE_HIDDEN_TABS: ReadonlySet<AssetsTab> = new Set(["adjust"]);

const PanelIconButton: React.FC<{
  label: string;
  icon: React.ComponentProps<typeof IconButton>["icon"];
  onClick: (event: React.MouseEvent) => void;
  className?: string;
}> = ({ label, icon, onClick, className }) => (
  <IconButton
    label={label}
    icon={icon}
    variant="ghost"
    size="sm"
    onClick={onClick}
    className={className}
  />
);

const PanelButton: React.FC<{
  label: string;
  onClick: (event: React.MouseEvent) => void;
  className?: string;
  isDisabled?: boolean;
  children?: React.ReactNode;
}> = ({ label, onClick, className, isDisabled, children }) => (
  <button
    type="button"
    aria-label={label}
    onClick={onClick}
    disabled={isDisabled}
    className={className}
  >
    {children ?? label}
  </button>
);






const MediaThumbnail: React.FC<{
  item: MediaItem;
  isSelected: boolean;
  viewMode: MediaViewMode;
  onSelect: () => void;
  onDelete: () => void;
  onReplace: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onAddToTimeline: () => void;
  onKieAI?: () => void;
  onRetryKieAI?: () => void;
}> = ({
  item,
  isSelected,
  viewMode,
  onSelect,
  onDelete,
  onReplace,
  onDragStart,
  onAddToTimeline,
  onKieAI,
  onRetryKieAI,
}) => {
  const [isHovered, setIsHovered] = useState(false);

  const getIcon = () => {
    switch (item.type) {
      case "video":
        return Film;
      case "audio":
        return Music;
      case "image":
        return ImageIcon;
      default:
        return Film;
    }
  };

  const Icon = getIcon();

  const formatResolution = () => {
    if (item.metadata?.width && item.metadata?.height) {
      return `${item.metadata.width}×${item.metadata.height}`;
    }
    return null;
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return null;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const iconColor = item.type === "audio"
    ? "text-primary/50"
    : item.type === "image"
      ? "text-primary/50"
      : "text-status-info/50";

  const borderClass = item.kieaiError
    ? "border-red-500 ring-1 ring-red-500/50 shadow-[0_0_10px_rgba(239,68,68,0.3)]"
    : item.isPending
    ? "border-primary ring-1 ring-primary shadow-glow"
    : item.isPlaceholder
      ? "border-yellow-500 ring-1 ring-yellow-500/50 shadow-[0_0_10px_rgba(234,179,8,0.3)]"
      : isSelected
        ? "border-accent ring-1 ring-accent/40 shadow-sm"
        : "border-border hover:border-border-strong";

  const hoverOverlay = (
    <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center gap-2 animate-in fade-in duration-200">
      {item.kieaiError ? (
        <PanelIconButton
          label={editorMessage("editor.assets.retry")}
          icon={<RefreshCw size={14} className="text-red-400" />}
          onClick={(e) => { e.stopPropagation(); onRetryKieAI?.(); }}
          className="p-2 bg-red-500/20 rounded-full hover:bg-red-500/40 backdrop-blur-sm transition-colors"
        />
      ) : item.isPending ? (
        <div title={editorMessage("editor.assets.generatingKie")} className="p-2">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : item.isPlaceholder ? (
        <>
          <PanelIconButton
            label={editorMessage("editor.assets.replace")}
            icon={<RefreshCw size={14} className="text-yellow-500" />}
            onClick={(e) => { e.stopPropagation(); onReplace(); }}
            className="p-2 bg-yellow-500/20 rounded-full hover:bg-yellow-500/40 backdrop-blur-sm transition-colors"
          />
          <PanelIconButton
            label={editorMessage("editor.assets.delete")}
            icon={<Trash2 size={14} className="text-red-400" />}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-2 bg-red-500/20 rounded-full hover:bg-red-500/40 backdrop-blur-sm transition-colors"
          />
        </>
      ) : (
        <>
          {item.type === "image" && onKieAI && (
            <PanelIconButton
              label={editorMessage("editor.assets.kie")}
              icon={<Sparkles size={14} className="text-primary" />}
              onClick={(e) => { e.stopPropagation(); onKieAI(); }}
              className="p-2 bg-primary/20 rounded-full hover:bg-primary/40 backdrop-blur-sm transition-colors"
            />
          )}
          <PanelIconButton
            label={editorMessage("editor.assets.addTimeline")}
            icon={<Plus size={14} className="text-primary" />}
            onClick={(e) => { e.stopPropagation(); onAddToTimeline(); }}
            className="p-2 bg-primary/20 rounded-full hover:bg-primary/40 backdrop-blur-sm transition-colors"
          />
          <PanelIconButton
            label={editorMessage("editor.assets.delete")}
            icon={<Trash2 size={14} className="text-red-400" />}
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="p-2 bg-red-500/20 rounded-full hover:bg-red-500/40 backdrop-blur-sm transition-colors"
          />
        </>
      )}
    </div>
  );

  // --- List view ---
  if (viewMode === "list") {
    return (
      <div
        draggable
        onDragStart={onDragStart}
        onClick={onSelect}
        onDoubleClick={(e) => { e.stopPropagation(); onAddToTimeline(); }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`flex items-center gap-3 px-2.5 py-2 rounded-xl border cursor-pointer transition-all group ${borderClass}`}
      >
        {/* Small thumbnail — 参考实测 48×32（3:2），与"添加媒体"行同一枚图块 */}
        <div className="w-[48px] h-[32px] rounded-[8px] bg-bg-2 relative overflow-hidden flex-shrink-0">
          {item.thumbnailUrl ? (
            <img src={item.thumbnailUrl} alt={item.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Icon size={14} className={iconColor} />
            </div>
          )}
          {item.kieaiError && (
            <div className="absolute inset-0 flex items-center justify-center bg-red-500/10">
              <AlertTriangle size={12} className="text-red-400" />
            </div>
          )}
          {!item.kieaiError && item.isPending && (
            <div className="absolute inset-0 flex items-center justify-center bg-primary/10">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}
          {!item.kieaiError && !item.isPending && item.isPlaceholder && (
            <div className="absolute inset-0 flex items-center justify-center bg-yellow-500/10">
              <AlertTriangle size={12} className="text-yellow-500/70" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div
            className={`text-[13px] leading-[18px] truncate font-medium ${isSelected ? "text-brand-accent" : "text-fg"}`}
            title={item.name}
          >
            {item.name}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] leading-[14px] text-fg-3">
            {item.metadata?.duration && <span>{formatDuration(item.metadata.duration)}</span>}
            {item.metadata?.duration && formatResolution() && <span>·</span>}
            {formatResolution() && <span>{formatResolution()}</span>}
            {(item.metadata?.duration || formatResolution()) && formatFileSize(item.metadata?.fileSize) && <span>·</span>}
            {formatFileSize(item.metadata?.fileSize) && <span>{formatFileSize(item.metadata?.fileSize)}</span>}
          </div>
        </div>

        {/* Hover actions */}
        {isHovered && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {item.kieaiError ? (
              <PanelIconButton
                label={editorMessage("editor.assets.retry")}
                icon={<RefreshCw size={12} className="text-red-400" />}
                onClick={(e) => { e.stopPropagation(); onRetryKieAI?.(); }}
                className="p-1 bg-red-500/20 rounded hover:bg-red-500/40 transition-colors"
              />
            ) : item.isPending ? (
              <div className="p-1" title={editorMessage("editor.assets.generating")}>
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              </div>
            ) : item.isPlaceholder ? (
              <>
                <PanelIconButton
                  label={editorMessage("editor.assets.replace")}
                  icon={<RefreshCw size={12} className="text-yellow-500" />}
                  onClick={(e) => { e.stopPropagation(); onReplace(); }}
                  className="p-1 bg-yellow-500/20 rounded hover:bg-yellow-500/40 transition-colors"
                />
                <PanelIconButton
                  label={editorMessage("editor.assets.delete")}
                  icon={<Trash2 size={12} className="text-red-400" />}
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="p-1 bg-red-500/20 rounded hover:bg-red-500/40 transition-colors"
                />
              </>
            ) : (
              <>
                {item.type === "image" && onKieAI && (
                  <PanelIconButton
                    label={editorMessage("editor.assets.kie")}
                    icon={<Sparkles size={12} className="text-primary" />}
                    onClick={(e) => { e.stopPropagation(); onKieAI(); }}
                    className="p-1 bg-primary/20 rounded hover:bg-primary/40 transition-colors"
                  />
                )}
                <PanelIconButton
                  label={editorMessage("editor.assets.addTimeline")}
                  icon={<Plus size={12} className="text-primary" />}
                  onClick={(e) => { e.stopPropagation(); onAddToTimeline(); }}
                  className="p-1 bg-primary/20 rounded hover:bg-primary/40 transition-colors"
                />
                <PanelIconButton
                  label={editorMessage("editor.assets.delete")}
                  icon={<Trash2 size={12} className="text-red-400" />}
                  onClick={(e) => { e.stopPropagation(); onDelete(); }}
                  className="p-1 bg-red-500/20 rounded hover:bg-red-500/40 transition-colors"
                />
              </>
            )}
          </div>
        )}

        {isSelected && (
          <div className="w-2 h-2 bg-brand-accent rounded-full shadow-sm flex-shrink-0" />
        )}
      </div>
    );
  }

  // --- Grid view (large & small) ---
  const thumbnailIconSize = viewMode === "small" ? 16 : 24;

  return (
    <div className="flex flex-col">
      {/* Thumbnail container */}
      <div
        draggable
        onDragStart={onDragStart}
        onClick={onSelect}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onAddToTimeline();
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`h-[78px] bg-bg-2 rounded-lg border relative group cursor-pointer transition-all overflow-hidden ${borderClass}`}
      >
        {/* Thumbnail or placeholder */}
        {item.type === "video" && <PreviewProxyBadge mediaId={item.id} />}
        {item.thumbnailUrl ? (
          <img
            src={item.thumbnailUrl}
            alt={item.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-2">
            <Icon size={thumbnailIconSize} className={iconColor} />
          </div>
        )}

        {/* Audio waveform placeholder */}
        {item.type === "audio" && (
          <div className="absolute top-1/2 left-0 right-0 h-4 flex items-center gap-px px-2 -translate-y-1/2">
            {[...Array(10)].map((_, i) => (
              <div
                key={i}
                className="flex-1 bg-primary/30 rounded-full"
                style={{ height: `${Math.random() * 100}%` }}
              />
            ))}
          </div>
        )}

        {/* KieAI Error Badge */}
        {item.kieaiError && (
          <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-red-500 rounded text-[8px] text-white font-bold flex items-center gap-1">
            <AlertTriangle size={8} />{editorMessage("editor.assets.failed")}</div>
        )}

        {/* Pending KieAI Badge */}
        {!item.kieaiError && item.isPending && (
          <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-primary rounded text-[8px] text-primary-foreground font-bold flex items-center gap-1">
            <div className="h-2 w-2 animate-spin rounded-full border border-white border-t-transparent" />
            AI
          </div>
        )}

        {/* Missing Asset Badge */}
        {!item.kieaiError && !item.isPending && item.isPlaceholder && (
          <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-yellow-500 rounded text-[8px] text-black font-bold flex items-center gap-1">
            <AlertTriangle size={10} />{editorMessage("editor.assets.missing")}</div>
        )}

        {/* Duration badge on thumbnail */}
        {item.metadata?.duration && (
          <div className="absolute bottom-1.5 right-1.5 px-[5px] py-[2px] bg-black/60 rounded text-[10px] font-semibold text-white tabular-nums">
            {formatDuration(item.metadata.duration)}
          </div>
        )}

        {/* Error overlay */}
        {item.kieaiError && !isHovered && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-500/10">
            <AlertTriangle size={viewMode === "small" ? 20 : 32} className="text-red-400/60" />
          </div>
        )}

        {/* Pending overlay */}
        {!item.kieaiError && item.isPending && !isHovered && (
          <div className="absolute inset-0 flex items-center justify-center bg-primary/10">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        )}

        {/* Warning icon overlay for placeholders */}
        {!item.kieaiError && !item.isPending && item.isPlaceholder && !isHovered && (
          <div className="absolute inset-0 flex items-center justify-center bg-yellow-500/10">
            <AlertTriangle size={viewMode === "small" ? 20 : 32} className="text-yellow-500/50" />
          </div>
        )}

        {/* Hover overlay with actions */}
        {isHovered && hoverOverlay}

        {/* Selection indicator */}
        {isSelected && (
          <div className="absolute top-1 right-1 w-2 h-2 bg-brand-accent rounded-full shadow-sm" />
        )}
      </div>

      {/* Filename below thumbnail */}
      <div
        className="text-[12px] truncate font-medium text-fg-2 mt-1.5"
        title={item.name}
      >
        {item.name}
      </div>
    </div>
  );
};

/**
 * 参考项目把导入入口放在素材列表末尾：一整行虚线卡片，里面一枚浅灰圆角
 * 图标块 + 灰色说明，而不是居中占满面板的大空态。
 */
const AddMediaRow: React.FC<{ onAdd: () => void }> = ({ onAdd }) => (
  <button
    type="button"
    onClick={onAdd}
    className="group flex h-[50px] w-full items-center gap-3 rounded-[14px] border border-dashed border-border-strong bg-transparent px-2 text-left transition-colors hover:border-brand-accent/60 hover:bg-brand-accent-soft"
  >
    <span className="grid h-[32px] w-[48px] flex-shrink-0 place-items-center rounded-[8px] bg-bg-2 transition-colors group-hover:bg-bg-3">
      <Upload size={16} className="text-fg-3" />
    </span>
    <span className="min-w-0 flex-1 text-[13px] font-normal text-fg-3 transition-colors group-hover:text-fg">
      {editorMessage("editor.assets.addMedia")}
    </span>
  </button>
);

const LoadingIndicator: React.FC<{ message: string }> = ({ message }) => (
  <div className="absolute inset-0 bg-bg-1/90 backdrop-blur-sm flex flex-col items-center justify-center z-50">
    <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin mb-3" />
    <Text type="body" color="secondary" display="block" className="text-sm text-fg-2">{message}</Text>
  </div>
);

export const AssetsPanel: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTabRaw] = useState<AssetsTab>("media");
  const ttsHasUnsaved = useTtsAudioStore((s) => s.generatedAudio !== null && !s.isAudioSaved);
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const selectedIds = useUIStore((state) => state.selectedItems);

  const setActiveTab = useCallback((tab: AssetsTab) => {
    if (activeTab === "ai" && tab !== "ai" && ttsHasUnsaved) {
      toast.warning(editorMessage("editor.assets.discarded"), editorMessage("editor.assets.discardHelp"));
    }
    setActiveTabRaw(tab);
  }, [activeTab, ttsHasUnsaved]);

  // 参考剪辑台把 inspector 收进素材面板第 6 个标签「调整」：选中片段时自动切过去，
  // 取消选中后回到之前停留的标签，桌面栅格因此不需要一列常驻属性面板。
  const adjustSelectionKey = useMemo(
    () =>
      selectedIds
        .filter(
          (item) =>
            item.type === "clip" ||
            item.type === "text-clip" ||
            item.type === "shape-clip" ||
            item.type === "subtitle",
        )
        .map((item) => item.id)
        .join("|"),
    [selectedIds],
  );
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const tabBeforeAdjust = useRef<AssetsTab | null>(null);
  const hadAdjustTarget = useRef(false);

  useEffect(() => {
    if (!isShotloomMode) return;
    const hasTarget = adjustSelectionKey.length > 0;
    if (hasTarget) {
      if (!hadAdjustTarget.current) {
        const previous = activeTabRef.current;
        tabBeforeAdjust.current = previous === "adjust" ? null : previous;
      }
      // 只在选中集合变化时切过去；用裸 setter，否则 setActiveTab 的身份会随标签变化，
      // 这个副作用会把用户手动切走的标签又抢回「调整」。
      if (activeTabRef.current !== "adjust") setActiveTabRaw("adjust");
    } else if (hadAdjustTarget.current) {
      const previous = tabBeforeAdjust.current;
      tabBeforeAdjust.current = null;
      if (previous) setActiveTabRaw(previous);
    }
    hadAdjustTarget.current = hasTarget;
  }, [adjustSelectionKey]);

  const [isDragOver, setIsDragOver] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [showOnlyMissing, setShowOnlyMissing] = useState(false);
  const [showAspectRatioDialog, setShowAspectRatioDialog] = useState(false);
  const [aspectRatioDialogData, setAspectRatioDialogData] = useState<{
    videoWidth: number;
    videoHeight: number;
    itemToAdd: MediaItem;
  } | null>(null);
  const [sortOrder, setSortOrder] = useState<"none" | "asc" | "desc">("none");
  const [mediaSearch, setMediaSearch] = useState("");
  const [mediaViewMode, setMediaViewMode] = useState<MediaViewMode>("list");
  const [generatingBackground, setGeneratingBackground] = useState<
    string | null
  >(null);
  const [backgroundCategory, setBackgroundCategory] = useState<
    "all" | "solid" | "gradient" | "pattern" | "mesh"
  >("all");

  // KieAI image generation dialog
  const [kieaiDialog, setKieaiDialog] = useState<{ file: File; previewUrl: string | null } | null>(null);

  // Project store
  const {
    project,
    importMedia,
    deleteMedia,
    replaceMediaAsset,
    updateSettings,
    setKieAIItemState,
  } = useProjectStore();
  const mediaItems = project.mediaLibrary.items;

  // KieAI store
  const { retryTask } = useKieAIStore();

  // UI store
  const { select, isSelected, startDrag, openModal } = useUIStore();

  // Count missing assets
  const missingAssetsCount = mediaItems.filter(
    (item) => item.isPlaceholder,
  ).length;

  // Filter media items by the missing-assets toggle, then optional sort
  const baseFilteredItems = mediaItems.filter((item) =>
    showOnlyMissing ? item.isPlaceholder : true,
  );
  const searchedItems = mediaSearch.trim()
    ? baseFilteredItems.filter((item) =>
        item.name.toLowerCase().includes(mediaSearch.trim().toLowerCase()),
      )
    : baseFilteredItems;
  const filteredItems =
    sortOrder === "none"
      ? searchedItems
      : [...searchedItems].sort((a, b) => {
          const comparison = a.name.localeCompare(b.name);
          return sortOrder === "desc" ? -comparison : comparison;
        });

  // Handle file import with loading state
  const handleFileImport = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;

      setIsImporting(true);
      const fileArray = Array.from(files);

      try {
        for (let i = 0; i < fileArray.length; i++) {
          const file = fileArray[i];
          setImportProgress(
            editorMessage("editor.assets.importFile", { name: file.name, current: i + 1, total: fileArray.length }),
          );

          const result = await importMedia(file);

          // If it's a video with audio, extract audio to separate track
          if (result.success && file.type.startsWith("video/")) {
            setImportProgress(editorMessage("editor.assets.extracting", { name: file.name }));
            // Audio extraction is handled by the importMedia function
            // The audio track is created automatically when adding to timeline
          }
        }
      } catch (error) {
        console.error("Import failed:", error);
      } finally {
        setIsImporting(false);
        setImportProgress("");
      }
    },
    [importMedia],
  );

  const requestHostImportFiles = useCallback(async (files: File[]) => {
    const payloads = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        mime: file.type || "application/octet-stream",
        bytes: await file.arrayBuffer(),
      })),
    );
    await requestShotloomFiles(payloads);
  }, []);

  // Handle drag and drop import — capture FileSystemFileHandle for each dropped file
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      // Snapshot dataTransfer synchronously — it becomes inert after the first await.
      const droppedFiles = e.dataTransfer.files;
      if (isShotloomMode) {
        // 拖入的 File 在内嵌编辑器里没有 Shotloom 素材身份；交给宿主落盘后再回传，
        // 否则关闭编辑器后这些媒体在项目里没有对应文件。
        await requestHostImportFiles(Array.from(droppedFiles));
        return;
      }
      const handlePromises =
        "getAsFileSystemHandle" in DataTransferItem.prototype
          ? Array.from(e.dataTransfer.items)
              .filter((item) => item.kind === "file")
              .map(async (item) => {
                try {
                  const handle = await (item as DataTransferItem & { getAsFileSystemHandle(): Promise<FileSystemHandle> }).getAsFileSystemHandle();
                  if (handle.kind === "file") {
                    const fileHandle = handle as FileSystemFileHandle;
                    const file = await fileHandle.getFile();
                    await saveFileHandle(file.name, file.size, fileHandle);
                  }
                } catch {
                  // Ignore — handle capture is best-effort
                }
              })
          : [];

      await Promise.all(handlePromises);
      handleFileImport(droppedFiles);
    },
    [handleFileImport, requestHostImportFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  // Handle media item selection
  const handleSelectItem = useCallback(
    (itemId: string) => {
      select({ type: "clip", id: itemId });
    },
    [select],
  );

  // Handle media item deletion
  const handleDeleteItem = useCallback(
    async (itemId: string) => {
      await deleteMedia(itemId);
    },
    [deleteMedia],
  );

  // Handle asset replacement
  const handleReplaceAsset = useCallback(
    async (itemId: string) => {
      if (isShotloomMode) {
        requestShotloomRelink(itemId);
        return;
      }
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "video/*,audio/*,image/*";
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          setIsImporting(true);
          setImportProgress(editorMessage("editor.assets.replacing"));
          try {
            await replaceMediaAsset(itemId, file);
          } catch (error) {
            console.error("Asset replacement failed:", error);
          } finally {
            setIsImporting(false);
            setImportProgress("");
          }
        }
      };
      input.click();
    },
    [replaceMediaAsset],
  );

  const handleRelinkFromFolder = useCallback(async () => {
    if (isShotloomMode) {
      toast.warning(editorMessage("editor.assets.recoverIndividually"), editorMessage("editor.assets.recoverIndividuallyHelp"));
      return;
    }
    if (!("showDirectoryPicker" in window)) {
      toast.error(editorMessage("editor.assets.folderUnsupported"), editorMessage("editor.assets.folderHelp"));
      return;
    }
    let dirHandle: FileSystemDirectoryHandle;
    try {
      dirHandle = await (window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker();
    } catch {
      return; // user cancelled
    }

    const { project } = useProjectStore.getState();
    const placeholders = project.mediaLibrary.items.filter((item) => item.isPlaceholder);
    if (placeholders.length === 0) return;

    // Persist the directory handle for future auto-restore
    try { await saveDirectoryHandle(project.id, dirHandle); } catch { /* best-effort */ }

    // Build a name:size → {File, handle} map for reliable matching
    const fileMap = new Map<string, { file: File; handle: FileSystemFileHandle }>();
    const entries = (dirHandle as unknown as { entries: () => AsyncIterableIterator<[string, FileSystemHandle]> }).entries();
    for await (const [, fh] of entries) {
      if ((fh as FileSystemHandle).kind === "file") {
        const fileHandle = fh as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        fileMap.set(`${file.name.toLowerCase()}:${file.size}`, { file, handle: fileHandle });
      }
    }

    setIsImporting(true);
    let linked = 0;
    for (const item of placeholders) {
      // Match on original source file name + size (same strategy as auto-restore)
      const key = item.sourceFile
        ? `${item.sourceFile.name.toLowerCase()}:${item.sourceFile.size}`
        : null;
      const entry = key ? fileMap.get(key) : null;
      if (entry) {
        setImportProgress(editorMessage("editor.assets.relinking", { name: item.name }));
        try {
          // Save individual file handle for future auto-restore
          try { await saveFileHandle(entry.file.name, entry.file.size, entry.handle); } catch { /* best-effort */ }
          await replaceMediaAsset(item.id, entry.file, dirHandle.name);
          linked++;
        } catch (err) {
          console.error(`[AssetsPanel] Failed to relink ${item.name}:`, err);
        }
      }
    }
    setIsImporting(false);
    setImportProgress("");

    if (linked > 0) {
      toast.success(editorMessage(placeholders.length === 1 ? "editor.assets.relinkedOne" : "editor.assets.relinkedMany", { linked, total: placeholders.length }));
    } else {
      toast.error(editorMessage("editor.assets.noMatches"), editorMessage("editor.assets.noMatchesHelp"));
    }
  }, [replaceMediaAsset]);

  // Handle drag start for timeline placement
  const handleItemDragStart = useCallback(
    (e: React.DragEvent, item: MediaItem) => {
      e.dataTransfer.setData(
        "application/json",
        JSON.stringify({ mediaId: item.id }),
      );
      e.dataTransfer.effectAllowed = "copy";
      startDrag("media", { mediaId: item.id, mediaType: item.type });
    },
    [startDrag],
  );

  const addMediaToTimeline = useCallback(async (item: MediaItem) => {
    const { addClipToNewTrack } = useProjectStore.getState();
    await addClipToNewTrack(item.id, playheadPosition);
  }, [playheadPosition]);

  const handleConfirmAspectRatioMatch = useCallback(async () => {
    if (!aspectRatioDialogData) return;

    await updateSettings({
      width: aspectRatioDialogData.videoWidth,
      height: aspectRatioDialogData.videoHeight,
    });

    const itemToAdd = aspectRatioDialogData.itemToAdd;
    setShowAspectRatioDialog(false);
    setAspectRatioDialogData(null);

    await addMediaToTimeline(itemToAdd);
  }, [aspectRatioDialogData, updateSettings, addMediaToTimeline]);

  const handleCancelAspectRatioMatch = useCallback(async () => {
    if (!aspectRatioDialogData) return;

    const itemToAdd = aspectRatioDialogData.itemToAdd;
    setShowAspectRatioDialog(false);
    setAspectRatioDialogData(null);

    await addMediaToTimeline(itemToAdd);
  }, [aspectRatioDialogData, addMediaToTimeline]);

  const handleAddToTimeline = useCallback(
    async (item: MediaItem) => {
      const { project: currentProject } = useProjectStore.getState();
      const tracks = currentProject.timeline.tracks;
      const hasClips = tracks.some((track) => track.clips.length > 0);

      if (
        !hasClips &&
        item.type === "video" &&
        item.metadata?.width &&
        item.metadata?.height
      ) {
        const videoWidth = item.metadata.width;
        const videoHeight = item.metadata.height;
        const projectWidth = currentProject.settings.width;
        const projectHeight = currentProject.settings.height;

        if (videoWidth !== projectWidth || videoHeight !== projectHeight) {
          setAspectRatioDialogData({ videoWidth, videoHeight, itemToAdd: item });
          setShowAspectRatioDialog(true);
          return;
        }
      }

      await addMediaToTimeline(item);
    },
    [addMediaToTimeline],
  );

  const triggerFileInput = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Shotloom 模式下素材归属宿主项目：导入必须经过宿主，否则关闭编辑器后
  // OpenReel 本地库里的文件在 Shotloom 里没有对应素材。
  const requestHostImport = useCallback(() => {
    if (typeof window === "undefined") return;
    requestShotloomImport();
  }, []);

  const handleImportBackground = useCallback(
    async (preset: BackgroundPreset) => {
      setGeneratingBackground(preset.id);
      try {
        const { width, height } = project.settings;
        const blob = await generateBackgroundBlob(preset, width, height);
        const file = new File([blob], `${preset.name}_${width}x${height}.png`, {
          type: "image/png",
        });
        const result = await importMedia(file);
        if (result.success && result.actionId) {
          const { addClipToNewTrack } = useProjectStore.getState();
          await addClipToNewTrack(result.actionId);
        }
      } catch (error) {
        console.error("Failed to generate background:", error);
      } finally {
        setGeneratingBackground(null);
      }
    },
    [importMedia, project.settings],
  );

  const filteredBackgrounds = BACKGROUND_PRESETS.filter(
    (preset) =>
      backgroundCategory === "all" || preset.category === backgroundCategory,
  );

  // Open KieAI dialog for an image asset
  const handleOpenKieAI = useCallback(async (item: MediaItem) => {
    try {
      const blob = await loadMediaBlob(item.id);
      if (!blob) {
        toast.error(editorMessage("editor.assets.notFound"), editorMessage("editor.assets.notFoundHelp"));
        return;
      }
      const mimeType = blob.type || (item.name.match(/\.png$/i) ? "image/png" : "image/jpeg");
      const file = new File([blob], item.name, { type: mimeType as string });
      setKieaiDialog({ file, previewUrl: item.thumbnailUrl });
    } catch (err) {
      console.error("[KieAI] Failed to load media blob:", err);
      toast.error(editorMessage("editor.assets.kieFailed"), err instanceof Error ? err.message : editorMessage("editor.assets.unknown"));
    }
  }, []);

  const handleRetryKieAI = useCallback((item: MediaItem) => {
    if (!item.kieaiTaskId) return;
    // Reset error state and re-activate polling
    setKieAIItemState(item.id, true, false);
    retryTask(item.kieaiTaskId);
  }, [retryTask, setKieAIItemState]);

  const renderSectionContent = (tab: AssetsTab): React.ReactNode => {
    switch (tab) {
      case "media":
        return (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* 搜索 + 视图切换：参考项目把导入入口下移到素材列表之后，
                顶部只留一枚搜索框与三档视图分段按钮。 */}
            <div className="shrink-0 px-4 pt-3 pb-2">
              <div className="flex items-center gap-2">
                <label className="relative flex h-[36px] min-w-0 flex-1 items-center">
                  <svg
                    aria-hidden
                    className="pointer-events-none absolute left-3 text-fg-muted"
                    fill="none"
                    height="15"
                    viewBox="0 0 24 24"
                    width="15"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.6-3.6" />
                  </svg>
                  <input
                    aria-label={editorMessage("editor.assets.search")}
                    value={mediaSearch}
                    onChange={(event) => setMediaSearch(event.target.value)}
                    placeholder={editorMessage("editor.assets.search")}
                    className="h-full w-full rounded-[10px] border border-transparent bg-bg-2 pl-9 pr-3 text-[13px] text-fg placeholder:text-fg-muted focus:border-border-strong focus:bg-bg-1 focus:outline-none"
                  />
                </label>
                <div className="flex h-[36px] shrink-0 items-center gap-0.5 rounded-[10px] border border-border bg-bg-1 px-1">
                  {(["small", "large", "list"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-label={editorMessage(mediaViewLabels[mode])}
                      aria-pressed={mediaViewMode === mode}
                      title={editorMessage(mediaViewLabels[mode])}
                      onClick={() => setMediaViewMode(mode)}
                      className={`grid h-[26px] w-[26px] place-items-center rounded-[7px] transition-colors ${
                        mediaViewMode === mode
                          ? "bg-bg-3 text-fg"
                          : "text-fg-3 hover:bg-bg-2 hover:text-fg-2"
                      }`}
                    >
                      {mode === "small" && (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <rect x="3" y="3" width="7" height="7" rx="1.5" />
                          <rect x="14" y="3" width="7" height="7" rx="1.5" />
                          <rect x="3" y="14" width="7" height="7" rx="1.5" />
                          <rect x="14" y="14" width="7" height="7" rx="1.5" />
                        </svg>
                      )}
                      {mode === "large" && (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <path d="M3 12h18M12 3v18" />
                        </svg>
                      )}
                      {mode === "list" && (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                          <path d="M9 6h11M9 12h11M9 18h11" />
                          <path d="M3.5 5.5h2v2h-2zM3.5 11h2v2h-2zM3.5 17h2v2h-2z" fill="currentColor" stroke="none" />
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
                {/* 参考实现的素材行只有搜索框 + 三档视图，`assets.*` 词典里也没有任何
                    排序键；排序是上游 OpenReel 自带的便利项，且 `sortOrder` 只是本组件
                    的 useState（不持久化），所以宿主模式直接收起而不会留下无法复原的状态。 */}
                {!isShotloomMode && (
                  <button
                    type="button"
                    aria-label={editorMessage("editor.assets.sort")}
                    title={editorMessage("editor.assets.sort")}
                    onClick={() =>
                      setSortOrder((prev) =>
                        prev === "none" ? "asc" : prev === "asc" ? "desc" : "none",
                      )
                    }
                    className={`grid h-[36px] w-[30px] shrink-0 place-items-center rounded-[10px] transition-colors ${
                      sortOrder === "none"
                        ? "text-fg-3 hover:bg-bg-2 hover:text-fg-2"
                        : "bg-bg-3 text-fg"
                    }`}
                  >
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    >
                      <path d="M3 7h13M3 7l3-3M3 7l3 3M21 17H8M21 17l-3-3M21 17l-3 3" />
                    </svg>
                  </button>
                )}
              </div>
              {!isShotloomMode && (
                <button
                  type="button"
                  aria-label={editorMessage("editor.assets.record")}
                  onClick={() => openModal("recorder")}
                  className="mt-2 flex w-full items-center justify-center gap-[7px] rounded-[9px] border border-border bg-bg p-[10px] text-[13px] font-medium text-fg-2"
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--fg-3)"
                    strokeWidth="1.9"
                  >
                    <circle cx="12" cy="12" r="8" />
                    <circle cx="12" cy="12" r="3" fill="var(--fg-3)" stroke="none" />
                  </svg>{editorMessage("editor.assets.record")}</button>
              )}
            </div>

            {missingAssetsCount > 0 && (
              <div className="px-4 pb-3 space-y-2">
                <PanelButton
                  label={editorMessage("editor.assets.missingOnly")}
                  onClick={() => setShowOnlyMissing(!showOnlyMissing)}
                  className={`w-full px-3 py-2 rounded-lg border text-xs font-medium transition-all flex items-center justify-between ${
                    showOnlyMissing
                      ? "bg-yellow-500/10 border-yellow-500 text-yellow-500"
                      : "bg-background-tertiary border-border text-text-secondary hover:border-yellow-500/50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={14} />
                    <span>{editorMessage("editor.assets.missingOnly")}</span>
                  </div>
                  <div className="px-2 py-0.5 rounded-full bg-yellow-500 text-black text-[10px] font-bold">
                    {missingAssetsCount}
                  </div>
                </PanelButton>
                <PanelButton
                  label={editorMessage("editor.assets.relink")}
                  onClick={handleRelinkFromFolder}
                  className="w-full px-3 py-2 rounded-lg border border-yellow-500/40 bg-yellow-500/5 text-yellow-500 text-xs font-medium transition-all hover:bg-yellow-500/15 flex items-center gap-2"
                >
                  <RefreshCw size={14} />
                  <span>{editorMessage("editor.assets.relinkMore")}</span>
                </PanelButton>
              </div>
            )}

            <div
              className={`min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scrollbar ${isDragOver ? "bg-brand-accent-soft" : ""}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
            >
              <div className="px-4 pb-[18px] relative">
                <div
                  className={
                    mediaViewMode === "list"
                      ? "flex flex-col gap-2"
                      : mediaViewMode === "small"
                        ? "grid grid-cols-3 gap-2"
                        : "grid grid-cols-2 gap-3"
                  }
                >
                  {filteredItems.map((item) => (
                    <MediaThumbnail
                      key={item.id}
                      item={item}
                      isSelected={isSelected(item.id)}
                      viewMode={mediaViewMode}
                      onSelect={() => handleSelectItem(item.id)}
                      onDelete={() => handleDeleteItem(item.id)}
                      onReplace={() => handleReplaceAsset(item.id)}
                      onDragStart={(e) => handleItemDragStart(e, item)}
                      onAddToTimeline={() => handleAddToTimeline(item)}
                      onKieAI={item.type === "image" && !item.isPending && !item.kieaiError ? () => handleOpenKieAI(item) : undefined}
                      onRetryKieAI={item.kieaiError && item.kieaiTaskId ? () => handleRetryKieAI(item) : undefined}
                    />
                  ))}
                </div>
                <div className="mt-2">
                  <AddMediaRow
                    onAdd={isShotloomMode ? requestHostImport : triggerFileInput}
                  />
                </div>

                {/* Keep selection tools below the gallery so its first click does not move the second-click target. */}
                {mediaItems.filter((item) => item.type === "video" && selectedIds.some((selected) => selected.id === item.id)).slice(0, 1).map((item) => (
                  <div key={item.id} className="mt-4"><PreviewProxyControls item={item} /></div>
                ))}

                {isDragOver && (
                  <div className="absolute inset-4 border-2 border-dashed border-accent rounded-xl flex items-center justify-center bg-brand-accent-soft pointer-events-none z-50 backdrop-blur-sm">
                    <div className="text-brand-accent text-sm font-bold bg-bg-1 px-4 py-2 rounded-full shadow-lg">{editorMessage("editor.assets.drop")}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      case "graphics":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70">
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="px-4 py-4">
                {/* 参考实现的图形页顺序是 形状 → 背景 → SVG 导入 → 贴纸，形状栅格为 4 列。 */}
                <div className="mb-6">
                  <Text type="label" color="secondary" weight="bold" display="block" className="mb-3 text-xs">{editorMessage("editor.assets.shapes")}</Text>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      {
                        type: "rectangle" as ShapeType,
                        icon: Square,
                        get label() { return editorMessage("editor.assets.rectangle"); },
                      },
                      { type: "circle" as ShapeType, icon: Circle, label: editorMessage("editor.assets.circle") },
                      {
                        type: "triangle" as ShapeType,
                        icon: Triangle,
                        get label() { return editorMessage("editor.assets.triangle"); },
                      },
                      { type: "star" as ShapeType, icon: Star, label: editorMessage("editor.assets.star") },
                      {
                        type: "arrow" as ShapeType,
                        icon: ArrowRight,
                        get label() { return editorMessage("editor.assets.arrow"); },
                      },
                      {
                        type: "polygon" as ShapeType,
                        icon: Hexagon,
                        get label() { return editorMessage("editor.assets.polygon"); },
                      },
                    ].map((shape) => (
                      <PanelButton
                        key={shape.type}
                        label={shape.label}
                        onClick={async () => {
                          const created = await insertTimelineOverlay(
                            playheadPosition,
                            5,
                            (trackId) =>
                              useProjectStore
                                .getState()
                                .createShapeClip(
                                  trackId,
                                  playheadPosition,
                                  shape.type,
                                ),
                          );
                          if (created) {
                            select({
                              type: "shape-clip",
                              id: created.id,
                              trackId: created.trackId,
                            });
                          }
                        }}
                        className="aspect-square bg-background-tertiary rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center gap-1 group"
                      >
                        <shape.icon
                          size={20}
                          className="text-text-secondary group-hover:text-primary transition-colors"
                        />
                        <span className="text-[9px] text-text-muted group-hover:text-text-secondary">
                          {shape.label}
                        </span>
                      </PanelButton>
                    ))}
                  </div>
                </div>

                <div className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <Text type="label" color="secondary" weight="bold" display="block" className="flex items-center gap-1.5 text-xs">
                      <Palette size={12} />{editorMessage("editor.assets.backgrounds")}</Text>
                  </div>
                  <div className="flex gap-1.5 mb-3 flex-wrap">
                    {(["all", "solid", "gradient", "mesh", "pattern"] as const).map(
                      (cat) => (
                        <SelectableCard
                          key={cat}
                          label={editorMessage(backgroundCategoryLabels[cat])}
                          isSelected={backgroundCategory === cat}
                          onChange={() => setBackgroundCategory(cat)}
                          onClick={() => setBackgroundCategory(cat)}
                          padding={1}
                          variant={backgroundCategory === cat ? "green" : "muted"}
                          className={`px-2.5 py-1 text-[10px] rounded-md transition-all ${
                            backgroundCategory === cat
                              ? "bg-primary text-white"
                              : "bg-background-tertiary text-text-muted hover:text-text-secondary"
                          }`}
                        >
                          {editorMessage(backgroundCategoryLabels[cat])}
                        </SelectableCard>
                      ),
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {filteredBackgrounds.map((preset) => (
                      <PanelButton
                        key={preset.id}
                        label={backgroundName(preset)}
                        onClick={() => handleImportBackground(preset)}
                        isDisabled={generatingBackground !== null}
                        className="aspect-square rounded-lg border border-border hover:border-primary/50 transition-all overflow-hidden relative group disabled:opacity-50"
                      >
                        <span className="absolute inset-0" style={{ background: preset.thumbnail }} />
                        {generatingBackground === preset.id && (
                          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                          <Plus size={16} className="text-white" />
                        </div>
                        <span className="absolute bottom-0 left-0 right-0 text-[8px] text-white bg-black/60 py-0.5 px-1 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                          {backgroundName(preset)}
                        </span>
                      </PanelButton>
                    ))}
                  </div>
                </div>

                {/* 参考实现的图形页只有 形状 / 背景 / SVG 导入 / 贴纸 四段，没有 3D 对象；
                    且这一段的图标是 □ ○ ◯ △ ▯ ◆ 这些 Unicode 字形，与其余栅格的 SVG 图标不成一套。 */}
                {!isShotloomMode && (
                  <div className="mb-6">
                    <Text type="label" color="secondary" weight="bold" display="block" className="mb-3 text-xs">{editorMessage("editor.assets.objects")}</Text>
                    <div className="grid grid-cols-3 gap-2">
                      {([
                        { type: "mesh-cube" as ShapeType, get label() { return editorMessage("editor.assets.cube"); }, icon: "□" },
                        { type: "mesh-sphere" as ShapeType, get label() { return editorMessage("editor.assets.sphere"); }, icon: "○" },
                        { type: "mesh-torus" as ShapeType, get label() { return editorMessage("editor.assets.torus"); }, icon: "◯" },
                        { type: "mesh-cone" as ShapeType, get label() { return editorMessage("editor.assets.cone"); }, icon: "△" },
                        { type: "mesh-cylinder" as ShapeType, get label() { return editorMessage("editor.assets.cylinder"); }, icon: "▯" },
                        { type: "mesh-icosahedron" as ShapeType, get label() { return editorMessage("editor.assets.icosahedron"); }, icon: "◆" },
                      ]).map((mesh) => (
                        <PanelButton
                          key={mesh.type}
                          label={mesh.label}
                          onClick={async () => {
                            const created = await insertTimelineOverlay(
                              playheadPosition,
                              5,
                              (trackId) =>
                                useProjectStore
                                  .getState()
                                  .createShapeClip(
                                    trackId,
                                    playheadPosition,
                                    mesh.type,
                                  ),
                            );
                            // Nudge the rotation so the 3D depth is visible from
                            // the get-go (otherwise a head-on cube looks flat).
                            if (created) {
                              useProjectStore.getState().updateClipRotate3D(
                                created.id,
                                { x: -18, y: 28, z: 0 },
                              );
                              select({
                                type: "shape-clip",
                                id: created.id,
                                trackId: created.trackId,
                              });
                            }
                          }}
                          className="aspect-square bg-background-tertiary rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center gap-1 group"
                        >
                          <span className="text-2xl text-text-secondary group-hover:text-primary transition-colors leading-none">
                            {mesh.icon}
                          </span>
                          <span className="text-[9px] text-text-muted group-hover:text-text-secondary">
                            {mesh.label}
                          </span>
                        </PanelButton>
                      ))}
                    </div>
                </div>
                )}

                <div className="mb-6">
                  <Text type="label" color="secondary" weight="bold" display="block" className="mb-3 text-xs">{editorMessage("editor.assets.svg")}</Text>
                  <PanelButton
                    label={editorMessage("editor.assets.importSvg")}
                    onClick={() => {
                      const input = document.createElement("input");
                      input.type = "file";
                      input.accept = ".svg";
                      input.onchange = async (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (file) {
                          const content = await file.text();
                          const created = await insertTimelineOverlay(
                            playheadPosition,
                            5,
                            (trackId) =>
                              useProjectStore
                                .getState()
                                .importSVG(content, trackId, playheadPosition),
                          );
                          if (created) {
                            select({
                              type: "shape-clip",
                              id: created.id,
                              trackId: created.trackId,
                            });
                          }
                        }
                      };
                      input.click();
                    }}
                    className="w-full py-3 bg-background-tertiary rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all flex items-center justify-center gap-2 group"
                  >
                    <FileCode
                      size={16}
                      className="text-text-secondary group-hover:text-primary transition-colors"
                    />
                    <span className="text-xs text-text-secondary group-hover:text-text-primary">{editorMessage("editor.assets.importSvg")}</span>
                  </PanelButton>
                </div>

                <div className="mb-6">
                  <StickerPickerPanel />
                </div>
              </div>
            </div>
          </div>
        );
      case "text":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70">
            <div className="min-h-0 flex-1 overflow-auto">
              <div className="min-w-0 px-4 py-4 space-y-3">
                <PanelButton
                  label={editorMessage("editor.assets.addTitle")}
                  onClick={async () => {
                    const created = await insertTimelineOverlay(
                      playheadPosition,
                      5,
                      (trackId) =>
                        useProjectStore
                          .getState()
                          .createTextClip(
                            trackId,
                            playheadPosition,
                            editorMessage("editor.assets.newTitle"),
                            5,
                            DEFAULT_TITLE_STYLE,
                          ),
                    );
                    if (created) {
                      select({
                        type: "text-clip",
                        id: created.id,
                        trackId: created.trackId,
                      });
                    }
                  }}
                  className="flex min-h-[72px] w-full min-w-0 flex-col items-center justify-center rounded-lg border border-border bg-background-tertiary px-3 py-3 text-center transition-all hover:border-primary/50 hover:bg-primary/5"
                >
                  <span className="block max-w-full truncate text-base font-bold leading-tight text-text-primary">{editorMessage("editor.assets.addTitle")}</span>
                  <Text
                    type="supporting"
                    color="secondary"
                    display="block"
                    maxLines={1}
                    className="mt-1 max-w-full text-[11px] leading-tight"
                  >{editorMessage("editor.assets.titleHelp")}</Text>
                </PanelButton>
                <div className="grid min-w-0 grid-cols-2 gap-2">
                  {TEXT_STYLE_PRESETS.map((preset) => (
                    <PanelButton
                      key={preset.name}
                      label={preset.name}
                      onClick={async () => {
                        const created = await insertTimelineOverlay(
                          playheadPosition,
                          5,
                          (trackId) =>
                            useProjectStore
                              .getState()
                              .createTextClip(
                                trackId,
                                playheadPosition,
                                preset.text,
                                5,
                                preset.style,
                              ),
                        );
                        if (created) {
                          select({
                            type: "text-clip",
                            id: created.id,
                            trackId: created.trackId,
                          });
                        }
                      }}
                      className="flex min-h-[44px] min-w-0 items-center justify-center rounded-lg border border-border bg-background-tertiary px-2 py-2 text-center text-xs font-medium leading-tight text-text-secondary transition-all hover:border-primary/50 hover:bg-primary/5 hover:text-text-primary"
                    >
                      <span className="block max-w-full truncate">
                        {preset.name}
                      </span>
                    </PanelButton>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      case "effects":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70 bg-bg-1">
            <EffectsPanel />
          </div>
        );
      case "transitions":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70 bg-bg-1">
            <TransitionsPanel />
          </div>
        );
      case "adjust":
        return (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg-1">
            <InspectorPanel />
          </div>
        );
      case "ai":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70 bg-background-secondary content-area-fix">
            <AIGenTab />
          </div>
        );
      case "recipes":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70 bg-background-secondary content-area-fix">
            <RecipesTab />
          </div>
        );
      case "templates":
        return (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border/70 bg-background-secondary content-area-fix">
            <TemplatesTab />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div
      data-tour="assets"
      className="w-full h-full bg-bg-1 overflow-hidden flex flex-col relative"
    >
      {/* ── Asset type tabs (icon + label, horizontal, panel top) ──
          参考项目把类型切换放在面板顶部的横排，而不是左侧竖列：选中态给图标一枚
          强调色药丸并把标签染成强调色，标签下方一条发丝线收尾，悬停提示是这一类的说明。 */}
      <div className="flex items-stretch gap-0.5 border-b border-border bg-bg-1 px-2 pt-2 pb-1 shrink-0 overflow-x-auto scrollbar-none">
        {(isShotloomMode
          ? ASSETS_TABS.filter((tab) => !HOST_HIDDEN_TABS.has(tab.value))
          : ASSETS_TABS.filter((tab) => !STANDALONE_HIDDEN_TABS.has(tab.value))
        ).map((tab) => {
          const Icon = TAB_ICONS[tab.value];
          const isActive = activeTab === tab.value;
          return (
            <button
              key={tab.value}
              type="button"
              aria-label={tab.label}
              aria-pressed={isActive}
              title={tab.description}
              onClick={() => setActiveTab(tab.value)}
              className={`group flex min-w-[50px] shrink-0 flex-col items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[10.5px] font-medium tracking-tight transition-colors ${
                isActive
                  ? "text-accent"
                  : "text-fg-3 hover:text-fg hover:bg-hover"
              }`}
            >
              <span
                className={`grid h-7 w-7 place-items-center rounded-md transition-colors ${
                  isActive
                    ? "bg-accent-soft text-accent"
                    : "text-fg-2 group-hover:text-fg"
                }`}
              >
                <Icon size={17} strokeWidth={1.6} />
              </span>
              <span className={isActive ? "text-accent" : ""}>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* ── Body: section content fills the remaining space ──── */}
      <div className="flex-1 flex flex-col min-w-0 h-full bg-bg-1 relative">
        {isImporting && (
          <LoadingIndicator message={importProgress || editorMessage("editor.assets.importing")} />
        )}

        <input
          ref={fileInputRef}
          type="file"
          aria-label={editorMessage("editor.assets.import")}
          accept="video/*,audio/*,image/*"
          multiple
          className="hidden"
          onChange={(event) => {
            handleFileImport(event.target.files);
            event.target.value = "";
          }}
        />

        {/* Dynamic Section Content */}
        <div className="flex-1 min-h-0 relative flex flex-col overflow-hidden">
          {activeTab !== "media" && (
            <div className="min-w-0 px-4 pt-[18px] pb-0 shrink-0">
              <div
                className="truncate font-bold text-[18px] text-fg"
                title={ASSETS_TABS.find((t) => t.value === activeTab)?.label}
              >
                {ASSETS_TABS.find((t) => t.value === activeTab)?.label}
              </div>
            </div>
          )}
          {renderSectionContent(activeTab)}
        </div>
      </div>

      {aspectRatioDialogData && (
        <AspectRatioMatchDialog
          isOpen={showAspectRatioDialog}
          videoWidth={aspectRatioDialogData.videoWidth}
          videoHeight={aspectRatioDialogData.videoHeight}
          currentWidth={project.settings.width}
          currentHeight={project.settings.height}
          onConfirm={handleConfirmAspectRatioMatch}
          onCancel={handleCancelAspectRatioMatch}
        />
      )}

      {kieaiDialog && (
        <KieAIImageDialog
          open={true}
          onClose={() => setKieaiDialog(null)}
          sourceFile={kieaiDialog.file}
          previewUrl={kieaiDialog.previewUrl}
        />
      )}
    </div>
  );
};

export default AssetsPanel;
