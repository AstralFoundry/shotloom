import { editorMessage } from "../../../../shotloom-mode";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import type { ZImageInput } from "../../../../services/kieai/image-generation";
import { aspectRatioOptions, ASPECT_RATIO_OPTIONS_BASIC } from "./shared";

interface Props {
  value: ZImageInput;
  onChange: (v: ZImageInput) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export function ZImageForm({ value, onChange, onSubmit, isLoading }: Props) {
  return (
    <div className="space-y-4">
      <Card variant="yellow" padding={2} className="border border-yellow-500/30">
        <Text type="supporting" className="text-xs text-yellow-400">
          {editorMessage("editor.imageForm.zImageHint")}
        </Text>
      </Card>

      <ToolcraftTextAreaControl
        label={editorMessage("editor.imageForm.prompt")}
        isRequired
        value={value.prompt}
        onChange={(prompt) => onChange({ ...value, prompt })}
        placeholder={editorMessage("editor.imageForm.promptPlaceholder")}
        maxLength={1000}
        rows={4}
        width="100%"
      />

      <Selector
        label={editorMessage("editor.imageForm.aspectRatio")}
        value={value.aspect_ratio}
        onChange={(aspect_ratio) =>
          onChange({ ...value, aspect_ratio: aspect_ratio as ZImageInput["aspect_ratio"] })
        }
        options={aspectRatioOptions(ASPECT_RATIO_OPTIONS_BASIC)}
        size="sm"
        width="100%"
      />

      <Button
        label={isLoading ? editorMessage("editor.imageForm.generating") : editorMessage("editor.imageForm.generate", { model: "Z-Image" })}
        onClick={onSubmit}
        isDisabled={isLoading || !value.prompt.trim()}
        variant="primary"
        className="w-full"
      />
    </div>
  );
}
