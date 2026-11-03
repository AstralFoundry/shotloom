import { t } from '@/i18n/index';
import { isRecord } from '@/utils/typeGuards';
import { isGenerationNodeType } from '@/domain/graph/NodeType';
import {
  supportedAgentActionTypes,
  validateAgentActionContract,
} from '@/services/agentActionContract';
import { CANVAS_ARTIFACT_TYPES, type AgentAction } from '@/services/agentTypes';
import { getGenerationInputModes, isModelForType } from '@/domain/catalog/ModelCatalog';

export interface AgentActionValidation {
  valid: boolean;
  error?: string;
  index?: number;
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function validateNodeRefList(action: AgentAction, key: keyof AgentAction): string {
  if (action[key] === undefined) return '';
  if (!Array.isArray(action[key])) return t('agent.validation.array', { value0: String(action.type), value1: String(key) });
  return '';
}

export function validateAgentActionShape(value: unknown): AgentActionValidation {
  if (!isRecord(value)) return { valid: false, error: t('agent.validation.object') };
  if (typeof value.type !== 'string' || !value.type.trim()) {
    return { valid: false, error: t('agent.validation.typeRequired') };
  }
  const action = value as AgentAction;
  if (!supportedAgentActionTypes.has(action.type)) {
    return { valid: false, error: t('agent.validation.unknown', { value0: String(action.type) }) };
  }
  const contractResult = validateAgentActionContract(action);
  if (!contractResult.valid) return contractResult;

  if (action.artifactType !== undefined
    && !CANVAS_ARTIFACT_TYPES.includes(action.artifactType)) {
    return { valid: false, error: t('agent.validation.artifactType', { value0: String(String(action.artifactType)) }) };
  }

  if (action.type === 'set_artifact_type'
    && (!hasValue(action.nodeId) || !hasValue(action.artifactType))) {
    return { valid: false, error: t('agent.validation.artifactFields') };
  }

  if (action.type === 'create_gen_node') {
    if (!isGenerationNodeType(action.nodeType)) {
      return { valid: false, error: t('agent.validation.nodeType', { value0: String(action.nodeType) }) };
    }
    if (action.config !== undefined && !isRecord(action.config)) return { valid: false, error: t('agent.validation.createConfig') };
    if (!hasValue(action.prompt)) {
      return { valid: false, error: t('agent.validation.createPrompt') };
    }
    if (hasValue(action.config?.prompt) || hasValue(action.config?.model)) {
      return { valid: false, error: t('agent.validation.createTopLevel') };
    }
    const model = String(action.model || '');
    if (model && !isModelForType(String(action.nodeType || ''), model)) {
      return { valid: false, error: t('agent.validation.createModel', { value0: String(model), value1: String(action.nodeType) }) };
    }
    if (action.inputMode && !getGenerationInputModes(model).some((item) => item.value === action.inputMode)) {
      return { valid: false, error: t('agent.validation.inputMode', { value0: String(action.inputMode), value1: String(model) }) };
    }
  }

  if (action.type === 'place_asset_on_canvas'
    && !hasValue(action.assetId) && !hasValue(action.materialId) && !hasValue(action.assetName)) {
    return { valid: false, error: t('agent.validation.assetFields') };
  }

  if (action.type === 'update_gen_config') {
    if (action.config !== undefined && !isRecord(action.config)) {
      return { valid: false, error: t('agent.validation.updateConfig') };
    }
    if (hasValue(action.config?.prompt) || hasValue(action.config?.model)) {
      return { valid: false, error: t('agent.validation.updateTopLevel') };
    }
    if (hasValue(action.model)) {
      const existingType = String(action.nodeType || '');
      if (existingType && !isModelForType(existingType, String(action.model))) {
        return { valid: false, error: t('agent.validation.updateModel', { value0: String(action.model), value1: String(existingType) }) };
      }
    }
  }

  if (action.type === 'create_gen_node') {
    const inputLinksError = validateNodeRefList(action, 'inputLinks');
    if (inputLinksError) return { valid: false, error: inputLinksError };
  }

  if (action.type === 'connect_nodes') {
    if (!hasValue(action.source) || !hasValue(action.target)) {
      return { valid: false, error: t('agent.validation.connectionFields', { value0: String(action.type) }) };
    }
  }

  if (action.type === 'delete_edge') {
    if (!hasValue(action.edgeId)
      && (!hasValue(action.source) || !hasValue(action.target))) {
      return { valid: false, error: t('agent.validation.deleteEdge') };
    }
  }

  if (action.type === 'toggle_edge') {
    if (!hasValue(action.edgeId)
      && (!hasValue(action.source) || !hasValue(action.target))) {
      return { valid: false, error: t('agent.validation.toggleEdge') };
    }
    if (action.enabled !== undefined && typeof action.enabled !== 'boolean') {
      return { valid: false, error: t('agent.validation.enabled') };
    }
  }

  if (action.type === 'move_node' && !action.position && action.x == null && action.y == null) {
    return { valid: false, error: t('agent.validation.position') };
  }

  return { valid: true };
}
