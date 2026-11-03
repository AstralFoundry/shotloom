import { editorMessage } from "../../../../shotloom-mode";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextAreaControl } from "@openreel/ui";
import type { GrokInput } from "../../../../services/kieai/image-generation";

interface Props {
  value: GrokInput;
  onChange: (v: GrokInput) => void;
  onSubmit: () => void;
  isLoading: boolean;
}

export function GrokForm({ value, onChange, onSubmit, isLoading }: Props) {
  return (
    <div className="space-y-4">
      <Card variant="blue" padding={2} className="border border-blue-500/30">
        <Text type="supporting" className="text-xs text-blue-400">
          {editorMessage("editor.imageForm.grokHint")}
        </Text>
      </Card>

      <ToolcraftTextAreaControl
        label={editorMessage("editor.imageForm.optionalPrompt")}
        value={value.prompt ?? ""}
        onChange={(prompt) => onChange({ ...value, prompt: prompt || undefined })}
        placeholder={editorMessage("editor.imageForm.optionalPlaceholder")}
        maxLength={1000}
        rows={3}
        width="100%"
      />

      <Button
        label={isLoading ? editorMessage("editor.imageForm.generating") : editorMessage("editor.imageForm.generate", { model: "Grok Imagine" })}
        onClick={onSubmit}
        isDisabled={isLoading}
        variant="primary"
        className="w-full"
      />
    </div>
  );
}
