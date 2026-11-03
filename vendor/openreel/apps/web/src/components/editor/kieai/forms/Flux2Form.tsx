import { editorMessage } from "../../../../shotloom-mode";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import type { Flux2Input } from "../../../../services/kieai/image-generation";
import { aspectRatioOptions, ASPECT_RATIO_OPTIONS } from "./shared";

interface Props {
  value: Flux2Input;
  onChange: (v: Flux2Input) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export function Flux2Form({ value, onChange, onSubmit, isLoading }: Props) {
  return (
    <div className="space-y-4">
      <ToolcraftTextAreaControl
        label={editorMessage("editor.imageForm.prompt")}
        isRequired
        value={value.prompt}
        onChange={(prompt) => onChange({ ...value, prompt })}
        placeholder={editorMessage("editor.imageForm.promptPlaceholder")}
        maxLength={2000}
        rows={4}
        width="100%"
      />

      <div className="grid grid-cols-2 gap-3">
        <Selector
          label={editorMessage("editor.imageForm.aspectRatio")}
          value={value.aspect_ratio}
          onChange={(aspect_ratio) =>
            onChange({ ...value, aspect_ratio: aspect_ratio as Flux2Input["aspect_ratio"] })
          }
          options={aspectRatioOptions(ASPECT_RATIO_OPTIONS)}
          size="sm"
          width="100%"
        />

        <Selector
          label={editorMessage("editor.imageForm.resolution")}
          value={value.resolution}
          onChange={(resolution) =>
            onChange({ ...value, resolution: resolution as Flux2Input["resolution"] })
          }
          options={[
            { value: "1K", label: "1K" },
            { value: "2K", label: "2K" },
          ]}
          size="sm"
          width="100%"
        />
      </div>

      <Button
        label={isLoading ? editorMessage("editor.imageForm.generating") : editorMessage("editor.imageForm.generate", { model: "Flux 2" })}
        onClick={onSubmit}
        isDisabled={isLoading || !value.prompt.trim()}
        variant="primary"
        className="w-full"
      />
    </div>
  );
}
