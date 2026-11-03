import { editorMessage } from "../../../shotloom-mode";
import { ToolcraftButton as Button, ToolcraftSwitchControl } from "@openreel/ui";
import { useChatStore } from "../../../stores/chat-store";
import { useSettingsStore } from "../../../stores/settings-store";
import { AIConnectionPanel } from "./AIConnectionPanel";

export function AISettingsPanel() {
  const status = useChatStore((state) => state.status);
  const busy = status === "running" || status === "awaiting_confirm";
  const autoConfirm = useSettingsStore((state) => state.agentAutoConfirm);
  const setAutoConfirm = useSettingsStore((state) => state.setAgentAutoConfirm);
  const dryRun = useSettingsStore((state) => state.agentDryRun);
  const setDryRun = useSettingsStore((state) => state.setAgentDryRun);
  const closeSettings = useSettingsStore((state) => state.closeSettings);

  return (
    <div className="space-y-5 pb-1">
      <div>
        <h3 className="text-sm font-medium text-fg">{editorMessage("editor.aiSettings.modelConnection")}</h3>
        <p className="mt-1 text-xs text-fg-muted">{editorMessage("editor.aiSettings.modelHelp")}</p>
      </div>
      {busy && <p role="status" className="text-xs text-fg-muted">{editorMessage("editor.aiSettings.busy")}</p>}
      <AIConnectionPanel disabled={busy} />
      <div className="space-y-3 border-t border-border pt-4">
        <ToolcraftSwitchControl
          label={editorMessage("editor.aiSettings.preview")}
          description={editorMessage("editor.aiSettings.previewHelp")}
          checked={dryRun}
          onCheckedChange={setDryRun}
          disabled={busy}
        />
        <ToolcraftSwitchControl
          label={editorMessage("editor.aiSettings.autoApprove")}
          description={editorMessage("editor.aiSettings.autoApproveHelp")}
          checked={autoConfirm}
          onCheckedChange={setAutoConfirm}
          disabled={busy}
        />
      </div>
      <div className="flex justify-end border-t border-border pt-4">
        <Button label={editorMessage("editor.aiSettings.done")} variant="primary" size="sm" onClick={closeSettings} />
      </div>
    </div>
  );
}
