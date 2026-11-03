import { editorMessage } from "../../shotloom-mode";
import React, {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
} from "react";
import {
  Search,
  X,
  Video,
  Music2,
  Type,
  Palette,
  Wand2,
  Layers,
  Zap,
  Square,
  Move,
  Focus,
  Clock,
  Eye,
  Sliders,
} from "@/icons/lucide-compat";
import { ToolcraftSegmentedControl } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftEmptyState as EmptyState } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftKbd as Kbd } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutContent as LayoutContent, ToolcraftLayoutFooter as LayoutFooter } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { useUIStore } from "../../stores/ui-store";
import { useProjectStore } from "../../stores/project-store";

interface SearchItem {
  id: string;
  nameKey: Parameters<typeof editorMessage>[0];
  category: string;
  keywords: string[];
  icon: React.ElementType;
  descriptionKey: Parameters<typeof editorMessage>[0];
  sectionId: string;
  clipTypes: Array<"video" | "audio" | "text" | "shape" | "image">;
}

const SEARCHABLE_EFFECTS: SearchItem[] = [
  {
    id: "transform",
    nameKey: "editor.search.effect.transform",
    category: "position-size",
    keywords: ["position", "scale", "rotate", "move", "resize", "transform"],
    icon: Move,
    descriptionKey: "editor.search.effect.transform.description",
    sectionId: "transform",
    clipTypes: ["video", "image", "text", "shape"],
  },
  {
    id: "crop",
    nameKey: "editor.search.effect.crop",
    category: "position-size",
    keywords: ["crop", "cut", "trim", "frame", "aspect"],
    icon: Focus,
    descriptionKey: "editor.search.effect.crop.description",
    sectionId: "crop",
    clipTypes: ["video", "image"],
  },
  {
    id: "speed",
    nameKey: "editor.search.effect.speed",
    category: "time",
    keywords: ["speed", "slow", "fast", "time", "duration", "playback"],
    icon: Clock,
    descriptionKey: "editor.search.effect.speed.description",
    sectionId: "speed",
    clipTypes: ["video", "audio"],
  },
  {
    id: "video-effects",
    nameKey: "editor.search.effect.video-effects",
    category: "video",
    keywords: [
      "brightness",
      "contrast",
      "saturation",
      "blur",
      "sharpen",
      "vignette",
      "effects",
    ],
    icon: Sliders,
    descriptionKey: "editor.search.effect.video-effects.description",
    sectionId: "video-effects",
    clipTypes: ["video", "image", "text", "shape"],
  },
  {
    id: "color-grading",
    nameKey: "editor.search.effect.color-grading",
    category: "video",
    keywords: [
      "color",
      "grade",
      "wheels",
      "curves",
      "lut",
      "hsl",
      "exposure",
      "temperature",
    ],
    icon: Palette,
    descriptionKey: "editor.search.effect.color-grading.description",
    sectionId: "color-grading",
    clipTypes: ["video", "image"],
  },
  {
    id: "green-screen",
    nameKey: "editor.search.effect.green-screen",
    category: "video",
    keywords: ["green", "screen", "chroma", "key", "background", "remove"],
    icon: Eye,
    descriptionKey: "editor.search.effect.green-screen.description",
    sectionId: "green-screen",
    clipTypes: ["video", "image"],
  },
  {
    id: "background-removal",
    nameKey: "editor.search.effect.background-removal",
    category: "video",
    keywords: ["background", "remove", "ai", "mask", "cutout", "person"],
    icon: Wand2,
    descriptionKey: "editor.search.effect.background-removal.description",
    sectionId: "background-removal",
    clipTypes: ["video", "image"],
  },
  {
    id: "masking",
    nameKey: "editor.search.effect.masking",
    category: "video",
    keywords: ["mask", "shape", "feather", "reveal", "hide", "vignette"],
    icon: Layers,
    descriptionKey: "editor.search.effect.masking.description",
    sectionId: "masking",
    clipTypes: ["video", "image"],
  },
  {
    id: "motion-tracking",
    nameKey: "editor.search.effect.motion-tracking",
    category: "video",
    keywords: ["motion", "track", "follow", "pin", "stabilize"],
    icon: Move,
    descriptionKey: "editor.search.effect.motion-tracking.description",
    sectionId: "motion-tracking",
    clipTypes: ["video"],
  },
  {
    id: "pip",
    nameKey: "editor.search.effect.pip",
    category: "video",
    keywords: ["pip", "picture", "overlay", "corner", "position"],
    icon: Square,
    descriptionKey: "editor.search.effect.pip.description",
    sectionId: "pip",
    clipTypes: ["video", "image"],
  },
  {
    id: "blending",
    nameKey: "editor.search.effect.blending",
    category: "video",
    keywords: ["blend", "mode", "multiply", "screen", "overlay", "opacity"],
    icon: Layers,
    descriptionKey: "editor.search.effect.blending.description",
    sectionId: "blending",
    clipTypes: ["video", "image"],
  },
  {
    id: "transform-3d",
    nameKey: "editor.search.effect.transform-3d",
    category: "video",
    keywords: ["3d", "perspective", "rotate", "flip", "tilt"],
    icon: Move,
    descriptionKey: "editor.search.effect.transform-3d.description",
    sectionId: "transform-3d",
    clipTypes: ["video", "image"],
  },
  {
    id: "keyframes",
    nameKey: "editor.search.effect.keyframes",
    category: "animation",
    keywords: ["keyframe", "animate", "animation", "ease", "interpolate"],
    icon: Zap,
    descriptionKey: "editor.search.effect.keyframes.description",
    sectionId: "keyframes",
    clipTypes: ["video", "image", "text", "shape"],
  },
  {
    id: "transitions",
    nameKey: "editor.search.effect.transitions",
    category: "animation",
    keywords: ["transition", "fade", "dissolve", "wipe", "slide"],
    icon: Zap,
    descriptionKey: "editor.search.effect.transitions.description",
    sectionId: "transitions",
    clipTypes: ["video", "image"],
  },
  {
    id: "motion-presets",
    nameKey: "editor.search.effect.motion-presets",
    category: "animation",
    keywords: ["motion", "preset", "zoom", "pan", "shake", "bounce"],
    icon: Zap,
    descriptionKey: "editor.search.effect.motion-presets.description",
    sectionId: "motion-presets",
    clipTypes: ["video", "image"],
  },
  {
    id: "audio-effects",
    nameKey: "editor.search.effect.audio-effects",
    category: "audio",
    keywords: [
      "audio",
      "eq",
      "equalizer",
      "compressor",
      "reverb",
      "delay",
      "sound",
    ],
    icon: Music2,
    descriptionKey: "editor.search.effect.audio-effects.description",
    sectionId: "audio-effects",
    clipTypes: ["audio", "video"],
  },
  {
    id: "audio-ducking",
    nameKey: "editor.search.effect.audio-ducking",
    category: "audio",
    keywords: ["duck", "ducking", "voice", "music", "fade", "auto"],
    icon: Music2,
    descriptionKey: "editor.search.effect.audio-ducking.description",
    sectionId: "audio-ducking",
    clipTypes: ["audio", "video"],
  },
  {
    id: "text-properties",
    nameKey: "editor.search.effect.text-properties",
    category: "text",
    keywords: ["text", "font", "size", "color", "style", "typography"],
    icon: Type,
    descriptionKey: "editor.search.effect.text-properties.description",
    sectionId: "text-properties",
    clipTypes: ["text"],
  },
  {
    id: "text-material",
    nameKey: "editor.search.effect.text-material",
    category: "text",
    keywords: ["text", "material", "shader", "paper", "glsl", "gradient", "dissolve"],
    icon: Wand2,
    descriptionKey: "editor.search.effect.text-material.description",
    sectionId: "text-properties",
    clipTypes: ["text"],
  },
  {
    id: "text-animation",
    nameKey: "editor.search.effect.text-animation",
    category: "text",
    keywords: ["text", "animate", "typewriter", "fade", "slide", "bounce"],
    icon: Type,
    descriptionKey: "editor.search.effect.text-animation.description",
    sectionId: "text-animation",
    clipTypes: ["text"],
  },
  {
    id: "shape-properties",
    nameKey: "editor.search.effect.shape-properties",
    category: "shapes",
    keywords: ["shape", "fill", "stroke", "corner", "radius", "shadow"],
    icon: Square,
    descriptionKey: "editor.search.effect.shape-properties.description",
    sectionId: "shape-properties",
    clipTypes: ["shape"],
  },
  {
    id: "shape-shader-fill",
    nameKey: "editor.search.effect.shape-shader-fill",
    category: "shapes",
    keywords: ["shape", "fill", "shader", "paper", "material", "gradient"],
    icon: Wand2,
    descriptionKey: "editor.search.effect.shape-shader-fill.description",
    sectionId: "shape-properties",
    clipTypes: ["shape"],
  },
];

const CATEGORIES = [
  { id: "all", nameKey: "editor.search.category.all", icon: undefined },
  { id: "video", nameKey: "editor.search.category.video", icon: Video },
  { id: "audio", nameKey: "editor.search.category.audio", icon: Music2 },
  { id: "text", nameKey: "editor.search.category.text", icon: Type },
  { id: "animation", nameKey: "editor.search.category.animation", icon: Zap },
] as const;

const categoryKeys: Record<string, Parameters<typeof editorMessage>[0]> = {
  "position-size": "editor.search.category.position-size",
  "time": "editor.search.category.time",
  "video": "editor.search.category.video",
  "animation": "editor.search.category.animation",
  "audio": "editor.search.category.audio",
  "text": "editor.search.category.text",
  "shapes": "editor.search.category.shapes",
  "all": "editor.search.category.all"
};

const clipTypeKeys = {
  "video": "editor.search.clipType.video",
  "audio": "editor.search.clipType.audio",
  "text": "editor.search.clipType.text",
  "shape": "editor.search.clipType.shape",
  "image": "editor.search.clipType.image"
} as const;

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { selectedItems, setPanelVisible } = useUIStore();
  const project = useProjectStore((state) => state.project);

  const selectedClipType = useMemo(() => {
    const clipItem = selectedItems.find(
      (item) =>
        item.type === "clip" ||
        item.type === "text-clip" ||
        item.type === "shape-clip",
    );
    if (!clipItem) return null;
    if (clipItem.type === "text-clip") return "text";
    if (clipItem.type === "shape-clip") return "shape";
    const track = project.timeline.tracks.find((candidate) =>
      candidate.clips.some((clip) => clip.id === clipItem.id),
    );
    if (track?.type === "audio") return "audio";
    const clip = track?.clips.find((candidate) => candidate.id === clipItem.id);
    const media = clip
      ? project.mediaLibrary.items.find((item) => item.id === clip.mediaId)
      : undefined;
    if (track?.type === "image" || media?.type === "image") return "image";
    return "video";
  }, [project.mediaLibrary.items, project.timeline.tracks, selectedItems]);

  const filteredEffects = useMemo(() => {
    let effects = SEARCHABLE_EFFECTS;

    if (selectedClipType) {
      effects = effects.filter((e) =>
        e.clipTypes.includes(
          selectedClipType as "video" | "audio" | "text" | "shape" | "image",
        ),
      );
    }

    if (selectedCategory !== "all") {
      effects = effects.filter((e) =>
        e.category === selectedCategory,
      );
    }

    if (query.trim()) {
      const searchTerms = query.toLowerCase().split(" ");
      effects = effects.filter((e) => {
        const searchText = [editorMessage(e.nameKey), editorMessage(e.descriptionKey), ...e.keywords, editorMessage(categoryKeys[e.category])]
          .join(" ")
          .toLowerCase();
        return searchTerms.every((term) => searchText.includes(term));
      });
    }

    return effects;
  }, [query, selectedCategory, selectedClipType]);

  const handleSelect = useCallback(
    (effect: SearchItem) => {
      setPanelVisible("inspector", true);

      setTimeout(() => {
        const sectionElement = document.querySelector(
          `[data-section-id="${effect.sectionId}"]`,
        );
        if (sectionElement) {
          sectionElement.scrollIntoView({ behavior: "smooth", block: "start" });

          const header = sectionElement.querySelector<HTMLElement>(
            '[data-slot="toolcraft-panel-section-header"]',
          );
          if (header?.getAttribute("aria-expanded") === "false") {
            header.click();
          }

          sectionElement.classList.add(
            "ring-2",
            "ring-primary",
            "ring-offset-2",
          );
          setTimeout(() => {
            sectionElement.classList.remove(
              "ring-2",
              "ring-primary",
              "ring-offset-2",
            );
          }, 2000);
        }
      }, 100);

      onClose();
    },
    [onClose, setPanelVisible],
  );

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, selectedCategory]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          Math.min(prev + 1, filteredEffects.length - 1),
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && filteredEffects[selectedIndex]) {
        e.preventDefault();
        handleSelect(filteredEffects[selectedIndex]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, filteredEffects, selectedIndex, handleSelect]);

  useEffect(() => {
    if (listRef.current && filteredEffects[selectedIndex]) {
      const selectedEl = listRef.current.children[selectedIndex] as HTMLElement;
      if (selectedEl) {
        selectedEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [selectedIndex, filteredEffects]);

  if (!isOpen) return null;

  return (
    <Dialog
      isOpen
      onOpenChange={(open) => !open && onClose()}
      width={672}
      purpose="form"
    >
      <Layout
        header={
          <DialogHeader
            title={editorMessage("editor.search.title")}
            subtitle={
              selectedClipType
                ? editorMessage("editor.search.selectedSubtitle", { type: editorMessage(clipTypeKeys[selectedClipType]) })
                : editorMessage("editor.search.subtitle")
            }
            onOpenChange={(open) => !open && onClose()}
            startContent={<Search size={18} className="text-primary" aria-hidden />}
          />
        }
        content={
          <LayoutContent>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <ToolcraftTextInputControl
                    ref={inputRef}
                    label={editorMessage("editor.search.inputLabel")}
                    isLabelHidden
                    type="text"
                    value={query}
                    onChange={setQuery}
                    placeholder={
                      selectedClipType
                        ? editorMessage("editor.search.selectedPlaceholder", { type: editorMessage(clipTypeKeys[selectedClipType]) })
                        : editorMessage("editor.search.placeholder")
                    }
                    startIcon={<Search size={16} aria-hidden />}
                    width="100%"
                    hasAutoFocus
                  />
                </div>
                {query && (
                  <IconButton
                    label={editorMessage("editor.search.clear")}
                    onClick={() => setQuery("")}
                    variant="ghost"
                    size="sm"
                    icon={<X size={14} aria-hidden />}
                  />
                )}
                <Kbd keys="escape" />
              </div>

              <ToolcraftSegmentedControl
                ariaLabel={editorMessage("editor.search.category")}
                value={selectedCategory}
                onChange={setSelectedCategory}
                options={CATEGORIES.map((cat) => {
                  const CategoryIcon = cat.icon;
                  return {
                    value: cat.id,
                    label: editorMessage(cat.nameKey),
                    icon: CategoryIcon ? (
                      <CategoryIcon size={14} aria-hidden />
                    ) : undefined,
                  };
                })}
              />

              <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
                {filteredEffects.length === 0 ? (
                  <EmptyState
                    title={editorMessage("editor.search.empty")}
                    description={editorMessage("editor.search.emptyHint")}
                    icon={<Search size={32} className="text-text-muted opacity-50" aria-hidden />}
                    isCompact
                  />
                ) : (
                  <div className="space-y-2 py-1">
                    {filteredEffects.map((effect, index) => {
                      const Icon = effect.icon;
                      const selected = index === selectedIndex;
                      return (
                        <ClickableCard
                          key={effect.id}
                          label={editorMessage("editor.search.openEffect", { name: editorMessage(effect.nameKey) })}
                          onClick={() => handleSelect(effect)}
                          padding={3}
                          variant={selected ? "green" : "default"}
                          className={`border ${
                            selected ? "border-primary" : "border-border"
                          }`}
                        >
                          <div className="flex items-center gap-4 text-left">
                            <div
                              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                                selected
                                  ? "bg-primary text-white"
                                  : "bg-background-tertiary text-text-secondary"
                              }`}
                            >
                              <Icon size={16} aria-hidden />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <Text
                                  type="label"
                                  weight="bold"
                                  color={selected ? "active" : "primary"}
                                  maxLines={1}
                                >
                                  {editorMessage(effect.nameKey)}
                                </Text>
                                <Card variant="muted" padding={1} className="shrink-0">
                                  <Text
                                    type="supporting"
                                    color="secondary"
                                    className="text-[10px]"
                                  >
                                    {editorMessage(categoryKeys[effect.category])}
                                  </Text>
                                </Card>
                              </div>
                              <Text
                                type="supporting"
                                color="secondary"
                                display="block"
                                maxLines={1}
                                className="mt-0.5"
                              >
                                {editorMessage(effect.descriptionKey)}
                              </Text>
                            </div>
                            <Kbd keys="enter" />
                          </div>
                        </ClickableCard>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <div className="flex items-center justify-between gap-3">
              <Text type="supporting" color="secondary" className="text-[10px]">
                {editorMessage(filteredEffects.length === 1 ? "editor.effects.availableOne" : "editor.effects.availableMany", { count: filteredEffects.length })}
              </Text>
              <div className="flex items-center gap-2">
                <Kbd keys="up" />
                <Kbd keys="down" />
                <Text type="supporting" color="secondary" className="text-[10px]">
                  {editorMessage("editor.search.navigate")}
                </Text>
                <Kbd keys="enter" />
                <Text type="supporting" color="secondary" className="text-[10px]">
                  {editorMessage("editor.search.select")}
                </Text>
              </div>
            </div>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
};

export default SearchModal;
