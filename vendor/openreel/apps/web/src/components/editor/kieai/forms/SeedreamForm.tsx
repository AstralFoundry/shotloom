import { editorMessage } from "../../../../shotloom-mode";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import type { SeedreamInput } from "../../../../services/kieai/image-generation";
import { aspectRatioOptions, ASPECT_RATIO_OPTIONS } from "./shared";

interface Props {
  value: SeedreamInput;
  onChange: (v: SeedreamInput) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export function SeedreamForm({ value, onChange, onSubmit, isLoading }: Props) {
  return (
    <div className="space-y-4">
      <ToolcraftTextAreaControl
        label={editorMessage("editor.imageForm.prompt")}
        isRequired
        value={value.prompt}
        onChange={(prompt) => onChange({ ...value, prompt })}
        placeholder={editorMessage("editor.imageForm.promptPlaceholder")}
        maxLength={3000}
        rows={4}
        width="100%"
      />

      <div className="grid grid-cols-2 gap-3">
        <Selector
          label={editorMessage("editor.imageForm.aspectRatio")}
          value={value.aspect_ratio}
          onChange={(aspect_ratio) =>
            onChange({ ...value, aspect_ratio: aspect_ratio as SeedreamInput["aspect_ratio"] })
          }
          options={aspectRatioOptions(ASPECT_RATIO_OPTIONS)}
          size="sm"
          width="100%"
        />

        <Selector
          label={editorMessage("editor.imageForm.quality")}
          value={value.quality}
          onChange={(quality) =>
            onChange({ ...value, quality: quality as SeedreamInput["quality"] })
          }
          options={[
            { value: "basic", label: editorMessage("editor.imageForm.basicQuality") },
            { value: "high", label: editorMessage("editor.imageForm.highQuality") },
          ]}
          size="sm"
          width="100%"
        />
      </div>

      <Button
        label={isLoading ? editorMessage("editor.imageForm.generating") : editorMessage("editor.imageForm.generate", { model: "Seedream" })}
        onClick={onSubmit}
        isDisabled={isLoading || !value.prompt.trim()}
        variant="primary"
        className="w-full"
      />
    </div>
  );
}
