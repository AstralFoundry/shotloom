import { editorMessage } from "../../../shotloom-mode";
import { AI_PROVIDER_DEFAULTS, useAIConnectionStore, type AIProvider } from "../../../stores/ai-connection-store";

const inputClass = "mt-1.5 w-full rounded-md border border-border bg-bg-2 px-3 py-2 text-sm text-fg focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50";
export function AIConnectionPanel({ disabled = false }: { disabled?: boolean }) {
  const connection = useAIConnectionStore();
  return (
    <div className="space-y-4 text-xs">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-fg-2">{editorMessage("editor.aiSettings.provider")}
          <select aria-label={editorMessage("editor.aiSettings.providerLabel")} className={inputClass} disabled={disabled} value={connection.provider} onChange={(e) => { const provider = e.target.value as AIProvider; connection.configure({ provider, ...AI_PROVIDER_DEFAULTS[provider], apiKey: "" }); }}>
            <option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="compatible">{editorMessage("editor.aiSettings.compatible")}</option>
          </select>
        </label>
        <label className="block text-fg-2">{editorMessage("editor.aiSettings.modelId")}<input aria-label={editorMessage("editor.aiSettings.modelIdLabel")} className={inputClass} disabled={disabled} value={connection.model} onChange={(e) => connection.configure({ model: e.target.value })} spellCheck={false} /></label>
      </div>
        <label className="block text-fg-2">{editorMessage("editor.aiSettings.baseUrl")}<input aria-label={editorMessage("editor.aiSettings.baseUrlLabel")} className={inputClass} disabled={disabled} value={connection.baseUrl} onChange={(e) => connection.configure({ baseUrl: e.target.value })} spellCheck={false} /></label>
        <label className="block text-fg-2">{editorMessage("editor.aiSettings.sessionKey")}<input aria-label={editorMessage("editor.aiSettings.sessionKey")} type="password" autoComplete="off" className={inputClass} disabled={disabled} value={connection.apiKey} onChange={(e) => connection.configure({ apiKey: e.target.value })} /></label>
        {connection.apiKey && <button type="button" disabled={disabled} className="text-accent underline" onClick={connection.forgetKey}>{editorMessage("editor.aiSettings.forget")}</button>}
        <p className="text-[11px] leading-relaxed text-fg-muted">{editorMessage("editor.aiSettings.privacy")}</p>
    </div>
  );
}
