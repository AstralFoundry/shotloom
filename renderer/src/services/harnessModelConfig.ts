import { getAvailableAgentModelCatalog, settingsStore } from '../store/settingsStore';
import { getAgentReasoningDefault, getModelInfo, getModelModeConfig, getModelReasoningEffortParam } from '../domain/catalog/ModelCatalog';
import type { CatalogAgentProtocol } from '../domain/catalog/ModelCatalog';

// Harness owns a fixed set of selector IDs; values remain the catalog's wire spelling.
const effortIds: Record<string, string> = { none: 'off', off: 'off', minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', ultra: 'max', max: 'max' };

/** Product catalog translation; official adapters own serialization and streaming. */
export function harnessModelConfig() {
  const providers: Record<string, { key: string; profile: {
    baseURL: string; api: string; displayName: string;
    cacheRetention?: 'short' | 'long';
    models: Array<{ id: string; name: string; contextWindow?: number; maxTokens?: number; input: string[]; reasoningEfforts?: Record<string, string>; compat?: CatalogAgentProtocol['compat'] }>;
  } }> = {};
  let defaultModel: { provider: string; model: string; reasoningEffort?: string } | undefined;
  const models = getAvailableAgentModelCatalog().find(row => row.type === 'textGeneration')?.models ?? [];
  for (const model of models) {
    const mode = getModelModeConfig(model.id);
    const info = getModelInfo(model.id);
    if (!mode?.agent?.supportsTools || !info) continue;
    const transport = mode.agent.transport;
    // provider-default uses the plugin's declared OpenAI-compatible endpoint,
    // including Gemini's /openai prefix. Never infer a protocol from a vendor ID.
    const api = transport === 'openai-responses' ? 'openai-responses'
      : transport === 'anthropic-messages' ? 'anthropic-messages' : 'openai-completions';
    const config = settingsStore.providerConfigs[model.provider];
    if (!config?.apiKey) continue;
    const endpoint = mode.agent.endpoint ?? mode.endpoint;
    const suffix = api === 'openai-responses' ? '/responses' : api === 'anthropic-messages' ? '/v1/messages' : '/chat/completions';
    const apiPrefix = endpoint.path.endsWith(suffix) ? endpoint.path.slice(0, -suffix.length) : '';
    const connectionBase = endpoint.scope === 'origin' ? new URL(config.baseUrl).origin : config.baseUrl.replace(/\/+$/, '');
    const scopedBase = endpoint.scope === 'v1' && !connectionBase.toLowerCase().endsWith('/v1') ? `${connectionBase}/v1` : connectionBase;
    const baseURL = `${scopedBase}${apiPrefix}`;
    const route = `shotloom-${model.provider}-${api}`;
    const entry = providers[route] ??= { key: config.apiKey, profile: { baseURL, api, displayName: model.provider,
      ...(config.cacheRetention ? { cacheRetention: config.cacheRetention } : {}), models: [] } };
    const id = info.upstreamModel || model.id;
    const param = getModelReasoningEffortParam(model.id);
    const reasoningEfforts = Object.fromEntries((param?.options ?? []).flatMap(option => {
      const wire = String(option);
      return effortIds[wire] ? [[effortIds[wire], wire]] : [];
    }));
    const hasReasoning = Object.keys(reasoningEfforts).some(level => level !== 'off');
    const defaultEffort = effortIds[getAgentReasoningDefault(model.id)];
    entry.profile.models.push({ id, name: model.name,
      ...(hasReasoning ? { reasoningEfforts } : {}),
      compat: {
        // A generic Chat Completions endpoint need not accept OpenAI's 24h option.
        supportsLongCacheRetention: api !== 'openai-completions',
        ...(api === 'openai-completions' && hasReasoning ? { supportsReasoningEffort: true } : {}),
        ...mode.agent.compat,
      },
      ...(mode.inputConstraints.text?.maxTokens ? { contextWindow: mode.inputConstraints.text.maxTokens } : {}),
      ...(mode.outputConstraints?.maxTokens ? { maxTokens: mode.outputConstraints.maxTokens } : {}),
      input: ['text', ...(Number(mode.inputConstraints.images?.max || 0) > 0 ? ['image'] : [])] });
    if (!defaultModel || model.id === settingsStore.agentPreferredTextModel) defaultModel = { provider: route, model: id,
      ...(hasReasoning && defaultEffort ? { reasoningEffort: defaultEffort } : {}),
    };
  }
  return { providers, ...(defaultModel ? { defaultModel } : {}) };
}
