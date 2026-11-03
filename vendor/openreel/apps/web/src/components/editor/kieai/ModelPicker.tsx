import { editorMessage } from "../../../shotloom-mode";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ChevronRight } from "@/icons/lucide-compat";
import { IMAGE_MODELS, type ImageModelId } from "../../../services/kieai/image-generation";

const MODELS = [
  {
    id: IMAGE_MODELS.SEEDREAM,
    name: "Seedream 5 Lite",
    description: "editor.imageDialog.description.seedream",
    badge: "4K",
  },
  {
    id: IMAGE_MODELS.Z_IMAGE,
    name: "Z-Image",
    description: "editor.imageDialog.description.zimage",
    badge: "editor.imageDialog.badge.textImage",
  },
  {
    id: IMAGE_MODELS.NANO_BANANA2,
    name: "Nano Banana 2",
    description: "editor.imageDialog.description.nano",
    badge: "editor.imageDialog.badge.versatile",
  },
  {
    id: IMAGE_MODELS.FLUX2,
    name: "Flux 2 Pro",
    description: "editor.imageDialog.description.flux",
    badge: "editor.imageDialog.badge.pro",
  },
  {
    id: IMAGE_MODELS.GROK,
    name: "Grok Imagine",
    description: "editor.imageDialog.description.grok",
    badge: "editor.imageDialog.badge.style",
  },
  {
    id: IMAGE_MODELS.QWEN,
    name: "Qwen",
    description: "editor.imageDialog.description.qwen",
    badge: "editor.imageDialog.badge.control",
  },
] as const;

interface Props {
  onSelect: (model: ImageModelId) => void;
}

export function ModelPicker({ onSelect }: Props) {
  return (
    <div className="space-y-3">
      <Text type="supporting" color="secondary" className="text-xs text-text-muted">{editorMessage("editor.imageDialog.choose")}</Text>
      <div className="grid grid-cols-1 gap-2">
        {MODELS.map((m) => (
          <Button
            key={m.id}
            label={m.name}
            variant="ghost"
            size="lg"
            onClick={() => onSelect(m.id)}
            className="flex items-start gap-3 rounded-lg border border-border bg-background-elevated p-3 text-left hover:border-primary hover:bg-primary/5 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-primary">{m.name}</span>
                {m.badge && (
                  <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-primary/15 text-primary">
                    {m.badge === "4K" ? m.badge : editorMessage(m.badge)}
                  </span>
                )}
              </div>
              <Text type="supporting" color="secondary" className="mt-0.5 text-xs text-text-muted leading-relaxed">{editorMessage(m.description)}</Text>
            </div>
            <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-text-muted" />
          </Button>
        ))}
      </div>
    </div>
  );
}
