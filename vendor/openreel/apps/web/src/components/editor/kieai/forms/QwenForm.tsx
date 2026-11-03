import { editorMessage } from "../../../../shotloom-mode";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftSelectControl as Selector } from "@openreel/ui";
import { ToolcraftSliderControl } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import type { QwenInput } from "../../../../services/kieai/image-generation";

interface Props {
  value: QwenInput;
  onChange: (v: QwenInput) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export function QwenForm({ value, onChange, onSubmit, isLoading }: Props) {
  const strength = value.strength ?? 0.8;

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

      <div className="space-y-1.5">
        <Text type="supporting" color="secondary" weight="bold" display="block">
          {editorMessage("editor.imageForm.strengthValue", { value: strength.toFixed(1) })}
          <Text type="supporting" color="secondary" className="ml-2">
            {editorMessage("editor.imageForm.strengthHint")}
          </Text>
        </Text>
        <ToolcraftSliderControl
          label={editorMessage("editor.imageForm.strength")}
          isLabelHidden
          min={0}
          max={1}
          step={0.05}
          value={strength}
          onChange={(nextStrength: number) =>
            onChange({ ...value, strength: nextStrength })
          }
          valueDisplay="none"
        />
        <div className="flex justify-between">
          <Text type="supporting" color="secondary" className="text-[10px]">
            {editorMessage("editor.imageForm.preserve")}
          </Text>
          <Text type="supporting" color="secondary" className="text-[10px]">
            {editorMessage("editor.imageForm.remake")}
          </Text>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Selector
          label={editorMessage("editor.imageForm.format")}
          value={value.output_format ?? "png"}
          onChange={(output_format) =>
            onChange({ ...value, output_format: output_format as QwenInput["output_format"] })
          }
          options={[
            { value: "png", label: "PNG" },
            { value: "jpeg", label: "JPEG" },
          ]}
          size="sm"
          width="100%"
        />

        <Selector
          label={editorMessage("editor.imageForm.acceleration")}
          value={value.acceleration ?? "regular"}
          onChange={(acceleration) =>
            onChange({ ...value, acceleration: acceleration as QwenInput["acceleration"] })
          }
          options={[
            { value: "none", label: editorMessage("editor.imageForm.accelerationNone") },
            { value: "regular", label: editorMessage("editor.imageForm.accelerationRegular") },
            { value: "high", label: editorMessage("editor.imageForm.accelerationHigh") },
          ]}
          size="sm"
          width="100%"
        />
      </div>

      <ToolcraftTextAreaControl
        label={editorMessage("editor.imageForm.negativePrompt")}
        value={value.negative_prompt ?? ""}
        onChange={(negative_prompt) =>
          onChange({ ...value, negative_prompt: negative_prompt || undefined })
        }
        placeholder={editorMessage("editor.imageForm.negativePlaceholder")}
        maxLength={500}
        rows={2}
        width="100%"
      />

      <Button
        label={isLoading ? editorMessage("editor.imageForm.generating") : editorMessage("editor.imageForm.generate", { model: "Qwen" })}
        onClick={onSubmit}
        isDisabled={isLoading || !value.prompt.trim()}
        variant="primary"
        className="w-full"
      />
    </div>
  );
}
