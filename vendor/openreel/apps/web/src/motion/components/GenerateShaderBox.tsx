import { editorMessage } from "../../shotloom-mode";
import type { JSX } from "react";
import { useState } from "react";
import { Sparkles } from "@/icons/lucide-compat";
import type { MotionShaderCategory, MotionShaderDef } from "@openreel/core";
import { ToolcraftText } from "@openreel/ui";
import { generateAiShader, type LlmMessage, type GenerateAiShaderResult } from "../../services/ai-shader";
import { makeBYOKClient } from "../../services/agent/llm-transport";
import { getSecret, isSessionUnlocked } from "../../services/secure-storage";
import { useProjectStore } from "../../stores/project-store";
import { useSettingsStore, type LlmProvider } from "../../stores/settings-store";
import { Button, Field, TextInput } from "./primitives";

interface GenerateShaderBoxProps {
  category: MotionShaderCategory;
  onGenerated: (def: MotionShaderDef) => void;
}

type Phase =
  | { readonly kind: "idle" }
  | { readonly kind: "generating" }
  | { readonly kind: "error"; readonly message: string };

function generationErrorMessage(result: Extract<GenerateAiShaderResult, { ok: false }>): string {
  switch (result.issue?.code) {
    case "empty-prompt": return editorMessage("editor.motion.shader.generate.emptyPrompt");
    case "invalid-json": return editorMessage("editor.motion.shader.generate.invalidJson", { schema: "{name, glsl, params}" });
    case "no-attempts": return editorMessage("editor.motion.shader.generate.noAttempts");
    case "empty": return editorMessage("editor.motion.shader.generate.empty");
    case "version": return editorMessage("editor.motion.shader.generate.version");
    case "output": return editorMessage("editor.motion.shader.generate.output");
    case "input": return editorMessage("editor.motion.shader.generate.input");
    case "progress": return editorMessage("editor.motion.shader.generate.progress");
    case "fill-input": return editorMessage("editor.motion.shader.generate.fillInput");
    case "compile": return editorMessage("editor.motion.shader.generate.compile", { detail: result.issue.detail });
    default: return result.error;
  }
}

function isDesktop(): boolean {
  return typeof window !== "undefined" && window.openreel?.platform === "desktop";
}

function resolveModel(): {
  provider: LlmProvider | null;
  model: string;
  baseUrl: string;
} {
  const settings = useSettingsStore.getState();
  return {
    provider: settings.defaultLlmProvider,
    model: settings.llmModel.trim(),
    baseUrl: settings.llmBaseUrl,
  };
}

async function resolveApiKey(provider: LlmProvider): Promise<string | null> {
  if (isDesktop()) return "";
  const optionalKey =
    !useSettingsStore.getState().configuredServices.includes(provider);
  if (optionalKey && !isSessionUnlocked()) return "";
  if (!isSessionUnlocked()) return null;
  try {
    const key = await getSecret(provider);
    return key ?? (optionalKey ? "" : null);
  } catch {
    return null;
  }
}

export function GenerateShaderBox({
  category,
  onGenerated,
}: GenerateShaderBoxProps): JSX.Element {
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const busy = phase.kind === "generating";

  const runGenerate = async (): Promise<void> => {
    const trimmed = prompt.trim();
    if (trimmed === "" || busy) return;

    setPhase({ kind: "generating" });

    const { provider, model, baseUrl } = resolveModel();
    if (!provider || !model || !baseUrl.trim()) {
      setPhase({ kind: "error", message: editorMessage("editor.motion.shader.generate.configure") });
      return;
    }
    const apiKey = await resolveApiKey(provider);
    if (apiKey === null) {
      setPhase({ kind: "error", message: editorMessage("editor.motion.shader.generate.configure") });
      return;
    }

    const client = makeBYOKClient({ provider, model, apiKey, baseUrl });
    const send = async (messages: readonly LlmMessage[]): Promise<string> => {
      const response = await client.complete({
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        tools: [],
      });
      return response.text;
    };

    let result;
    try {
      result = await generateAiShader(trimmed, category, { send, defaultName: editorMessage("editor.motion.shader.generate.defaultName") });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : editorMessage("editor.motion.shader.generate.failed");
      setPhase({ kind: "error", message });
      return;
    }

    if (!result.ok) {
      setPhase({ kind: "error", message: generationErrorMessage(result) });
      return;
    }

    const { def } = result;
    const dispatched = await useProjectStore.getState().executeAction({
      type: "project/registerGeneratedShader",
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      params: { def },
    });
    if (!dispatched.success) {
      setPhase({
        kind: "error",
        message: dispatched.error?.message ?? editorMessage("editor.motion.shader.generate.saveFailed"),
      });
      return;
    }

    setPrompt("");
    setPhase({ kind: "idle" });
    onGenerated(def);
  };

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-border bg-bg-2 p-3">
      <ToolcraftText
        as="span"
        type="label"
        color="primary"
        weight="semibold"
        className="flex items-center gap-1.5"
      >
        <Sparkles size={13} />
        {editorMessage("editor.motion.shader.generate.title")}
      </ToolcraftText>
      <Field label={editorMessage("editor.motion.shader.generate.prompt")}>
        <TextInput
          value={prompt}
          onChange={setPrompt}
          placeholder={editorMessage("editor.motion.shader.generate.placeholder")}
          disabled={busy}
        />
      </Field>
      <Button
        label={editorMessage("editor.motion.shader.generate.generate")}
        variant="solid"
        onClick={() => void runGenerate()}
        disabled={busy || prompt.trim() === ""}
      />
      {phase.kind === "generating" ? (
        <ToolcraftText type="supporting" color="secondary">
          {editorMessage("editor.motion.shader.generate.generating")}
        </ToolcraftText>
      ) : null}
      {phase.kind === "error" ? (
        <span data-shotloom-user-content="" className="block text-[11px] leading-relaxed text-status-error">
          {phase.message}
        </span>
      ) : null}
    </div>
  );
}
