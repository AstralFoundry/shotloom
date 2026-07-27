import {
  supportedAgentActionTypes,
  validateAgentActionContract,
} from '@/services/agentActionContract';
import type { AgentAction, JsonObject } from '@/services/agentTypes';
import { isModelForType } from '@/domain/catalog/ModelCatalog';

export interface AgentActionValidation {
  valid: boolean;
  error?: string;
  index?: number;
}

const generationNodeTypes = new Set(['imageGeneration', 'videoGeneration', 'audioGeneration', 'textGeneration']);

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasValue(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function validateNodeRefList(action: AgentAction, key: keyof AgentAction): string {
  if (action[key] === undefined) return '';
  if (!Array.isArray(action[key])) return `${action.type}: ${key} must be an array`;
  return '';
}

export function validateAgentActionShape(value: unknown): AgentActionValidation {
  if (!isObject(value)) return { valid: false, error: 'action is not an object' };
  if (typeof value.type !== 'string' || !value.type.trim()) {
    return { valid: false, error: 'action.type is required' };
  }
  const action = value as AgentAction;
  if (!supportedAgentActionTypes.has(action.type)) {
    return { valid: false, error: `unknown action type: ${action.type}` };
  }
  const contractResult = validateAgentActionContract(action);
  if (!contractResult.valid) return contractResult;

  if (action.type === 'create_gen_node') {
    if (!generationNodeTypes.has(String(action.nodeType || ''))) {
      return { valid: false, error: `invalid gen nodeType: ${action.nodeType}` };
    }
    if (action.config !== undefined && !isObject(action.config)) return { valid: false, error: 'create_gen_node: config must be an object' };
    if (!hasValue(action.prompt)) {
      return { valid: false, error: 'create_gen_node requires non-empty top-level prompt' };
    }
    if (hasValue(action.config?.prompt) || hasValue(action.config?.model)) {
      return { valid: false, error: 'create_gen_node config must not contain prompt/model; use top-level fields' };
    }
    const model = String(action.model || '');
    if (model && !isModelForType(String(action.nodeType || ''), model)) {
      return { valid: false, error: `create_gen_node model ${model} is not an enabled ${action.nodeType} model in model-catalog-v2.json` };
    }
  }

  if (action.type === 'create_note_node' && !hasValue(action.content)) {
    return { valid: false, error: 'create_note_node requires non-empty content' };
  }

  if (action.type === 'place_asset_on_canvas'
    && !hasValue(action.assetId) && !hasValue(action.materialId) && !hasValue(action.assetName)) {
    return { valid: false, error: 'place_asset_on_canvas requires assetId, materialId, or assetName' };
  }

  if (action.type === 'update_gen_config') {
    if (action.config !== undefined && !isObject(action.config)) {
      return { valid: false, error: 'update_gen_config: config must be an object' };
    }
    if (hasValue(action.config?.prompt) || hasValue(action.config?.model)) {
      return { valid: false, error: 'update_gen_config config must not contain prompt/model; use top-level fields' };
    }
    if (hasValue(action.model)) {
      const existingType = String(action.nodeType || '');
      if (existingType && !isModelForType(existingType, String(action.model))) {
        return { valid: false, error: `update_gen_config model ${action.model} is not an enabled ${existingType} model` };
      }
    }
  }

  if (action.type === 'create_gen_node' || action.type === 'create_note_node') {
    const inputLinksError = validateNodeRefList(action, 'inputLinks');
    if (inputLinksError) return { valid: false, error: inputLinksError };
  }

  if (action.type === 'connect_nodes') {
    if (!hasValue(action.source) || !hasValue(action.target)) {
      return { valid: false, error: `${action.type} requires source and target` };
    }
  }

  if (action.type === 'delete_edge') {
    if (!hasValue(action.edgeId)
      && (!hasValue(action.source) || !hasValue(action.target))) {
      return { valid: false, error: 'delete_edge requires edgeId or source+target' };
    }
  }

  if (action.type === 'toggle_edge') {
    if (!hasValue(action.edgeId)
      && (!hasValue(action.source) || !hasValue(action.target))) {
      return { valid: false, error: 'toggle_edge requires edgeId or source+target' };
    }
    if (action.enabled !== undefined && typeof action.enabled !== 'boolean') {
      return { valid: false, error: 'toggle_edge: enabled must be a boolean' };
    }
  }

  if (action.type === 'move_node' && !action.position && action.x == null && action.y == null) {
    return { valid: false, error: 'move_node requires position or x/y' };
  }

  return { valid: true };
}

export function validateAgentActions(actions: unknown): AgentActionValidation {
  if (!Array.isArray(actions)) return { valid: false, error: 'actions must be an array' };
  if (actions.length === 0) return { valid: false, error: 'actions array must not be empty' };
  for (const [index, action] of (actions as unknown[]).entries()) {
    const result = validateAgentActionShape(action);
    if (!result.valid) {
      return {
        valid: false,
        error: `actions[${index}]: ${result.error}`,
        index,
      };
    }
  }
  return { valid: true };
}
