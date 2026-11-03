import { getAvailableAgentModelCatalog, settingsStore } from '../store/settingsStore';
import { getAgentReasoningDefault, getModelInfo, getModelModeConfig, getModelReasoningEffortParam } from '../domain/catalog/ModelCatalog';

// Harness owns a fixed set of selector IDs; values remain the catalog's wire spelling.
const effortIds: Record<string, string> = { none: 'off', off: 'off', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', ultra: 'max', max: 'max' };

/** Product catalog translation; official adapters own serialization and streaming. */
export function harnessModelConfig() {
  const providers: Record<string, { key: string; profile: {
    baseURL: string; api: string; displayName: string;
    models: Array<{ id: string; name: string; contextWindow?: number; maxTokens?: number; input: string[]; reasoningEfforts?: Record<string, string>; compat?: { supportsReasoningEffort: boolean } }>;
  } }> = {};
  let defaultModel: { provider: string; model: string; reasoningEffort?: string } | undefined;
  const models = getAvailableAgentModelCatalog().find(row => row.type === 'textGeneration')?.models ?? [];
  for (const model of models) {
    const mode = getModelModeConfig(model.id);
    const info = getModelInfo(model.id);
    if (!mode?.agent?.supportsTools || !info) continue;
    const transport = mode.agent.transport;
    // Explicit provider-default catalog contracts currently use Chat Completions.
    // Native Gemini has a different protocol and is not advertised as compatible.
    if (transport === 'provider-default' && model.provider === 'google') continue;
    const api = transport === 'openai-responses' ? 'openai-responses'
      : transport === 'anthropic-messages' ? 'anthropic-messages' : 'openai-completions';
    const config = settingsStore.providerConfigs[model.provider];
    if (!config?.apiKey) continue;
    const route = `shotloom-${model.provider}-${api}`;
    const entry = providers[route] ??= { key: config.apiKey, profile: { baseURL: config.baseUrl, api, displayName: model.provider, models: [] } };
    const id = info.upstreamModel || model.id;
    const param = getModelReasoningEffortParam(model.id);
    const reasoningEfforts = Object.fromEntries((param?.options ?? []).flatMap(option => {
      const wire = String(option);
      return effortIds[wire] ? [[effortIds[wire], wire]] : [];
    }));
    const hasReasoning = Object.keys(reasoningEfforts).some(level => level !== 'off');
    const defaultEffort = effortIds[getAgentReasoningDefault(model.id)];
    entry.profile.models.push({ id, name: model.name,
      ...(hasReasoning ? { reasoningEfforts,
        ...(api === 'openai-completions' ? { compat: { supportsReasoningEffort: true } } : {}),
      } : {}),
      ...(mode.inputConstraints.text?.maxTokens ? { contextWindow: mode.inputConstraints.text.maxTokens } : {}),
      ...(mode.outputConstraints?.maxTokens ? { maxTokens: mode.outputConstraints.maxTokens } : {}),
      input: ['text', ...(Number(mode.inputConstraints.images?.max || 0) > 0 ? ['image'] : [])] });
    if (!defaultModel || model.id === settingsStore.agentPreferredTextModel) defaultModel = { provider: route, model: id,
      ...(hasReasoning && defaultEffort ? { reasoningEffort: defaultEffort } : {}),
    };
  }
  return { providers, ...(defaultModel ? { defaultModel } : {}) };
}
