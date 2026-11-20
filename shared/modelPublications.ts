import runninghubGatewayTemplates from './runninghubGatewayTemplates.json';
import { modelCatalogV2 } from '../renderer/src/config/model-catalog-v2/index';

export const modelTypes = ['textGeneration', 'imageGeneration', 'videoGeneration', 'audioGeneration'] as const;
export type ModelType = typeof modelTypes[number];
export type ModelPublication = {
  id: string;
  owned_by: string;
  supported_endpoint_types: string[];
  available: boolean;
  name: string;
  type: ModelType | null;
  template_id: string | null;
  sort_order: number;
  published: boolean;
  revision: number;
};
interface ExecutionTemplate {
  id: string; name: string; provider: string; type: string; enabled: boolean;
  defaultMode: string; sortOrder: number; upstreamModel?: string;
  modes: Array<{ endpoint: { method: string; path: string; scope: string }; requestTemplate?: unknown;
    agent?: { transport: string; endpoint?: { method: string; path: string; scope: string } } }>;
}

// Only templates whose model is a wire parameter and whose routes the gateway supports are reusable.
const gatewayPaths = new Set(['/chat/completions', '/responses', '/v1/messages', '/images/generations', '/images/edits', '/videos', '/audio/speech']);
const chatTemplate = {
  id: 'newapi-chat-completions', name: 'New API · Chat Completions', provider: 'openai',
  type: 'textGeneration', enabled: true, sortOrder: 0, defaultMode: 'text-generation',
  modes: [{ id: 'text-generation', label: 'Chat Completions',
    endpoint: { method: 'POST', path: '/chat/completions', scope: 'v1' },
    inputConstraints: {}, outputConstraints: { supportsStreaming: true }, params: [],
    agent: { transport: 'provider-default', supportsTools: true },
    requestTemplate: { model: '{{model}}', messages: '{{messages}}' }, resultTextPath: 'choices.0.message.content',
  }],
};
export const executionTemplates: ExecutionTemplate[] = [chatTemplate, ...runninghubGatewayTemplates, ...(modelCatalogV2.models as unknown as ExecutionTemplate[]).filter(model =>
  model.enabled !== false && model.provider !== 'runninghub' && model.modes.every(mode =>
    gatewayPaths.has(mode.endpoint.path) && (mode.requestTemplate as { model?: unknown })?.model === '{{model}}'))];

export function compilePublication(row: ModelPublication) {
  const template = executionTemplates.find(item => item.id === row.template_id);
  if (!row.published || !row.available || !template || template.type !== row.type) return null;
  return { ...structuredClone(template), id: row.id, upstreamModel: row.id,
    name: row.name || row.id, sortOrder: row.sort_order, enabled: true };
}
